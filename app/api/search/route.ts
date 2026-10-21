import dbConnect from "@/lib/db";
import Block from "@/models/Block";
import PageModel from "@/models/Page";
import { rateLimit } from "@/lib/rateLimit";
import { currentUserId } from "@/lib/server/auth";
import { MAX_PAGES } from "@/lib/server/pages";
import { BLOCK_PROJECTION, PAGE_PROJECTION, serializeBlock, serializePage } from "@/lib/server/serialize";
import { isCrossSiteRequest, jsonError, jsonPrivate } from "@/lib/server/requests";
import type { SearchResults } from "@/lib/types";

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;
const MAX_BLOCK_RESULTS = 60;
const MAX_PAGE_RESULTS = 12;
const SEARCH_LIMIT = { maxAttempts: 120, windowMs: 60_000 };

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function GET(request: Request) {
  if (isCrossSiteRequest(request.headers)) return jsonError("Forbidden", 403);

  const userId = await currentUserId();
  if (!userId) return jsonError("Unauthorized", 401);

  if (!rateLimit("search", userId, SEARCH_LIMIT)) {
    return jsonError("Too many searches. Please wait a moment.", 429);
  }

  const query = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (query.length > MAX_QUERY_LENGTH) return jsonError("Query too long", 400);

  const empty: SearchResults = { query, pages: [], blocks: [], truncated: false };
  if (query.length < MIN_QUERY_LENGTH) return jsonPrivate(empty);

  try {
    await dbConnect();
    const pattern = new RegExp(escapeRegex(query), "i");

    const activePages = await PageModel.find({ userId, deletedAt: null }, PAGE_PROJECTION)
      .limit(MAX_PAGES)
      .lean<Record<string, unknown>[]>();
    const activeIds = activePages.map((page) => page._id);

    const blocks = await Block.find(
      {
        userId,
        deletedAt: null,
        chatId: { $in: activeIds },
        $or: [
          { content: pattern },
          { fileName: pattern },
          { "attachments.fileName": pattern },
          { "attachments.caption": pattern },
        ],
      },
      BLOCK_PROJECTION,
    )
      .sort({ createdAt: -1 })
      .limit(MAX_BLOCK_RESULTS)
      .lean<Record<string, unknown>[]>();

    const pages = activePages
      .map(serializePage)
      .filter((page) => pattern.test(page.title))
      .slice(0, MAX_PAGE_RESULTS);

    const results: SearchResults = {
      query,
      pages,
      blocks: blocks.map(serializeBlock),
      truncated: blocks.length === MAX_BLOCK_RESULTS,
    };
    return jsonPrivate(results);
  } catch {
    return jsonError("Search failed", 500);
  }
}
