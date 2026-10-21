import Block from "@/models/Block";
import PageModel from "@/models/Page";
import { MAX_BLOCKS_PER_PAGE, MAX_BLOCKS_PER_USER } from "@/lib/editor/blockTypes";
import { MAX_PAGES } from "@/lib/server/pages";

export const MAX_PAGE_DEPTH = 12;

const PAGE_FULL = "This page is full — start a new page";
const ACCOUNT_FULL = "You've reached the block limit for your account";

export async function blockCapacityError(
  userId: string,
  target: { pageId: string | null; account: boolean },
  count: number,
): Promise<string | null> {
  const [onPage, total] = await Promise.all([
    target.pageId
      ? Block.countDocuments({ userId, chatId: target.pageId, deletedAt: null })
      : Promise.resolve(0),
    target.account ? Block.countDocuments({ userId }) : Promise.resolve(0),
  ]);
  if (target.pageId && onPage + count > MAX_BLOCKS_PER_PAGE) return PAGE_FULL;
  if (target.account && total + count > MAX_BLOCKS_PER_USER) return ACCOUNT_FULL;
  return null;
}

export async function pageCapacityError(userId: string, count = 1): Promise<string | null> {
  const total = await PageModel.countDocuments({ userId });
  return total + count > MAX_PAGES ? "You've reached the page limit for your account" : null;
}
