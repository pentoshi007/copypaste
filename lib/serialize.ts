import type {
  ChatItem,
  NoteAttachment,
  NoteItem,
  NoteType,
} from "@/lib/types";

export const NOTE_PROJECTION = {
  _id: 1,
  chatId: 1,
  type: 1,
  content: 1,
  imageUrl: 1,
  publicId: 1,
  language: 1,
  createdAt: 1,
  fileName: 1,
  fileSize: 1,
  mimeType: 1,
  attachments: 1,
} as const;

export const CHAT_PROJECTION = {
  _id: 1,
  title: 1,
  createdAt: 1,
  updatedAt: 1,
} as const;

export const NOTES_LIMIT = 500;

export const CHATS_LIMIT = 200;

type RawAttachment = {
  index?: number | null;
  kind?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  imageUrl?: string | null;
  publicId?: string | null;
  caption?: string | null;
};

type RawNote = {
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
  attachments?: RawAttachment[] | null;
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

function serializeAttachment(a: RawAttachment): NoteAttachment {
  const kind = a.kind === "image" ? "image" : "file";
  const attachment: NoteAttachment = {
    index: Number(a.index ?? 0),
    kind,
    fileName: a.fileName ?? "",
    fileSize: a.fileSize ?? 0,
    mimeType: a.mimeType ?? "",
    caption: a.caption ?? "",
  };
  if (kind === "image") {
    attachment.imageUrl = a.imageUrl ?? "";
    attachment.publicId = a.publicId ?? "";
  }
  return attachment;
}

export function serializeNote(n: RawNote): NoteItem {
  const note: NoteItem = {
    _id: String(n._id),
    chatId: String(n.chatId),
    type: (n.type ?? "text") as NoteType,
    content: n.content ?? "",
    imageUrl: n.imageUrl ?? "",
    publicId: n.publicId ?? "",
    language: n.language ?? "",
    createdAt: serializeDate(n.createdAt),
    fileName: n.fileName ?? "",
    fileSize: n.fileSize ?? 0,
    mimeType: n.mimeType ?? "",
  };
  if (Array.isArray(n.attachments) && n.attachments.length > 0) {
    note.attachments = n.attachments.map(serializeAttachment);
  }
  return note;
}

export function serializeChat(c: RawChat): ChatItem {
  return {
    _id: String(c._id),
    title: c.title ?? "New Chat",
    createdAt: serializeDate(c.createdAt),
    updatedAt: serializeDate(c.updatedAt),
  };
}
