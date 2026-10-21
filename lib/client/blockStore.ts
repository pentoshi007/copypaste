import { toast } from "sonner";
import {
  createBlocks,
  deleteBlocks,
  duplicateBlocks,
  mergeBlocks,
  moveBlocks,
  moveBlocksToPage,
  restoreBlocks,
  ungroupBlock,
  updateBlock,
} from "@/actions/blocks";
import { attachmentKind } from "@/lib/attachments";
import { generateObjectId } from "@/lib/client/objectId";
import { reportFailure, syncQueue } from "@/lib/client/syncQueue";
import {
  MAX_CONTENT_LENGTH,
  MAX_INDENT,
  isMediaType,
  type BlockColor,
  type BlockType,
} from "@/lib/editor/blockTypes";
import { evenPositions, positionsBetween } from "@/lib/editor/position";
import { splitSelection, uploadBatch, type UploadResult } from "@/lib/upload";
import type { ActionResult, Block, BlockPatch, DuplicatePlacement, NewBlockInput } from "@/lib/types";

export interface UploadState {
  file: File;
  previewUrl: string;
  progress: number;
  error: string;
  result: UploadResult | null;
}

export type LocalBlock = Block & { key: string; pending?: boolean; upload?: UploadState };

export interface BlockDraft {
  type: BlockType;
  content?: string;
  language?: string;
  indent?: number;
  checked?: boolean;
  color?: BlockColor;
}

export type DropSide = "before" | "after";

export interface DropTarget {
  key: string;
  side: DropSide;
}

export interface BlockStoreEvents {
  onCreated?(blocks: LocalBlock[]): void;
  onConflict?(): void;
}

const SAVE_DEBOUNCE_MS = 450;
const UPLOAD_CONCURRENCY = 3;
const UNDO_TOAST_MS = 6000;
const PREVIEW_RELEASE_MS = 30_000;
const CREATE_RETRY_MS = 10_000;

function clampIndent(indent: number): number {
  return Math.max(0, Math.min(MAX_INDENT, indent));
}

function fromServer(block: Block): LocalBlock {
  return { ...block, key: block._id };
}

function toBlock(block: LocalBlock): Block {
  return {
    _id: block._id,
    pageId: block.pageId,
    type: block.type,
    content: block.content,
    language: block.language,
    position: block.position,
    indent: block.indent,
    checked: block.checked,
    collapsed: block.collapsed,
    color: block.color,
    imageUrl: block.imageUrl,
    publicId: block.publicId,
    fileName: block.fileName,
    fileSize: block.fileSize,
    mimeType: block.mimeType,
    attachments: block.attachments,
    createdAt: block.createdAt,
    updatedAt: block.updatedAt,
  };
}

function applyPatch(block: LocalBlock, patch: BlockPatch): LocalBlock {
  const next: LocalBlock = { ...block };
  if (patch.content !== undefined) next.content = patch.content;
  if (patch.type !== undefined) next.type = patch.type;
  if (patch.language !== undefined) next.language = patch.language;
  if (patch.checked !== undefined) next.checked = patch.checked;
  if (patch.indent !== undefined) next.indent = patch.indent;
  if (patch.collapsed !== undefined) next.collapsed = patch.collapsed;
  if (patch.color !== undefined) next.color = patch.color;
  if (next.type === "code" && !next.language) next.language = "plaintext";
  return next;
}

function currentValues(block: LocalBlock, dirty: BlockPatch): BlockPatch {
  const patch: BlockPatch = {};
  if (dirty.content !== undefined) patch.content = block.content;
  if (dirty.type !== undefined) patch.type = block.type;
  if (dirty.language !== undefined) patch.language = block.language;
  if (dirty.checked !== undefined) patch.checked = block.checked;
  if (dirty.indent !== undefined) patch.indent = block.indent;
  if (dirty.collapsed !== undefined) patch.collapsed = block.collapsed;
  if (dirty.color !== undefined) patch.color = block.color;
  return patch;
}

function toInput(block: LocalBlock): NewBlockInput {
  const result = block.upload?.result;
  return {
    _id: block._id,
    type: block.type,
    content: block.content,
    language: block.language,
    position: block.position,
    indent: block.indent,
    checked: block.checked,
    color: block.color,
    attachment: result
      ? {
          kind: result.kind,
          fileName: result.fileName,
          fileSize: result.fileSize,
          mimeType: result.mimeType,
          imageUrl: result.imageUrl,
          publicId: result.publicId,
          storageKey: result.storageKey,
          version: result.version,
          signature: result.signature,
        }
      : undefined,
  };
}

