import type { BlockType } from "@/lib/editor/blockTypes";

export interface ShortcutMatch {
  type: BlockType;
  checked?: boolean;
  content: string;
}

const PREFIXES: readonly [RegExp, BlockType, boolean?][] = [
  [/^#\s$/, "h1"],
  [/^##\s$/, "h2"],
  [/^###\s$/, "h3"],
  [/^[-*+]\s$/, "bullet"],
  [/^\d+[.)]\s$/, "numbered"],
  [/^\[\s?\]\s$/, "todo", false],
  [/^\[[xX]\]\s$/, "todo", true],
  [/^"\s$/, "quote"],
  [/^>\s$/, "toggle"],
  [/^!\s$/, "callout"],
];

export function matchMarkdownShortcut(previous: string, next: string, caret: number): ShortcutMatch | null {
  if (next.length !== previous.length + 1) return null;

  if (next === "```" && caret === 3) return { type: "code", content: "" };
  if (next === "---" && caret === 3) return { type: "divider", content: "" };

  const head = next.slice(0, caret);
  if (head.length > 6) return null;

  for (const [pattern, type, checked] of PREFIXES) {
    if (pattern.test(head)) {
      return { type, checked, content: next.slice(caret) };
    }
  }
  return null;
}
