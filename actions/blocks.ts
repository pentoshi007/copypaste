"use server";

import { after } from "next/server";
import { z } from "zod";
import Block from "@/models/Block";
import PageModel from "@/models/Page";
import {
  BLOCK_COLORS,
  BLOCK_TYPES,
  MAX_BLOCKS_PER_PAGE,
  MAX_BLOCKS_PER_REQUEST,
  MAX_CAPTION_LENGTH,
  MAX_CONTENT_LENGTH,
  MAX_INDENT,
  MAX_LANGUAGE_LENGTH,
  canConvert,
  type BlockType,
} from "@/lib/editor/blockTypes";
import { POSITION_STEP } from "@/lib/editor/position";
import { isHttpUrl } from "@/lib/guards";
import { objectId } from "@/lib/validation";
import { fail, runWrite } from "@/lib/server/actions";
import { verifyAttachment, type VerifiedAttachment } from "@/lib/server/attachments";
import { releaseBlobs } from "@/lib/server/blobs";
import { copyBlockFields } from "@/lib/server/blockCopy";
import { blockCapacityError } from "@/lib/server/limits";
import { touchActivePage } from "@/lib/server/pages";
import { BLOCK_PROJECTION, serializeBlock } from "@/lib/server/serialize";
import { consumeUploads } from "@/lib/server/uploads";
import type {
  ActionResult,
  AttachmentInput,
  Block as BlockItem,
  BlockPatch,
  BlockPlacement,
  DuplicatePlacement,
  NewBlockInput,
} from "@/lib/types";

type Raw = Record<string, unknown>;

const position = z.number().refine(Number.isFinite, "Invalid position");
const indent = z.number().int().min(0).max(MAX_INDENT);
const blockIds = z
  .array(objectId)
  .min(1)
  .max(MAX_BLOCKS_PER_REQUEST * 5);

const attachmentSchema = z.object({
  kind: z.enum(["image", "file"]),
  fileName: z.string().max(255),
  fileSize: z.number().int().nonnegative(),
  mimeType: z.string().max(255),
  imageUrl: z.string().max(2048).optional(),
  publicId: z.string().max(256).optional(),
  storageKey: z.string().max(512).optional(),
});

const newBlockSchema = z.object({
  type: z.enum(BLOCK_TYPES),
  content: z.string().max(MAX_CONTENT_LENGTH, "Block is too long"),
  language: z.string().max(MAX_LANGUAGE_LENGTH),
  position,
  indent,
  checked: z.boolean(),
  color: z.enum(BLOCK_COLORS),
  attachment: attachmentSchema.optional(),
});

const createSchema = z.object({
  pageId: objectId,
  blocks: z.array(newBlockSchema).min(1).max(MAX_BLOCKS_PER_REQUEST),
});

const patchSchema = z.object({
  content: z.string().max(MAX_CONTENT_LENGTH, "Block is too long").optional(),
  type: z.enum(BLOCK_TYPES).optional(),
  language: z.string().max(MAX_LANGUAGE_LENGTH).optional(),
  checked: z.boolean().optional(),
  indent: indent.optional(),
  collapsed: z.boolean().optional(),
  color: z.enum(BLOCK_COLORS).optional(),
});

const updateSchema = z.object({ blockId: objectId, patch: patchSchema });

const placementSchema = z.object({ blockId: objectId, position, indent });

const moveSchema = z.object({
  pageId: objectId,
  placements: z.array(placementSchema).min(1).max(MAX_BLOCKS_PER_PAGE),
});

const moveToPageSchema = z.object({ pageId: objectId, blockIds });

const idsSchema = z.object({ blockIds });

const duplicatePlacementSchema = z.object({
  blockId: objectId,
  position,
  indent,
  content: z.string().max(MAX_CONTENT_LENGTH, "Block is too long"),
  language: z.string().max(MAX_LANGUAGE_LENGTH),
  checked: z.boolean(),
  collapsed: z.boolean(),
  color: z.enum(BLOCK_COLORS),
});

const duplicateSchema = z.object({
  pageId: objectId,
  placements: z.array(duplicatePlacementSchema).min(1).max(MAX_BLOCKS_PER_REQUEST),
});

const captionSchema = z.object({
  blockId: objectId,
  index: z.number().int().nonnegative().max(1000),
  caption: z.string().max(MAX_CAPTION_LENGTH, "Caption is too long"),
});

const ungroupSchema = z.object({
  blockId: objectId,
  positions: z.array(position).min(1).max(MAX_BLOCKS_PER_REQUEST),
});

