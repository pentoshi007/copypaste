import { NextResponse } from "next/server";
import { getR2Config, presignGet } from "@/lib/r2";
import { OBJECT_ID_PATTERN } from "@/lib/guards";
import {
  PRIVATE_HEADERS,
  isCrossSiteSubresource,
  jsonError,
  parseAttachmentIndex,
} from "@/lib/server/requests";
import { resolveFileKey } from "@/lib/server/fileAccess";

const DOWNLOAD_TTL_SECONDS = 120;

export async function GET(request: Request, { params }: { params: Promise<{ blockId: string }> }) {
  if (isCrossSiteSubresource(request.headers)) return jsonError("Forbidden", 403);

  const { blockId } = await params;
  if (!OBJECT_ID_PATTERN.test(blockId)) return jsonError("Invalid block id", 400);

  const index = parseAttachmentIndex(request.url);
  if (index !== null && index < 0) return jsonError("Invalid attachment index", 400);

  const resolved = await resolveFileKey(blockId, index);
  if (!resolved.ok) return jsonError(resolved.error, resolved.status);

  const config = getR2Config();
  if (!config) return jsonError("File storage isn't configured", 503);

  try {
    const url = await presignGet(config, resolved.storageKey, DOWNLOAD_TTL_SECONDS);
    return NextResponse.redirect(url, { status: 302, headers: PRIVATE_HEADERS });
  } catch {
    return jsonError("Could not prepare the download", 500);
  }
}
