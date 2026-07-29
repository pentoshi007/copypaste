"use server";

import { after } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import dbConnect from "@/lib/db";
import Note from "@/models/Note";
import Chat from "@/models/Chat";
import {
  MAX_FILE_BYTES,
  deleteObjects,
  getR2Config,
  headObject,
  isOwnedFileKey,
  sanitizeFileName,
  type ObjectMetadata,
} from "@/lib/r2";
import type { NoteItem, NoteType } from "@/lib/types";

/** The subset of a saved note document these actions read back. */
type NoteDocLike = {
  _id: unknown;
  chatId: unknown;
  type?: string | null;
  content?: string | null;
  imageUrl?: string | null;
  publicId?: string | null;
  language?: string | null;
  createdAt?: unknown;
  fileName?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
};

/*
 * These actions deliberately do NOT call `revalidatePath("/")`.
 *
 * The page is `force-dynamic`, so there is no cached render to invalidate —
 * revalidating just forced the client to re-request a full RSC payload, which
 * re-ran auth, the DB connect and both list queries after *every* note. The
 * client already has everything it needs: each action returns the created or
 * updated entity and AppShell merges it into local state, so the round-trip
 * was pure latency.
 */

const chatIdSchema = z.string().length(24).regex(/^[a-f0-9]+$/i); // ObjectId

const noteInputSchema = z.object({
  type: z.enum(["text", "code", "link", "image", "file"]),
  content: z.string().max(10000, "Content too long (max 10000 chars)"),
  imageUrl: z.string().max(2048).optional().default(""),
  publicId: z.string().max(256).optional().default(""),
  language: z.string().max(50).optional().default(""),
  // File attachments. `storageKey` is verified against the caller's namespace
  // below; fileSize/mimeType are re-read from R2 rather than trusted.
  storageKey: z.string().max(512).optional().default(""),
  fileName: z.string().max(255).optional().default(""),
  fileSize: z.number().int().nonnegative().optional().default(0),
  mimeType: z.string().max(255).optional().default(""),
});

/** Notes accepted in one send. Mirrors MAX_BATCH_FILES in lib/upload.ts. */
const MAX_BATCH_NOTES = 20;

const createNotesSchema = z.object({
  chatId: chatIdSchema,
  notes: z.array(noteInputSchema).min(1).max(MAX_BATCH_NOTES),
});

export type NoteActionResult = {
  error?: string;
  note?: NoteItem;
  chatTitle?: string;
};

/**
 * One entry per submitted note, in the order they were submitted.
 *
 * Per-item rather than all-or-nothing: in a mixed batch one attachment can fail
 * its ownership or size check while the rest are perfectly valid, and throwing
 * the whole send away because of it would mean re-uploading everything.
 */
export type CreateNotesResult = {
  /** Set only when the whole request failed (auth, bad shape, unknown chat). */
  error?: string;
  results?: Array<{ note?: NoteItem; error?: string }>;
  chatTitle?: string;
};

// Fields needed when serializing a note for the client
// Fields needed when serializing a note back to the client.
// `storageKey` is intentionally excluded — the client downloads through
// /api/files/[noteId] and never needs the raw R2 key.
const NOTE_PROJECTION =
  "_id chatId type content imageUrl publicId language createdAt fileName fileSize mimeType";

/** Link content must be an http/https URL — blocks javascript:/data:. */
function validateLinkContent(content: string): string | null {
  const urlCheck = z
    .string()
    .url()
    .refine((u) => {
      try {
        const parsedUrl = new URL(u);
        return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
      } catch {
        return false;
      }
    }, "Only http/https URLs are allowed")
    .safeParse(content);

  return urlCheck.success ? null : "Please enter a valid http/https URL";
}

/**
 * Creates one or more notes in a single chat.
 *
 * Sending several attachments at once used to mean one server action per file,
 * and each of those paid for its own auth, database connect and chat lookup.
 * Batching collapses that into a fixed cost: one auth, one chat lookup that
 * doubles as the ownership check, all the R2 metadata reads in parallel, and one
 * `insertMany`. Sending ten files is now barely slower than sending one.
 */