type BlocksResult = ActionResult<{ blocks: BlockItem[] }>;

function contentFor(type: BlockType, content: string): string | { error: string } {
  if (type === "divider") return "";
  if (type === "link") {
    const url = content.trim();
    return url && !isHttpUrl(url) ? { error: "Please enter a valid http/https URL" } : url;
  }
  return content;
}

function attachmentFields(verified: VerifiedAttachment): Raw {
  return verified.storage === "cloudinary"
    ? {
        storage: "cloudinary",
        imageUrl: verified.imageUrl,
        publicId: verified.publicId,
        fileName: verified.fileName,
        fileSize: verified.fileSize,
        mimeType: verified.mimeType,
      }
    : {
        storage: "r2",
        storageKey: verified.storageKey,
        fileName: verified.fileName,
        fileSize: verified.fileSize,
        mimeType: verified.mimeType,
      };
}

function scheduleOrphanCleanup(userId: string, orphans: { kind: "image" | "file"; key: string }[]) {
  if (orphans.length === 0) return;
  after(() =>
    releaseBlobs(userId, {
      objectKeys: orphans.filter((o) => o.kind === "file").map((o) => o.key),
      publicIds: orphans.filter((o) => o.kind === "image").map((o) => o.key),
    }),
  );
}

async function prepareBlock(
  input: NewBlockInput,
  userId: string,
): Promise<
  | { ok: true; doc: Raw; reservedKey?: string }
  | { ok: false; error: string; orphan?: { kind: "image" | "file"; key: string } }
> {
  if (input.type === "group") return { ok: false, error: "Groups can't be created directly" };

  const content = contentFor(input.type, input.content);
  if (typeof content !== "string") return { ok: false, error: content.error };

  const base: Raw = {
    type: input.type,
    content,
    language: input.type === "code" ? input.language : "",
    position: input.position,
    indent: input.indent,
    checked: input.type === "todo" ? input.checked : false,
    color: input.color,
    storage: "none",
  };

  const needsAttachment = input.type === "image" || input.type === "file";
  if (!needsAttachment) {
    return input.attachment ? { ok: false, error: "Unexpected attachment" } : { ok: true, doc: base };
  }

  const attachment: AttachmentInput | undefined = input.attachment;
  if (!attachment || attachment.kind !== input.type) {
    return { ok: false, error: "Upload incomplete" };
  }

  const verified = await verifyAttachment(attachment, userId);
  if (!verified.ok) return verified;

  const reservedKey =
    verified.value.storage === "cloudinary" ? verified.value.publicId : verified.value.storageKey;
  return { ok: true, doc: { ...base, ...attachmentFields(verified.value) }, reservedKey };
}

export async function createBlocks(input: {
  pageId: string;
  blocks: NewBlockInput[];
}): Promise<BlocksResult> {
  return runWrite(
    createSchema,
    input,
    async (userId, { pageId, blocks }) => {
      if (!(await touchActivePage(userId, pageId))) return fail("Page not found");

      const capacity = await blockCapacityError(userId, pageId, blocks.length);
      if (capacity) return fail(capacity);

      const prepared = await Promise.all(blocks.map((block) => prepareBlock(block, userId)));
      const failure = prepared.find((result) => !result.ok);
      if (failure && !failure.ok) {
        scheduleOrphanCleanup(
          userId,
          prepared.flatMap((result) => (!result.ok && result.orphan ? [result.orphan] : [])),
        );
        return fail(failure.error);
      }

      const now = new Date();
      const docs = prepared.map((result) => ({
        ...(result.ok ? result.doc : {}),
        userId,
        chatId: pageId,
        createdAt: now,
        updatedAt: now,
      }));
      const created = await Block.insertMany(docs);

      await consumeUploads(
        userId,
        prepared.flatMap((result) => (result.ok && result.reservedKey ? [result.reservedKey] : [])),
      );

      return { ok: true, blocks: created.map((doc) => serializeBlock(doc.toObject())) };
    },
    "Failed to save",
  );
}

