import type { AttachmentRef } from "@/lib/attachments";

export type NoteType = "text" | "code" | "link" | "image" | "file" | "group";

export interface NoteAttachment extends Omit<AttachmentRef, "storageKey"> {
  index: number;
}

export interface NoteItem {
  _id: string;
  chatId: string;
  type: NoteType;
  content: string;
  imageUrl: string;
  publicId: string;
  language: string;
  createdAt: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  attachments?: NoteAttachment[];
  pending?: boolean;
}

export interface ChatItem {
  _id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface NoteDraft {
  type: NoteType;
  content: string;
  imageUrl: string;
  publicId: string;
  language: string;
  storageKey?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  attachments?: DraftAttachment[];
}

export interface DraftAttachment extends NoteAttachment {
  storageKey?: string;
}