export async function createNotes(
  input: z.infer<typeof createNotesSchema>
): Promise<CreateNotesResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "Unauthorized" };
  }
  const userId = session.user.id;

  const parsed = createNotesSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { chatId, notes: items } = parsed.data;

  // Per-item outcome, filled in as each check runs. `null` means "still valid".
  const itemErrors: (string | null)[] = items.map(() => null);
  // Real size/type read back from R2, for file items only.
  const fileMeta: (ObjectMetadata | null)[] = items.map(() => null);

  const config = items.some((it) => it.type === "file") ? getR2Config() : null;

  // --- Checks that need no I/O ---------------------------------------------
  // The browser uploads directly to Cloudinary/R2, so the identifiers it sends
  // back are untrusted input. These branches confirm each asset lives in this
  // user's namespace; without that, a user could claim someone else's asset and
  // then read or delete it through their own note.
  items.forEach((item, i) => {
    if (item.type === "link") {
      itemErrors[i] = validateLinkContent(item.content);
      return;
    }

    if (item.type === "image") {
      if (!item.imageUrl || !item.publicId) {
        itemErrors[i] = "Image upload incomplete";
      } else if (!isOwnedCloudinaryId(item.publicId, userId)) {
        itemErrors[i] = "Invalid image reference";
      } else if (!isCloudinaryDeliveryUrl(item.imageUrl)) {
        itemErrors[i] = "Invalid image URL";
      }
      return;
    }

    if (item.type === "file") {
      if (!config) {
        itemErrors[i] = "File storage isn't configured";
      } else if (!isOwnedFileKey(item.storageKey, userId)) {
        itemErrors[i] = "Invalid file reference";
      }
    }
  });

  try {
    await dbConnect();

    // CRITICAL: verify the chat belongs to this user (IDOR prevention).
    // One round trip does double duty here — it authorises the write *and*
    // bumps the chat's activity timestamp. `new: false` returns the document as
    // it was, so we can still tell whether it's an untitled ("New Chat") chat.
    // `updatedAt` is selected too so the bump can be undone if it turns out
    // nothing in the batch was actually saveable.
    const chatPromise = Chat.findOneAndUpdate(
      { _id: chatId, userId },
      { updatedAt: new Date() },
      { new: false, select: "title updatedAt" }
    ).lean();

    // Confirm each object really exists and record its true size/type instead of
    // the client-reported values. This also stops a note being created that
    // points at an object that was never uploaded.
    //
    // All of these run concurrently, and alongside the chat lookup, so a
    // twenty-file batch costs one HEAD round trip's worth of latency rather
    // than twenty.
    await Promise.all(
      items.map(async (item, i) => {
        if (itemErrors[i] || item.type !== "file" || !config) return;
        fileMeta[i] = await headObject(config, item.storageKey);
        if (!fileMeta[i]) {
          itemErrors[i] = "Upload didn't complete — please try again";
        }
      })
    );

    const chat = await chatPromise;

    // Objects with no note to point at them would sit in the bucket forever.
    const orphanedKeys: string[] = [];

    if (!chat) {
      for (const [i, item] of items.entries()) {
        if (item.type === "file" && fileMeta[i]) orphanedKeys.push(item.storageKey);
      }
      if (orphanedKeys.length > 0 && config) {
        after(async () => {
          await deleteObjects(config, orphanedKeys);
        });
      }
      return { error: "Chat not found" };
    }

    // The presigned PUT doesn't constrain body length, so the size declared at
    // presign time is advisory. This is the real check — and the oversized
    // object is removed rather than left behind eating the storage quota.
    items.forEach((item, i) => {
      const meta = fileMeta[i];
      if (itemErrors[i] || item.type !== "file" || !meta) return;
      if (meta.size > MAX_FILE_BYTES) {
        orphanedKeys.push(item.storageKey);
        itemErrors[i] = `File is too large (max ${Math.floor(
          MAX_FILE_BYTES / (1024 * 1024)
        )}MB)`;
      }
    });

    if (orphanedKeys.length > 0 && config) {
      after(async () => {
        await deleteObjects(config, orphanedKeys);
      });
    }

    // --- Build the documents ------------------------------------------------
    // createdAt is assigned explicitly and staggered by a millisecond per note.
    // Left to the schema default they would all share one timestamp, and since
    // notes are read back sorted by createdAt, a batch would come back in an
    // arbitrary order the next time the chat loaded.
    const now = Date.now();
    const accepted: number[] = [];
    const docs = items.flatMap((item, i) => {
      if (itemErrors[i]) return [];

      const isFile = item.type === "file";
      const meta = fileMeta[i];
      const fileName = isFile
        ? sanitizeFileName(
            item.fileName || item.storageKey.split("/").pop() || "file"
          )
        : "";

      accepted.push(i);
      return [
        {
          userId, // scoped to authenticated user — never trust a client userId
          chatId,
          type: item.type,
          content: item.content,
          imageUrl: item.type === "image" ? item.imageUrl : "",
          publicId: item.type === "image" ? item.publicId : "",
          storage: isFile ? "r2" : "cloudinary",
          storageKey: isFile ? item.storageKey : "",
          fileName,
          fileSize: isFile ? meta?.size ?? 0 : 0,
          mimeType: isFile ? meta?.contentType ?? "" : "",
          language: item.language,
          createdAt: new Date(now + accepted.length - 1),
        },
      ];
    });

    const results: Array<{ note?: NoteItem; error?: string }> = items.map(
      (_, i) => ({ error: itemErrors[i] ?? "Couldn't save note" })
    );

    if (docs.length === 0) {
      // The lookup above already bumped the chat's activity timestamp as a side
      // effect of authorising the write. Nothing was written, so put it back —
      // otherwise a batch that failed outright still jumps the chat to the top
      // of the sidebar on the next load.
      const previous = chat.updatedAt;
      after(async () => {
        try {
          await Chat.updateOne({ _id: chatId, userId }, { updatedAt: previous });
        } catch {
          // Cosmetic ordering only — never worth surfacing.
        }
      });
      return { results, chatTitle: chat.title };
    }

    // `ordered: true` keeps the returned documents aligned with `docs`, so each
    // saved note can be matched back to the item the client sent.
    let created: NoteDocLike[];
    try {
      created = (await Note.insertMany(docs, {
        ordered: true,
      })) as unknown as NoteDocLike[];
    } catch {
      // With `ordered: true` the documents before the failure are committed and
      // stay committed, so we can't assume the whole batch is gone. Work out
      // which objects genuinely have no note pointing at them and drop only
      // those — deleting an object whose note *did* land would leave the user
      // with a broken attachment, which is worse than an orphan.
      const submittedKeys = accepted
        .map((i) => items[i])
        .filter((item) => item.type === "file")
        .map((item) => item.storageKey);

      if (submittedKeys.length > 0 && config) {
        after(async () => {
          try {
            const surviving = await Note.find(
              { userId, storageKey: { $in: submittedKeys } },
              { storageKey: 1 }
            ).lean();
            const kept = new Set(
              surviving.map((n: { storageKey?: string | null }) => n.storageKey)
            );
            const dead = submittedKeys.filter((key) => !kept.has(key));
            if (dead.length > 0) await deleteObjects(config, dead);
          } catch {
            // Best effort — an orphan is recoverable, a wrong delete isn't.
          }
        });
      }
      return { error: "Failed to save notes" };
    }

    created.forEach((doc, position) => {
      const index = accepted[position];
      results[index] = {
        note: {
          _id: String(doc._id),
          chatId: String(doc.chatId),
          type: doc.type as NoteType,
          content: doc.content ?? "",
          imageUrl: doc.imageUrl ?? "",
          publicId: doc.publicId ?? "",
          language: doc.language ?? "",
          createdAt: serializeDate(doc.createdAt),
          fileName: doc.fileName ?? "",
          fileSize: doc.fileSize ?? 0,
          mimeType: doc.mimeType ?? "",
        },
      };
    });

    // Auto-title from the first note that landed. Only the first note in a chat
    // pays for this extra write.
    //
    // Best-effort on purpose: the notes are already committed by this point, and
    // failing the whole request over a title would make the client roll back a
    // batch that is safely in the database.
    let chatTitle: string = chat.title;
    if (chatTitle === "New Chat") {
      const first = docs[0];
      const derived = deriveChatTitle(
        first.type as NoteType,
        first.content,
        first.fileName
      );
      if (derived !== chat.title) {
        try {
          await Chat.updateOne({ _id: chatId, userId }, { title: derived });
          chatTitle = derived;
        } catch {
          // Keep the old title; the notes themselves are fine.
        }
      }
    }

    return { results, chatTitle };
  } catch {
    return { error: "Failed to create note" };
  }
}


