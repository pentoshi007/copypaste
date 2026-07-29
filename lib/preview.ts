/**
 * Which attachments can be shown inside the app, and how.
 *
 * This is shared between the upload route (which bakes `Content-Disposition`
 * onto the object) and the UI (which decides what to render), so the two can't
 * drift apart. R2 has no `response-content-disposition` override on GetObject,
 * so whatever we choose at upload time is permanent for that object.
 */

export type PreviewKind = "pdf" | "image" | "video" | "audio" | "text" | "none";

/** Extensions worth showing as plain text when the MIME type is unhelpful. */
const TEXT_EXTENSIONS =
  /\.(txt|md|markdown|csv|tsv|log|json|ya?ml|toml|ini|conf|env|sql|ts|tsx|js|jsx|mjs|cjs|py|java|kt|c|h|cpp|hpp|cs|go|rs|rb|php|swift|sh|bash|zsh|css|scss|patch|diff)$/i;

const PDF_EXTENSION = /\.pdf$/i;

export function previewKind(mimeType: string, fileName: string): PreviewKind {
  const mt = (mimeType || "").toLowerCase();

  if (mt === "application/pdf" || PDF_EXTENSION.test(fileName)) return "pdf";
  // SVG is never rendered — it can carry script.
  if (mt.startsWith("image/") && mt !== "image/svg+xml") return "image";
  if (mt.startsWith("video/")) return "video";
  if (mt.startsWith("audio/")) return "audio";

  // HTML is deliberately excluded from the text branch below by being served
  // through our own proxy as text/plain rather than rendered.
  if (mt === "text/html" || /\.x?html?$/i.test(fileName)) return "text";
  if (mt.startsWith("text/") || TEXT_EXTENSIONS.test(fileName)) return "text";

  return "none";
}

/**
 * Whether the object should be stored with `Content-Disposition: inline`.
 *
 * Only formats the browser renders natively *and* can't be turned into a
 * scripting context. Text and HTML are excluded on purpose: serving them inline
 * from the storage origin would make an uploaded `.html` file a stored-XSS
 * vector on that hostname. Text previews go through our own proxy instead, which
 * forces `text/plain` and `nosniff`.
 */
export function isInlineViewable(mimeType: string, fileName: string): boolean {
  const kind = previewKind(mimeType, fileName);
  return (
    kind === "pdf" || kind === "image" || kind === "video" || kind === "audio"
  );
}

/** Largest text file we'll stream through the app for preview. */
export const TEXT_PREVIEW_MAX_BYTES = 512 * 1024;

/**
 * Office formats can't be rendered by a browser. Previewing them would mean
 * handing a signed URL to a third-party viewer (Microsoft/Google), which would
 * send private files off to someone else's servers — so they stay download-only.
 */
export function isOfficeDocument(mimeType: string, fileName: string): boolean {
  return (
    /officedocument|ms-excel|ms-powerpoint|msword|opendocument/i.test(
      mimeType
    ) || /\.(docx?|xlsx?|pptx?|odt|ods|odp|rtf|pages|numbers|key)$/i.test(fileName)
  );
}
