import { evenPositions, positionsBetween } from "@/lib/editor/position";
import type { PagePosition } from "@/lib/types";

export interface TreeNode {
  _id: string;
  parentId: string | null;
  position: number;
}

export function byPosition<T extends { position: number }>(a: T, b: T): number {
  return a.position - b.position;
}

export function childrenIndex<T extends TreeNode>(pages: readonly T[]): Map<string | null, T[]> {
  const index = new Map<string | null, T[]>();
  const known = new Set(pages.map((page) => page._id));
  for (const page of pages) {
    const parent = page.parentId && known.has(page.parentId) ? page.parentId : null;
    const list = index.get(parent);
    if (list) list.push(page);
    else index.set(parent, [page]);
  }
  for (const list of index.values()) list.sort(byPosition);
  return index;
}

export function descendantIds(pages: readonly TreeNode[], rootId: string): Set<string> {
  const index = childrenIndex(pages);
  const result = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const child of index.get(current) ?? []) {
      if (result.has(child._id)) continue;
      result.add(child._id);
      stack.push(child._id);
    }
  }
  return result;
}

export function ancestorsOf<T extends TreeNode>(pages: readonly T[], pageId: string): T[] {
  const byId = new Map(pages.map((page) => [page._id, page]));
  const chain: T[] = [];
  const seen = new Set<string>([pageId]);
  let cursor = byId.get(pageId)?.parentId ?? null;
  while (cursor && !seen.has(cursor)) {
    const parent = byId.get(cursor);
    if (!parent) break;
    chain.unshift(parent);
    seen.add(cursor);
    cursor = parent.parentId;
  }
  return chain;
}

export function wouldCreateCycle(
  pages: readonly TreeNode[],
  pageId: string,
  parentId: string | null,
): boolean {
  if (!parentId) return false;
  return descendantIds(pages, pageId).has(parentId);
}

export interface Placement {
  position: number;
  rebalanced: PagePosition[];
}

export function placeAmong(
  siblings: readonly TreeNode[],
  movedId: string,
  beforeId: string | null,
): Placement {
  const others = siblings.filter((page) => page._id !== movedId).sort(byPosition);
  const found = beforeId ? others.findIndex((page) => page._id === beforeId) : -1;
  const index = found === -1 ? others.length : found;

  const [position] = positionsBetween(others[index - 1]?.position, others[index]?.position, 1) ?? [];
  if (position !== undefined) return { position, rebalanced: [] };

  const fresh = evenPositions(others.length + 1);
  const order = [...others.slice(0, index), null, ...others.slice(index)];
  const rebalanced: PagePosition[] = [];
  order.forEach((page, i) => {
    if (page) rebalanced.push({ _id: page._id, position: fresh[i] });
  });
  return { position: fresh[index], rebalanced };
}
