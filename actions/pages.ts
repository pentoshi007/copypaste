"use server";

import { after } from "next/server";
import { z } from "zod";
import Block from "@/models/Block";
import PageModel from "@/models/Page";
import { isAllowedPageIcon } from "@/lib/editor/emoji";
import { MAX_TITLE_LENGTH } from "@/lib/editor/titles";
import { ancestorsOf, descendantIds, placeAmong, wouldCreateCycle } from "@/lib/editor/pageTree";
import { objectId } from "@/lib/validation";
import { fail, runWrite } from "@/lib/server/actions";
import { releaseBlobs, hasBlobs } from "@/lib/server/blobs";
import { copyBlockFields } from "@/lib/server/blockCopy";
import { MAX_PAGE_DEPTH, blockCapacityError, pageCapacityError } from "@/lib/server/limits";
import { createPageDocument, listTreeRows, removePagesPermanently } from "@/lib/server/pages";
import { PAGE_PROJECTION, serializePage } from "@/lib/server/serialize";
import type { ActionResult, Page, PagePatch, PagePosition } from "@/lib/types";

type Raw = Record<string, unknown>;

const title = z.string().trim().max(MAX_TITLE_LENGTH, "Title is too long");
const icon = z.string().max(16).refine(isAllowedPageIcon, "Choose an icon from the picker");

const createSchema = z.object({
  parentId: objectId.nullable(),
  title: title.optional(),
  icon: icon.optional(),
});

const updateSchema = z.object({
  pageId: objectId,
  patch: z.object({
    title: title.optional(),
    icon: icon.optional(),
    favorite: z.boolean().optional(),
    fullWidth: z.boolean().optional(),
  }),
});

const moveSchema = z.object({
  pageId: objectId,
  parentId: objectId.nullable(),
  beforeId: objectId.nullable(),
});

const pageIdSchema = z.object({ pageId: objectId });
const emptySchema = z.object({});

type PageResult = ActionResult<{ page: Page }>;

export async function createPage(input: {
  parentId: string | null;
  title?: string;
  icon?: string;
}): Promise<PageResult> {
  return runWrite(
    createSchema,
    input,
    async (userId, data) => {
      const capacity = await pageCapacityError(userId);
      if (capacity) return fail(capacity);

      if (data.parentId) {
        const rows = await listTreeRows(userId);
        if (!rows.some((row) => row._id === data.parentId)) return fail("Parent page not found");
        if (ancestorsOf(rows, data.parentId).length + 1 >= MAX_PAGE_DEPTH) {
          return fail("Pages can't be nested any deeper");
        }
      }

      const page = await createPageDocument(userId, {
        parentId: data.parentId,
        title: data.title ?? "",
        icon: data.icon ?? "",
      });
      return { ok: true, page };
    },
    "Failed to create page",
  );
}

export async function updatePage(input: { pageId: string; patch: PagePatch }): Promise<ActionResult> {
  return runWrite(
    updateSchema,
    input,
    async (userId, { pageId, patch }) => {
      const set: Raw = { updatedAt: new Date() };
      for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) set[key] = value;
      }
      const result = await PageModel.updateOne({ _id: pageId, userId, deletedAt: null }, { $set: set });
      return result.matchedCount === 1 ? { ok: true } : fail("Page not found");
    },
    "Failed to update page",
  );
}

export async function movePage(input: {
  pageId: string;
  parentId: string | null;
  beforeId: string | null;
}): Promise<ActionResult<{ position: number; rebalanced: PagePosition[] }>> {
  return runWrite(
    moveSchema,
    input,
    async (userId, { pageId, parentId, beforeId }) => {
      const rows = await listTreeRows(userId);
      if (!rows.some((row) => row._id === pageId)) return fail("Page not found");
      if (parentId && !rows.some((row) => row._id === parentId)) return fail("Destination not found");
      if (wouldCreateCycle(rows, pageId, parentId)) return fail("A page can't be moved inside itself");

      const depthBelow = (id: string): number => {
        const children = rows.filter((row) => row.parentId === id);
        return children.length === 0 ? 0 : 1 + Math.max(...children.map((child) => depthBelow(child._id)));
      };
      const parentDepth = parentId ? ancestorsOf(rows, parentId).length + 1 : 0;
      if (parentDepth + 1 + depthBelow(pageId) > MAX_PAGE_DEPTH) {
        return fail("Pages can't be nested any deeper");
      }

      const siblings = rows.filter((row) => row.parentId === parentId);
      const validBefore = beforeId && siblings.some((row) => row._id === beforeId) ? beforeId : null;
      const placement = placeAmong(siblings, pageId, validBefore);

      await PageModel.bulkWrite(
        [
          {
            updateOne: {
              filter: { _id: pageId, userId, deletedAt: null },
              update: { $set: { parentId, position: placement.position, updatedAt: new Date() } },
            },
          },
          ...placement.rebalanced.map((row) => ({
            updateOne: {
              filter: { _id: row._id, userId },
              update: { $set: { position: row.position } },
            },
          })),
        ],
        { ordered: true },
      );
      return { ok: true, position: placement.position, rebalanced: placement.rebalanced };
    },
    "Failed to move page",
  );
}

