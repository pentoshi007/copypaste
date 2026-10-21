import { isSafeHref } from "@/lib/guards";

export type InlineNode =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "bold" | "italic" | "strike"; children: InlineNode[] }
  | { kind: "link"; href: string; children: InlineNode[] };

const AUTOLINK = /^https?:\/\/[^\s<>"']+/i;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;
const WORD_CHAR = /[\p{L}\p{N}_]/u;
const MAX_DEPTH = 4;

function findClosing(source: string, marker: string, from: number): number {
  let index = source.indexOf(marker, from);
  while (index !== -1) {
    if (index > from && source[index - 1] !== " ") return index;
    index = source.indexOf(marker, index + 1);
  }
  return -1;
}

function opensEmphasis(source: string, index: number, marker: string): boolean {
  const next = source[index + marker.length];
  if (!next || next === " " || next === marker[0]) return false;
  if (marker === "_" && index > 0 && WORD_CHAR.test(source[index - 1])) return false;
  return true;
}

export function parseInline(source: string, depth = 0): InlineNode[] {
  const nodes: InlineNode[] = [];
  let buffer = "";
  let i = 0;

  const flush = () => {
    if (buffer) nodes.push({ kind: "text", text: buffer });
    buffer = "";
  };

  while (i < source.length) {
    const char = source[i];
    const rest = source.slice(i);

    if (char === "`") {
      const end = source.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        nodes.push({ kind: "code", text: source.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if (depth < MAX_DEPTH) {
      const pair = rest.startsWith("**") ? "**" : rest.startsWith("~~") ? "~~" : null;
      if (pair && opensEmphasis(source, i, pair)) {
        const end = findClosing(source, pair, i + 2);
        if (end !== -1) {
          flush();
          nodes.push({
            kind: pair === "**" ? "bold" : "strike",
            children: parseInline(source.slice(i + 2, end), depth + 1),
          });
          i = end + 2;
          continue;
        }
      }

      if ((char === "*" || char === "_") && opensEmphasis(source, i, char)) {
        const end = findClosing(source, char, i + 1);
        const closesWord = end !== -1 && !(char === "_" && WORD_CHAR.test(source[end + 1] ?? ""));
        if (end !== -1 && closesWord) {
          flush();
          nodes.push({ kind: "italic", children: parseInline(source.slice(i + 1, end), depth + 1) });
          i = end + 1;
          continue;
        }
      }

      if (char === "[") {
        const labelEnd = source.indexOf("](", i + 1);
        const urlEnd = labelEnd === -1 ? -1 : source.indexOf(")", labelEnd + 2);
        if (labelEnd > i + 1 && urlEnd !== -1) {
          const href = source.slice(labelEnd + 2, urlEnd).trim();
          if (isSafeHref(href)) {
            flush();
            nodes.push({
              kind: "link",
              href,
              children: parseInline(source.slice(i + 1, labelEnd), depth + 1),
            });
            i = urlEnd + 1;
            continue;
          }
        }
      }
    }

    if ((char === "h" || char === "H") && (i === 0 || !WORD_CHAR.test(source[i - 1]))) {
      const match = AUTOLINK.exec(rest);
      if (match) {
        const href = match[0].replace(TRAILING_PUNCTUATION, "");
        if (href.length > 8 && isSafeHref(href)) {
          flush();
          nodes.push({ kind: "link", href, children: [{ kind: "text", text: href }] });
          i += href.length;
          continue;
        }
      }
    }

    buffer += char;
    i++;
  }

  flush();
  return nodes;
}

export function inlineToPlainText(nodes: InlineNode[]): string {
  return nodes
    .map((node) =>
      node.kind === "text" || node.kind === "code" ? node.text : inlineToPlainText(node.children),
    )
    .join("");
}

export function hasInlineMarkup(source: string): boolean {
  const nodes = parseInline(source);
  return !(nodes.length <= 1 && (nodes[0]?.kind ?? "text") === "text");
}
