import PageModel from "@/models/Page";
import Block from "@/models/Block";
import { BLOCK_PROJECTION, PAGE_PROJECTION, serializeBlock, serializePage } from "@/lib/server/serialize";
import { BLOB_PROJECTION, collectBlobs, type BlobHolder, type BlobRefs } from "@/lib/server/blobs";
import { MAX_BLOCKS_PER_PAGE } from "@/lib/editor/blockTypes";
import { POSITION_STEP, evenPositions } from "@/lib/editor/position";
import type { Block as BlockItem, Page } from "@/lib/types";

export const MAX_PAGES = 1000;

type Raw = Record<string, unknown>;

export interface TreeRow {
  _id: string;
  parentId: string | null;
  position: number;
}

async function backfillPagePositions(userId: string): Promise<void> {
  const docs = await PageModel.find({ userId }, { _id: 1, position: 1, updatedAt: 1 })
    .sort({ updatedAt: -1 })
    .lean<Raw[]>();

  const positioned = docs.filter((doc) => typeof doc.position === "number");
  const legacy = docs.filter((doc) => typeof doc.position !== "number");
  const start = positioned.reduce((max, doc) => Math.max(max, doc.position as number), 0);

  await PageModel.bulkWrite(
    legacy.map((doc, index) => ({
      updateOne: {
        filter: { _id: doc._id, userId },
        update: { $set: { position: start + (index + 1) * POSITION_STEP } },
      },
    })),
  );
}

export async function listActivePages(userId: string): Promise<Page[]> {
  const load = () =>
    PageModel.find({ userId, deletedAt: null }, PAGE_PROJECTION)
      .sort({ position: 1 })
      .limit(MAX_PAGES)
      .lean<Raw[]>();

  let docs = await load();
  if (docs.some((doc) => typeof doc.position !== "number")) {
    await backfillPagePositions(userId);
    docs = await load();
  }
  return docs.map(serializePage);
}

export async function listTreeRows(userId: string): Promise<TreeRow[]> {
  const docs = await PageModel.find({ userId, deletedAt: null }, { _id: 1, parentId: 1, position: 1 })
    .limit(MAX_PAGES)
    .lean<Raw[]>();
  return docs.map((doc) => ({
    _id: String(doc._id),
    parentId: doc.parentId ? String(doc.parentId) : null,
    position: typeof doc.position === "number" ? doc.position : 0,
  }));
}

const BACKFILL_BATCH = 1000;

async function writePositions(
  model: typeof Block,
  userId: string,
  rows: { _id: unknown; position: number }[],
) {
  for (let i = 0; i < rows.length; i += BACKFILL_BATCH) {
    await model.bulkWrite(
      rows.slice(i, i + BACKFILL_BATCH).map((row) => ({
        updateOne: { filter: { _id: row._id, userId }, update: { $set: { position: row.position } } },
      })),
      { ordered: false },
    );
  }
}

async function backfillBlockPositions(userId: string, pageId: string): Promise<void> {
  const docs = await Block.find({ userId, chatId: pageId }, { _id: 1, position: 1, createdAt: 1 })
    .sort({ createdAt: 1 })
    .lean<Raw[]>();

  const legacy = docs.filter((doc) => typeof doc.position !== "number");
  if (legacy.length === 0) return;
  const positioned = docs
    .filter((doc) => typeof doc.position === "number")
    .sort((a, b) => (a.position as number) - (b.position as number));
  const ordered = [...legacy, ...positioned];
  const positions = evenPositions(ordered.length);

  await writePositions(
    Block,
    userId,
    ordered.map((doc, index) => ({ _id: doc._id, position: positions[index] })),
  );
}

export async function ensureBlockPositions(userId: string, pageId: string): Promise<void> {
  const unpositioned = await Block.exists({ userId, chatId: pageId, position: { $exists: false } });
  if (unpositioned) await backfillBlockPositions(userId, pageId);
}

export async function loadPageBlocks(userId: string, pageId: string): Promise<BlockItem[]> {
  await ensureBlockPositions(userId, pageId);
  const docs = await Block.find({ userId, chatId: pageId, deletedAt: null }, BLOCK_PROJECTION)
    .sort({ position: 1, createdAt: 1 })
    .limit(MAX_BLOCKS_PER_PAGE)
    .lean<Raw[]>();
  return docs.map(serializeBlock);
}

export async function touchActivePage(userId: string, pageId: string): Promise<boolean> {
  const result = await PageModel.updateOne(
    { _id: pageId, userId, deletedAt: null },
    { $set: { updatedAt: new Date() } },
  );
  return result.matchedCount === 1;
}

export async function siblingEdge(
  userId: string,
  parentId: string | null,
  edge: "first" | "last",
): Promise<number | undefined> {
  const doc = await PageModel.findOne({ userId, parentId, deletedAt: null }, { position: 1 })
    .sort({ position: edge === "first" ? 1 : -1 })
    .lean<Raw>();
  return typeof doc?.position === "number" ? doc.position : undefined;
}

export async function createPageDocument(
  userId: string,
  fields: { parentId: string | null; title: string; icon: string },
): Promise<Page> {
  const atTop = fields.parentId === null;
  const edge = await siblingEdge(userId, fields.parentId, atTop ? "first" : "last");
  const position = edge === undefined ? POSITION_STEP : atTop ? edge - POSITION_STEP : edge + POSITION_STEP;

  const doc = await PageModel.create({ userId, ...fields, position });
  return serializePage(doc.toObject());
}

export async function removePagesPermanently(userId: string, pageIds: readonly string[]): Promise<BlobRefs> {
  if (pageIds.length === 0) return { objectKeys: [], publicIds: [] };

  const holders = await Block.find({ userId, chatId: { $in: pageIds } }, BLOB_PROJECTION).lean<
    BlobHolder[]
  >();

  await Block.deleteMany({ userId, chatId: { $in: pageIds } });
  await PageModel.deleteMany({ userId, _id: { $in: pageIds } });

  return collectBlobs(holders);
}
