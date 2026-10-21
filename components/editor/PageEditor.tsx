"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { FilePlus, FileText, Plus } from "lucide-react";
import { toast } from "sonner";
import BlockRow, { INDENT_PX } from "./BlockRow";
import BlockMenu, { type BlockMenuActions } from "./BlockMenu";
import MobileToolbar, { type MobileToolbarActions } from "./MobileToolbar";
import PageHeader from "./PageHeader";
import SlashMenu from "./SlashMenu";
import { EditorContext, type EditorApi } from "./EditorContext";
import { filterCatalog, type CatalogEntry } from "./blockCatalog";
import PagePicker from "@/components/workspace/PagePicker";
import { BlockStore, type DropTarget, type LocalBlock } from "@/lib/client/blockStore";
import { copyToClipboard, useIsTouch, useListNavigation } from "@/lib/client/hooks";
import {
  createDragGhost,
  moveGhost,
  startAutoScroll,
  trackPointerDrag,
  type Point,
} from "@/lib/client/pointerDrag";
import { placeCaret, type Caret } from "@/lib/client/textarea";
import { computeLayout, expandToSubtrees, subtreeEnd } from "@/lib/editor/layout";
import {
  MAX_INDENT,
  hasEditableText,
  isConvertible,
  isListType,
  type BlockType,
} from "@/lib/editor/blockTypes";
import { blocksToPlainText } from "@/lib/editor/markdown";
import { childrenIndex } from "@/lib/editor/pageTree";
import { deriveTitle, displayTitle } from "@/lib/editor/titles";
import { isHttpUrl } from "@/lib/guards";
import type { Block, BlockPatch, Page, PagePatch } from "@/lib/types";

const EMPTY_SELECTION: ReadonlySet<string> = new Set();
const HIGHLIGHT_MS = 2200;
const RESYNC_DELAY_MS = 1500;
const MAX_RESYNC_ATTEMPTS = 4;

interface PageEditorProps {
  page: Page;
  pages: Page[];
  initialBlocks: Block[];
  remote: { version: number; blocks: Block[]; requestedAt: number; force: boolean } | null;
  autoFocusTitle: boolean;
  revealBlockId: string | null;
  onRevealed(): void;
  onUpdatePage(patch: PagePatch, options?: { debounce?: boolean }): void;
  onCreateSubPage(): void;
  onOpenPage(pageId: string): void;
  onBlocksMoved(targetPageId: string): void;
  onSnapshot(pageId: string, blocks: Block[]): void;
  onConflict(pageId: string): void;
}

interface SlashState {
  key: string;
  anchor: HTMLElement;
  start: number;
  query: string;
}

type DropInfo =
  | { kind: "block"; target: DropTarget; indent: number; rect: DOMRect }
  | { kind: "page"; pageId: string; element: HTMLElement }
  | null;

function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
}

function visibleIndexes(blocks: LocalBlock[]): number[] {
  const layout = computeLayout(blocks);
  const result: number[] = [];
  layout.forEach((entry, index) => {
    if (!entry.hidden) result.push(index);
  });
  return result;
}

function showLine(indicator: HTMLDivElement, rect: DOMRect, side: "before" | "after", indent: number) {
  const left = rect.left + indent * INDENT_PX;
  indicator.hidden = false;
  indicator.style.top = `${(side === "before" ? rect.top : rect.bottom) - 1}px`;
  indicator.style.left = `${left}px`;
  indicator.style.width = `${Math.max(40, rect.right - left)}px`;
}

function blockDropAt(
  scroller: HTMLElement,
  blocks: LocalBlock[],
  point: Point,
  dragged: ReadonlySet<string>,
): DropInfo {
  const bounds = scroller.getBoundingClientRect();
  if (point.x < bounds.left || point.x > bounds.right || point.y < bounds.top || point.y > bounds.bottom)
    return null;

  let best: { row: HTMLElement; rect: DOMRect; distance: number } | null = null;
  for (const row of scroller.querySelectorAll<HTMLElement>("[data-block-key]")) {
    const rect = row.getBoundingClientRect();
    const distance =
      point.y < rect.top ? rect.top - point.y : point.y > rect.bottom ? point.y - rect.bottom : 0;
    if (!best || distance < best.distance) best = { row, rect, distance };
    if (distance === 0) break;
  }
  if (!best) return null;

  const key = best.row.dataset.blockKey ?? "";
  if (dragged.has(key)) return null;
  const index = blocks.findIndex((block) => block.key === key);
  const block = blocks[index];
  if (!block) return null;

  const side = point.y < best.rect.top + best.rect.height / 2 ? "before" : "after";
  if (side === "after") {
    if (block.type === "toggle" && block.collapsed) {
      return {
        kind: "block",
        target: { key: blocks[subtreeEnd(blocks, index)].key, side },
        indent: block.indent,
        rect: best.rect,
      };
    }
    const next = blocks[index + 1];
    if (next && next.indent > block.indent) {
      return {
        kind: "block",
        target: { key, side },
        indent: Math.min(block.indent + 1, MAX_INDENT),
        rect: best.rect,
      };
    }
  }
  return { kind: "block", target: { key, side }, indent: block.indent, rect: best.rect };
}