export async function updateBlock(input: { blockId: string; patch: BlockPatch }): Promise<ActionResult> {
  return runWrite(
    updateSchema,
    input,
    async (userId, { blockId, patch }) => {
      const existing = await Block.findOne(
        { _id: blockId, userId, deletedAt: null },
        { type: 1, content: 1, chatId: 1 },
      ).lean<Raw>();
      if (!existing) return fail("Block not found");

      const currentType = existing.type as BlockType;
      const nextType = patch.type ?? currentType;
      if (patch.type && patch.type !== currentType) {
        if (!canConvert(currentType, patch.type)) return fail("This block can't be converted");
        if (patch.type === "divider" && (patch.content ?? String(existing.content ?? "")).trim()) {
          return fail("Only empty blocks can become dividers");
        }
      }

      const set: Raw = { updatedAt: new Date() };
      if (patch.type !== undefined) set.type = patch.type;
      if (patch.content !== undefined || patch.type !== undefined) {
        const content = contentFor(nextType, patch.content ?? String(existing.content ?? ""));
        if (typeof content !== "string") return fail(content.error);
        set.content = content;
      }
      if (patch.language !== undefined && nextType === "code") set.language = patch.language;
      if (patch.checked !== undefined && nextType === "todo") set.checked = patch.checked;
      if (patch.collapsed !== undefined) set.collapsed = patch.collapsed;
      if (patch.indent !== undefined) set.indent = patch.indent;
      if (patch.color !== undefined) set.color = patch.color;

      await Promise.all([
        Block.updateOne({ _id: blockId, userId }, { $set: set }),
        touchActivePage(userId, String(existing.chatId)),
      ]);
      return { ok: true };
    },
    "Failed to save",
  );
}

export async function moveBlocks(input: {
  pageId: string;
  placements: BlockPlacement[];
}): Promise<ActionResult> {
  return runWrite(
    moveSchema,
    input,
    async (userId, { pageId, placements }) => {
      if (!(await touchActivePage(userId, pageId))) return fail("Page not found");

      const now = new Date();
      await Block.bulkWrite(
        placements.map((placement) => ({
          updateOne: {
            filter: { _id: placement.blockId, userId, chatId: pageId, deletedAt: null },
            update: {
              $set: { position: placement.position, indent: placement.indent, updatedAt: now },
            },
          },
        })),
        { ordered: false },
      );
      return { ok: true };
    },
    "Failed to move",
  );
}

export async function moveBlocksToPage(input: { pageId: string; blockIds: string[] }): Promise<ActionResult> {
  return runWrite(
    moveToPageSchema,
    input,
    async (userId, { pageId, blockIds: ids }) => {
      if (!(await touchActivePage(userId, pageId))) return fail("Page not found");

      const capacity = await blockCapacityError(userId, pageId, ids.length, "page");
      if (capacity) return fail(capacity);

      const sources = await Block.find(
        { _id: { $in: ids }, userId, deletedAt: null },
        { _id: 1, indent: 1 },
      ).lean<Raw[]>();
      const byId = new Map(sources.map((source) => [String(source._id), source]));
      const ordered = ids.map((id) => byId.get(id)).filter((source): source is Raw => Boolean(source));
      if (ordered.length === 0) return fail("Blocks not found");

      const last = await Block.findOne({ userId, chatId: pageId, deletedAt: null }, { position: 1 })
        .sort({ position: -1 })
        .lean<Raw>();
      const start = typeof last?.position === "number" ? last.position : 0;
      const baseIndent = Math.min(...ordered.map((source) => Number(source.indent ?? 0)));
      const now = new Date();

      await Block.bulkWrite(
        ordered.map((source, index) => ({
          updateOne: {
            filter: { _id: source._id, userId, deletedAt: null },
            update: {
              $set: {
                chatId: pageId,
                position: start + (index + 1) * POSITION_STEP,
                indent: Math.max(0, Number(source.indent ?? 0) - baseIndent),
                updatedAt: now,
              },
            },
          },
        })),
        { ordered: false },
      );
      return { ok: true };
    },
    "Failed to move",
  );
}

export async function deleteBlocks(input: { blockIds: string[] }): Promise<ActionResult> {
  return runWrite(
    idsSchema,
    input,
    async (userId, { blockIds: ids }) => {
      await Block.updateMany(
        { _id: { $in: ids }, userId, deletedAt: null },
        { $set: { deletedAt: new Date() } },
      );
      return { ok: true };
    },
    "Failed to delete",
  );
}

export async function restoreBlocks(input: { blockIds: string[] }): Promise<ActionResult> {
  return runWrite(
    idsSchema,
    input,
    async (userId, { blockIds: ids }) => {
      const blocks = await Block.find({ _id: { $in: ids }, userId }, { chatId: 1 }).lean<Raw[]>();
      const pageIds = [...new Set(blocks.map((block) => String(block.chatId)))];
      const activePages = await PageModel.find(
        { _id: { $in: pageIds }, userId, deletedAt: null },
        { _id: 1 },
      ).lean<Raw[]>();

      await Block.updateMany(
        { _id: { $in: ids }, userId, chatId: { $in: activePages.map((page) => page._id) } },
        { $set: { deletedAt: null, updatedAt: new Date() } },
      );
      return { ok: true };
    },
    "Failed to restore",
  );
}

