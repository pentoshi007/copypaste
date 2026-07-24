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
}

export interface ChatItem {
  _id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}