function assignPositions(order: LocalBlock[], changed: ReadonlySet<string>) {
  const list = order.slice();
  for (let start = 0; start < list.length;) {
    if (!changed.has(list[start].key)) {
      start++;
      continue;
    }
    let end = start;
    while (end < list.length && changed.has(list[end].key)) end++;
    const positions = positionsBetween(list[start - 1]?.position, list[end]?.position, end - start);
    if (!positions) {
      const even = evenPositions(order.length);
      return {
        list: order.map((block, index) => ({ ...block, position: even[index] })),
        changed: new Set(order.map((block) => block.key)),
      };
    }
    for (let i = start; i < end; i++) list[i] = { ...list[i], position: positions[i - start] };
    start = end;
  }
  return { list, changed: new Set(changed) };
}

export class BlockStore {
  private blocks: LocalBlock[];
  private readonly confirmed = new Set<string>();
  private readonly patches = new Map<string, BlockPatch>();
  private readonly timers = new Map<string, number>();
  private readonly uploads = new Map<string, AbortController>();
  private readonly unsaved = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private retryTimer = 0;
  private lastMutation = 0;

  constructor(
    readonly pageId: string,
    initial: Block[],
    private readonly events: BlockStoreEvents = {},
  ) {
    this.blocks = initial.map(fromServer);
    for (const block of initial) this.confirmed.add(block._id);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): LocalBlock[] => this.blocks;

  find(key: string): LocalBlock | undefined {
    return this.blocks.find((block) => block.key === key);
  }

  isSaved(key: string): boolean {
    return this.confirmed.has(key);
  }

  hasPendingWork(): boolean {
    return (
      this.patches.size > 0 ||
      this.uploads.size > 0 ||
      syncQueue.isBusy() ||
      this.blocks.some((block) => block.pending && !block.upload?.error)
    );
  }

  savedBlocks(): Block[] {
    return this.blocks.filter((block) => this.confirmed.has(block.key) && !block.upload).map(toBlock);
  }

  replaceFromServer(blocks: Block[], keepKey: string | null, requestedAt: number): boolean {
    if (this.hasPendingWork() || this.lastMutation >= requestedAt) return false;
    const local = keepKey ? this.find(keepKey) : undefined;
    const localOnly = this.blocks.filter((block) => block.pending);

    for (const block of blocks) this.confirmed.add(block._id);
    const fresh = blocks.map((block) => {
      const next = fromServer(block);
      return local && next.key === local.key ? { ...next, content: local.content } : next;
    });
    const merged =
      localOnly.length > 0 ? [...fresh, ...localOnly].sort((a, b) => a.position - b.position) : fresh;
    this.commit(merged, false);
    return true;
  }

  insert(drafts: BlockDraft[], afterKey: string | null): string[] {
    const keys = this.insertLocal(
      drafts.map((draft) => this.blockFromDraft(draft)),
      afterKey,
    );
    this.persistCreation(keys);
    return keys;
  }

  insertUploads(files: File[], afterKey: string | null): string[] {
    const { rejections } = splitSelection(files);
    const rejected = new Set(rejections.map((rejection) => rejection.index));
    for (const rejection of rejections) toast.error(rejection.error);

    const usable = files.filter((_, index) => !rejected.has(index));
    if (usable.length === 0) return [];

    const keys = this.insertLocal(
      usable.map((file) => {
        const kind = attachmentKind(file.type, file.name);
        return {
          ...this.blockFromDraft({ type: kind }),
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || "application/octet-stream",
          upload: {
            file,
            previewUrl: kind === "image" ? URL.createObjectURL(file) : "",
            progress: 0,
            error: "",
            result: null,
          },
        };
      }),
      afterKey,
    );
    void this.runUploads(keys);
    return keys;
  }

  retryUpload(key: string) {
    void this.uploadOne(key);
  }

  update(key: string, patch: BlockPatch, options: { debounce?: boolean } = {}) {
    if (!this.find(key)) return;
    this.commit(this.blocks.map((item) => (item.key === key ? applyPatch(item, patch) : item)));
    this.patches.set(key, { ...this.patches.get(key), ...patch });

    window.clearTimeout(this.timers.get(key));
    if (options.debounce) {
      this.timers.set(
        key,
        window.setTimeout(() => this.flush(key), SAVE_DEBOUNCE_MS),
      );
    } else {
      this.flush(key);
    }
  }

