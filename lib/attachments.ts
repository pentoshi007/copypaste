export type AttachmentKind = "image" | "file";

export type AttachmentRef = {
  kind: AttachmentKind;
  fileName: string;
  fileSize: number;
  mimeType: string;
  imageUrl?: string;
  publicId?: string;
  storageKey?: string;
  version?: number;
  signature?: string;
  caption?: string;
};

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const MAX_FILES_PER_UPLOAD = 30;

export const UPLOAD_AUTHORIZATION_LIMIT = { maxAttempts: 120, windowMs: 60_000 };

const IMAGE_EXTENSIONS = /\.(png|jpe?g|jfif|gif|webp|avif|bmp|ico|heic|heif|tiff?)$/i;

const IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/pjpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "image/x-ms-bmp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/heic",
  "image/heif",
  "image/tiff",
]);

export function isImageMime(mimeType: string): boolean {
  return IMAGE_MIME_TYPES.has((mimeType || "").toLowerCase().trim());
}

export function attachmentKind(mimeType: string, fileName: string): AttachmentKind {
  if (/\.svg$/i.test(fileName)) return "file";
  if (isImageMime(mimeType)) return "image";
  const declared = (mimeType || "").toLowerCase().trim();
  if (declared && declared !== "application/octet-stream") return "file";
  return IMAGE_EXTENSIONS.test(fileName) ? "image" : "file";
}