export async function duplicatePage(input: {
  pageId: string;
}): Promise<ActionResult<{ page: Page; rebalanced: PagePosition[] }>> {
  return runWrite(
    pageIdSchema,
    input,
    async (userId, { pageId }) => {
      const source = await PageModel.findOne(
        { _id: pageId, userId, deletedAt: null },
        PAGE_PROJECTION,
      ).lean<Raw>();
      if (!source) return fail("Page not found");

      const pageCapacity = await pageCapacityError(userId);
      if (pageCapacity) return fail(pageCapacity);

      const blocks = await Block.find({ userId, chatId: pageId, deletedAt: null })
        .sort({ position: 1 })
        .lean<Raw[]>();
      const blockCapacity = await blockCapacityError(userId, pageId, blocks.length, "page-and-account");
      if (blockCapacity) return fail(blockCapacity);

      const original = serializePage(source);
      const rows = await listTreeRows(userId);
      const siblings = rows
        .filter((row) => row.parentId === original.parentId)
        .sort((a, b) => a.position - b.position);
      const next = siblings[siblings.findIndex((row) => row._id === pageId) + 1];
      const placement = placeAmong(siblings, "", next?._id ?? null);

      const now = new Date();
      const copy = await PageModel.create({
        userId,
        title: `${original.title || "Untitled"} (copy)`.slice(0, MAX_TITLE_LENGTH),
        icon: original.icon,
        parentId: original.parentId,
        position: placement.position,
        fullWidth: original.fullWidth,
        createdAt: now,
        updatedAt: now,
      });

      if (placement.rebalanced.length > 0) {
        await PageModel.bulkWrite(
          placement.rebalanced.map((row) => ({
            updateOne: { filter: { _id: row._id, userId }, update: { $set: { position: row.position } } },
          })),
        );
      }

      if (blocks.length > 0) {
        await Block.insertMany(
          blocks.map((block) => ({
            ...copyBlockFields(block),
            userId,
            chatId: copy._id,
            position: block.position,
            indent: block.indent ?? 0,
            createdAt: now,
            updatedAt: now,
          })),
        );
      }

      return { ok: true, page: serializePage(copy.toObject()), rebalanced: placement.rebalanced };
    },
    "Failed to duplicate page",
  );
}

export async function trashPage(input: { pageId: string }): Promise<ActionResult<{ trashedIds: string[] }>> {
  return runWrite(
    pageIdSchema,
    input,
    async (userId, { pageId }) => {
      const rows = await listTreeRows(userId);
      if (!rows.some((row) => row._id === pageId)) return fail("Page not found");

      const ids = [...descendantIds(rows, pageId)];
      await PageModel.updateMany(
        { _id: { $in: ids }, userId, deletedAt: null },
        { $set: { deletedAt: new Date(), trashRootId: pageId, favorite: false } },
      );
      return { ok: true, trashedIds: ids };
    },
    "Failed to move page to trash",
  );
}

export async function restorePage(input: { pageId: string }): Promise<ActionResult<{ pages: Page[] }>> {
  return runWrite(
    pageIdSchema,
    input,
    async (userId, { pageId }) => {
      const root = await PageModel.findOne(
        { _id: pageId, userId, trashRootId: pageId },
        { parentId: 1 },
      ).lean<Raw>();
      if (!root) return fail("Page not found in trash");

      const parentActive = root.parentId
        ? await PageModel.exists({ _id: root.parentId, userId, deletedAt: null })
        : null;

      await PageModel.updateMany(
        { userId, trashRootId: pageId },
        { $set: { deletedAt: null, trashRootId: null, updatedAt: new Date() } },
      );
      if (root.parentId && !parentActive) {
        await PageModel.updateOne({ _id: pageId, userId }, { $set: { parentId: null } });
      }

      const restored = await PageModel.find(
        { _id: { $in: [...descendantIds(await listTreeRows(userId), pageId)] }, userId },
        PAGE_PROJECTION,
      ).lean<Raw[]>();
      return { ok: true, pages: restored.map(serializePage) };
    },
    "Failed to restore page",
  );
}

async function destroyPages(userId: string, filter: Raw): Promise<void> {
  const pages = await PageModel.find({ ...filter, userId, deletedAt: { $ne: null } }, { _id: 1 }).lean<
    Raw[]
  >();
  const refs = await removePagesPermanently(
    userId,
    pages.map((page) => String(page._id)),
  );
  if (hasBlobs(refs)) after(() => releaseBlobs(userId, refs));
}

export async function deletePageForever(input: { pageId: string }): Promise<ActionResult> {
  return runWrite(
    pageIdSchema,
    input,
    async (userId, { pageId }) => {
      const exists = await PageModel.exists({ _id: pageId, userId, trashRootId: pageId });
      if (!exists) return fail("Page not found in trash");
      await destroyPages(userId, { trashRootId: pageId });
      return { ok: true };
    },
    "Failed to delete page",
  );
}

export async function emptyTrash(): Promise<ActionResult> {
  return runWrite(
    emptySchema,
    {},
    async (userId) => {
      await destroyPages(userId, {});
      return { ok: true };
    },
    "Failed to empty trash",
  );
}
