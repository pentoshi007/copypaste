"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import dbConnect from "@/lib/db";
import Chat from "@/models/Chat";
import Note from "@/models/Note";
import type { ChatItem } from "@/lib/types";

const titleSchema = z
  .string()
  .min(1, "Title cannot be empty")
  .max(100, "Title too long (max 100 chars)")
  .trim();

const idSchema = z.string().length(24).regex(/^[a-f0-9]+$/i);

export type ChatActionResult = {
  error?: string;
  chat?: ChatItem;
  ok?: boolean;
};

export async function createChat(title?: string): Promise<ChatActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "Unauthorized" };
  }

  try {
    await dbConnect();
    const doc = await Chat.create({
      userId: session.user.id,
      title: title ? (titleSchema.safeParse(title).success ? title : "New Chat") : "New Chat",
    });

    const chat: ChatItem = {
      _id: String(doc._id),
      title: doc.title,
      createdAt: serializeDate(doc.createdAt),
      updatedAt: serializeDate(doc.updatedAt),
    };

    revalidatePath("/");
    return { chat };
  } catch {
    return { error: "Failed to create chat" };
  }
}

export async function updateChatTitle(
  chatId: string,
  title: string
): Promise<ChatActionResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "Unauthorized" };
  }

  const idCheck = idSchema.safeParse(chatId);
  if (!idCheck.success) {
    return { error: "Invalid chat ID" };
  }

  const titleCheck = titleSchema.safeParse(title);
  if (!titleCheck.success) {
    return { error: titleCheck.error.issues[0]?.message ?? "Invalid title" };
  }

  try {
    await dbConnect();

    // CRITICAL: scope by userId to prevent IDOR
    const doc = await Chat.findOneAndUpdate(
      { _id: chatId, userId: session.user.id },
      { title: titleCheck.data, updatedAt: new Date() },
      { new: true }
    );

    if (!doc) {
      return { error: "Chat not found" };
    }

    const chat: ChatItem = {
      _id: String(doc._id),
      title: doc.title,
      createdAt: serializeDate(doc.createdAt),
      updatedAt: serializeDate(doc.updatedAt),
    };

    revalidatePath("/");
    return { chat };
  } catch {
    return { error: "Failed to update chat" };
  }
}

export async function deleteChat(
  chatId: string
): Promise<{ error?: string; ok?: boolean }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "Unauthorized" };
  }

  const idCheck = idSchema.safeParse(chatId);
  if (!idCheck.success) {
    return { error: "Invalid chat ID" };
  }

  try {
    await dbConnect();

    // CRITICAL: scope by userId to prevent IDOR — never delete by id alone
    const chat = await Chat.findOne({ _id: chatId, userId: session.user.id });
    if (!chat) {
      return { error: "Chat not found" };
    }

    // Find all notes in this chat (for Cloudinary cleanup)
    const notes = await Note.find({ chatId, userId: session.user.id })
      .select("publicId")
      .lean();

    // Best-effort Cloudinary cleanup for image notes
    for (const note of notes) {
      if (note.publicId) {
        try {
          const cloudinary = (await import("cloudinary")).default;
          await cloudinary.v2.uploader.destroy(note.publicId).catch(() => {});
        } catch {
          // non-fatal
        }
      }
    }

    // Delete all notes in this chat
    await Note.deleteMany({ chatId, userId: session.user.id });
    // Delete the chat itself
    await Chat.deleteOne({ _id: chatId, userId: session.user.id });

    revalidatePath("/");
    return { ok: true };
  } catch {
    return { error: "Failed to delete chat" };
  }
}

function serializeDate(d: unknown): string {
  if (typeof d === "string") return d;
  return new Date(d as unknown as string).toISOString();
}
