export type PreviewKind = "pdf" | "image" | "video" | "audio" | "text" | "none";

const TEXT_EXTENSIONS =
  /\.(txt|md|markdown|csv|tsv|log|json|ya?ml|toml|ini|conf|env|sql|ts|tsx|js|jsx|mjs|cjs|py|java|kt|c|h|cpp|hpp|cs|go|rs|rb|php|swift|sh|bash|zsh|css|scss|patch|diff)$/i;

const PDF_EXTENSION = /\.pdf$/i;

export function previewKind(mimeType: string, fileName: string): PreviewKind {
  const mt = (mimeType || "").toLowerCase();

  if (mt === "application/pdf" || PDF_EXTENSION.test(fileName)) return "pdf";

  if (mt.startsWith("image/") && mt !== "image/svg+xml") return "image";
  if (mt.startsWith("video/")) return "video";
  if (mt.startsWith("audio/")) return "audio";

  if (mt === "text/html" || /\.x?html?$/i.test(fileName)) return "text";
  if (mt.startsWith("text/") || TEXT_EXTENSIONS.test(fileName)) return "text";

  return "none";
}

export function isInlineViewable(mimeType: string, fileName: string): boolean {
  const kind = previewKind(mimeType, fileName);
  return (
    kind === "pdf" || kind === "image" || kind === "video" || kind === "audio"
  );
}

export const TEXT_PREVIEW_MAX_BYTES = 512 * 1024;

export function isOfficeDocument(mimeType: string, fileName: string): boolean {
  return (
    /officedocument|ms-excel|ms-powerpoint|msword|opendocument/i.test(
      mimeType
    ) || /\.(docx?|xlsx?|pptx?|odt|ods|odp|rtf|pages|numbers|key)$/i.test(fileName)
  );
}