  flush(key: string) {
    window.clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    const block = this.find(key);
    if (block?.pending && block.upload) return;

    const patch = this.patches.get(key);
    if (!patch) return;
    this.patches.delete(key);

    void syncQueue.enqueue(async () => {
      const current = this.find(key);
      if (!current || !this.confirmed.has(key)) return true;
      return this.settle(await updateBlock({ blockId: key, patch: currentValues(current, patch) }));
    });
  }

  flushAll() {
    for (const key of [...this.patches.keys()]) this.flush(key);
  }

  remove(keys: string[], options: { undoable?: boolean } = {}) {
    const keySet = new Set(keys);
    const removed = this.blocks.filter((block) => keySet.has(block.key));
    if (removed.length === 0) return;

    for (const block of removed) {
      if (this.confirmed.has(block.key)) this.flush(block.key);
      this.forget(block.key);
    }
    this.commit(this.blocks.filter((block) => !keySet.has(block.key)));
    for (const block of removed) this.discardUpload(block);

    void syncQueue.enqueue(async () => {
      const blockIds = removed.map((block) => block.key).filter((key) => this.confirmed.has(key));
      if (blockIds.length === 0) return true;
      return this.settle(await deleteBlocks({ blockIds }));
    });

    const restorable = removed.filter((block) => !block.upload);
    if (options.undoable !== false && restorable.length > 0) {
      toast(restorable.length === 1 ? "Block deleted" : `${restorable.length} blocks deleted`, {
        duration: UNDO_TOAST_MS,
        action: { label: "Undo", onClick: () => this.restore(restorable) },
      });
    }
  }

  merge(targetKey: string, sourceKey: string, content: string): boolean {
    const target = this.find(targetKey);
    const source = this.find(sourceKey);
    if (!target || !source || targetKey === sourceKey) return false;
    if (content.length > MAX_CONTENT_LENGTH) {
      toast.error("Those blocks are too long to merge");
      return false;
    }

    this.flush(targetKey);
    this.forget(sourceKey);
    this.commit(
      this.blocks
        .filter((block) => block.key !== sourceKey)
        .map((block) => (block.key === targetKey ? { ...block, content } : block)),
    );

    void syncQueue.enqueue(async () => {
      const targetSaved = this.confirmed.has(targetKey);
      const sourceSaved = this.confirmed.has(sourceKey);
      const latest = this.find(targetKey)?.content ?? content;
      if (targetSaved && sourceSaved) {
        return this.settle(await mergeBlocks({ targetId: targetKey, sourceId: sourceKey, content: latest }));
      }
      if (targetSaved)
        return this.settle(await updateBlock({ blockId: targetKey, patch: { content: latest } }));
      if (sourceSaved) return this.settle(await deleteBlocks({ blockIds: [sourceKey] }));
      return true;
    });
    return true;
  }

  move(keys: string[], target: DropTarget | null, rootIndent?: number) {
    const keySet = new Set(keys);
    const moving = this.blocks.filter((block) => keySet.has(block.key));
    if (moving.length === 0) return;
    if (target && keySet.has(target.key)) return;

    const rest = this.blocks.filter((block) => !keySet.has(block.key));
    let index = target ? rest.findIndex((block) => block.key === target.key) : rest.length;
    if (index === -1) return;
    if (target?.side === "after") index += 1;

    const delta = rootIndent === undefined ? 0 : rootIndent - moving[0].indent;
    const shifted = moving.map((block) => ({ ...block, indent: clampIndent(block.indent + delta) }));
    const order = [...rest.slice(0, index), ...shifted, ...rest.slice(index)];

    const unchanged = order.every(
      (block, i) => block.key === this.blocks[i].key && block.indent === this.blocks[i].indent,
    );
    if (unchanged) return;

    const { list, changed } = assignPositions(order, keySet);
    this.commit(list);
    this.persistPlacements([...changed]);
  }

  setIndents(changes: Map<string, number>) {
    if (changes.size === 0) return;
    this.commit(
      this.blocks.map((block) =>
        changes.has(block.key) ? { ...block, indent: clampIndent(changes.get(block.key) as number) } : block,
      ),
    );
    this.persistPlacements([...changes.keys()]);
  }

