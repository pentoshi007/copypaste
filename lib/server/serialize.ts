import type { Block, BlockAttachment, Page, TrashedPage } from "@/lib/types";
import { BLOCK_COLORS, BLOCK_TYPES, type BlockColor, type BlockType } from "@/lib/editor/blockTypes";
import { LEGACY_DEFAULT_TITLE } from "@/lib/editor/titles";

type Raw = Record<string, unknown>;

export const BLOCK_PROJECTION = {
  _id: 1,
  chatId: 1,
  type: 1,
  content: 1,
  language: 1,
  position: 1,
  indent: 1,
  checked: 1,
  collapsed: 1,
  color: 1,
  imageUrl: 1,
  publicId: 1,
  fileName: 1,
  fileSize: 1,
  mimeType: 1,
  "attachments.index": 1,
  "attachments.kind": 1,
  "attachments.fileName": 1,
  "attachments.fileSize": 1,
  "attachments.mimeType": 1,
  "attachments.imageUrl": 1,
  "attachments.publicId": 1,
  "attachments.caption": 1,
  createdAt: 1,
  updatedAt: 1,
} as const;

export const PAGE_PROJECTION = {
  _id: 1,
  title: 1,
  icon: 1,
  parentId: 1,
  position: 1,
  favorite: 1,
  fullWidth: 1,
  createdAt: 1,
  updatedAt: 1,
} as const;

const TYPE_SET: ReadonlySet<string> = new Set(BLOCK_TYPES);
const COLOR_SET: ReadonlySet<string> = new Set(BLOCK_COLORS);

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function count(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function id(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

export function serializeDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date(0).toISOString();
}

function serializeAttachment(raw: Raw): BlockAttachment {
  const kind = raw.kind === "image" ? "image" : "file";
  const attachment: BlockAttachment = {
    index: count(raw.index),
    kind,
    fileName: text(raw.fileName),
    fileSize: count(raw.fileSize),
    mimeType: text(raw.mimeType),
    caption: text(raw.caption),
  };
  if (kind === "image") {
    attachment.imageUrl = text(raw.imageUrl);
    attachment.publicId = text(raw.publicId);
  }
  return attachment;
}

export function serializeBlock(raw: Raw): Block {
  const type = TYPE_SET.has(text(raw.type)) ? (raw.type as BlockType) : "text";
  const color = COLOR_SET.has(text(raw.color)) ? (raw.color as BlockColor) : "default";
  const block: Block = {
    _id: String(raw._id),
    pageId: String(raw.chatId),
    type,
    content: text(raw.content),
    language: text(raw.language),
    position: count(raw.position),
    indent: count(raw.indent),
    checked: raw.checked === true,
    collapsed: raw.collapsed === true,
    color,
    imageUrl: text(raw.imageUrl),
    publicId: text(raw.publicId),
    fileName: text(raw.fileName),
    fileSize: count(raw.fileSize),
    mimeType: text(raw.mimeType),
    createdAt: serializeDate(raw.createdAt),
    updatedAt: serializeDate(raw.updatedAt ?? raw.createdAt),
  };
  if (Array.isArray(raw.attachments) && raw.attachments.length > 0) {
    block.attachments = (raw.attachments as Raw[]).map(serializeAttachment);
  }
  return block;
}

function serializeTitle(value: unknown): string {
  const title = text(value).trim();
  return title === LEGACY_DEFAULT_TITLE ? "" : title;
}

export function serializePage(raw: Raw): Page {
  return {
    _id: String(raw._id),
    title: serializeTitle(raw.title),
    icon: text(raw.icon),
    parentId: id(raw.parentId),
    position: count(raw.position),
    favorite: raw.favorite === true,
    fullWidth: raw.fullWidth === true,
    createdAt: serializeDate(raw.createdAt),
    updatedAt: serializeDate(raw.updatedAt ?? raw.createdAt),
  };
}

export function serializeTrashedPage(raw: Raw): TrashedPage {
  return {
    _id: String(raw._id),
    title: serializeTitle(raw.title),
    icon: text(raw.icon),
    deletedAt: serializeDate(raw.deletedAt),
  };
}
