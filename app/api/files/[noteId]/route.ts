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
  // Refuse downloads initiated by another site. Browsers set Sec-Fetch-Site and
  // script can't forge it, so this blocks a hostile page from making a visitor's
  // browser pull their files. Requests without the header (curl, old browsers)
  // fall through — they still need a valid session cookie.
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
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
