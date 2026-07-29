import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { rateLimit } from "@/lib/rateLimit";
import {
  MAX_FILE_BYTES,
  buildFileKey,
  contentDispositionFor,
  getR2Config,
  presignPut,
  sanitizeFileName,
} from "@/lib/r2";

/**
 * Issues a short-lived, single-object PUT URL so the browser can upload a file
 * straight to R2. The bytes never touch this server.
 *
 * The response also carries the exact headers the client must send, so the
 * stored object ends up with the right content type and a
 * `Content-Disposition` that preserves the original filename on download.
 */

const PRESIGN_TTL_SECONDS = 900; // 15 minutes — enough for a large file on mobile

/**
 * Types we refuse to store. These are only ever served as downloads from a
 * private bucket, but there's no reason to host executables.
 */
const BLOCKED_TYPES = new Set([
  "application/x-msdownload",
  "application/x-msdos-program",
  "application/x-ms-installer",
  "application/vnd.microsoft.portable-executable",
]);

const BLOCKED_EXTENSIONS =
  /\.(exe|msi|bat|cmd|com|scr|cpl|jar|app|dmg|pkg|deb|rpm|sh|ps1|vbs|lnk)$/i;

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

  // Presigning costs nothing (no R2 call), but each signed URL is a potential
  // write against the free-tier Class A allowance, so cap the burst rate.
  const allowed = rateLimit("upload-url", session.user.id, {
    maxAttempts: 40,
    windowMs: 60_000,
  });
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many uploads. Please wait a moment." },
      { status: 429 }
    );
  }

  let body: { fileName?: unknown; contentType?: unknown; size?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const rawName = typeof body.fileName === "string" ? body.fileName : "";
  const fileName = sanitizeFileName(rawName);
  if (!rawName.trim()) {
    return NextResponse.json({ error: "Missing file name" }, { status: 400 });
  }

  const size = typeof body.size === "number" ? body.size : NaN;
  if (!Number.isFinite(size) || size <= 0) {
    return NextResponse.json({ error: "Invalid file size" }, { status: 400 });
  }
  if (size > MAX_FILE_BYTES) {
    return NextResponse.json(
      {
        error: `File is too large (max ${Math.floor(
          MAX_FILE_BYTES / (1024 * 1024)
        )}MB)`,
      },
      { status: 413 }
    );
  }

  const contentType =
    typeof body.contentType === "string" && body.contentType.trim()
      ? body.contentType.trim()
      : "application/octet-stream";

  if (BLOCKED_TYPES.has(contentType) || BLOCKED_EXTENSIONS.test(fileName)) {
    return NextResponse.json(
      { error: "That file type isn't allowed" },
      { status: 400 }
    );
  }

  // Key is namespaced by the *authenticated* user id, never a client value.
  const key = buildFileKey(session.user.id, fileName);

  try {
    const uploadUrl = await presignPut(config, key, PRESIGN_TTL_SECONDS);
    return NextResponse.json(
      {
        key,
        uploadUrl,
        fileName,
        // The client must send these verbatim so R2 stores them as metadata.
        //
        // IMPORTANT: every header listed here ends up in the browser's
        // `Access-Control-Request-Headers` preflight, and R2 rejects the
        // preflight outright (403, no CORS headers) if any of them is missing
        // from the bucket's `AllowedHeaders`. Adding one here without also
        // updating the bucket policy breaks all uploads. Keep this list minimal
        // and in sync with the CORS policy documented in the README.
        headers: {
          "Content-Type": contentType,
          // inline for natively-viewable formats so they can be previewed
          // in-app; attachment for everything else.
          "Content-Disposition": contentDispositionFor(fileName, contentType),
        },
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch {
    return NextResponse.json(
      { error: "Could not prepare the upload" },
      { status: 500 }
    );
  }
}
