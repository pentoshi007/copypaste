import { after } from "next/server";
import dbConnect from "@/lib/db";
import { rateLimit } from "@/lib/rateLimit";
import { MAX_FILES_PER_UPLOAD, UPLOAD_AUTHORIZATION_LIMIT, attachmentKind } from "@/lib/attachments";
import {
  MAX_FILE_BYTES,
  buildFileKey,
  contentDispositionFor,
  getR2Config,
  presignPut,
  sanitizeFileName,
} from "@/lib/r2";
import { currentUserId } from "@/lib/server/auth";
import { isCrossSiteRequest, jsonError, jsonPrivate } from "@/lib/server/requests";
import {
  uploadAllowance,
  reserveUploads,
  sweepOrphanUploads,
  type PlannedUpload,
} from "@/lib/server/uploads";

const PRESIGN_TTL_SECONDS = 900;
const MAX_NAME_LENGTH = 255;
const MAX_MB = Math.floor(MAX_FILE_BYTES / (1024 * 1024));

const BLOCKED_TYPES = new Set([
  "application/x-msdownload",
  "application/x-msdos-program",
  "application/x-ms-installer",
  "application/vnd.microsoft.portable-executable",
  "application/x-executable",
  "application/x-sharedlib",
]);

const BLOCKED_EXTENSIONS =
  /\.(exe|msi|bat|cmd|com|scr|cpl|jar|app|dmg|pkg|deb|rpm|sh|ps1|vbs|lnk|run|so|dylib)$/i;

const CONTENT_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;

interface ValidEntry {
  fileName: string;
  contentType: string;
  size: number;
}

interface Presign {
  index: number;
  key: string;
  uploadUrl: string;
  fileName: string;
  headers: Record<string, string>;
}

function validateEntry(entry: unknown): ValidEntry | { error: string } {
  const record = (entry ?? {}) as Record<string, unknown>;
  const rawName = typeof record.fileName === "string" ? record.fileName : "";
  if (!rawName.trim()) return { error: "Missing file name" };
  const fileName = sanitizeFileName(rawName.slice(0, MAX_NAME_LENGTH));

  const size = typeof record.size === "number" ? record.size : NaN;
  if (!Number.isSafeInteger(size) || size <= 0) return { error: "Invalid file size" };
  if (size > MAX_FILE_BYTES) return { error: `File is too large (max ${MAX_MB}MB)` };

  const declared = typeof record.contentType === "string" ? record.contentType.trim() : "";
  const contentType = CONTENT_TYPE_PATTERN.test(declared)
    ? declared.toLowerCase()
    : "application/octet-stream";

  if (BLOCKED_TYPES.has(contentType) || BLOCKED_EXTENSIONS.test(fileName)) {
    return { error: "That file type isn't allowed" };
  }
  if (attachmentKind(contentType, fileName) !== "file") {
    return { error: "Images are uploaded separately" };
  }
  return { fileName, contentType, size };
}

export async function POST(request: Request) {
  if (isCrossSiteRequest(request.headers)) return jsonError("Forbidden", 403);

  const userId = await currentUserId();
  if (!userId) return jsonError("Unauthorized", 401);

  const config = getR2Config();
  if (!config) return jsonError("File storage isn't configured on the server", 503);

  const raw = await request.json().catch(() => null);
  const files = (raw as { files?: unknown } | null)?.files;
  if (!Array.isArray(files)) return jsonError("Expected { files: [...] }", 400);
  if (files.length === 0 || files.length > MAX_FILES_PER_UPLOAD) {
    return jsonError(`Select between 1 and ${MAX_FILES_PER_UPLOAD} files`, 400);
  }

  if (!rateLimit("upload-url", userId, UPLOAD_AUTHORIZATION_LIMIT)) {
    return jsonError("Too many uploads. Please wait a moment.", 429);
  }

  try {
    await dbConnect();
    const allowance = await uploadAllowance(userId);
    if (allowance.slots < files.length) {
      return jsonError("Too many unfinished uploads. Please wait a moment.", 429);
    }
    let budget = allowance.bytes;

    const presigns: Presign[] = [];
    const planned: PlannedUpload[] = [];
    const errors: { index: number; error: string }[] = [];

    for (const [index, entry] of files.entries()) {
      const check = validateEntry(entry);
      if ("error" in check) {
        errors.push({ index, error: check.error });
        continue;
      }
      if (check.size > budget) {
        errors.push({ index, error: "Storage quota exceeded — delete some files first" });
        continue;
      }

      const key = buildFileKey(userId, check.fileName);
      const headers = {
        "Content-Type": check.contentType,
        "Content-Disposition": contentDispositionFor(check.fileName, check.contentType),
      };
      try {
        const uploadUrl = await presignPut(
          config,
          key,
          { ...headers, "Content-Length": String(check.size) },
          PRESIGN_TTL_SECONDS,
        );
        budget -= check.size;
        planned.push({ kind: "file", key, size: check.size });
        presigns.push({ index, key, uploadUrl, fileName: check.fileName, headers });
      } catch {
        errors.push({ index, error: "Could not prepare the upload" });
      }
    }

    await reserveUploads(userId, planned);
    after(sweepOrphanUploads);

    return jsonPrivate({ presigns, errors });
  } catch {
    return jsonError("Could not prepare the upload", 500);
  }
}
