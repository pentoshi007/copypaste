import type { AttachmentKind } from "@/lib/attachments";
import type { BlockColor, BlockType } from "@/lib/editor/blockTypes";

export type { BlockColor, BlockType } from "@/lib/editor/blockTypes";

export interface BlockAttachment {
  index: number;
  kind: AttachmentKind;
  fileName: string;
  fileSize: number;
  mimeType: string;
  caption: string;
  imageUrl?: string;
  publicId?: string;
}

export interface Block {
  _id: string;
  pageId: string;
  type: BlockType;
  content: string;
  language: string;
  position: number;
  indent: number;
  checked: boolean;
  collapsed: boolean;
  color: BlockColor;
  imageUrl: string;
  publicId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  attachments?: BlockAttachment[];
  createdAt: string;
  updatedAt: string;
}

export interface Page {
  _id: string;
  title: string;
  icon: string;
  parentId: string | null;
  position: number;
  favorite: boolean;
  fullWidth: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TrashedPage {
  _id: string;
  title: string;
  icon: string;
  deletedAt: string;
}

export interface BlockPatch {
  content?: string;
  type?: BlockType;
  language?: string;
  checked?: boolean;
  indent?: number;
  collapsed?: boolean;
  color?: BlockColor;
}

export interface PagePatch {
  title?: string;
  icon?: string;
  favorite?: boolean;
  fullWidth?: boolean;
}

export interface AttachmentInput {
  kind: AttachmentKind;
  fileName: string;
  fileSize: number;
  mimeType: string;
  imageUrl?: string;
  publicId?: string;
  storageKey?: string;
  version?: number;
  signature?: string;
}

export interface NewBlockInput {
  _id: string;
  type: BlockType;
  content: string;
  language: string;
  position: number;
  indent: number;
  checked: boolean;
  collapsed: boolean;
  color: BlockColor;
  attachment?: AttachmentInput;
}

export interface BlockPlacement {
  blockId: string;
  position: number;
  indent: number;
}

export interface DuplicatePlacement extends BlockPlacement {
  newId: string;
  content: string;
  language: string;
  checked: boolean;
  collapsed: boolean;
  color: BlockColor;
}

export interface PagePosition {
  _id: string;
  position: number;
}

export type ActionResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface SearchResults {
  query: string;
  pages: Page[];
  blocks: Block[];
  truncated: boolean;
}
