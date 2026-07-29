import { NextResponse } from "next/server";
import { auth } from "@/auth";
import dbConnect from "@/lib/db";
import Note from "@/models/Note";
import { getR2Config, presignGet } from "@/lib/r2";

/**
 * Downloads a file attachment.
 *
 * The bucket is private, so this route is the only way in. It verifies the note
 * belongs to the caller and then redirects to a short-lived signed GET — the
 * file streams from Cloudflare's edge rather than through this server, so we pay
 * no bandwidth and add no latency beyond the redirect.
 *
 * Because the browser follows the redirect as a top-level navigation, no CORS
 * configuration is needed for downloads.
 */

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const DOWNLOAD_TTL_SECONDS = 120;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ noteId: string }> }
) {
  // Block cross-site *subresource* requests — a hostile page embedding this URL
  // in an <img> or <iframe> to make a visitor's browser pull their own files.
  //
  // Top-level navigations are allowed from any initiator, because a legitimate
  // one isn't always same-origin: when an installed PWA opens a link with
  // target="_blank", Chrome hands it to the browser as a fresh context and
  // reports Sec-Fetch-Site: cross-site. Gating on that alone returned 403 inside
  // the installed app while the identical click worked in a browser tab.
  //
  // Same-origin requests of any destination stay allowed, since the in-app
  // preview deliberately loads this route as an iframe/video/audio subresource.
  //
  // This is defence in depth rather than the actual control. What protects the
  // file is: a valid session is required; the note is looked up scoped to the
  // caller's userId, so only ever their own file is reachable; the route sends
  // no CORS headers, so a cross-origin fetch cannot read the response; the
  // session cookie is SameSite=Lax, so it isn't even sent on cross-site
  // subresource requests (those get 401); and frame-ancestors 'self' stops other
  // origins framing it.
  const fetchSite = request.headers.get("sec-fetch-site");
  const fetchDest = request.headers.get("sec-fetch-dest");
  const sameOrigin =
    !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
  const topLevelNavigation = fetchDest === "document";
  if (!sameOrigin && !topLevelNavigation) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Authenticate before opening a database connection, so unauthenticated
  // requests stay cheap and a connection failure can't mask the 401.
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { noteId } = await params;
  if (!OBJECT_ID.test(noteId)) {
    return NextResponse.json({ error: "Invalid note id" }, { status: 400 });
  }

  const config = getR2Config();
  if (!config) {
    return NextResponse.json(
      { error: "File storage isn't configured" },
      { status: 503 }
    );
  }

  try {
    await dbConnect();

    // CRITICAL: scope by userId — the note id alone must never grant access.
    const note = await Note.findOne(
      { _id: noteId, userId: session.user.id },
      { storageKey: 1, storage: 1 }
    ).lean();

    if (!note?.storageKey || note.storage !== "r2") {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const url = await presignGet(config, note.storageKey, DOWNLOAD_TTL_SECONDS);

    // 302 rather than 307: this is a plain GET, and the signed URL is
    // single-use-ish (short TTL), so it must never be cached.
    return NextResponse.redirect(url, {
      status: 302,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Could not prepare the download" },
      { status: 500 }
    );
  }
}
