"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import dbConnect from "@/lib/db";
import Note from "@/models/Note";
import Chat from "@/models/Chat";
import type { NoteItem, NoteType } from "@/lib/types";

const createNoteSchema = z.object({
  chatId: z.string().length(24).regex(/^[a-f0-9]+$/i), // MongoDB ObjectId
  type: z.enum(["text", "code", "link", "image"]),
  content: z.string().max(10000, "Content too long (max 10000 chars)"),
  imageUrl: z.string().max(2048).optional().default(""),
  publicId: z.string().max(256).optional().default(""),
  language: z.string().max(50).optional().default(""),
});

export type CreateNoteResult = {
  error?: string;
  note?: NoteItem;
  chatTitle?: string;
};

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

  // Image type: require imageUrl + publicId
  if (type === "image" && (!imageUrl || !publicId)) {
    return { error: "Image upload incomplete" };
  }

  try {
    await dbConnect();

    // CRITICAL: verify the chat belongs to this user (IDOR prevention)
    const chat = await Chat.findOne({ _id: chatId, userId: session.user.id });
    if (!chat) {
      return { error: "Chat not found" };
    }

    const doc = await Note.create({
      userId: session.user.id, // scoped to authenticated user — never trust client userId
      chatId,
      type,
      content,
      imageUrl,
      publicId,
      language,
    });

    // Auto-title the chat from the first note's content if it's still "New Chat"
    let chatTitle = chat.title;
    if (chat.title === "New Chat") {
      if (type === "image") {
        chatTitle = content.trim() || "Image";
      } else {
        const c = content.trim();
        chatTitle = c.length > 50 ? c.slice(0, 47) + "…" : c || "New Chat";
      }
      await Chat.updateOne(
        { _id: chatId, userId: session.user.id },
        { title: chatTitle, updatedAt: new Date() }
      );
    } else {
      await Chat.updateOne(
        { _id: chatId, userId: session.user.id },
        { updatedAt: new Date() }
      );
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
    };

    revalidatePath("/");
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

  // Link type: validate URL scheme (http/https only — blocks javascript:/data:)
  try {
    await dbConnect();

    // CRITICAL: scope by userId to prevent IDOR — never update by id alone
    const note = await Note.findOne({ _id: noteId, userId: session.user.id });
    if (!note) {
      return { error: "Note not found" };
    }

    // If it's a link, validate the URL
    if (note.type === "link") {
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

    note.content = content;
    if (note.type === "code" && language) {
      note.language = language;
    }
    await note.save();

    const updated: NoteItem = {
      _id: String(note._id),
      chatId: String(note.chatId),
      type: note.type as NoteType,
      content: note.content ?? "",
      imageUrl: note.imageUrl ?? "",
      publicId: note.publicId ?? "",
      language: note.language ?? "",
      createdAt: serializeDate(note.createdAt),
    };

    revalidatePath("/");
    return { note: updated };
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

    // CRITICAL: scope by userId to prevent IDOR — never delete by id alone
    const note = await Note.findOne({ _id: noteId, userId: session.user.id });
    if (!note) {
      return { error: "Note not found" };
    }

    // Best-effort Cloudinary cleanup for image notes
    if (note.publicId) {
      try {
        const cloudinary = (await import("cloudinary")).default;
        cloudinary.v2.uploader.destroy(note.publicId).catch(() => {});
      } catch {
        // non-fatal — Cloudinary env may not be configured in dev
      }
    }

    await Note.deleteOne({ _id: noteId, userId: session.user.id });
    revalidatePath("/");
    return { ok: true };
  } catch {
    return { error: "Failed to delete note" };
  }
}

function serializeDate(d: unknown): string {
  if (typeof d === "string") return d;
  return new Date(d as unknown as string).toISOString();
}
