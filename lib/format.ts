const UNITS = ["B", "KB", "MB", "GB", "TB"];

/** Human-readable byte size, e.g. 1536 -> "1.5 KB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  // Whole numbers for bytes and KB; one decimal from MB up.
  const decimals = unit === 0 ? 0 : value < 10 && unit > 1 ? 1 : 0;
  return `${value.toFixed(decimals)} ${UNITS[unit]}`;
}

/** Short, lowercase extension without the dot, or "" when there isn't one. */
export function fileExtension(fileName: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(fileName);
  return match ? match[1].toLowerCase() : "";
}
