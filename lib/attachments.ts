import { previewKind } from "@/lib/preview";

export type AttachmentKind = "image" | "file";

export type AttachmentRef = {
  kind: AttachmentKind;
  fileName: string;
  fileSize: number;
  mimeType: string;
  imageUrl?: string;
  publicId?: string;
  storageKey?: string;
  caption?: string;
};

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const MAX_FILES_PER_NOTE = 30;

export const MAX_GROUP_BYTES = 250 * 1024 * 1024;

const IMAGE_EXTENSIONS =
  /\.(png|jpe?g|gif|webp|avif|bmp|ico|heic|heif|tiff?|jfif)$/i;

export function isImageMime(mimeType: string): boolean {
  const mt = (mimeType || "").toLowerCase().trim();
  return mt.startsWith("image/") && mt !== "image/svg+xml";
}

export function attachmentKind(
  mimeType: string,
  fileName: string
): AttachmentKind {
  if (/\.svg$/i.test(fileName)) return "file";
  if (isImageMime(mimeType)) return "image";
  return IMAGE_EXTENSIONS.test(fileName) ? "image" : "file";
}

export function isPreviewable(mimeType: string, fileName: string): boolean {
  return previewKind(mimeType, fileName) !== "none";
}
