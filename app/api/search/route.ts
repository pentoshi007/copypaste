import { NextResponse } from "next/server";
import { auth } from "@/auth";
import dbConnect from "@/lib/db";
import Note from "@/models/Note";
import { rateLimit } from "@/lib/rateLimit";
import { NOTE_PROJECTION, serializeNote } from "@/lib/serialize";

/**
 * Searches the caller's notes by substring across message text, captions and
 * attachment filenames.
 *
 * Substring matching rather than MongoDB's `$text` index: `$text` is word-based
 * with stemming, so "auth" wouldn't find "authenticate" and "pdf" wouldn't find
 * "report.pdf" — which is exactly what people expect from a clipboard search.
 * The trade-off is that a regex can't be served from an index, so the query is
 * bounded instead: scoped to one user, sorted along the
 * { userId, createdAt: -1 } index so matching can stop at the limit, and
 * projected down to the fields the list needs.
 */

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;
const MAX_RESULTS = 60;

/**
 * Escapes regex metacharacters so the query is matched literally.
 *
 * Without this the input is a regex: `(a+)+$` would be a ReDoS vector, and a
 * stray `[` would throw. After escaping the pattern is a literal string, so
 * matching is linear in the input.
 */
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Debouncing on the client already keeps this quiet; the cap is here so a
  // scripted caller can't turn search into a collection scan generator.
  if (
    !rateLimit("search", session.user.id, {
      maxAttempts: 120,
      windowMs: 60_000,
    })
  ) {
    return NextResponse.json(
      { error: "Too many searches. Please wait a moment." },
      { status: 429 }
    );
  }

  const raw = new URL(request.url).searchParams.get("q") ?? "";
  const query = raw.trim();

  if (query.length > MAX_QUERY_LENGTH) {
    return NextResponse.json({ error: "Query too long" }, { status: 400 });
  }
  if (query.length < MIN_QUERY_LENGTH) {
    return NextResponse.json(
      { results: [], query },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  }

  try {
    await dbConnect();

    const pattern = new RegExp(escapeRegex(query), "i");

    // CRITICAL: scope by userId — search must never reach another user's notes.
    const notes = await Note.find(
      {
        userId: session.user.id,
        $or: [{ content: pattern }, { fileName: pattern }],
      },
      NOTE_PROJECTION
    )
      .sort({ createdAt: -1 })
      .limit(MAX_RESULTS)
      .lean();

    return NextResponse.json(
      {
        results: notes.map(serializeNote),
        query,
        truncated: notes.length === MAX_RESULTS,
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
