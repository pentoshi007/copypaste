import { NextResponse } from "next/server";
import { getObjectRange, getR2Config } from "@/lib/r2";
import { OBJECT_ID_PATTERN } from "@/lib/guards";
import { TEXT_PREVIEW_MAX_BYTES } from "@/lib/preview";
import {
  PRIVATE_HEADERS,
  isCrossSiteSubresource,
  jsonError,
  parseAttachmentIndex,
} from "@/lib/server/requests";
import { resolveFileKey } from "@/lib/server/fileAccess";

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
    const result = await getObjectRange(config, resolved.storageKey, TEXT_PREVIEW_MAX_BYTES);
    if (!result) return jsonError("Could not read the file", 502);

    return NextResponse.json(
      { text: result.body, truncated: result.truncated },
      { headers: { ...PRIVATE_HEADERS, "X-Content-Type-Options": "nosniff" } },
    );
  } catch {
    return jsonError("Could not read the file", 500);
  }
}
