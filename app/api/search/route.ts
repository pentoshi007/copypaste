import { NextResponse } from "next/server";
import { auth } from "@/auth";
import dbConnect from "@/lib/db";
import Note from "@/models/Note";
import { rateLimit } from "@/lib/rateLimit";
import { NOTE_PROJECTION, serializeNote } from "@/lib/serialize";

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;
const MAX_RESULTS = 60;

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

    const notes = await Note.find(
      {
        userId: session.user.id,
        $or: [
          { content: pattern },
          { fileName: pattern },
          { "attachments.fileName": pattern },
          { "attachments.caption": pattern },
        ],
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