const updateNoteSchema = z.object({
  noteId: z.string().length(24).regex(/^[a-f0-9]+$/i),
  content: z.string().max(10000, "Content too long (max 10000 chars)"),
  language: z.string().max(50).optional().default(""),
});

export async function updateNote(
  input: z.infer<typeof updateNoteSchema>
): Promise<NoteActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "Unauthorized" };
  }

  const parsed = updateNoteSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { noteId, content, language } = parsed.data;

  try {
    await dbConnect();

    // CRITICAL: scope by userId to prevent IDOR — never update by id alone
    // Use findOne to check type for link validation (lean, minimal fields)
    const existing = await Note.findOne(
      { _id: noteId, userId: session.user.id },
      { type: 1 }
    ).lean();

    if (!existing) {
      return { error: "Note not found" };
    }

    // If it's a link, validate the URL
    if (existing.type === "link") {
      const urlCheck = z
        .string()
        .url()
        .refine((u) => {
          try {
            const parsedUrl = new URL(u);
            return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
          } catch {
            return false;
          }
        }, "Only http/https URLs are allowed")
        .safeParse(content);

      if (!urlCheck.success) {
        return { error: "Please enter a valid http/https URL" };
      }
    }

    // Single atomic update — no need to fetch, modify, then save
    const updated = await Note.findOneAndUpdate(
      { _id: noteId, userId: session.user.id },
      {
        content,
        language: existing.type === "code" ? language : undefined,
      },
      { new: true, select: NOTE_PROJECTION }
    ).lean();

    if (!updated) {
      return { error: "Note not found" };
    }

    const note: NoteItem = {
      _id: String(updated._id),
      chatId: String(updated.chatId),
      type: updated.type as NoteType,
      content: updated.content ?? "",
      imageUrl: updated.imageUrl ?? "",
      publicId: updated.publicId ?? "",
      language: updated.language ?? "",
      createdAt: serializeDate(updated.createdAt),
      fileName: updated.fileName ?? "",
      fileSize: updated.fileSize ?? 0,
      mimeType: updated.mimeType ?? "",
    };

    return { note };
  } catch {
    return { error: "Failed to update note" };
  }
}

