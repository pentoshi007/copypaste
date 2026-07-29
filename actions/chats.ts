"use server";

import { after } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import dbConnect from "@/lib/db";
import Chat from "@/models/Chat";
import Note from "@/models/Note";
import { deleteObjects, getR2Config } from "@/lib/r2";
import type { ChatItem } from "@/lib/types";

// No `revalidatePath("/")` here — see the note in actions/notes.ts. The client
// updates its own state from the returned chat, so invalidating the (dynamic)
// page only added a wasted server round-trip per action.

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
    // Atomic update — no need to fetch first
    const doc = await Chat.findOneAndUpdate(
      { _id: chatId, userId: session.user.id },
      { title: titleCheck.data, updatedAt: new Date() },
      { new: true, select: "_id title createdAt updatedAt" }
    ).lean();

    if (!doc) {
      return { error: "Chat not found" };
    }

    const chat: ChatItem = {
      _id: String(doc._id),
      title: doc.title,
      createdAt: serializeDate(doc.createdAt),
      updatedAt: serializeDate(doc.updatedAt),
    };

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

    // CRITICAL: scope by userId to prevent IDOR — use findOneAndDelete
    const chat = await Chat.findOneAndDelete(
      { _id: chatId, userId: session.user.id },
      { select: "_id" }
    ).lean();

    if (!chat) {
      return { error: "Chat not found" };
    }

    // Collect attachment identifiers before the notes are gone.
    const attachments = await Note.find(
      {
        chatId,
        userId: session.user.id,
        $or: [{ publicId: { $ne: "" } }, { storageKey: { $ne: "" } }],
      },
      { publicId: 1, storage: 1, storageKey: 1 }
    ).lean();

    const publicIds: string[] = [];
    const objectKeys: string[] = [];
    for (const note of attachments) {
      if (note.storage === "r2" && note.storageKey) {
        objectKeys.push(note.storageKey);
      } else if (note.publicId) {
        publicIds.push(note.publicId);
      }
    }

    // Delete the notes — this is what the user is waiting on.
    await Note.deleteMany({ chatId, userId: session.user.id });

    // Blob cleanup runs *after* the response is flushed, so deleting a chat full
    // of attachments no longer blocks the UI on N remote API calls.
    if (publicIds.length > 0 || objectKeys.length > 0) {
      after(async () => {
        if (objectKeys.length > 0) {
          const config = getR2Config();
          // DeleteObject is free on R2, so batching buys nothing but complexity.
          if (config) await deleteObjects(config, objectKeys);
        }

        if (publicIds.length > 0) {
          try {
            const cloudinary = (await import("cloudinary")).default;
            // delete_resources handles up to 100 ids per request.
            for (let i = 0; i < publicIds.length; i += 100) {
              await cloudinary.v2.api
                .delete_resources(publicIds.slice(i, i + 100))
                .catch(() => {});
            }
          } catch {
            // non-fatal — Cloudinary env may not be configured in dev
          }
        }
      });
    }

    return { ok: true };
  } catch {
    return { error: "Failed to delete chat" };
  }
}

function serializeDate(d: unknown): string {
  if (typeof d === "string") return d;
  return new Date(d as unknown as string).toISOString();
}
