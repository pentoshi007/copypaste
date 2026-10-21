import dbConnect from "@/lib/db";
import PageModel from "@/models/Page";
import { OBJECT_ID_PATTERN } from "@/lib/guards";
import { currentUserId } from "@/lib/server/auth";
import { loadPageBlocks } from "@/lib/server/pages";
import { isCrossSiteRequest, jsonError, jsonPrivate } from "@/lib/server/requests";

export async function GET(request: Request, { params }: { params: Promise<{ pageId: string }> }) {
  if (isCrossSiteRequest(request.headers)) return jsonError("Forbidden", 403);

  const userId = await currentUserId();
  if (!userId) return jsonError("Unauthorized", 401);

  const { pageId } = await params;
  if (!OBJECT_ID_PATTERN.test(pageId)) return jsonError("Invalid page id", 400);

  try {
    await dbConnect();
    const page = await PageModel.exists({ _id: pageId, userId, deletedAt: null });
    if (!page) return jsonError("Page not found", 404);

    return jsonPrivate({ blocks: await loadPageBlocks(userId, pageId) });
  } catch {
    return jsonError("Failed to load blocks", 500);
  }
}
