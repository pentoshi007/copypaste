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
} from "@/lib/r2";
import type { NoteItem, NoteType } from "@/lib/types";

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

const createNoteSchema = z.object({
  chatId: z.string().length(24).regex(/^[a-f0-9]+$/i), // MongoDB ObjectId
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

export type CreateNoteResult = {
  error?: string;
  note?: NoteItem;
  chatTitle?: string;
};

// Fields needed when serializing a note for the client
// Fields needed when serializing a note back to the client.
// `storageKey` is intentionally excluded — the client downloads through
// /api/files/[noteId] and never needs the raw R2 key.
const NOTE_PROJECTION =
  "_id chatId type content imageUrl publicId language createdAt fileName fileSize mimeType";

export async function createNote(
  input: z.infer<typeof createNoteSchema>
): Promise<CreateNoteResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "Unauthorized" };
  }

  const parsed = createNoteSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { chatId, type, content, imageUrl, publicId, language } = parsed.data;
  let { fileName, fileSize, mimeType } = parsed.data;
  const { storageKey } = parsed.data;

  // Link type: validate URL scheme (http/https only — blocks javascript:/data:)
  if (type === "link") {
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

  // --- Attachment ownership checks ----------------------------------------
  // The browser uploads directly to Cloudinary/R2, so the identifiers it sends
  // back are untrusted input. Both branches below confirm the asset lives in
  // this user's namespace; without that, a user could claim someone else's
  // asset and then read or delete it through their own note.

  if (type === "image") {
    if (!imageUrl || !publicId) {
      return { error: "Image upload incomplete" };
    }
    if (!isOwnedCloudinaryId(publicId, session.user.id)) {
      return { error: "Invalid image reference" };
    }
    if (!isCloudinaryDeliveryUrl(imageUrl)) {
      return { error: "Invalid image URL" };
    }
  }

  if (type === "file") {
    const config = getR2Config();
    if (!config) {
      return { error: "File storage isn't configured" };
    }
    if (!isOwnedFileKey(storageKey, session.user.id)) {
      return { error: "Invalid file reference" };
    }

    // Confirm the object really exists and record its true size/type instead of
    // the client-reported values. This also stops a note being created that
    // points at an object that was never uploaded.
    const metadata = await headObject(config, storageKey);
    if (!metadata) {
      return { error: "Upload didn't complete — please try again" };
    }

    // The presigned PUT doesn't constrain body length, so the size declared at
    // presign time is advisory. This is the real check — and the oversized
    // object is removed rather than left behind eating the storage quota.
    if (metadata.size > MAX_FILE_BYTES) {
      after(async () => {
        await deleteObjects(config, [storageKey]);
      });
      return {
        error: `File is too large (max ${Math.floor(
          MAX_FILE_BYTES / (1024 * 1024)
        )}MB)`,
      };
    }

    fileSize = metadata.size;
    mimeType = metadata.contentType;
    fileName = sanitizeFileName(fileName || storageKey.split("/").pop() || "file");
  }

  try {
    await dbConnect();

    // CRITICAL: verify the chat belongs to this user (IDOR prevention).
    // One round trip does double duty here — it authorises the write *and*
    // bumps the chat's activity timestamp. `new: false` returns the document as
    // it was, so we can still tell whether it's an untitled ("New Chat") chat.
    const chat = await Chat.findOneAndUpdate(
      { _id: chatId, userId: session.user.id },
      { updatedAt: new Date() },
      { new: false, select: "title" }
    ).lean();

    if (!chat) {
      return { error: "Chat not found" };
    }

    const doc = await Note.create({
      userId: session.user.id, // scoped to authenticated user — never trust client userId
      chatId,
      type,
      content,
      imageUrl: type === "image" ? imageUrl : "",
      publicId: type === "image" ? publicId : "",
      storage: type === "file" ? "r2" : "cloudinary",
      storageKey: type === "file" ? storageKey : "",
      fileName: type === "file" ? fileName : "",
      fileSize: type === "file" ? fileSize : 0,
      mimeType: type === "file" ? mimeType : "",
      language,
    });

    // Auto-title from the first note. Only the first note in a chat pays for
    // this extra write; every later note is two round trips total.
    let chatTitle: string = chat.title;
    if (chatTitle === "New Chat") {
      chatTitle = deriveChatTitle(type, content, fileName);
      if (chatTitle !== chat.title) {
        await Chat.updateOne(
          { _id: chatId, userId: session.user.id },
          { title: chatTitle }
        );
      }
    }

    const note: NoteItem = {
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
    };

    return { note, chatTitle };
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
): Promise<CreateNoteResult> {
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
