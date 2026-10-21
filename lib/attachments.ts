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

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|avif|bmp|ico|heic|heif|tiff?|jfif)$/i;

export function isImageMime(mimeType: string): boolean {
  const mt = (mimeType || "").toLowerCase().trim();
  return mt.startsWith("image/") && mt !== "image/svg+xml";
}

export function attachmentKind(mimeType: string, fileName: string): AttachmentKind {
  if (/\.svg$/i.test(fileName)) return "file";
  if (isImageMime(mimeType)) return "image";
  return IMAGE_EXTENSIONS.test(fileName) ? "image" : "file";
}