export async function deleteNote(
  noteId: string
): Promise<{ error?: string; ok?: boolean }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "Unauthorized" };
  }

  // Validate noteId format
  const idCheck = z
    .string()
    .length(24)
    .regex(/^[a-f0-9]+$/i)
    .safeParse(noteId);
  if (!idCheck.success) {
    return { error: "Invalid note ID" };
  }

  try {
    await dbConnect();

    // CRITICAL: scope by userId to prevent IDOR — use findOneAndDelete
    // to collapse fetch + delete into a single atomic operation
    const note = await Note.findOneAndDelete(
      { _id: noteId, userId: session.user.id },
      { select: "publicId storage storageKey" }
    ).lean();

    if (!note) {
      return { error: "Note not found" };
    }

    // Blob cleanup runs after the response is flushed. A bare fire-and-forget
    // promise can be killed when the serverless invocation ends; `after()` keeps
    // the function alive just long enough.
    if (note.storage === "r2" && note.storageKey) {
      const key = note.storageKey;
      after(async () => {
        const config = getR2Config();
        if (config) await deleteObjects(config, [key]);
      });
    } else if (note.publicId) {
      const publicId = note.publicId;
      after(async () => {
        try {
          const cloudinary = (await import("cloudinary")).default;
          await cloudinary.v2.uploader.destroy(publicId).catch(() => {});
        } catch {
          // non-fatal — Cloudinary env may not be configured in dev
        }
      });
    }

    return { ok: true };
  } catch {
    return { error: "Failed to delete note" };
  }
}

/**
 * Whether a Cloudinary public_id sits in this user's namespace.
 *
 * /api/upload-sign always generates ids as `u/<userId>/<random>`, so anything
 * outside that prefix wasn't issued to this caller. This is what prevents a user
 * from deleting (or claiming) another user's image by submitting its public_id.
 */
function isOwnedCloudinaryId(publicId: string, userId: string): boolean {
  if (!publicId || publicId.includes("..")) return false;
  return publicId.startsWith(`u/${userId}/`);
}

/** Only accept Cloudinary's own delivery host, over TLS. */
function isCloudinaryDeliveryUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" && parsed.hostname === "res.cloudinary.com"
    );
  } catch {
    return false;
  }
}

/** Names a brand-new chat after its first note. */
function deriveChatTitle(
  type: NoteType,
  content: string,
  fileName = ""
): string {
  const trimmed = content.trim();
  if (type === "image") return trimmed || "Image";
  if (type === "file") return trimmed || fileName || "File";
  if (!trimmed) return "New Chat";
  return trimmed.length > 50 ? `${trimmed.slice(0, 47)}...` : trimmed;
}

function serializeDate(d: unknown): string {
  if (typeof d === "string") return d;
  return new Date(d as unknown as string).toISOString();
}
