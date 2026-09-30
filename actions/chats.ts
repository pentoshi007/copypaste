"use server";

import { after } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import dbConnect from "@/lib/db";
import Chat from "@/models/Chat";
import Note from "@/models/Note";
import {
  collectBlobs,
  destroyBlobs,
  type BlobRefs,
} from "@/lib/attachments.server";
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

    const chat = await Chat.findOneAndDelete(
      { _id: chatId, userId: session.user.id },
      { select: "_id" }
    ).lean();

    if (!chat) {
      return { error: "Chat not found" };
    }

const notes = await Note.find(
      {
        chatId,
        userId: session.user.id,
        $or: [
          { publicId: { $ne: "" } },
          { storageKey: { $ne: "" } },
          { "attachments.publicId": { $ne: "" } },
          { "attachments.storageKey": { $ne: "" } },
        ],
      },
      { publicId: 1, storageKey: 1, attachments: 1 }
    ).lean();

    const refs: BlobRefs = { objectKeys: [], publicIds: [] };
    for (const note of notes) {
      const found = collectBlobs(note);
      refs.objectKeys.push(...found.objectKeys);
      refs.publicIds.push(...found.publicIds);
    }
    refs.objectKeys = [...new Set(refs.objectKeys)];
    refs.publicIds = [...new Set(refs.publicIds)];

    await Note.deleteMany({ chatId, userId: session.user.id });

    if (refs.objectKeys.length > 0 || refs.publicIds.length > 0) {
      after(async () => {
        await destroyBlobs(refs);
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
