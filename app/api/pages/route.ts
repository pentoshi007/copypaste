import dbConnect from "@/lib/db";
import { currentUserId } from "@/lib/server/auth";
import { listActivePages } from "@/lib/server/pages";
import { isCrossSiteRequest, jsonError, jsonPrivate } from "@/lib/server/requests";

export async function GET(request: Request) {
  if (isCrossSiteRequest(request.headers)) return jsonError("Forbidden", 403);

  const userId = await currentUserId();
  if (!userId) return jsonError("Unauthorized", 401);

  try {
    await dbConnect();
    return jsonPrivate({ pages: await listActivePages(userId) });
  } catch {
    return jsonError("Failed to load pages", 500);
  }
}
