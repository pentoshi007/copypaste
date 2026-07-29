import { sendWithProgress, type ProgressCallback } from "@/lib/xhr";
import { isBlockedUpload } from "@/lib/preview";

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
 *
 * A batch can mix the two freely: each file is classified on its own and takes
 * whichever path suits it, so selecting a photo, a PDF and a .docx together
 * lands the photo on Cloudinary and the other two on R2 in the same send.
 */

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB — Cloudinary's cap

/**
 * Files accepted in one send. Matches the batch cap on `createNotes`, and keeps
 * a single selection comfortably inside the presign rate limit.
 */
export const MAX_BATCH_FILES = 20;

/**
 * Parallel transfers.
 *
 * Uploading one file at a time wastes most of the available bandwidth on a
 * batch of small files, because each transfer spends its first moments in
 * connection setup. Going much wider than this is counter-productive: the
 * files then compete for the same uplink and every one of them finishes late,
 * which looks slower even though the total is the same.
 */
export const UPLOAD_CONCURRENCY = 3;

export type UploadResult = { secure_url: string; public_id: string };

export type UploadedFile = {
  /** R2 object key. Passed back to the server when creating the note. */
  storageKey: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
};

/** Which backend a file belongs on, and therefore which note type it becomes. */
export type UploadKind = "image" | "file";

/**
 * Fallback MIME types by extension.
 *
 * `File.type` is empty surprisingly often — files dragged from some archive
 * managers, cloud-drive pickers on Android, and anything with an extension the
 * OS doesn't recognise. When that happens the object used to be stored as
 * `application/octet-stream`, which made the browser download a PDF instead of
 * rendering it in the preview frame (R2 can't override the stored content type
 * per request, so the wrong value is permanent for that object).
 */
const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  // Documents
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  rtf: "application/rtf",
  epub: "application/epub+zip",
  // Images
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  heic: "image/heic",
  heif: "image/heif",
  tif: "image/tiff",
  tiff: "image/tiff",
  // Media
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  flac: "audio/flac",
  // Archives
  zip: "application/zip",
  rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed",
  tar: "application/x-tar",
  gz: "application/gzip",
  // Text and code. Everything here is stored with
  // `Content-Disposition: attachment` (see lib/preview.ts), so labelling a
  // .js file as JavaScript can't turn it into a script the browser executes.
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  log: "text/plain",
  json: "application/json",
  xml: "application/xml",
  yml: "text/yaml",
  yaml: "text/yaml",
  sql: "text/plain",
  js: "text/javascript",
  ts: "text/plain",
  tsx: "text/plain",
  jsx: "text/plain",
  py: "text/x-python",
  css: "text/css",
};

function extensionOf(fileName: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(fileName);
  return match ? match[1].toLowerCase() : "";
}

/**
 * The content type to store the object with: whatever the browser reported,
 * or a guess from the extension when it reported nothing useful.
 */
export function inferContentType(file: File): string {
  const reported = (file.type || "").trim();
  if (reported && reported !== "application/octet-stream") return reported;
  // `||` rather than `??`: a missing extension yields undefined *and* `reported`
  // is often the empty string, and neither is a usable content type.
  return (
    EXTENSION_CONTENT_TYPES[extensionOf(file.name)] ||
    reported ||
    "application/octet-stream"
  );
}

/**
 * Which backend this file goes to.
 *
 * SVG is treated as a generic file, never as an inline image: it can carry
 * script, and Cloudinary would serve it from a hostname we don't control.
 *
 * An image past Cloudinary's size cap is routed to R2 as a plain attachment
 * rather than rejected. Losing one photo out of a twenty-file batch because it
 * came off a modern phone camera isn't a good trade — as a `file` note it still
 * previews inline and still downloads at full resolution.
 */
export function classifyFile(file: File): UploadKind {
  const type = inferContentType(file).toLowerCase();
  const isImage = type.startsWith("image/") && type !== "image/svg+xml";
  if (isImage && file.size > 0 && file.size <= MAX_IMAGE_BYTES) return "image";
  return "file";
}

/**
 * Rejects a file before any bytes move. Returns a ready-to-show message, or
 * null when the file is fine.
 */
export function validateFile(file: File): string | null {
  // Directories dropped onto the composer arrive as zero-byte entries, as do
  // files that were moved or unmounted between selection and read.
  if (file.size === 0) return `"${file.name}" is empty`;
  if (isBlockedUpload(inferContentType(file), file.name)) {
    return `"${file.name}" isn't an allowed file type`;
  }
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

  const contentType = inferContentType(file);

  // The server decides the object key, enforces the size cap and builds the
  // headers. The client is not trusted to choose any of them.
  //
  // Presigning happens here, immediately before the transfer, rather than for
  // the whole batch up front: a signed PUT is only valid for 15 minutes, and a
  // batch queued behind two large files could otherwise start uploading against
  // a URL that had already expired.
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
