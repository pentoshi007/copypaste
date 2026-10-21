import { toast } from "sonner";
import {
  createBlocks,
  deleteBlocks,
  duplicateBlocks,
  moveBlocks,
  moveBlocksToPage,
  restoreBlocks,
  ungroupBlock,
  updateBlock,
} from "@/actions/blocks";
import { attachmentKind } from "@/lib/attachments";
import { MAX_INDENT, type BlockColor, type BlockType } from "@/lib/editor/blockTypes";
import { evenPositions, positionsBetween } from "@/lib/editor/position";
import { reportFailure, syncQueue } from "@/lib/client/syncQueue";
import { splitSelection, uploadBatch, type UploadResult } from "@/lib/upload";
import type { Block, BlockPatch, DuplicatePlacement, NewBlockInput } from "@/lib/types";

export interface UploadState {
  file: File;
  previewUrl: string;
  progress: number;
  error: string;
  result: UploadResult | null;
}

export type LocalBlock = Block & { key: string; upload?: UploadState };

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

const SAVE_DEBOUNCE_MS = 450;
const UPLOAD_CONCURRENCY = 3;
const UNDO_TOAST_MS = 6000;
const PREVIEW_RELEASE_MS = 30_000;

let keySequence = 0;

function nextKey(): string {
  keySequence += 1;
  return `local-${Date.now().toString(36)}-${keySequence}`;
}

function clampIndent(indent: number): number {
  return Math.max(0, Math.min(MAX_INDENT, indent));
}

function fromServer(block: Block): LocalBlock {
  return { ...block, key: block._id };
}

