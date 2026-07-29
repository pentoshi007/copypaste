import { NextResponse } from "next/server";
import { auth } from "@/auth";
import dbConnect from "@/lib/db";
import Chat from "@/models/Chat";
import { CHATS_LIMIT, CHAT_PROJECTION, serializeChat } from "@/lib/serialize";

/**
 * The user's chat list.
 *
 * The page seeds this list on load, so this route exists for the refresh
 * button: it's how a chat created on another device turns up without a full
 * reload of the (dynamic, uncached) page, which would re-run auth, both list
 * queries and a whole RSC render.
 */
export async function GET() {
  // Authenticate before opening a database connection, so unauthenticated
  // requests stay cheap and a connection failure can't mask the 401.
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await dbConnect();

    // Scoped by userId — the same projection and serializer the page loader
    // uses, so the client never ends up holding two shapes of the same chat.
    const chats = await Chat.find({ userId: session.user.id }, CHAT_PROJECTION)
      .sort({ updatedAt: -1 })
      .limit(CHATS_LIMIT)
      .lean();

    return NextResponse.json(
      { chats: chats.map(serializeChat) },
      // Per-user data: never store it in a shared or disk cache.
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch {
    return NextResponse.json(
      { error: "Failed to fetch chats" },
      { status: 500 }
    );
  }
}
