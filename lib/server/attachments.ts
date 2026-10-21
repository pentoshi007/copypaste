import { MAX_IMAGE_BYTES, attachmentKind } from "@/lib/attachments";
import { MAX_FILE_BYTES, getR2Config, headObject, isOwnedFileKey, sanitizeFileName } from "@/lib/r2";
import { isGenuineUploadResponse, lookupImage } from "@/lib/server/cloudinary";
import { hasPendingUpload } from "@/lib/server/uploads";
import type { AttachmentInput } from "@/lib/types";

export interface VerifiedImage {
  storage: "cloudinary";
  imageUrl: string;
  publicId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

export interface VerifiedFile {
  storage: "r2";
  storageKey: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

export type VerifiedAttachment = VerifiedImage | VerifiedFile;

export type VerifyResult =
  | { ok: true; value: VerifiedAttachment }
  | { ok: false; error: string; orphan?: { kind: "image" | "file"; key: string } };

const MAX_MB = Math.floor(MAX_FILE_BYTES / (1024 * 1024));

export function isOwnedCloudinaryId(publicId: string, userId: string): boolean {
  if (!publicId || publicId.includes("..") || publicId.includes("//")) return false;
  return /^u\/[a-f0-9]{24}\/[a-f0-9]{32}$/i.test(publicId) && publicId.startsWith(`u/${userId}/`);
}

export function isCloudinaryDeliveryUrl(url: string, publicId: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "res.cloudinary.com") return false;
    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    if (cloudName && !parsed.pathname.startsWith(`/${cloudName}/image/upload/`)) return false;
    return parsed.pathname.includes(`/${publicId}`);
  } catch {
    return false;
  }
}

async function verifyImage(input: AttachmentInput, userId: string): Promise<VerifyResult> {
  const publicId = input.publicId ?? "";
  if (!isOwnedCloudinaryId(publicId, userId)) return { ok: false, error: "Invalid image reference" };
  if (typeof input.version !== "number" || !input.signature)
    return { ok: false, error: "Image upload incomplete" };
  if (!isGenuineUploadResponse(publicId, input.version, input.signature)) {
    return { ok: false, error: "Invalid image upload" };
  }
  if (!(await hasPendingUpload(userId, publicId))) {
    return { ok: false, error: "That upload has expired — please try again" };
  }

  const orphan = { kind: "image" as const, key: publicId };
  const lookup = await lookupImage(publicId);
  if (lookup.status === "missing") return { ok: false, error: "Upload didn't complete — please try again" };

  const bytes = lookup.status === "found" ? lookup.bytes : MAX_IMAGE_BYTES;
  if (!Number.isFinite(bytes) || bytes <= 0 || bytes > MAX_IMAGE_BYTES) {
    return { ok: false, error: "Image is too large (max 10MB)", orphan };
  }

  const imageUrl = lookup.status === "found" ? lookup.secureUrl : (input.imageUrl ?? "");
  if (!isCloudinaryDeliveryUrl(imageUrl, publicId)) return { ok: false, error: "Invalid image URL" };

  return {
    ok: true,
    value: {
      storage: "cloudinary",
      imageUrl,
      publicId,
      fileName: sanitizeFileName(input.fileName || "image"),
      fileSize: bytes,
      mimeType: lookup.status === "found" && lookup.format ? `image/${lookup.format}` : input.mimeType,
    },
  };
}

async function verifyFile(input: AttachmentInput, userId: string): Promise<VerifyResult> {
  const storageKey = input.storageKey ?? "";
  const config = getR2Config();
  if (!config) return { ok: false, error: "File storage isn't configured" };
  if (!isOwnedFileKey(storageKey, userId)) return { ok: false, error: "Invalid file reference" };
  if (!(await hasPendingUpload(userId, storageKey))) {
    return { ok: false, error: "That upload has expired — please try again" };
  }

  const metadata = await headObject(config, storageKey);
  if (!metadata) return { ok: false, error: "Upload didn't complete — please try again" };

  const orphan = { kind: "file" as const, key: storageKey };
  if (metadata.size <= 0) return { ok: false, error: `"${input.fileName}" is empty`, orphan };
  if (metadata.size > MAX_FILE_BYTES) {
    return { ok: false, error: `"${input.fileName}" is too large (max ${MAX_MB}MB)`, orphan };
  }

  return {
    ok: true,
    value: {
      storage: "r2",
      storageKey,
      fileName: sanitizeFileName(input.fileName || storageKey.split("/").pop() || "file"),
      fileSize: metadata.size,
      mimeType: metadata.contentType,
    },
  };
}

export async function verifyAttachment(input: AttachmentInput, userId: string): Promise<VerifyResult> {
  if (input.kind !== attachmentKind(input.mimeType, input.fileName)) {
    return { ok: false, error: `"${input.fileName}" doesn't match its file type` };
  }
  return input.kind === "image" ? verifyImage(input, userId) : verifyFile(input, userId);
}
