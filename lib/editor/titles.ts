export const UNTITLED = "Untitled";
export const MAX_TITLE_LENGTH = 200;
export const LEGACY_DEFAULT_TITLE = "New Chat";

const AUTO_TITLE_LENGTH = 60;

export function displayTitle(title: string): string {
  return title.trim() || UNTITLED;
}

export function deriveTitle(text: string): string {
  const firstLine = text
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) return "";
  const plain = firstLine
    .replace(/[*_~`#>[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= AUTO_TITLE_LENGTH) return plain;
  return `${plain.slice(0, AUTO_TITLE_LENGTH - 1).trimEnd()}…`;
}