  moveToPage(keys: string[], pageId: string): boolean {
    const keySet = new Set(keys);
    const moving = this.blocks.filter((block) => keySet.has(block.key));
    if (moving.length === 0) return false;
    if (moving.some((block) => block.pending)) {
      toast.error("Wait for these blocks to finish saving before moving them");
      return false;
    }

    for (const block of moving) this.flush(block.key);
    this.commit(this.blocks.filter((block) => !keySet.has(block.key)));

    void syncQueue.enqueue(async () => {
      const blockIds = moving.map((block) => block.key).filter((key) => this.confirmed.has(key));
      if (blockIds.length === 0) return true;
      return this.settle(await moveBlocksToPage({ pageId, blockIds }));
    });
    return true;
  }

  duplicate(keys: string[]): string[] {
    const keySet = new Set(keys);
    const sources = this.blocks.filter((block) => keySet.has(block.key) && !block.upload);
    if (sources.length === 0) return [];
    if (sources.some((block) => isMediaType(block.type) && !this.confirmed.has(block.key))) {
      toast.error("Wait for uploads to finish before duplicating them");
      return [];
    }
    for (const source of sources) this.flush(source.key);

    const lastIndex = this.blocks.findIndex((block) => block.key === sources[sources.length - 1].key);
    const pairs = sources.map((source) => {
      const id = generateObjectId();
      return { source, copy: { ...source, _id: id, key: id, pending: true } as LocalBlock };
    });
    const copyKeys = new Set(pairs.map(({ copy }) => copy.key));
    const order = [
      ...this.blocks.slice(0, lastIndex + 1),
      ...pairs.map(({ copy }) => copy),
      ...this.blocks.slice(lastIndex + 1),
    ];

    const { list, changed } = assignPositions(order, copyKeys);
    this.commit(list);
    this.persistPlacements([...changed].filter((key) => !copyKeys.has(key)));

    const media = pairs.filter(({ source }) => isMediaType(source.type));
    const plain = pairs.filter(({ source }) => !isMediaType(source.type));
    if (plain.length > 0) this.persistCreation(plain.map(({ copy }) => copy.key));
    if (media.length > 0)
      this.persistDuplicates(media.map(({ source, copy }) => ({ sourceKey: source.key, copyKey: copy.key })));
    return pairs.map(({ copy }) => copy.key);
  }

  ungroup(key: string) {
    const index = this.blocks.findIndex((block) => block.key === key);
    const group = this.blocks[index];
    if (!group || group.type !== "group" || !this.confirmed.has(key)) return;

    const count = (group.attachments?.length ?? 0) + (group.content.trim() ? 1 : 0);
    const placeholders = Array.from({ length: count }, (_, i) => ({ ...group, key: `${key}:${i}` }));
    const placeholderKeys = new Set(placeholders.map((placeholder) => placeholder.key));
    const order = [...this.blocks.slice(0, index), ...placeholders, ...this.blocks.slice(index + 1)];
    const { list, changed } = assignPositions(order, placeholderKeys);
    const positions = list.filter((block) => placeholderKeys.has(block.key)).map((block) => block.position);

    const others = [...changed].filter((changedKey) => !placeholderKeys.has(changedKey));
    if (others.length > 0) {
      const byKey = new Map(list.map((block) => [block.key, block]));
      this.commit(this.blocks.map((block) => byKey.get(block.key) ?? block));
      this.persistPlacements(others);
    }

    void syncQueue.enqueue(
      async () => {
        const result = await ungroupBlock({ blockId: key, positions });
        if (!result.ok) {
          toast.error(result.error);
          return false;
        }
        for (const block of result.blocks) this.confirmed.add(block._id);
        this.confirmed.delete(key);
        const at = this.blocks.findIndex((block) => block.key === key);
        if (at !== -1) {
          this.commit([
            ...this.blocks.slice(0, at),
            ...result.blocks.map(fromServer),
            ...this.blocks.slice(at + 1),
          ]);
        }
        return true;
      },
      { idempotent: false },
    );
  }

  setAttachmentCaption(key: string, index: number, caption: string) {
    this.commit(
      this.blocks.map((block) =>
        block.key === key
          ? {
              ...block,
              attachments: block.attachments?.map((attachment) =>
                attachment.index === index ? { ...attachment, caption } : attachment,
              ),
            }
          : block,
      ),
    );
  }

  dispose() {
    this.flushAll();
    this.listeners.clear();
  }

  private blockFromDraft(draft: BlockDraft): LocalBlock {
    const now = new Date().toISOString();
    const id = generateObjectId();
    return {
      _id: id,
      key: id,
      pending: true,
      pageId: this.pageId,
      type: draft.type,
      content: draft.content ?? "",
      language: draft.language ?? (draft.type === "code" ? "plaintext" : ""),
      position: 0,
      indent: clampIndent(draft.indent ?? 0),
      checked: draft.checked ?? false,
      collapsed: false,
      color: draft.color ?? "default",
      imageUrl: "",
      publicId: "",
      fileName: "",
      fileSize: 0,
      mimeType: "",
      createdAt: now,
      updatedAt: now,
    };
  }

