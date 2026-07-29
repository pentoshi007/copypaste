export type NoteType = "text" | "code" | "link" | "image";

export interface NoteItem {
  _id: string;
  chatId: string;
  type: NoteType;
  content: string;
  imageUrl: string;
  publicId: string;
  language: string;
  createdAt: string; // ISO string for client serialization
  /**
   * Client-only: true while an optimistically-inserted note is still being
   * persisted. Never set by the server.
   */
  pending?: boolean;
}

export interface ChatItem {
  _id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/** What the composer hands off when the user hits send. */
export interface NoteDraft {
  type: NoteType;
  content: string;
  imageUrl: string;
  publicId: string;
  language: string;
}
