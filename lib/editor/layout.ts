import type { BlockType } from "@/lib/editor/blockTypes";

interface LayoutSource {
  type: BlockType;
  indent: number;
  collapsed: boolean;
}

export interface BlockLayout {
  hidden: boolean;
  number: number;
  hasChildren: boolean;
}

export function computeLayout(blocks: readonly LayoutSource[]): BlockLayout[] {
  const layout: BlockLayout[] = new Array(blocks.length);
  const counters: number[] = [];
  const lastType: (BlockType | undefined)[] = [];
  let hideDeeperThan: number | null = null;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const depth = block.indent;

    if (hideDeeperThan !== null && depth <= hideDeeperThan) hideDeeperThan = null;
    const hidden = hideDeeperThan !== null;

    lastType.length = depth + 1;
    counters.length = depth + 1;
    const continues = lastType[depth] === "numbered";
    counters[depth] = block.type === "numbered" ? (continues ? counters[depth] + 1 : 1) : 0;
    lastType[depth] = block.type;

    const next = blocks[i + 1];
    layout[i] = {
      hidden,
      number: counters[depth],
      hasChildren: next !== undefined && next.indent > depth,
    };

    if (!hidden && block.type === "toggle" && block.collapsed) hideDeeperThan = depth;
  }

  return layout;
}

export function subtreeEnd(blocks: readonly { indent: number }[], index: number): number {
  const root = blocks[index];
  if (!root) return index;
  let end = index;
  while (end + 1 < blocks.length && blocks[end + 1].indent > root.indent) end++;
  return end;
}

export function expandToSubtrees<T extends { key: string; indent: number }>(
  blocks: readonly T[],
  keys: Iterable<string>,
): string[] {
  const wanted = new Set(keys);
  const result: string[] = [];
  for (let i = 0; i < blocks.length; i++) {
    if (!wanted.has(blocks[i].key)) continue;
    const end = subtreeEnd(blocks, i);
    for (let j = i; j <= end; j++) result.push(blocks[j].key);
    i = end;
  }
  return result;
}