function hitTest(
  scroller: HTMLElement,
  blocks: LocalBlock[],
  currentPageId: string,
  point: Point,
  dragged: ReadonlySet<string>,
): DropInfo {
  const element = document.elementFromPoint(point.x, point.y) as HTMLElement | null;
  const pageTarget = element?.closest<HTMLElement>("[data-page-drop]");
  if (pageTarget) {
    const pageId = pageTarget.dataset.pageDrop ?? "";
    return pageId && pageId !== currentPageId ? { kind: "page", pageId, element: pageTarget } : null;
  }
  return blockDropAt(scroller, blocks, point, dragged);
}

export default function PageEditor(props: PageEditorProps) {
  const { page, pages, remote, revealBlockId } = props;
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });

  const autoTitleRef = useRef<(created: LocalBlock[]) => void>(() => undefined);
  const [store] = useState(
    () =>
      new BlockStore(page._id, props.initialBlocks, {
        onCreated: (created) => autoTitleRef.current(created),
        onConflict: () => latest.current.onConflict(latest.current.page._id),
      }),
  );

  const blocks = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const layout = useMemo(() => computeLayout(blocks), [blocks]);

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [selection, setSelectionState] = useState<ReadonlySet<string>>(EMPTY_SELECTION);
  const [menu, setMenu] = useState<{ key: string; anchor: HTMLElement } | null>(null);
  const [slash, setSlashState] = useState<SlashState | null>(null);
  const [pickerKeys, setPickerKeys] = useState<string[] | null>(null);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const [fileDragActive, setFileDragActive] = useState(false);
  const [focusVersion, requestFocusPass] = useReducer((value: number) => value + 1, 0);

  const isTouch = useIsTouch();
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputsRef = useRef(new Map<string, HTMLTextAreaElement | HTMLInputElement>());
  const pendingFocusRef = useRef<{ key: string; caret: Caret } | null>(null);
  const pickTargetRef = useRef<{ afterKey: string | null; replaceKey: string | null }>({
    afterKey: null,
    replaceKey: null,
  });
  const selectionRef = useRef(selection);
  const anchorKeyRef = useRef<string | null>(null);
  const slashRef = useRef<SlashState | null>(null);
  const editingRef = useRef<string | null>(null);

  const slashEntries = useMemo(() => (slash ? filterCatalog(slash.query) : []), [slash]);
  const slashNav = useListNavigation(slashEntries.length, slash ? `${slash.key}:${slash.query}` : "");
  const slashNavRef = useRef({ entries: slashEntries, nav: slashNav });
  useLayoutEffect(() => {
    slashNavRef.current = { entries: slashEntries, nav: slashNav };
  });

  const setSelection = useCallback((next: ReadonlySet<string>) => {
    selectionRef.current = next;
    setSelectionState(next);
  }, []);

  const setSlash = useCallback((next: SlashState | null) => {
    slashRef.current = next;
    setSlashState(next);
  }, []);

  const setEditing = useCallback((key: string | null) => {
    editingRef.current = key;
    setEditingKey(key);
  }, []);

  useLayoutEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    const input = inputsRef.current.get(pending.key);
    if (!input) return;
    pendingFocusRef.current = null;
    placeCaret(input, pending.caret);
  }, [focusVersion, blocks, editingKey]);

  const { api, applySlash, maybeAutoTitle } = useMemo(() => {
    const find = (key: string) => store.find(key);
    const list = () => store.getSnapshot();

    const focusRoot = () => rootRef.current?.focus({ preventScroll: true });

    const selectOnly = (keys: string[]) => {
      setEditing(null);
      setSelection(new Set(keys));
      anchorKeyRef.current = keys[0] ?? null;
      (document.activeElement as HTMLElement | null)?.blur?.();
      focusRoot();
    };

    const focusBlock = (key: string, caret: Caret) => {
      const block = find(key);
      if (!block) return;
      if (!hasEditableText(block.type) && block.type !== "link") {
        selectOnly([key]);
        rowElement(key)?.scrollIntoView({ block: "nearest" });
        return;
      }
      pendingFocusRef.current = { key, caret };
      if (selectionRef.current.size > 0) setSelection(EMPTY_SELECTION);
      setEditing(key);
      requestFocusPass();
    };

    const rowElement = (key: string) =>
      scrollRef.current?.querySelector<HTMLElement>(`[data-block-key="${CSS.escape(key)}"]`) ?? null;

    const neighbor = (key: string, direction: -1 | 1): LocalBlock | null => {
      const blocksNow = list();
      const visible = visibleIndexes(blocksNow);
      const position = visible.findIndex((index) => blocksNow[index].key === key);
      if (position === -1) return null;
      const next = visible[position + direction];
      return next === undefined ? null : blocksNow[next];
    };

    const closeSlash = () => {
      if (slashRef.current) setSlash(null);
    };

    const roots = (key: string): string[] => {
      const selected = selectionRef.current;
      if (!selected.has(key)) return [key];
      return list()
        .filter((block) => selected.has(block.key))
        .map((block) => block.key);
    };

    const maybeAutoTitle = (block: LocalBlock | undefined) => {
      const current = latest.current.page;
      if (!block || current.title.trim()) return;
      const firstWithContent = list().find((item) => item.content.trim() || item.fileName);
      if (firstWithContent && firstWithContent.key !== block.key) return;
      const title = deriveTitle(block.content || block.fileName);
      if (title) latest.current.onUpdatePage({ title });
    };

    const indent = (key: string, delta: 1 | -1) => {
      const blocksNow = list();
      const rootKeys = new Set(roots(key));
      const changes = new Map<string, number>();
      for (let index = 0; index < blocksNow.length; index++) {
        const block = blocksNow[index];
        if (!rootKeys.has(block.key)) continue;
        const previous = blocksNow[index - 1];
        const previousIndent = previous ? (changes.get(previous.key) ?? previous.indent) : -1;
        const target = Math.max(0, Math.min(block.indent + delta, previousIndent + 1, MAX_INDENT));
        const shift = target - block.indent;
        const end = subtreeEnd(blocksNow, index);
        if (shift !== 0) {
          for (let child = index; child <= end; child++) {
            changes.set(blocksNow[child].key, blocksNow[child].indent + shift);
          }
        }
        index = end;
      }
      store.setIndents(changes);
    };

    const moveBy = (key: string, direction: -1 | 1) => {
      const blocksNow = list();
      const keys = expandToSubtrees(blocksNow, roots(key));
      if (keys.length === 0) return;
      const first = blocksNow.findIndex((block) => block.key === keys[0]);
      const last = blocksNow.findIndex((block) => block.key === keys[keys.length - 1]);
      const head = blocksNow[first];
      const hidden = computeLayout(blocksNow);

      if (direction === -1) {
        let index = first - 1;
        while (index >= 0 && (hidden[index].hidden || blocksNow[index].indent > head.indent)) index--;
        if (index < 0) return;
        store.move(keys, { key: blocksNow[index].key, side: "before" });
      } else {
        const next = last + 1;
        if (next >= blocksNow.length) return;
        store.move(keys, { key: blocksNow[subtreeEnd(blocksNow, next)].key, side: "after" });
      }

      const editing = editingRef.current;
      if (editing && keys.includes(editing)) {
        const input = inputsRef.current.get(editing);
        focusBlock(editing, input?.selectionStart ?? "end");
      }
      rowElement(keys[0])?.scrollIntoView({ block: "nearest" });
    };

    const remove = (key: string) => {
      const keys = expandToSubtrees(list(), roots(key));
      const previous = neighbor(keys[0], -1);
      store.remove(keys);
      setSelection(EMPTY_SELECTION);
      if (editingRef.current && keys.includes(editingRef.current)) {
        setEditing(null);
        if (previous) focusBlock(previous.key, "end");
      }
    };

    const convert: EditorApi["convert"] = (key, type, options = {}) => {
      const block = find(key);
      if (!block || !isConvertible(block.type)) return;
      closeSlash();
      const content = options.content ?? block.content;
      const wasEditing = editingRef.current === key;

      if (type === "divider") {
        if (content.trim()) {
          const [divider] = store.insert([{ type: "divider", indent: block.indent }], key);
          const [next] = store.insert([{ type: "text", indent: block.indent }], divider);
          focusBlock(next, "start");
        } else {
          store.update(key, { type: "divider", content: "" });
          const [next] = store.insert([{ type: "text", indent: block.indent }], key);
          focusBlock(next, "start");
        }
        return;
      }

      if (type === "link" && content.trim() && !isHttpUrl(content.trim())) {
        if (content !== block.content) store.update(key, { content });
        const [link] = store.insert([{ type: "link", indent: block.indent }], key);
        focusBlock(link, "end");
        return;
      }

      const patch: BlockPatch = { type, content: type === "link" ? content.trim() : content };
      if (type === "todo") patch.checked = options.checked ?? false;
      if (type === "code" && !block.language) patch.language = "plaintext";
      store.update(key, patch);

      if (wasEditing || options.content !== undefined || type === "link" || type === "code") {
        focusBlock(key, options.content !== undefined ? 0 : "end");
      }
    };

    const pickFiles = (afterKey: string | null, accept: string, replaceKey: string | null = null) => {
      const input = fileInputRef.current;
      if (!input) return;
      pickTargetRef.current = { afterKey, replaceKey };
      input.accept = accept;
      input.click();
    };

    const insertBelow = (key: string) => {
      const blocksNow = list();
      const index = blocksNow.findIndex((block) => block.key === key);
      const block = blocksNow[index];
      if (!block) return;
      closeSlash();
      store.flush(key);
      const openToggle = block.type === "toggle" && !block.collapsed;
      const afterKey =
        block.type === "toggle" && block.collapsed ? blocksNow[subtreeEnd(blocksNow, index)].key : key;
      const type: BlockType = isListType(block.type) ? block.type : "text";
      const [created] = store.insert(
        [{ type, indent: openToggle ? Math.min(block.indent + 1, MAX_INDENT) : block.indent }],
        afterKey,
      );
      focusBlock(created, "start");
    };

    const applySlash = (entry: CatalogEntry) => {
      const state = slashRef.current;
      if (!state) return;
      setSlash(null);
      const block = find(state.key);
      if (!block) return;
      const input = inputsRef.current.get(state.key);
      const caret = input?.selectionStart ?? state.start + 1 + state.query.length;
      const content = block.content.slice(0, state.start) + block.content.slice(caret);
      const empty = !content.trim();

      switch (entry.action) {
        case "upload-image":
        case "upload-file":
          store.update(state.key, { content });
          pickFiles(
            state.key,
            entry.action === "upload-image" ? "image/*" : "",
            empty && block.type === "text" ? state.key : null,
          );
          return;
        case "page":
          store.update(state.key, { content });
          latest.current.onCreateSubPage();
          return;
        default: {
          const type = entry.action;
          if (empty || block.type === "text") {
            convert(state.key, type, { content });
            if (type !== "divider" && type !== "link") focusBlock(state.key, state.start);
            return;
          }
          store.update(state.key, { content });
          if (type === "divider") {
            const [divider] = store.insert([{ type: "divider", indent: block.indent }], state.key);
            const [next] = store.insert([{ type: "text", indent: block.indent }], divider);
            focusBlock(next, "start");
            return;
          }
          const [created] = store.insert([{ type, indent: block.indent }], state.key);
          focusBlock(created, "start");
        }
      }
    };

    const editorApi: EditorApi = {
      store,
      registerInput: (key, element) => {
        if (element) inputsRef.current.set(key, element);
        else inputsRef.current.delete(key);
      },
      focusBlock,
      stopEditing: (key) => {
        if (pendingFocusRef.current?.key === key) return;
        store.flush(key);
        maybeAutoTitle(find(key));
        if (slashRef.current?.key === key) setSlash(null);
        if (editingRef.current === key) setEditing(null);
      },
      focusNeighbor: (key, direction, caret) => {
        const target = neighbor(key, direction);
        if (!target) return false;
        focusBlock(target.key, caret);
        return true;
      },
      splitBlock: (key, before, after) => {
        const blocksNow = list();
        const index = blocksNow.findIndex((block) => block.key === key);
        const block = blocksNow[index];
        if (!block) return;
        closeSlash();

        const listLike = isListType(block.type) || block.type === "toggle";
        if (listLike && !before && !after) {
          if (block.indent > 0) indent(key, -1);
          else store.update(key, { type: "text" });
          focusBlock(key, 0);
          return;
        }

        if (!before && after && index >= 0) {
          const previousKey = index > 0 ? blocksNow[index - 1].key : null;
          store.insert([{ type: listLike ? block.type : "text", indent: block.indent }], previousKey);
          focusBlock(key, 0);
          return;
        }

        if (before !== block.content) store.update(key, { content: before });
        store.flush(key);

        const openToggle = block.type === "toggle" && !block.collapsed;
        const afterKey =
          block.type === "toggle" && block.collapsed ? blocksNow[subtreeEnd(blocksNow, index)].key : key;
        const type: BlockType = isListType(block.type)
          ? block.type
          : block.type === "toggle" && block.collapsed
            ? "toggle"
            : "text";
        const [created] = store.insert(
          [
            {
              type,
              content: after,
              indent: openToggle ? Math.min(block.indent + 1, MAX_INDENT) : block.indent,
            },
          ],
          afterKey,
        );
        focusBlock(created, "start");
      },
      insertBelow,
      mergeBackward: (key) => {
        const block = find(key);
        if (!block) return;
        closeSlash();
        if (block.type !== "text" && hasEditableText(block.type) && block.type !== "code") {
          store.update(key, { type: "text" });
          focusBlock(key, 0);
          return;
        }
        if (block.indent > 0) {
          indent(key, -1);
          focusBlock(key, 0);
          return;
        }
        const previous = neighbor(key, -1);
        if (!previous) return;
        if (hasEditableText(previous.type)) {
          const caret = previous.content.length;
          if (store.merge(previous.key, key, previous.content + block.content))
            focusBlock(previous.key, caret);
          return;
        }
        if (!block.content) {
          store.remove([key], { undoable: false });
          focusBlock(previous.key, "end");
        } else {
          selectOnly([previous.key]);
        }
      },
      mergeForward: (key) => {
        const block = find(key);
        const next = neighbor(key, 1);
        if (!block || !next || !hasEditableText(next.type)) return;
        const caret = block.content.length;
        if (store.merge(key, next.key, block.content + next.content)) focusBlock(key, caret);
      },
      indent,
      moveBy,
      duplicate: (key) => {
        const created = store.duplicate(expandToSubtrees(list(), roots(key)));
        if (created.length > 0 && selectionRef.current.size > 0) setSelection(new Set([created[0]]));
      },
      remove,
      convert,
      slashOpen: (key, anchor, start) => setSlash({ key, anchor, start, query: "" }),
      slashUpdate: (key, value, caret) => {
        const state = slashRef.current;
        if (!state || state.key !== key) return;
        const query = value.slice(state.start + 1, caret);
        if (
          caret <= state.start ||
          value[state.start] !== "/" ||
          query.length > 24 ||
          /\n|\s\s/.test(query)
        ) {
          setSlash(null);
          return;
        }
        if (query !== state.query) setSlash({ ...state, query });
      },
      slashKeyDown: (event) => {
        if (!slashRef.current) return false;
        if (event.key === "Escape") {
          event.preventDefault();
          setSlash(null);
          return true;
        }
        const { entries, nav } = slashNavRef.current;
        const outcome = nav.handleKey(event);
        if (outcome === "select") {
          const entry = entries[nav.index];
          if (entry) applySlash(entry);
          else setSlash(null);
          return true;
        }
        return outcome === "handled";
      },
      openBlockMenu: (key, anchor) => {
        const block = find(key);
        if (!block) return;
        if (!selectionRef.current.has(key)) selectOnly([key]);
        else setEditing(null);
        setMenu({ key, anchor });
      },
      startDrag: (event: ReactPointerEvent, key) => startBlockDrag(event, key),
      select: (key, extend) => {
        const anchor = anchorKeyRef.current;
        if (!extend || !anchor || !find(anchor)) {
          selectOnly([key]);
          return;
        }
        const blocksNow = list();
        const visible = visibleIndexes(blocksNow);
        const from = visible.findIndex((index) => blocksNow[index].key === anchor);
        const to = visible.findIndex((index) => blocksNow[index].key === key);
        const [start, end] = from <= to ? [from, to] : [to, from];
        setEditing(null);
        setSelection(new Set(visible.slice(start, end + 1).map((index) => blocksNow[index].key)));
        focusRoot();
      },
      escape: (key) => {
        closeSlash();
        store.flush(key);
        selectOnly([key]);
      },
      uploadFiles: (files, afterKey) => {
        const keys = store.insertUploads(files, afterKey);
        if (keys.length > 0) setEditing(null);
      },
      pasteUrlIntoEmpty: (key, url) => {
        const block = find(key);
        if (!block || block.type !== "text") return false;
        store.update(key, { type: "link", content: url });
        maybeAutoTitle(find(key));
        const [created] = store.insert([{ type: "text", indent: block.indent }], key);
        focusBlock(created, "start");
        return true;
      },
      committed: (key) => {
        store.flush(key);
        maybeAutoTitle(find(key));
      },
    };

    return { api: editorApi, applySlash, maybeAutoTitle };

    function startBlockDrag(event: ReactPointerEvent, key: string) {
      const scroller = scrollRef.current;
      const indicator = indicatorRef.current;
      if (!scroller || !indicator) return;

      trackPointerDrag(event.nativeEvent, {
        threshold: 4,
        onStart: () => {
          const blocksNow = store.getSnapshot();
          const rootKeys = roots(key);
          const keys = expandToSubtrees(blocksNow, rootKeys);
          const dragged = new Set(keys);
          const head = store.find(keys[0]);
          if (!head) return null;

          setEditing(null);
          setSlash(null);
          setMenu(null);
          setSelection(new Set(rootKeys));
          const label = head.content.split("\n")[0].slice(0, 60) || head.fileName || head.type;
          const ghost = createDragGhost(label, rootKeys.length);
          let point: Point | null = null;
          let drop: DropInfo = null;
          let activePage: HTMLElement | null = null;

          const render = () => {
            if (!point) return;
            moveGhost(ghost, point);
            drop = hitTest(scroller, store.getSnapshot(), latest.current.page._id, point, dragged);
            if (activePage && (drop?.kind !== "page" || drop.element !== activePage)) {
              delete activePage.dataset.dropActive;
              activePage = null;
            }
            if (drop?.kind === "page") {
              activePage = drop.element;
              activePage.dataset.dropActive = "true";
              indicator.hidden = true;
            } else if (drop?.kind === "block") {
              showLine(indicator, drop.rect, drop.target.side, drop.indent);
            } else {
              indicator.hidden = true;
            }
          };

          const stopScroll = startAutoScroll(scroller, () => point, render);
          const cleanup = () => {
            stopScroll();
            ghost.remove();
            indicator.hidden = true;
            if (activePage) delete activePage.dataset.dropActive;
          };

          return {
            move: (next) => {
              point = next;
              render();
            },
            drop: () => {
              cleanup();
              const final: DropInfo = drop;
              if (final?.kind === "block") {
                store.move(keys, final.target, final.indent);
              } else if (final?.kind === "page" && store.moveToPage(keys, final.pageId)) {
                const target = latest.current.pages.find((item) => item._id === final.pageId);
                setSelection(EMPTY_SELECTION);
                latest.current.onBlocksMoved(final.pageId);
                toast.success(`Moved to ${displayTitle(target?.title ?? "")}`);
              }
            },
            cancel: cleanup,
          };
        },
      });
    }
  }, [store, setEditing, setSelection, setSlash]);

  useEffect(() => {
    autoTitleRef.current = (created) => {
      for (const block of created) maybeAutoTitle(block);
    };
  }, [maybeAutoTitle]);

  const menuActions = useMemo<BlockMenuActions | null>(() => {
    if (!menu) return null;
    const targets = () => {
      const selected = selectionRef.current;
      const keys = selected.has(menu.key) ? [...selected] : [menu.key];
      return store.getSnapshot().filter((block) => keys.includes(block.key));
    };
    return {
      convert: (type) => {
        for (const block of targets()) api.convert(block.key, type);
      },
      color: (color) => {
        for (const block of targets()) store.update(block.key, { color });
      },
      copy: async () => {
        const chosen = targets();
        const single = chosen.length === 1 ? chosen[0] : null;
        const text = single?.type === "image" ? single.imageUrl : blocksToPlainText(chosen);
        if (await copyToClipboard(text)) toast.success("Copied to clipboard");
        else toast.error("Couldn't copy");
      },
      duplicate: () => api.duplicate(menu.key),
      moveTo: () =>
        setPickerKeys(
          expandToSubtrees(
            store.getSnapshot(),
            targets().map((block) => block.key),
          ),
        ),
      moveBy: (direction) => api.moveBy(menu.key, direction),
      ungroup: () => store.ungroup(menu.key),
      remove: () => api.remove(menu.key),
    };
  }, [menu, api, store]);

  const toolbarActions = useMemo<MobileToolbarActions | null>(() => {
    if (!editingKey) return null;
    const key = editingKey;
    return {
      convert: (type) => api.convert(key, type),
      indent: (delta) => api.indent(key, delta),
      moveBy: (direction) => api.moveBy(key, direction),
      attach: () => {
        const input = fileInputRef.current;
        if (!input) return;
        pickTargetRef.current = { afterKey: key, replaceKey: null };
        input.accept = "";
        input.click();
      },
      duplicate: () => api.duplicate(key),
      remove: () => api.remove(key),
      done: () => (document.activeElement as HTMLElement | null)?.blur?.(),
    };
  }, [editingKey, api]);

  const closeMenu = useCallback(() => setMenu(null), []);
  const closeSlash = useCallback(() => setSlash(null), [setSlash]);

  const appendOrFocusLast = useCallback(() => {
    const blocksNow = store.getSnapshot();
    const visible = visibleIndexes(blocksNow);
    const last = visible.length > 0 ? blocksNow[visible[visible.length - 1]] : undefined;
    if (last && last.type === "text" && !last.content) {
      api.focusBlock(last.key, "end");
      return;
    }
    const lastKey = blocksNow.length > 0 ? blocksNow[blocksNow.length - 1].key : null;
    const [created] = store.insert([{ type: "text" }], lastKey);
    api.focusBlock(created, "start");
  }, [api, store]);

  const focusFirstBlock = useCallback(() => {
    const first = store.getSnapshot()[0];
    if (first && hasEditableText(first.type)) api.focusBlock(first.key, "start");
    else {
      const [created] = store.insert([{ type: "text" }], null);
      api.focusBlock(created, "start");
    }
  }, [api, store]);

  const resyncAttempts = useRef(0);
  useEffect(() => {
    if (!remote) return;
    const applied = store.replaceFromServer(
      remote.blocks,
      editingRef.current,
      remote.requestedAt,
      remote.force,
    );
    if (applied || !remote.force) {
      resyncAttempts.current = 0;
      return;
    }
    if (resyncAttempts.current >= MAX_RESYNC_ATTEMPTS) return;
    resyncAttempts.current += 1;
    const timer = window.setTimeout(
      () => latest.current.onConflict(latest.current.page._id),
      RESYNC_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [remote, store]);

  useEffect(() => {
    if (!revealBlockId) return;
    const blocksNow = store.getSnapshot();
    const index = blocksNow.findIndex((block) => block._id === revealBlockId);
    if (index === -1) return;

    let depth = blocksNow[index].indent;
    for (let cursor = index - 1; cursor >= 0 && depth > 0; cursor--) {
      const candidate = blocksNow[cursor];
      if (candidate.indent < depth) {
        if (candidate.type === "toggle" && candidate.collapsed)
          store.update(candidate.key, { collapsed: false });
        depth = candidate.indent;
      }
    }

    const key = blocksNow[index].key;
    const frame = requestAnimationFrame(() => {
      scrollRef.current
        ?.querySelector<HTMLElement>(`[data-block-key="${CSS.escape(key)}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
      setHighlightKey(key);
      latest.current.onRevealed();
    });
    return () => cancelAnimationFrame(frame);
  }, [revealBlockId, blocks, store]);

  useEffect(() => {
    if (!highlightKey) return;
    const timer = window.setTimeout(() => setHighlightKey(null), HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [highlightKey]);

  useEffect(() => {
    const flush = () => store.flushAll();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      latest.current.onSnapshot(store.pageId, store.savedBlocks());
      store.dispose();
    };
  }, [store]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const selected = selectionRef.current;
      if (selected.size === 0 || editingRef.current || isEditableTarget(event.target)) return;
      if (document.querySelector("[aria-modal='true'], [role='dialog']")) return;

      const blocksNow = store.getSnapshot();
      const ordered = blocksNow.filter((block) => selected.has(block.key));
      const first = ordered[0];
      const last = ordered[ordered.length - 1];
      if (!first || !last) return;
      const mod = event.metaKey || event.ctrlKey;

      if (event.key === "Escape") {
        setSelection(EMPTY_SELECTION);
      } else if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        api.remove(first.key);
      } else if (event.key === "Enter") {
        event.preventDefault();
        api.focusBlock(first.key, "end");
      } else if (mod && event.key.toLowerCase() === "c") {
        event.preventDefault();
        void copyToClipboard(blocksToPlainText(ordered)).then(
          (ok) => ok && toast.success("Copied to clipboard"),
        );
      } else if (mod && event.key.toLowerCase() === "d") {
        event.preventDefault();
        api.duplicate(first.key);
      } else if (mod && event.key.toLowerCase() === "a") {
        event.preventDefault();
        const visible = visibleIndexes(blocksNow);
        setSelection(new Set(visible.map((index) => blocksNow[index].key)));
      } else if (mod && event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        api.moveBy(first.key, event.key === "ArrowUp" ? -1 : 1);
      } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        const direction = event.key === "ArrowUp" ? -1 : 1;
        const visible = visibleIndexes(blocksNow);
        const edge = direction === -1 ? first : last;
        const at = visible.findIndex((index) => blocksNow[index].key === edge.key);
        const next = visible[at + direction];
        if (next === undefined) return;
        const nextKey = blocksNow[next].key;
        if (event.shiftKey) api.select(nextKey, true);
        else api.select(nextKey, false);
        scrollRef.current
          ?.querySelector<HTMLElement>(`[data-block-key="${CSS.escape(nextKey)}"]`)
          ?.scrollIntoView({ block: "nearest" });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [api, store, setSelection]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (isEditableTarget(event.target) || editingRef.current) return;
      if (document.querySelector("[aria-modal='true']")) return;
      const data = event.clipboardData;
      if (!data) return;
      const blocksNow = store.getSnapshot();
      const selected = blocksNow.filter((block) => selectionRef.current.has(block.key));
      const afterKey: string | null =
        selected.length > 0
          ? selected[selected.length - 1].key
          : (blocksNow[blocksNow.length - 1]?.key ?? null);

      const files = Array.from(data.files ?? []);
      if (files.length > 0) {
        event.preventDefault();
        store.insertUploads(files, afterKey);
        return;
      }
      const text = data.getData("text/plain");
      if (!text.trim()) return;
      event.preventDefault();
      const trimmed = text.trim();
      const isLink = isHttpUrl(trimmed) && !/\s/.test(trimmed);
      const [created] = store.insert(
        [{ type: isLink ? "link" : "text", content: isLink ? trimmed : text }],
        afterKey,
      );
      setSelection(new Set([created]));
      if (!latest.current.page.title.trim()) {
        const title = deriveTitle(text);
        if (title) latest.current.onUpdatePage({ title });
      }
      requestAnimationFrame(() =>
        scrollRef.current
          ?.querySelector<HTMLElement>(`[data-block-key="${CSS.escape(created)}"]`)
          ?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
      );
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [store, setSelection]);

  const handleFileDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!fileDragActive) setFileDragActive(true);
    const indicator = indicatorRef.current;
    if (!indicator) return;
    const drop = blockDropAt(
      event.currentTarget,
      store.getSnapshot(),
      { x: event.clientX, y: event.clientY },
      EMPTY_SELECTION,
    );
    if (drop?.kind === "block") showLine(indicator, drop.rect, drop.target.side, drop.indent);
    else indicator.hidden = true;
  };

  const endFileDrag = () => {
    setFileDragActive(false);
    if (indicatorRef.current) indicatorRef.current.hidden = true;
  };

  const handleFileDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    const drop = blockDropAt(
      event.currentTarget,
      store.getSnapshot(),
      { x: event.clientX, y: event.clientY },
      EMPTY_SELECTION,
    );
    endFileDrag();
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;

    const blocksNow = store.getSnapshot();
    let afterKey: string | null = blocksNow[blocksNow.length - 1]?.key ?? null;
    if (drop?.kind === "block") {
      const index = blocksNow.findIndex((block) => block.key === drop.target.key);
      afterKey = drop.target.side === "after" ? drop.target.key : index > 0 ? blocksNow[index - 1].key : null;
    }
    store.insertUploads(files, afterKey);
  };

  const children = useMemo(() => childrenIndex(pages).get(page._id) ?? [], [pages, page._id]);
  const editingBlock = editingKey ? blocks.find((block) => block.key === editingKey) : undefined;
  const menuBlock = menu ? blocks.find((block) => block.key === menu.key) : undefined;
  const pickerExclude = useMemo(() => new Set([page._id]), [page._id]);

  return (
    <EditorContext.Provider value={api}>
      <div ref={rootRef} tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
        <div
          ref={scrollRef}
          className={`relative min-h-0 flex-1 overflow-y-auto overscroll-contain ${
            fileDragActive ? "bg-blue-50/40 dark:bg-blue-950/10" : ""
          }`}
          onDragOver={handleFileDragOver}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) endFileDrag();
          }}
          onDrop={handleFileDrop}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget && selectionRef.current.size > 0)
              setSelection(EMPTY_SELECTION);
          }}
        >
          <div className={`mx-auto w-full px-6 pb-8 md:px-16 ${page.fullWidth ? "max-w-none" : "max-w-3xl"}`}>
            <PageHeader
              page={page}
              blockCount={blocks.length}
              autoFocus={props.autoFocusTitle}
              onUpdate={props.onUpdatePage}
              onEnterBody={focusFirstBlock}
            />

            <div role="list" aria-label="Blocks" className="space-y-0.5">
              {blocks.map((block, index) =>
                layout[index].hidden ? null : (
                  <BlockRow
                    key={block.key}
                    block={block}
                    number={layout[index].number}
                    editing={block.key === editingKey}
                    selected={selection.has(block.key)}
                    highlighted={block.key === highlightKey}
                  />
                ),
              )}
            </div>

            <button
              type="button"
              onClick={appendOrFocusLast}
              className="group/add mt-1 flex min-h-24 w-full cursor-text items-start gap-2 rounded-md py-2 text-left text-sm text-neutral-300 dark:text-neutral-600"
              aria-label="Add a block"
            >
              <span className="flex items-center gap-2 opacity-0 transition group-hover/add:opacity-100 pointer-coarse:opacity-100">
                <Plus className="h-4 w-4" />
                {blocks.length === 0 ? "Click to start writing, or paste / drop anything" : "Add a block"}
              </span>
            </button>

            <section
              aria-label="Sub-pages"
              className="mt-2 border-t border-neutral-100 pt-3 dark:border-neutral-800/70"
            >
              {children.length > 0 && (
                <ul className="mb-1 space-y-0.5">
                  {children.map((child) => (
                    <li key={child._id}>
                      <button
                        type="button"
                        onClick={() => props.onOpenPage(child._id)}
                        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
                      >
                        <span className="flex w-5 justify-center">
                          {child.icon || <FileText className="h-4 w-4 text-neutral-400" />}
                        </span>
                        <span className="truncate underline decoration-neutral-300 underline-offset-4 dark:decoration-neutral-600">
                          {displayTitle(child.title)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onClick={props.onCreateSubPage}
                className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-sm text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
              >
                <FilePlus className="h-4 w-4" />
                Add a sub-page
              </button>
            </section>
          </div>
        </div>

        {isTouch && editingBlock && toolbarActions && (
          <MobileToolbar type={editingBlock.type} actions={toolbarActions} />
        )}

        <div ref={indicatorRef} hidden className="drop-line" aria-hidden="true" />

        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (files.length === 0) return;
            const { afterKey, replaceKey } = pickTargetRef.current;
            store.insertUploads(files, afterKey);
            const replaced = replaceKey ? store.find(replaceKey) : undefined;
            if (replaced && replaced.type === "text" && !replaced.content)
              store.remove([replaced.key], { undoable: false });
            setEditing(null);
          }}
        />
      </div>

      {slash && (
        <SlashMenu
          anchor={slash.anchor}
          entries={slashEntries}
          activeIndex={slashNav.index}
          onHover={slashNav.setIndex}
          onSelect={applySlash}
          onClose={closeSlash}
        />
      )}

      {menu && menuBlock && menuActions && (
        <BlockMenu
          anchor={menu.anchor}
          block={menuBlock}
          count={selection.has(menu.key) ? selection.size : 1}
          actions={menuActions}
          onClose={closeMenu}
        />
      )}

      {pickerKeys && (
        <PagePicker
          title="Move to page"
          pages={pages}
          excludeIds={pickerExclude}
          onClose={() => setPickerKeys(null)}
          onPick={(pageId) => {
            if (store.moveToPage(pickerKeys, pageId)) {
              setSelection(EMPTY_SELECTION);
              props.onBlocksMoved(pageId);
              const target = pages.find((item) => item._id === pageId);
              toast.success(`Moved to ${displayTitle(target?.title ?? "")}`);
            }
          }}
        />
      )}
    </EditorContext.Provider>
  );
}
