import { NextResponse } from "next/server";
import { getObjectRange, getR2Config } from "@/lib/r2";
import {
  isCrossSiteSubresource,
  OBJECT_ID,
  parseAttachmentIndex,
} from "@/lib/attachment-request";
import { resolveAttachmentKey } from "@/lib/attachment-resolver";
import { TEXT_PREVIEW_MAX_BYTES } from "@/lib/preview";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ noteId: string }> }
) {
  if (isCrossSiteSubresource(request.headers)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { noteId } = await params;
  if (!OBJECT_ID.test(noteId)) {
    return NextResponse.json({ error: "Invalid note id" }, { status: 400 });
  }

  const index = parseAttachmentIndex(request.url);
  if (index !== null && index < 0) {
    return NextResponse.json(
      { error: "Invalid attachment index" },
      { status: 400 }
    );
  }

  const resolved = await resolveAttachmentKey(noteId, index);
  if (!resolved.ok) {
    return NextResponse.json(
      { error: resolved.error },
      { status: resolved.status }
    );
  }

  const config = getR2Config();
  if (!config) {
    return NextResponse.json(
      { error: "File storage isn't configured" },
      { status: 503 }
    );
  }

  try {
    const result = await getObjectRange(
      config,
      resolved.storageKey,
      TEXT_PREVIEW_MAX_BYTES
    );
    if (!result) {
      return NextResponse.json(
        { error: "Could not read the file" },
        { status: 502 }
      );
    }

    return NextResponse.json(
      { text: result.body, truncated: result.truncated },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      }
    );
  } catch {
    return NextResponse.json(
      { error: "Could not read the file" },
      { status: 500 }
    );
  }
}
