import type { ChatItem, NoteItem, NoteType } from "@/lib/types";

/**
 * Shared Mongo projections + serializers.
 *
 * The page loader and the /api/notes route must agree on exactly which fields
 * they read and how they're converted to JSON, otherwise the client's cache can
 * end up holding two differently-shaped versions of the same note.
 */

export const NOTE_PROJECTION = {
  _id: 1,
  chatId: 1,
  type: 1,
  content: 1,
  imageUrl: 1,
  publicId: 1,
  language: 1,
  createdAt: 1,
} as const;

export const CHAT_PROJECTION = {
  _id: 1,
  title: 1,
  createdAt: 1,
  updatedAt: 1,
} as const;

/** Safety cap on notes returned for a single chat — the *newest* N. */
export const NOTES_LIMIT = 500;

/** Safety cap on chats returned for a single user. */
export const CHATS_LIMIT = 200;

type RawNote = {
  _id: unknown;
  chatId: unknown;
  type?: string | null;
  content?: string | null;
  imageUrl?: string | null;
  publicId?: string | null;
  language?: string | null;
  createdAt?: unknown;
};

type RawChat = {
  _id: unknown;
  title?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export function serializeDate(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return new Date(value as string).toISOString();
}

export function serializeNote(n: RawNote): NoteItem {
  return {
    _id: String(n._id),
    chatId: String(n.chatId),
    type: (n.type ?? "text") as NoteType,
    content: n.content ?? "",
    imageUrl: n.imageUrl ?? "",
    publicId: n.publicId ?? "",
    language: n.language ?? "",
    createdAt: serializeDate(n.createdAt),
  };
}

export function serializeChat(c: RawChat): ChatItem {
  return {
    _id: String(c._id),
    title: c.title ?? "New Chat",
    createdAt: serializeDate(c.createdAt),
    updatedAt: serializeDate(c.updatedAt),
  };
}