  private commit(next: LocalBlock[], userChange = true) {
    this.blocks = next;
    if (userChange) this.lastMutation = Date.now();
    for (const listener of this.listeners) listener();
  }

  private settle(result: ActionResult): boolean {
    if (result.ok) return true;
    reportFailure(result);
    this.events.onConflict?.();
    return false;
  }

  private forget(key: string) {
    window.clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    this.patches.delete(key);
  }

  private insertLocal(created: LocalBlock[], afterKey: string | null): string[] {
    const found = afterKey === null ? -1 : this.blocks.findIndex((block) => block.key === afterKey);
    const index = afterKey === null ? 0 : found === -1 ? this.blocks.length : found + 1;
    const createdKeys = new Set(created.map((block) => block.key));
    const order = [...this.blocks.slice(0, index), ...created, ...this.blocks.slice(index)];

    const { list, changed } = assignPositions(order, createdKeys);
    this.commit(list);
    this.persistPlacements([...changed].filter((key) => !createdKeys.has(key)));
    return created.map((block) => block.key);
  }

  private persistCreation(keys: string[]) {
    void syncQueue.enqueue(
      async () => {
        const targets = keys
          .map((key) => this.find(key))
          .filter(
            (block): block is LocalBlock =>
              Boolean(block?.pending) && (!block?.upload || Boolean(block.upload.result)),
          );
        if (targets.length === 0) return true;
        for (const target of targets) this.patches.delete(target.key);

        const result = await createBlocks({ pageId: this.pageId, blocks: targets.map(toInput) });
        if (!result.ok) {
          toast.error(result.error);
          this.dropLocal(targets.map((target) => target.key));
          return false;
        }
        this.adopt(result.blocks);
        return true;
      },
      { onGiveUp: () => this.retryLater(keys) },
    );
  }

  private persistDuplicates(pairs: { sourceKey: string; copyKey: string }[]) {
    const copyKeys = pairs.map((pair) => pair.copyKey);
    void syncQueue.enqueue(
      async () => {
        const placements: DuplicatePlacement[] = pairs.flatMap(({ sourceKey, copyKey }) => {
          const copy = this.find(copyKey);
          if (!copy?.pending || !this.confirmed.has(sourceKey)) return [];
          return [
            {
              blockId: sourceKey,
              newId: copyKey,
              position: copy.position,
              indent: copy.indent,
              content: copy.content,
              language: copy.language,
              checked: copy.checked,
              collapsed: copy.collapsed,
              color: copy.color,
            },
          ];
        });
        if (placements.length === 0) {
          this.dropLocal(copyKeys.filter((key) => this.find(key)?.pending));
          return true;
        }
        for (const placement of placements) this.patches.delete(placement.newId);

        const result = await duplicateBlocks({ pageId: this.pageId, placements });
        if (!result.ok) {
          toast.error(result.error);
          this.dropLocal(copyKeys);
          return false;
        }
        this.adopt(result.blocks);
        return true;
      },
      { onGiveUp: () => this.retryDuplicatesLater(pairs) },
    );
  }

  private retryLater(keys: string[]) {
    for (const key of keys) {
      if (this.find(key)?.pending && !this.unsaved.has(key)) {
        this.unsaved.add(key);
        syncQueue.setUnsaved(1);
      }
    }
    this.scheduleRetry();
  }

  private retryDuplicatesLater(pairs: { sourceKey: string; copyKey: string }[]) {
    window.setTimeout(() => this.persistDuplicates(pairs), CREATE_RETRY_MS);
  }

  private scheduleRetry() {
    if (this.retryTimer || this.unsaved.size === 0) return;
    const retry = () => {
      window.removeEventListener("online", retry);
      window.clearTimeout(this.retryTimer);
      this.retryTimer = 0;
      const keys = [...this.unsaved];
      this.unsaved.clear();
      syncQueue.setUnsaved(-keys.length);
      this.persistCreation(keys);
    };
    window.addEventListener("online", retry);
    this.retryTimer = window.setTimeout(retry, CREATE_RETRY_MS);
  }

