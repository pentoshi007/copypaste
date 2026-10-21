import {
  ChevronRight,
  Code2,
  FilePlus,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Lightbulb,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Paperclip,
  Quote,
  Type,
  type LucideIcon,
} from "lucide-react";
import type { BlockColor, BlockType } from "@/lib/editor/blockTypes";

export type SlashAction = BlockType | "upload-image" | "upload-file" | "page";

export interface CatalogEntry {
  action: SlashAction;
  label: string;
  description: string;
  icon: LucideIcon;
  keywords: string;
  shortcut?: string;
}

export const BLOCK_CATALOG: readonly CatalogEntry[] = [
  {
    action: "text",
    label: "Text",
    description: "Plain paragraph",
    icon: Type,
    keywords: "paragraph plain p",
  },
  {
    action: "h1",
    label: "Heading 1",
    description: "Big section heading",
    icon: Heading1,
    keywords: "title h1 heading",
    shortcut: "#",
  },
  {
    action: "h2",
    label: "Heading 2",
    description: "Medium section heading",
    icon: Heading2,
    keywords: "subtitle h2 heading",
    shortcut: "##",
  },
  {
    action: "h3",
    label: "Heading 3",
    description: "Small section heading",
    icon: Heading3,
    keywords: "h3 heading",
    shortcut: "###",
  },
  {
    action: "todo",
    label: "To-do list",
    description: "Track tasks with a checkbox",
    icon: ListTodo,
    keywords: "todo task checkbox check",
    shortcut: "[]",
  },
  {
    action: "bullet",
    label: "Bulleted list",
    description: "Simple bulleted list",
    icon: List,
    keywords: "bullet unordered ul list",
    shortcut: "-",
  },
  {
    action: "numbered",
    label: "Numbered list",
    description: "List with numbering",
    icon: ListOrdered,
    keywords: "numbered ordered ol list",
    shortcut: "1.",
  },
  {
    action: "toggle",
    label: "Toggle list",
    description: "Collapse nested content",
    icon: ChevronRight,
    keywords: "toggle collapse expand details",
    shortcut: ">",
  },
  {
    action: "quote",
    label: "Quote",
    description: "Capture a quote",
    icon: Quote,
    keywords: "quote blockquote citation",
    shortcut: '"',
  },
  {
    action: "callout",
    label: "Callout",
    description: "Make text stand out",
    icon: Lightbulb,
    keywords: "callout note tip info warning",
    shortcut: "!",
  },
  {
    action: "code",
    label: "Code",
    description: "Syntax-highlighted snippet",
    icon: Code2,
    keywords: "code snippet pre program",
    shortcut: "```",
  },
  {
    action: "link",
    label: "Link",
    description: "Bookmark a web address",
    icon: Link2,
    keywords: "link url bookmark web",
  },
  {
    action: "divider",
    label: "Divider",
    description: "Separate sections",
    icon: Minus,
    keywords: "divider separator hr line",
    shortcut: "---",
  },
  {
    action: "upload-image",
    label: "Image",
    description: "Upload images",
    icon: ImageIcon,
    keywords: "image picture photo upload media",
  },
  {
    action: "upload-file",
    label: "File",
    description: "Upload any file",
    icon: Paperclip,
    keywords: "file attachment upload pdf video audio document",
  },
  {
    action: "page",
    label: "Sub-page",
    description: "Nest a new page inside this one",
    icon: FilePlus,
    keywords: "page subpage child nested new",
  },
];

const BY_ACTION = new Map(BLOCK_CATALOG.map((entry) => [entry.action, entry]));

export function catalogEntry(action: SlashAction): CatalogEntry | undefined {
  return BY_ACTION.get(action);
}

export function filterCatalog(
  query: string,
  entries: readonly CatalogEntry[] = BLOCK_CATALOG,
): CatalogEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...entries];
  return entries.filter(
    (entry) => entry.label.toLowerCase().includes(needle) || entry.keywords.includes(needle),
  );
}

export const CONVERSION_TARGETS: readonly BlockType[] = [
  "text",
  "h1",
  "h2",
  "h3",
  "todo",
  "bullet",
  "numbered",
  "toggle",
  "quote",
  "callout",
  "code",
  "link",
];

export const COLOR_STYLES: Record<
  BlockColor,
  { label: string; text: string; background: string; swatch: string }
> = {
  default: { label: "Default", text: "", background: "", swatch: "bg-neutral-200 dark:bg-neutral-700" },
  gray: {
    label: "Gray",
    text: "text-neutral-500 dark:text-neutral-400",
    background: "bg-neutral-100 dark:bg-neutral-800/70",
    swatch: "bg-neutral-400",
  },
  brown: {
    label: "Brown",
    text: "text-amber-800 dark:text-amber-600",
    background: "bg-amber-50 dark:bg-amber-950/40",
    swatch: "bg-amber-700",
  },
  orange: {
    label: "Orange",
    text: "text-orange-600 dark:text-orange-400",
    background: "bg-orange-50 dark:bg-orange-950/40",
    swatch: "bg-orange-500",
  },
  yellow: {
    label: "Yellow",
    text: "text-yellow-700 dark:text-yellow-400",
    background: "bg-yellow-50 dark:bg-yellow-950/40",
    swatch: "bg-yellow-400",
  },
  green: {
    label: "Green",
    text: "text-emerald-700 dark:text-emerald-400",
    background: "bg-emerald-50 dark:bg-emerald-950/40",
    swatch: "bg-emerald-500",
  },
  blue: {
    label: "Blue",
    text: "text-blue-700 dark:text-blue-400",
    background: "bg-blue-50 dark:bg-blue-950/40",
    swatch: "bg-blue-500",
  },
  purple: {
    label: "Purple",
    text: "text-purple-700 dark:text-purple-400",
    background: "bg-purple-50 dark:bg-purple-950/40",
    swatch: "bg-purple-500",
  },
  pink: {
    label: "Pink",
    text: "text-pink-700 dark:text-pink-400",
    background: "bg-pink-50 dark:bg-pink-950/40",
    swatch: "bg-pink-500",
  },
  red: {
    label: "Red",
    text: "text-red-700 dark:text-red-400",
    background: "bg-red-50 dark:bg-red-950/40",
    swatch: "bg-red-500",
  },
};
