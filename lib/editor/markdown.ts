import type { Block } from "@/lib/types";
import { computeLayout } from "@/lib/editor/layout";
import { isListType } from "@/lib/editor/blockTypes";
import { displayTitle } from "@/lib/editor/titles";

function indentText(text: string, depth: number): string {
  if (depth === 0) return text;
  const pad = "    ".repeat(depth);
  return text
    .split("\n")
    .map((line) => (line ? pad + line : line))
    .join("\n");
}

function quoteLines(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line, index) => (index === 0 ? prefix : "> ") + line)
    .join("\n");
}

function blockToMarkdown(block: Block, number: number): string {
  const text = block.content;
  switch (block.type) {
    case "h1":
      return `# ${text}`;
    case "h2":
      return `## ${text}`;
    case "h3":
      return `### ${text}`;
    case "todo":
      return `- [${block.checked ? "x" : " "}] ${text}`;
    case "bullet":
    case "toggle":
      return `- ${text}`;
    case "numbered":
      return `${number || 1}. ${text}`;
    case "quote":
      return quoteLines(text, "> ");
    case "callout":
      return quoteLines(text, "> 💡 ");
    case "code":
      return `\`\`\`${block.language === "plaintext" ? "" : block.language}\n${text}\n\`\`\``;
    case "link":
      return text ? `<${text}>` : "";
    case "divider":
      return "---";
    case "image":
      return `![${text || block.fileName || "image"}](${block.imageUrl})`;
    case "file":
      return `📎 ${block.fileName || "file"}${text ? ` — ${text}` : ""}`;
    case "group": {
      const lines = (block.attachments ?? []).map(
        (attachment) =>
          `- 📎 ${attachment.fileName || attachment.kind}${attachment.caption ? ` — ${attachment.caption}` : ""}`,
      );
      return [text, ...lines].filter(Boolean).join("\n");
    }
    default:
      return text;
  }
}

export function blocksToMarkdown(blocks: Block[]): string {
  const layout = computeLayout(blocks);
  let output = "";

  blocks.forEach((block, index) => {
    const rendered = indentText(blockToMarkdown(block, layout[index].number), block.indent);
    if (index > 0) {
      const previous = blocks[index - 1];
      const tight = isListType(block.type) && isListType(previous.type);
      output += tight || block.indent > 0 ? "\n" : "\n\n";
    }
    output += rendered;
  });

  return output;
}

export function pageToMarkdown(title: string, blocks: Block[]): string {
  const body = blocksToMarkdown(blocks);
  return `# ${displayTitle(title)}\n\n${body}\n`;
}

export function blocksToPlainText(blocks: Block[]): string {
  return blocks
    .map((block) => {
      if (block.type === "todo") return `${block.checked ? "☑" : "☐"} ${block.content}`;
      if (block.type === "image" || block.type === "file") return block.content || block.fileName;
      if (block.type === "divider") return "---";
      return block.content;
    })
    .join("\n");
}

export function markdownFileName(title: string): string {
  const base = displayTitle(title)
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${base || "page"}.md`;
}
