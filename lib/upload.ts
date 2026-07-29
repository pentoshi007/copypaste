import { sendWithProgress, type ProgressCallback } from "@/lib/xhr";

/**
 * Client-side upload helpers.
 *
 * Two backends, split by content:
 *   - Images  -> Cloudinary (signed direct upload). Kept because Cloudinary
 *                resizes and re-encodes at delivery time, which R2 can't do.
 *   - Everything else -> Cloudflare R2 (presigned PUT to a private bucket).
 *
 * Both send bytes straight from the browser to the storage provider; nothing is
 * proxied through our server.
 */

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB

export type UploadResult = { secure_url: string; public_id: string };

export type UploadedFile = {
  /** R2 object key. Passed back to the server when creating the note. */
  storageKey: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
};

export function isImageFile(file: File): boolean {
  // SVG is treated as a generic file, never as an inline image: it can carry
  // script, and Cloudinary would serve it from a hostname we don't control.
  return file.type.startsWith("image/") && file.type !== "image/svg+xml";
}

export function validateImageFile(file: File): string | null {
  if (!isImageFile(file)) return "That file isn't an image";
  if (file.size > MAX_IMAGE_BYTES) return "Image is too large (max 10MB)";
  return null;
}

// ---------------------------------------------------------------------------
// Images -> Cloudinary
// ---------------------------------------------------------------------------

type SignResponse = {
  signature: string;
  timestamp: number;
  publicId: string;
  apiKey: string;
  cloudName: string;
  error?: string;
};

export async function uploadImage(
  file: File,
  onProgress?: ProgressCallback,
  signal?: AbortSignal
): Promise<UploadResult> {
  // The server picks the public_id (namespaced to the signed-in user), the
  // timestamp and the signature. The client contributes only the bytes — it
  // can't influence where the asset lands.
  const signRes = await fetch("/api/upload-sign", { method: "POST", signal });
  const signed = (await signRes.json().catch(() => null)) as
    | SignResponse
    | null;

  if (!signRes.ok || !signed?.signature) {
    throw new Error(signed?.error ?? "Upload authorization failed");
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("api_key", signed.apiKey);
  formData.append("timestamp", String(signed.timestamp));
  formData.append("public_id", signed.publicId);
  formData.append("signature", signed.signature);

  const raw = await sendWithProgress({
    method: "POST",
    url: `https://api.cloudinary.com/v1_1/${signed.cloudName}/image/upload`,
    body: formData,
    onProgress,
    signal,
  });

  let parsed: UploadResult;
  try {
    parsed = JSON.parse(raw) as UploadResult;
  } catch {
    throw new Error("Could not read the upload response");
  }
  if (!parsed.secure_url || !parsed.public_id) {
    throw new Error("Upload response was incomplete");
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Everything else -> Cloudflare R2
// ---------------------------------------------------------------------------

type PresignResponse = {
  key: string;
  uploadUrl: string;
  fileName: string;
  headers: Record<string, string>;
  error?: string;
};

export async function uploadFileToR2(
  file: File,
  onProgress?: ProgressCallback,
  signal?: AbortSignal
): Promise<UploadedFile> {
  if (file.size === 0) throw new Error("That file is empty");

  const contentType = file.type || "application/octet-stream";

  // The server decides the object key, enforces the size cap and builds the
  // headers. The client is not trusted to choose any of them.
  const presignRes = await fetch("/api/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      contentType,
      size: file.size,
    }),
    signal,
  });

  const presign = (await presignRes.json().catch(() => null)) as
    | PresignResponse
    | null;

  if (!presignRes.ok || !presign?.uploadUrl) {
    throw new Error(presign?.error ?? "Upload authorization failed");
  }

  await sendWithProgress({
    method: "PUT",
    url: presign.uploadUrl,
    body: file,
    // Sent verbatim so R2 stores them as the object's system metadata.
    headers: presign.headers,
    onProgress,
    signal,
  });

  return {
    storageKey: presign.key,
    fileName: presign.fileName,
    fileSize: file.size,
    mimeType: contentType,
  };
}