function toBlock(block: LocalBlock, id: string): Block {
  return {
    _id: id,
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
  private readonly ids = new Map<string, string>();
  private readonly patches = new Map<string, BlockPatch>();
  private readonly timers = new Map<string, number>();
  private readonly uploads = new Map<string, AbortController>();
  private readonly listeners = new Set<() => void>();

  constructor(
    readonly pageId: string,
    initial: Block[],
    private readonly onCreated?: (blocks: LocalBlock[]) => void,
  ) {
    this.blocks = initial.map(fromServer);
    for (const block of initial) this.ids.set(block._id, block._id);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): LocalBlock[] => this.blocks;

  find(key: string): LocalBlock | undefined {
    return this.blocks.find((block) => block.key === key);
  }

  hasPendingWork(): boolean {
    return (
      this.patches.size > 0 ||
      this.uploads.size > 0 ||
      syncQueue.isBusy() ||
      this.blocks.some((block) => block.upload)
    );
  }

  savedBlocks(): Block[] {
    return this.blocks.flatMap((block) => {
      const id = this.ids.get(block.key);
      return id && !block.upload ? [toBlock(block, id)] : [];
    });
  }

  replaceFromServer(blocks: Block[], keepKey: string | null): boolean {
    if (this.hasPendingWork()) return false;
    const keysById = new Map<string, string>();
    for (const [key, id] of this.ids) keysById.set(id, key);
    const local = keepKey ? this.find(keepKey) : undefined;

    this.commit(
      blocks.map((block) => {
        const key = keysById.get(block._id) ?? block._id;
        this.ids.set(key, block._id);
        const next = { ...fromServer(block), key };
        return local && key === local.key ? { ...next, content: local.content } : next;
      }),
    );
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
    const block = this.find(key);
    if (!block) return;
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
    if (block && !this.ids.has(key) && block.upload) return;

    const patch = this.patches.get(key);
    if (!patch) return;
    this.patches.delete(key);

    void syncQueue.enqueue(async () => {
      const blockId = this.ids.get(key);
      const current = this.find(key);
      if (!blockId || !current) return true;
      return reportFailure(await updateBlock({ blockId, patch: currentValues(current, patch) }));
    });
  }

  flushAll() {
    for (const key of [...this.patches.keys()]) this.flush(key);
  }

  remove(keys: string[], options: { undoable?: boolean } = {}) {
    const keySet = new Set(keys);
    const removed = this.blocks.filter((block) => keySet.has(block.key));
    if (removed.length === 0) return;

    for (const block of removed) this.flush(block.key);
    this.commit(this.blocks.filter((block) => !keySet.has(block.key)));
    for (const block of removed) this.discardUpload(block);

    void syncQueue.enqueue(async () => {
      const blockIds = removed.flatMap((block) => this.ids.get(block.key) ?? []);
      if (blockIds.length === 0) return true;
      return reportFailure(await deleteBlocks({ blockIds }));
    });

    const restorable = removed.filter((block) => !block.upload);
    if (options.undoable !== false && restorable.length > 0) {
      toast(restorable.length === 1 ? "Block deleted" : `${restorable.length} blocks deleted`, {
        duration: UNDO_TOAST_MS,
        action: { label: "Undo", onClick: () => this.restore(restorable) },
      });
    }
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
    if (moving.some((block) => block.upload && !this.ids.has(block.key))) {
      toast.error("Wait for uploads to finish before moving them");
      return false;
    }
    if (moving.length === 0) return false;

    for (const block of moving) this.flush(block.key);
    this.commit(this.blocks.filter((block) => !keySet.has(block.key)));

    void syncQueue.enqueue(async () => {
      const blockIds = moving.flatMap((block) => this.ids.get(block.key) ?? []);
      if (blockIds.length === 0) return true;
      return reportFailure(await moveBlocksToPage({ pageId, blockIds }));
    });
    return true;
  }

  duplicate(keys: string[]): string[] {
    const keySet = new Set(keys);
    const sources = this.blocks.filter((block) => keySet.has(block.key) && !block.upload);
    if (sources.length === 0) return [];
    for (const source of sources) this.flush(source.key);

    const lastIndex = this.blocks.findIndex((block) => block.key === sources[sources.length - 1].key);
    const copies = sources.map((source) => ({ ...source, key: nextKey(), _id: "" }));
    const copyKeys = new Set(copies.map((copy) => copy.key));
    const order = [...this.blocks.slice(0, lastIndex + 1), ...copies, ...this.blocks.slice(lastIndex + 1)];

    const { list, changed } = assignPositions(order, copyKeys);
    this.commit(list);
    this.persistPlacements([...changed].filter((key) => !copyKeys.has(key)));

    void syncQueue.enqueue(
      async () => {
        const pairs = copies.flatMap((copy, index) => {
          const blockId = this.ids.get(sources[index].key);
          const current = this.find(copy.key);
          return blockId && current ? [{ copy: current, blockId }] : [];
        });
        if (pairs.length === 0) {
          this.dropLocal([...copyKeys]);
          return true;
        }
        const placements: DuplicatePlacement[] = pairs.map(({ copy, blockId }) => ({
          blockId,
          position: copy.position,
          indent: copy.indent,
          content: copy.content,
          language: copy.language,
          checked: copy.checked,
          collapsed: copy.collapsed,
          color: copy.color,
        }));
        const result = await duplicateBlocks({ pageId: this.pageId, placements });
        if (!result.ok) {
          toast.error(result.error);
          this.dropLocal([...copyKeys]);
          return false;
        }
        this.adopt(
          pairs.map(({ copy }) => copy.key),
          result.blocks,
        );
        return true;
      },
      { idempotent: false },
    );
    return copies.map((copy) => copy.key);
  }

  ungroup(key: string) {
    const index = this.blocks.findIndex((block) => block.key === key);
    const group = this.blocks[index];
    const blockId = this.ids.get(key);
    if (!group || !blockId || group.type !== "group") return;

    const count = (group.attachments?.length ?? 0) + (group.content.trim() ? 1 : 0);
    const placeholders = Array.from({ length: count }, () => ({ ...group, key: nextKey() }));
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
        const result = await ungroupBlock({ blockId, positions });
        if (!result.ok) {
          toast.error(result.error);
          return false;
        }
        for (const block of result.blocks) this.ids.set(block._id, block._id);
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
    return {
      _id: "",
      key: nextKey(),
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

  private commit(next: LocalBlock[]) {
    this.blocks = next;
    for (const listener of this.listeners) listener();
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
          .filter((block): block is LocalBlock => Boolean(block) && !this.ids.has((block as LocalBlock).key));
        if (targets.length === 0) return true;
        for (const target of targets) this.patches.delete(target.key);

        const result = await createBlocks({ pageId: this.pageId, blocks: targets.map(toInput) });
        if (!result.ok) {
          toast.error(result.error);
          this.dropLocal(targets.map((target) => target.key));
          return false;
        }
        this.adopt(
          targets.map((target) => target.key),
          result.blocks,
        );
        return true;
      },
      { idempotent: false },
    );
  }

  private persistPlacements(keys: string[]) {
    if (keys.length === 0) return;
    void syncQueue.enqueue(async () => {
      const placements = keys.flatMap((key) => {
        const blockId = this.ids.get(key);
        const block = this.find(key);
        return blockId && block ? [{ blockId, position: block.position, indent: block.indent }] : [];
      });
      if (placements.length === 0) return true;
      return reportFailure(await moveBlocks({ pageId: this.pageId, placements }));
    });
  }

  private adopt(keys: string[], saved: Block[]) {
    const byKey = new Map<string, Block>();
    keys.forEach((key, index) => {
      const block = saved[index];
      if (!block) return;
      this.ids.set(key, block._id);
      byKey.set(key, block);
    });

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
          _id: server._id,
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
    );

    for (const key of keys) if (this.patches.has(key)) this.flush(key);
    if (created.length > 0) this.onCreated?.(created);
  }

  private dropLocal(keys: string[]) {
    const keySet = new Set(keys);
    for (const block of this.blocks) if (keySet.has(block.key)) this.discardUpload(block);
    this.commit(this.blocks.filter((block) => !keySet.has(block.key)));
  }

  private restore(removed: LocalBlock[]) {
    const present = new Set(this.blocks.map((block) => block.key));
    const restorable = removed.filter((block) => this.ids.has(block.key) && !present.has(block.key));
    if (restorable.length === 0) return;

    this.commit([...this.blocks, ...restorable].sort((a, b) => a.position - b.position));
    void syncQueue.enqueue(async () => {
      const blockIds = restorable.flatMap((block) => this.ids.get(block.key) ?? []);
      return reportFailure(await restoreBlocks({ blockIds }));
    });
  }

  private discardUpload(block: LocalBlock) {
    this.uploads.get(block.key)?.abort();
    this.uploads.delete(block.key);
    if (block.upload?.previewUrl && !this.ids.has(block.key)) URL.revokeObjectURL(block.upload.previewUrl);
  }

  private setUpload(key: string, patch: Partial<UploadState>) {
    this.commit(
      this.blocks.map((block) =>
        block.key === key && block.upload ? { ...block, upload: { ...block.upload, ...patch } } : block,
      ),
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
