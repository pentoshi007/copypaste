import Block from "@/models/Block";
import PageModel from "@/models/Page";
import { MAX_BLOCKS_PER_PAGE, MAX_BLOCKS_PER_USER } from "@/lib/editor/blockTypes";
import { MAX_PAGES } from "@/lib/server/pages";

export const MAX_PAGE_DEPTH = 12;

export async function blockCapacityError(
  userId: string,
  pageId: string,
  count: number,
  scope: "page" | "page-and-account" = "page-and-account",
): Promise<string | null> {
  const [onPage, total] = await Promise.all([
    Block.countDocuments({ userId, chatId: pageId, deletedAt: null }),
    scope === "page" ? Promise.resolve(0) : Block.countDocuments({ userId }),
  ]);
  if (onPage + count > MAX_BLOCKS_PER_PAGE) return "This page is full — start a new page";
  if (total + count > MAX_BLOCKS_PER_USER) return "You've reached the block limit for your account";
  return null;
}

export async function pageCapacityError(userId: string, count = 1): Promise<string | null> {
  const total = await PageModel.countDocuments({ userId });
  return total + count > MAX_PAGES ? "You've reached the page limit for your account" : null;
}
