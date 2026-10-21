import dbConnect from "@/lib/db";
import PageModel from "@/models/Page";
import { currentUserId } from "@/lib/server/auth";
import { MAX_PAGES } from "@/lib/server/pages";
import { serializeTrashedPage } from "@/lib/server/serialize";
import { isCrossSiteRequest, jsonError, jsonPrivate } from "@/lib/server/requests";

export async function GET(request: Request) {
  if (isCrossSiteRequest(request.headers)) return jsonError("Forbidden", 403);

  const userId = await currentUserId();
  if (!userId) return jsonError("Unauthorized", 401);

  try {
    await dbConnect();
    const docs = await PageModel.find(
      { userId, deletedAt: { $ne: null }, $expr: { $eq: ["$_id", "$trashRootId"] } },
      { _id: 1, title: 1, icon: 1, deletedAt: 1 },
    )
      .sort({ deletedAt: -1 })
      .limit(MAX_PAGES)
      .lean<Record<string, unknown>[]>();

    return jsonPrivate({ pages: docs.map(serializeTrashedPage) });
  } catch {
    return jsonError("Failed to load trash", 500);
  }
}