  private persistPlacements(keys: string[]) {
    if (keys.length === 0) return;
    void syncQueue.enqueue(async () => {
      const placements = keys.flatMap((key) => {
        const block = this.find(key);
        return block && this.confirmed.has(key)
          ? [{ blockId: key, position: block.position, indent: block.indent }]
          : [];
      });
      if (placements.length === 0) return true;
      return this.settle(await moveBlocks({ pageId: this.pageId, placements }));
    });
  }

  private adopt(saved: Block[]) {
    const byKey = new Map(saved.map((block) => [block._id, block]));
    for (const block of saved) {
      this.confirmed.add(block._id);
      if (this.unsaved.delete(block._id)) syncQueue.setUnsaved(-1);
    }

    const created: LocalBlock[] = [];
    this.commit(
      this.blocks.map((block) => {
        const server = byKey.get(block.key);
        if (!server) return block;
        if (block.upload?.previewUrl) {
          const url = block.upload.previewUrl;
          window.setTimeout(() => URL.revokeObjectURL(url), PREVIEW_RELEASE_MS);
        }
        const next: LocalBlock = {
          ...block,
          pending: false,
          createdAt: server.createdAt,
          updatedAt: server.updatedAt,
          imageUrl: server.imageUrl,
          publicId: server.publicId,
          fileName: server.fileName,
          fileSize: server.fileSize,
          mimeType: server.mimeType,
          attachments: server.attachments,
          upload: undefined,
        };
        created.push(next);
        return next;
      }),
      false,
    );

    for (const block of saved) if (this.patches.has(block._id)) this.flush(block._id);
    if (created.length > 0) this.events.onCreated?.(created);
  }

  private dropLocal(keys: string[]) {
    if (keys.length === 0) return;
    const keySet = new Set(keys);
    for (const block of this.blocks) {
      if (!keySet.has(block.key)) continue;
      this.discardUpload(block);
      this.forget(block.key);
      if (this.unsaved.delete(block.key)) syncQueue.setUnsaved(-1);
    }
    this.commit(this.blocks.filter((block) => !keySet.has(block.key)));
  }

  private restore(removed: LocalBlock[]) {
    const present = new Set(this.blocks.map((block) => block.key));
    const restorable = removed.filter((block) => this.confirmed.has(block.key) && !present.has(block.key));
    if (restorable.length === 0) return;

    this.commit([...this.blocks, ...restorable].sort((a, b) => a.position - b.position));
    void syncQueue.enqueue(async () =>
      this.settle(await restoreBlocks({ blockIds: restorable.map((block) => block.key) })),
    );
  }

  private discardUpload(block: LocalBlock) {
    this.uploads.get(block.key)?.abort();
    this.uploads.delete(block.key);
    if (block.upload?.previewUrl && !this.confirmed.has(block.key))
      URL.revokeObjectURL(block.upload.previewUrl);
  }

  private setUpload(key: string, patch: Partial<UploadState>) {
    this.commit(
      this.blocks.map((block) =>
        block.key === key && block.upload ? { ...block, upload: { ...block.upload, ...patch } } : block,
      ),
      false,
    );
  }

  private async runUploads(keys: string[]) {
    const queue = [...keys];
    const workers = Array.from({ length: Math.min(UPLOAD_CONCURRENCY, queue.length) }, async () => {
      for (let key = queue.shift(); key; key = queue.shift()) await this.uploadOne(key);
    });
    await Promise.all(workers);
  }

  private async uploadOne(key: string) {
    const block = this.find(key);
    if (!block?.upload || this.uploads.has(key)) return;

    const controller = new AbortController();
    this.uploads.set(key, controller);
    this.setUpload(key, { progress: 0, error: "" });

    let lastProgress = 0;
    try {
      const batch = await uploadBatch(
        [block.upload.file],
        (_index, percent) => {
          if (percent - lastProgress < 2 && percent < 100) return;
          lastProgress = percent;
          this.setUpload(key, { progress: percent });
        },
        controller.signal,
      );
      const rejection = batch.rejections[0];
      if (rejection) throw new Error(rejection.error);
      const result = batch.uploaded[0];
      if (!result) throw new Error("Upload failed");
      if (!this.find(key)) return;

      this.setUpload(key, { progress: 100, result });
      this.uploads.delete(key);
      this.persistCreation([key]);
    } catch (error) {
      if ((error as Error)?.name === "AbortError") return;
      this.setUpload(key, { error: (error as Error)?.message || "Upload failed" });
    } finally {
      if (this.uploads.get(key) === controller) this.uploads.delete(key);
    }
  }
}
