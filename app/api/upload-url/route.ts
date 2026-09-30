import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { rateLimit } from "@/lib/rateLimit";
import { attachmentKind, MAX_FILES_PER_NOTE } from "@/lib/attachments";
import {
  MAX_FILE_BYTES,
  buildFileKey,
  contentDispositionFor,
  getR2Config,
  presignPut,
  sanitizeFileName,
} from "@/lib/r2";

const PRESIGN_TTL_SECONDS = 900;

const MAX_NAME_LENGTH = 255;

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

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = getR2Config();
  if (!config) {
    return NextResponse.json(
      { error: "File storage isn't configured on the server" },
      { status: 503 }
    );
  }

  const raw = await request.json().catch(() => null);
  const files = (raw as { files?: unknown } | null)?.files;
  if (!Array.isArray(files)) {
    return NextResponse.json(
      { error: "Expected { files: [...] }" },
      { status: 400 }
    );
  }
  if (files.length === 0 || files.length > MAX_FILES_PER_NOTE) {
    return NextResponse.json(
      { error: `Select between 1 and ${MAX_FILES_PER_NOTE} files` },
      { status: 400 }
    );
  }

  if (
    !rateLimit("upload-url", session.user.id, {
      maxAttempts: MAX_FILES_PER_NOTE,
      windowMs: 60_000,
    })
  ) {
    return NextResponse.json(
      { error: "Too many uploads. Please wait a moment." },
      { status: 429 }
    );
  }

  const presigns: {
    index: number;
    key: string;
    uploadUrl: string;
    fileName: string;
    headers: Record<string, string>;
  }[] = [];
  const errors: { index: number; error: string }[] = [];

  for (const [index, entry] of files.entries()) {
    const check = validateEntry(entry);
    if ("error" in check) {
      errors.push({ index, error: check.error });
      continue;
    }

    const key = buildFileKey(session.user.id, check.fileName);

    try {
      const uploadUrl = await presignPut(config, key, PRESIGN_TTL_SECONDS);
      presigns.push({
        index,
        key,
        uploadUrl,
        fileName: check.fileName,
        headers: {
          "Content-Type": check.contentType,
          "Content-Disposition": contentDispositionFor(
            check.fileName,
            check.contentType
          ),
        },
      });
    } catch {
      errors.push({ index, error: "Could not prepare the upload" });
    }
  }

  return NextResponse.json(
    { presigns, errors },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}

type ValidEntry = { fileName: string; contentType: string };

function validateEntry(entry: unknown): ValidEntry | { error: string } {
  const record = (entry ?? {}) as Record<string, unknown>;
  const rawName = typeof record.fileName === "string" ? record.fileName : "";
  if (!rawName.trim()) return { error: "Missing file name" };

  const fileName = sanitizeFileName(rawName.slice(0, MAX_NAME_LENGTH));

  const size = typeof record.size === "number" ? record.size : NaN;
  if (!Number.isFinite(size) || size <= 0) return { error: "Invalid file size" };
  if (size > MAX_FILE_BYTES) {
    return {
      error: `File is too large (max ${Math.floor(MAX_FILE_BYTES / (1024 * 1024))}MB)`,
    };
  }

  const declared =
    typeof record.contentType === "string" ? record.contentType.trim() : "";
  const contentType = declared || "application/octet-stream";

  if (BLOCKED_TYPES.has(contentType) || BLOCKED_EXTENSIONS.test(fileName)) {
    return { error: "That file type isn't allowed" };
  }

  if (attachmentKind(contentType, fileName) !== "file") {
    return { error: "Images are uploaded separately" };
  }

  return { fileName, contentType };
}