export async function duplicateBlocks(input: {
  pageId: string;
  placements: DuplicatePlacement[];
}): Promise<BlocksResult> {
  return runWrite(
    duplicateSchema,
    input,
    async (userId, { pageId, placements }) => {
      if (!(await touchActivePage(userId, pageId))) return fail("Page not found");

      const capacity = await blockCapacityError(userId, pageId, placements.length);
      if (capacity) return fail(capacity);

      const sources = await Block.find({
        _id: { $in: placements.map((placement) => placement.blockId) },
        userId,
        chatId: pageId,
        deletedAt: null,
      }).lean<Raw[]>();
      const byId = new Map(sources.map((source) => [String(source._id), source]));

      const now = new Date();
      const docs: Raw[] = [];
      for (const placement of placements) {
        const source = byId.get(placement.blockId);
        if (!source) return fail("Some blocks no longer exist");
        const type = source.type as BlockType;
        const content = contentFor(type, placement.content);
        if (typeof content !== "string") return fail(content.error);
        docs.push({
          ...copyBlockFields(source),
          userId,
          chatId: pageId,
          content,
          language: type === "code" ? placement.language : source.language,
          checked: type === "todo" ? placement.checked : false,
          collapsed: placement.collapsed,
          color: placement.color,
          position: placement.position,
          indent: placement.indent,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        });
      }

      const created = await Block.insertMany(docs);
      return { ok: true, blocks: created.map((doc) => serializeBlock(doc.toObject())) };
    },
    "Failed to duplicate",
  );
}

export async function updateAttachmentCaption(input: {
  blockId: string;
  index: number;
  caption: string;
}): Promise<ActionResult> {
  return runWrite(
    captionSchema,
    input,
    async (userId, { blockId, index, caption }) => {
      const result = await Block.updateOne(
        { _id: blockId, userId, type: "group", deletedAt: null },
        { $set: { "attachments.$[att].caption": caption.trim(), updatedAt: new Date() } },
        { arrayFilters: [{ "att.index": index }] },
      );
      return result.matchedCount === 1 ? { ok: true } : fail("Block not found");
    },
    "Failed to update caption",
  );
}

export async function ungroupBlock(input: { blockId: string; positions: number[] }): Promise<BlocksResult> {
  return runWrite(
    ungroupSchema,
    input,
    async (userId, { blockId, positions }) => {
      const group = await Block.findOne(
        { _id: blockId, userId, type: "group", deletedAt: null },
        { chatId: 1, content: 1, indent: 1, attachments: 1 },
      ).lean<Raw>();
      if (!group) return fail("Block not found");

      const attachments = Array.isArray(group.attachments) ? (group.attachments as Raw[]) : [];
      const caption = String(group.content ?? "").trim();
      const expected = attachments.length + (caption ? 1 : 0);
      if (positions.length !== expected) return fail("The group changed — reload and try again");

      const capacity = await blockCapacityError(userId, String(group.chatId), expected - 1);
      if (capacity) return fail(capacity);

      const now = new Date();
      const common = {
        userId,
        chatId: group.chatId,
        indent: Number(group.indent ?? 0),
        createdAt: now,
        updatedAt: now,
      };
      const docs: Raw[] = [];
      if (caption) docs.push({ ...common, type: "text", content: caption, storage: "none" });
      for (const attachment of attachments) {
        const isImage = attachment.kind === "image";
        docs.push({
          ...common,
          type: isImage ? "image" : "file",
          content: String(attachment.caption ?? ""),
          storage: isImage ? "cloudinary" : "r2",
          imageUrl: isImage ? attachment.imageUrl : "",
          publicId: isImage ? attachment.publicId : "",
          storageKey: isImage ? "" : attachment.storageKey,
          fileName: attachment.fileName,
          fileSize: attachment.fileSize,
          mimeType: attachment.mimeType,
        });
      }
      docs.forEach((doc, index) => {
        doc.position = positions[index];
      });

      const created = await Block.insertMany(docs);
      await Block.deleteOne({ _id: blockId, userId });

      const ids = created.map((doc) => doc._id);
      const fresh = await Block.find({ _id: { $in: ids }, userId }, BLOCK_PROJECTION)
        .sort({ position: 1 })
        .lean<Raw[]>();
      return { ok: true, blocks: fresh.map(serializeBlock) };
    },
    "Failed to split the group",
  );
}
