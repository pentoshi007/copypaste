export const TEXT_BLOCK_TYPES = [
  "text",
  "h1",
  "h2",
  "h3",
  "todo",
  "bullet",
  "numbered",
  "quote",
  "callout",
  "toggle",
  "code",
] as const;

export const MEDIA_BLOCK_TYPES = ["image", "file", "group"] as const;

export const BLOCK_TYPES = [...TEXT_BLOCK_TYPES, "link", "divider", ...MEDIA_BLOCK_TYPES] as const;

export type TextBlockType = (typeof TEXT_BLOCK_TYPES)[number];
export type MediaBlockType = (typeof MEDIA_BLOCK_TYPES)[number];
export type BlockType = (typeof BLOCK_TYPES)[number];

export const BLOCK_COLORS = [
  "default",
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
] as const;

export type BlockColor = (typeof BLOCK_COLORS)[number];

export const MAX_INDENT = 6;
export const MAX_CONTENT_LENGTH = 20_000;
export const MAX_CAPTION_LENGTH = 2_000;
export const MAX_BLOCKS_PER_REQUEST = 100;
export const MAX_BLOCKS_PER_PAGE = 5_000;
export const MAX_BLOCKS_PER_USER = 20_000;
export const MAX_LANGUAGE_LENGTH = 40;

export const CODE_LANGUAGES = [
  "plaintext",
  "javascript",
  "typescript",
  "jsx",
  "tsx",
  "python",
  "java",
  "c",
  "cpp",
  "csharp",
  "go",
  "rust",
  "ruby",
  "php",
  "swift",
  "kotlin",
  "sql",
  "bash",
  "html",
  "css",
  "json",
  "yaml",
  "markdown",
  "diff",
] as const;

const TEXT_TYPE_SET: ReadonlySet<string> = new Set(TEXT_BLOCK_TYPES);
const MEDIA_TYPE_SET: ReadonlySet<string> = new Set(MEDIA_BLOCK_TYPES);
const CONVERTIBLE_TYPE_SET: ReadonlySet<string> = new Set([...TEXT_BLOCK_TYPES, "link", "divider"]);
const LIST_TYPE_SET: ReadonlySet<string> = new Set(["bullet", "numbered", "todo"]);

export function isTextType(type: BlockType): type is TextBlockType {
  return TEXT_TYPE_SET.has(type);
}

export function isMediaType(type: BlockType): type is MediaBlockType {
  return MEDIA_TYPE_SET.has(type);
}

export function isListType(type: BlockType): boolean {
  return LIST_TYPE_SET.has(type);
}

export function isConvertible(type: BlockType): boolean {
  return CONVERTIBLE_TYPE_SET.has(type);
}

export function canConvert(from: BlockType, to: BlockType): boolean {
  return from !== to && isConvertible(from) && isConvertible(to);
}

export function hasEditableText(type: BlockType): boolean {
  return isTextType(type);
}
