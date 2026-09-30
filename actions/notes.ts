"use server";

import { after } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import dbConnect from "@/lib/db";
import Note from "@/models/Note";
import Chat from "@/models/Chat";
import { MAX_FILES_PER_NOTE } from "@/lib/attachments";
import { serializeNote } from "@/lib/serialize";
import {
  collectBlobs,
  destroyBlobs,
  isCloudinaryDeliveryUrl,
  isOwnedCloudinaryId,
  storageKindFor,
  verifyGroupAttachments,
} from "@/lib/attachments.server";
import {
  MAX_FILE_BYTES,
  deleteObjects,
  getR2Config,
  headObject,
  isOwnedFileKey,
  sanitizeFileName,
} from "@/lib/r2";
import type { NoteItem, NoteType } from "@/lib/types";

const createNoteSchema = z.object({
  chatId: z.string().length(24).regex(/^[a-f0-9]+$/i),
  type: z.enum(["text", "code", "link", "image", "file"]),
  content: z.string().max(10000, "Content too long (max 10000 chars)"),
  imageUrl: z.string().max(2048).optional().default(""),
  publicId: z.string().max(256).optional().default(""),
  language: z.string().max(50).optional().default(""),

  storageKey: z.string().max(512).optional().default(""),
  fileName: z.string().max(255).optional().default(""),
  fileSize: z.number().int().nonnegative().optional().default(0),
  mimeType: z.string().max(255).optional().default(""),
});

const groupAttachmentSchema = z.object({
  kind: z.enum(["image", "file"]),
  imageUrl: z.string().max(2048).optional().default(""),
  publicId: z.string().max(256).optional().default(""),
  storageKey: z.string().max(512).optional().default(""),
  fileName: z.string().max(255).optional().default(""),
  fileSize: z.number().int().nonnegative().optional().default(0),
  mimeType: z.string().max(255).optional().default(""),
  caption: z
    .string()
    .max(1000, "Caption too long (max 1000 chars)")
    .optional()
    .default(""),
});

const createNoteGroupSchema = z.object({
  chatId: z.string().length(24).regex(/^[a-f0-9]+$/i),
  content: z.string().max(10000, "Content too long (max 10000 chars)"),
  attachments: z
    .array(groupAttachmentSchema)
    .min(1, "Attach at least one file")
    .max(MAX_FILES_PER_NOTE),
});

export type CreateNoteResult = {
  error?: string;
  note?: NoteItem;
  chatTitle?: string;
};

const NOTE_PROJECTION =
  "_id chatId type content imageUrl publicId language createdAt fileName fileSize mimeType attachments";

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

    const metadata = await headObject(config, storageKey);
    if (!metadata) {
      return { error: "Upload didn't complete — please try again" };
    }

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

    const chat = await Chat.findOneAndUpdate(
      { _id: chatId, userId: session.user.id },
      { updatedAt: new Date() },
      { new: false, select: "title" }
    ).lean();

    if (!chat) {
      return { error: "Chat not found" };
    }

    const doc = await Note.create({
      userId: session.user.id,
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

export async function createNoteGroup(
  input: z.input<typeof createNoteGroupSchema>
): Promise<CreateNoteResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "Unauthorized" };
  }

  const parsed = createNoteGroupSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { chatId, content, attachments } = parsed.data;

  const config = getR2Config();
  const needsR2 = attachments.some((a) => a.kind === "file");
  if (needsR2 && !config) {
    return { error: "File storage isn't configured" };
  }

  const verified = await verifyGroupAttachments(
    attachments,
    session.user.id,
    async (key) => (config ? headObject(config, key) : null),
    MAX_FILE_BYTES
  );

  if (!verified.ok) {
    if (config && verified.orphanKeys.length > 0) {
      const keys = verified.orphanKeys;
      after(async () => {
        await deleteObjects(config, keys);
      });
    }
    return { error: verified.error };
  }

  try {
    await dbConnect();

    const chat = await Chat.findOneAndUpdate(
      { _id: chatId, userId: session.user.id },
      { updatedAt: new Date() },
      { new: false, select: "title" }
    ).lean();

    if (!chat) {
      return { error: "Chat not found" };
    }

    const doc = await Note.create({
      userId: session.user.id,
      chatId,
      type: "group",
      content,
      imageUrl: "",
      publicId: "",
      storage: storageKindFor(verified.attachments),
      storageKey: "",
      fileName: "",
      fileSize: 0,
      mimeType: "",
      attachments: verified.attachments,
      language: "",
    });

    let chatTitle: string = chat.title;
    if (chatTitle === "New Chat") {
      chatTitle = deriveChatTitle(
        "group",
        content,
        verified.attachments[0]?.fileName ?? ""
      );
      if (chatTitle !== chat.title) {
        await Chat.updateOne(
          { _id: chatId, userId: session.user.id },
          { title: chatTitle }
        );
      }
    }

    return { note: serializeNote(doc.toObject()), chatTitle };
  } catch {
    return { error: "Failed to create note" };
  }
}

const updateAttachmentCaptionSchema = z.object({
  noteId: z.string().length(24).regex(/^[a-f0-9]+$/i),
  index: z.number().int().nonnegative(),
  caption: z.string().max(1000, "Caption too long (max 1000 chars)"),
});

export async function updateAttachmentCaption(
  input: z.infer<typeof updateAttachmentCaptionSchema>
): Promise<CreateNoteResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "Unauthorized" };
  }

  const parsed = updateAttachmentCaptionSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { noteId, index, caption } = parsed.data;

  try {
    await dbConnect();

    const updated = await Note.findOneAndUpdate(
      { _id: noteId, userId: session.user.id, type: "group" },
      { $set: { [`attachments.$.caption`]: caption.trim() } },
      {
        new: true,
        select: NOTE_PROJECTION,
        arrayFilters: [{ "att.index": index }],
      }
    ).lean();

    if (!updated) {
      return { error: "Note not found" };
    }

    return { note: serializeNote(updated) };
  } catch {
    return { error: "Failed to update caption" };
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

    const existing = await Note.findOne(
      { _id: noteId, userId: session.user.id },
      { type: 1 }
    ).lean();

    if (!existing) {
      return { error: "Note not found" };
    }

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

    const note = await Note.findOneAndDelete(
      { _id: noteId, userId: session.user.id },
      { select: "publicId storage storageKey attachments" }
    ).lean();

    if (!note) {
      return { error: "Note not found" };
    }

    const blobs = collectBlobs(note);
    if (blobs.objectKeys.length > 0 || blobs.publicIds.length > 0) {
      after(async () => {
        await destroyBlobs(blobs);
      });
    }

    return { ok: true };
  } catch {
    return { error: "Failed to delete note" };
  }
}

function deriveChatTitle(
  type: NoteType,
  content: string,
  fileName = ""
): string {
  const trimmed = content.trim();
  if (type === "image") return trimmed || "Image";
  if (type === "group") return trimmed || fileName || "Attachments";
  if (type === "file") return trimmed || fileName || "File";
  if (!trimmed) return "New Chat";
  return trimmed.length > 50 ? `${trimmed.slice(0, 47)}...` : trimmed;
}

function serializeDate(d: unknown): string {
  if (typeof d === "string") return d;
  return new Date(d as unknown as string).toISOString();
}
