"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { FilePlus, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import PageMenu, { type PageMenuActions } from "./PageMenu";
import PagePicker, { ROOT_TARGET } from "./PagePicker";
import SearchDialog from "./SearchDialog";
import TrashDialog from "./TrashDialog";
import type { PageTreeHandlers } from "./PageTree";
import PageEditor from "@/components/editor/PageEditor";
import {
  createPage as createPageAction,
  duplicatePage as duplicatePageAction,
  movePage as movePageAction,
  restorePage as restorePageAction,
  trashPage as trashPageAction,
  updatePage as updatePageAction,
} from "@/actions/pages";
import { RequestError, fetchPageBlocks, fetchPages } from "@/lib/client/api";
import { copyToClipboard, downloadText, useIsMobile, useLocalStorage } from "@/lib/client/hooks";
import {
  createDragGhost,
  moveGhost,
  startAutoScroll,
  trackPointerDrag,
  type Point,
} from "@/lib/client/pointerDrag";
import { reportFailure, syncQueue } from "@/lib/client/syncQueue";
import { markdownFileName, pageToMarkdown } from "@/lib/editor/markdown";
import {
  ancestorsOf,
  byPosition,
  childrenIndex,
  descendantIds,
  placeAmong,
  wouldCreateCycle,
} from "@/lib/editor/pageTree";
import { displayTitle } from "@/lib/editor/titles";
import { isObjectId } from "@/lib/guards";
import type { Block, Page, PagePatch } from "@/lib/types";

const TITLE_DEBOUNCE_MS = 500;
const REFRESH_INTERVAL_MS = 10_000;
const LAST_PAGE_KEY = "cp:last-page";

interface WorkspaceProps {
  username: string;
  initialPages: Page[];
  initialPageId: string | null;
  initialBlocks: Block[];
}

interface PageData {
  pageId: string | null;
  blocks: Block[] | null;
  remote: { version: number; blocks: Block[]; requestedAt: number } | null;
  failed: boolean;
}

type PageDrop =
  | { kind: "row"; pageId: string; zone: "before" | "inside" | "after"; element: HTMLElement }
  | { kind: "root"; element: HTMLElement }
  | null;

function pageUrl(pageId: string): string {
  return `/?p=${encodeURIComponent(pageId)}`;
}

export default function Workspace({ username, initialPages, initialPageId, initialBlocks }: WorkspaceProps) {
  const [pages, setPagesState] = useState<Page[]>(initialPages);
  const [activeId, setActiveIdState] = useState<string | null>(initialPageId);
  const [pageData, setPageData] = useState<PageData>({
    pageId: initialPageId,
    blocks: initialPageId ? initialBlocks : null,
    remote: null,
    failed: false,
  });
  const [reveal, setReveal] = useState<{ pageId: string; blockId: string } | null>(null);
  const [focusTitleFor, setFocusTitleFor] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useLocalStorage("cp:sidebar-collapsed", false);
  const [expandedList, setExpandedList] = useLocalStorage<string[]>("cp:expanded-pages", []);
  const [dialog, setDialog] = useState<"search" | "trash" | null>(null);
  const [pageMenu, setPageMenu] = useState<{
    pageId: string;
    anchor: HTMLElement;
    fromTopbar: boolean;
  } | null>(null);
  const [movingPageId, setMovingPageId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const isMobile = useIsMobile();
  const pagesRef = useRef(pages);
  const pagesMutatedAt = useRef(0);
  const activeIdRef = useRef(activeId);
  const expandedRef = useRef(expandedList);
  const cacheRef = useRef(new Map<string, Block[]>(initialPageId ? [[initialPageId, initialBlocks]] : []));
  const pendingPatches = useRef(new Map<string, { patch: PagePatch; timer: number }>());
  const remoteVersion = useRef(0);
  const lastRefresh = useRef(0);
  const lineRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    expandedRef.current = expandedList;
  }, [expandedList]);

  const setPages = useCallback(
    (update: (current: Page[]) => Page[], origin: "local" | "server" = "local") => {
      const next = update(pagesRef.current);
      pagesRef.current = next;
      if (origin === "local") pagesMutatedAt.current = Date.now();
      setPagesState(next);
    },
    [],
  );

  const setActiveId = useCallback((pageId: string | null) => {
    activeIdRef.current = pageId;
    setActiveIdState(pageId);
  }, []);

  const expanded = useMemo(() => new Set(expandedList), [expandedList]);
  const childrenOf = useMemo(() => childrenIndex(pages), [pages]);
  const favorites = useMemo(() => pages.filter((page) => page.favorite).sort(byPosition), [pages]);
  const activePage = useMemo(() => pages.find((page) => page._id === activeId) ?? null, [pages, activeId]);
  const ancestors = useMemo(() => (activeId ? ancestorsOf(pages, activeId) : []), [pages, activeId]);

  const expand = useCallback(
    (ids: string[]) => {
      const current = new Set(expandedRef.current);
      const before = current.size;
      for (const id of ids) current.add(id);
      if (current.size !== before) setExpandedList([...current]);
    },
    [setExpandedList],
  );

  const loadBlocks = useCallback(
    async (pageId: string) => {
      try {
        const { data: blocks, requestedAt } = await fetchPageBlocks(pageId);
        remoteVersion.current += 1;
        const version = remoteVersion.current;
        setPageData((current) => {
          if (current.pageId !== pageId) return current;
          return current.blocks === null
            ? { ...current, blocks, failed: false }
            : { ...current, remote: { version, blocks, requestedAt } };
        });
      } catch (error) {
        if (error instanceof RequestError && error.status === 404) {
          toast.error("That page no longer exists");
          setPages((current) => current.filter((page) => page._id !== pageId));
          cacheRef.current.delete(pageId);
        }
        setPageData((current) =>
          current.pageId === pageId && current.blocks === null ? { ...current, failed: true } : current,
        );
      }
    },
    [setPages],
  );

  const openPage = useCallback(
    (pageId: string | null, options: { history?: "push" | "replace" | "none"; blockId?: string } = {}) => {
      const history = options.history ?? "push";
      setMobileOpen(false);
      if (pageId && !pagesRef.current.some((page) => page._id === pageId)) return;
      if (pageId && options.blockId) setReveal({ pageId, blockId: options.blockId });
      if (pageId === activeIdRef.current) return;

      setActiveId(pageId);
      setRenamingId(null);
      setFocusTitleFor(null);
      const cached = pageId ? (cacheRef.current.get(pageId) ?? null) : null;
      setPageData({ pageId, blocks: cached, remote: null, failed: false });

      if (pageId) {
        expand(ancestorsOf(pagesRef.current, pageId).map((page) => page._id));
        if (history !== "none")
          window.history[history === "push" ? "pushState" : "replaceState"](null, "", pageUrl(pageId));
        try {
          localStorage.setItem(LAST_PAGE_KEY, pageId);
        } catch {}
        void loadBlocks(pageId);
      }
    },
    [expand, loadBlocks, setActiveId],
  );

  const flushPagePatch = useCallback((pageId: string) => {
    const pending = pendingPatches.current.get(pageId);
    if (!pending) return;
    window.clearTimeout(pending.timer);
    pendingPatches.current.delete(pageId);
    void syncQueue.enqueue(async () =>
      reportFailure(await updatePageAction({ pageId, patch: pending.patch })),
    );
  }, []);

  const updatePage = useCallback(
    (pageId: string, patch: PagePatch, options: { debounce?: boolean } = {}) => {
      const now = new Date().toISOString();
      setPages((current) =>
        current.map((page) => (page._id === pageId ? { ...page, ...patch, updatedAt: now } : page)),
      );
      const previous = pendingPatches.current.get(pageId);
      if (previous) window.clearTimeout(previous.timer);
      const merged = { ...previous?.patch, ...patch };
      const timer = options.debounce ? window.setTimeout(() => flushPagePatch(pageId), TITLE_DEBOUNCE_MS) : 0;
      pendingPatches.current.set(pageId, { patch: merged, timer });
      if (!options.debounce) flushPagePatch(pageId);
    },
    [flushPagePatch, setPages],
  );

  const createPage = useCallback(
    async (parentId: string | null) => {
      const result = await createPageAction({ parentId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setPages((current) => [...current, result.page]);
      if (parentId) expand([parentId]);
      cacheRef.current.set(result.page._id, []);
      openPage(result.page._id);
      setFocusTitleFor(result.page._id);
    },
    [expand, openPage, setPages],
  );

  const fallbackAfterRemoval = useCallback(
    (removed: Set<string>, preferred: string | null) => {
      if (!activeIdRef.current || !removed.has(activeIdRef.current)) return;
      const remaining = pagesRef.current;
      const next =
        (preferred && remaining.find((page) => page._id === preferred)) ||
        [...remaining].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ||
        null;
      openPage(next?._id ?? null, { history: "replace" });
    },
    [openPage],
  );

  const mergePages = useCallback(
    (incoming: Page[]) => {
      const byId = new Map(incoming.map((page) => [page._id, page]));
      setPages((current) => [...current.filter((page) => !byId.has(page._id)), ...incoming]);
    },
    [setPages],
  );

  const trashPage = useCallback(
    (pageId: string) => {
      const target = pagesRef.current.find((page) => page._id === pageId);
      if (!target) return;
      const ids = descendantIds(pagesRef.current, pageId);
      const removed = pagesRef.current.filter((page) => ids.has(page._id));
      setPages((current) => current.filter((page) => !ids.has(page._id)));
      fallbackAfterRemoval(ids, target.parentId);

      void syncQueue.enqueue(async () => {
        const result = await trashPageAction({ pageId });
        if (!result.ok) {
          toast.error(result.error);
          mergePages(removed);
          return false;
        }
        return true;
      });

      toast(`Moved “${displayTitle(target.title)}” to trash`, {
        duration: 6000,
        action: {
          label: "Undo",
          onClick: () => {
            void syncQueue.enqueue(async () => {
              const result = await restorePageAction({ pageId });
              if (!result.ok) {
                toast.error(result.error);
                return false;
              }
              mergePages(result.pages);
              return true;
            });
          },
        },
      });
    },
    [fallbackAfterRemoval, mergePages, setPages],
  );

  const movePage = useCallback(
    (pageId: string, parentId: string | null, beforeId: string | null) => {
      const current = pagesRef.current;
      if (wouldCreateCycle(current, pageId, parentId)) {
        toast.error("A page can't be moved inside itself");
        return;
      }
      const siblings = childrenIndex(current).get(parentId) ?? [];
      const placement = placeAmong(siblings, pageId, beforeId);
      const rebalanced = new Map(placement.rebalanced.map((row) => [row._id, row.position]));
      setPages((list) =>
        list.map((page) =>
          page._id === pageId
            ? { ...page, parentId, position: placement.position }
            : rebalanced.has(page._id)
              ? { ...page, position: rebalanced.get(page._id) as number }
              : page,
        ),
      );
      if (parentId) expand([parentId]);

      void syncQueue.enqueue(async () => {
        const result = await movePageAction({ pageId, parentId, beforeId });
        if (!result.ok) {
          toast.error(result.error);
          fetchPages()
            .then((fresh) => setPages(() => fresh.data, "server"))
            .catch(() => undefined);
          return false;
        }
        return true;
      });
    },
    [expand, setPages],
  );

  const duplicatePage = useCallback(
    async (pageId: string) => {
      await syncQueue.idle();
      const result = await duplicatePageAction({ pageId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const rebalanced = new Map(result.rebalanced.map((row) => [row._id, row.position]));
      setPages((current) => [
        ...current.map((page) =>
          rebalanced.has(page._id) ? { ...page, position: rebalanced.get(page._id) as number } : page,
        ),
        result.page,
      ]);
      openPage(result.page._id);
      toast.success("Page duplicated");
    },
    [openPage, setPages],
  );

  const exportMarkdown = useCallback(async (pageId: string, mode: "copy" | "download") => {
    const page = pagesRef.current.find((item) => item._id === pageId);
    if (!page) return;
    try {
      const { data: blocks } = await fetchPageBlocks(pageId);
      const markdown = pageToMarkdown(page.title, blocks);
      if (mode === "download") downloadText(markdownFileName(page.title), markdown);
      else if (await copyToClipboard(markdown)) toast.success("Copied as Markdown");
      else toast.error("Couldn't copy");
    } catch {
      toast.error("Couldn't export this page");
    }
  }, []);

  const startPageDrag = useCallback(
    (event: ReactPointerEvent, pageId: string) => {
      trackPointerDrag(event.nativeEvent, {
        threshold: 5,
        touchHoldMs: 350,
        onStart: () => {
          const page = pagesRef.current.find((item) => item._id === pageId);
          const line = lineRef.current;
          if (!page || !line) return null;
          const blocked = descendantIds(pagesRef.current, pageId);
          const ghost = createDragGhost(`${page.icon ? `${page.icon} ` : ""}${displayTitle(page.title)}`, 1);
          const scroller = document.querySelector<HTMLElement>("[data-sidebar-scroll]");
          let point: Point | null = null;
          let drop: PageDrop = null;
          let highlighted: HTMLElement | null = null;

          const clearHighlight = () => {
            if (highlighted) delete highlighted.dataset.dropActive;
            highlighted = null;
          };

          const render = () => {
            if (!point) return;
            moveGhost(ghost, point);
            clearHighlight();
            line.hidden = true;
            drop = null;

            const element = document.elementFromPoint(point.x, point.y) as HTMLElement | null;
            const root = element?.closest<HTMLElement>("[data-page-root-drop]");
            if (root) {
              drop = { kind: "root", element: root };
              highlighted = root;
              root.dataset.dropActive = "true";
              return;
            }
            const row = element?.closest<HTMLElement>("[data-page-drop]");
            const targetId = row?.dataset.pageDrop;
            if (!row || !targetId || blocked.has(targetId)) return;

            const rect = row.getBoundingClientRect();
            const offset = (point.y - rect.top) / rect.height;
            const zone = offset < 0.28 ? "before" : offset > 0.72 ? "after" : "inside";
            drop = { kind: "row", pageId: targetId, zone, element: row };
            if (zone === "inside") {
              highlighted = row;
              row.dataset.dropActive = "true";
            } else {
              line.hidden = false;
              line.style.top = `${(zone === "before" ? rect.top : rect.bottom) - 1}px`;
              line.style.left = `${rect.left + 8}px`;
              line.style.width = `${rect.width - 16}px`;
            }
          };

          const stopScroll = scroller ? startAutoScroll(scroller, () => point, render) : () => undefined;
          const cleanup = () => {
            stopScroll();
            ghost.remove();
            line.hidden = true;
            clearHighlight();
          };

          return {
            move: (next) => {
              point = next;
              render();
            },
            drop: () => {
              cleanup();
              const final: PageDrop = drop;
              if (!final) return;
              if (final.kind === "root") {
                const first = (childrenIndex(pagesRef.current).get(null) ?? []).find(
                  (item) => item._id !== pageId,
                );
                movePage(pageId, null, first?._id ?? null);
                return;
              }
              const target = pagesRef.current.find((item) => item._id === final.pageId);
              if (!target) return;
              if (final.zone === "inside") {
                movePage(pageId, target._id, null);
                return;
              }
              const parentId =
                target.parentId && pagesRef.current.some((item) => item._id === target.parentId)
                  ? target.parentId
                  : null;
              const siblings = (childrenIndex(pagesRef.current).get(parentId) ?? []).filter(
                (item) => item._id !== pageId,
              );
              const at = siblings.findIndex((item) => item._id === target._id);
              const beforeId = final.zone === "before" ? target._id : (siblings[at + 1]?._id ?? null);
              movePage(pageId, parentId, beforeId);
            },
            cancel: cleanup,
          };
        },
      });
    },
    [movePage],
  );

  const treeHandlers = useMemo<PageTreeHandlers>(
    () => ({
      open: (pageId) => openPage(pageId),
      toggle: (pageId) => {
        const current = new Set(expandedRef.current);
        if (current.has(pageId)) current.delete(pageId);
        else current.add(pageId);
        setExpandedList([...current]);
      },
      addChild: (pageId) => void createPage(pageId),
      openMenu: (pageId, anchor) => setPageMenu({ pageId, anchor, fromTopbar: false }),
      rename: (pageId, title) => {
        setRenamingId(null);
        const page = pagesRef.current.find((item) => item._id === pageId);
        if (page && page.title !== title.trim()) updatePage(pageId, { title: title.trim() });
      },
      startDrag: startPageDrag,
    }),
    [createPage, openPage, setExpandedList, startPageDrag, updatePage],
  );

  const menuPage = pageMenu ? (pages.find((page) => page._id === pageMenu.pageId) ?? null) : null;
  const menuActions = useMemo<PageMenuActions | null>(() => {
    if (!pageMenu || !menuPage) return null;
    const pageId = menuPage._id;
    return {
      rename: pageMenu.fromTopbar ? undefined : () => setRenamingId(pageId),
      addChild: () => void createPage(pageId),
      toggleFavorite: () => updatePage(pageId, { favorite: !menuPage.favorite }),
      toggleFullWidth:
        pageMenu.fromTopbar && !isMobile
          ? () => updatePage(pageId, { fullWidth: !menuPage.fullWidth })
          : undefined,
      duplicate: () => void duplicatePage(pageId),
      moveTo: () => setMovingPageId(pageId),
      copyLink: async () => {
        if (await copyToClipboard(`${window.location.origin}${pageUrl(pageId)}`))
          toast.success("Link copied");
      },
      copyMarkdown: () => void exportMarkdown(pageId, "copy"),
      exportMarkdown: () => void exportMarkdown(pageId, "download"),
      trash: () => trashPage(pageId),
    };
  }, [pageMenu, menuPage, createPage, updatePage, isMobile, duplicatePage, exportMarkdown, trashPage]);

  const movingExclusions = useMemo(
    () => (movingPageId ? descendantIds(pages, movingPageId) : new Set<string>()),
    [movingPageId, pages],
  );

  useEffect(() => {
    if (initialPageId && !new URL(window.location.href).searchParams.has("p")) {
      window.history.replaceState(null, "", pageUrl(initialPageId));
    }
  }, [initialPageId]);

  useEffect(() => {
    const onPopState = () => {
      const requested = new URL(window.location.href).searchParams.get("p");
      if (isObjectId(requested)) openPage(requested, { history: "none" });
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [openPage]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      if (key === "k" || (key === "p" && !event.shiftKey)) {
        event.preventDefault();
        setDialog("search");
      } else if (key === "\\") {
        event.preventDefault();
        if (isMobile) setMobileOpen((open) => !open);
        else setCollapsed(!collapsed);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [collapsed, isMobile, setCollapsed]);

  useEffect(() => {
    const flushAll = () => {
      for (const pageId of [...pendingPatches.current.keys()]) flushPagePatch(pageId);
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      flushAll();
      if (syncQueue.hasUnsaved()) event.preventDefault();
    };
    const refresh = () => {
      if (document.visibilityState !== "visible") {
        flushAll();
        return;
      }
      const now = Date.now();
      if (now - lastRefresh.current < REFRESH_INTERVAL_MS || syncQueue.isBusy()) return;
      lastRefresh.current = now;
      fetchPages()
        .then((fresh) => {
          const stale = pagesMutatedAt.current >= fresh.requestedAt;
          if (!stale && pendingPatches.current.size === 0 && !syncQueue.isBusy())
            setPages(() => fresh.data, "server");
        })
        .catch(() => undefined);
      if (activeIdRef.current) void loadBlocks(activeIdRef.current);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("pagehide", flushAll);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pagehide", flushAll);
    };
  }, [flushPagePatch, loadBlocks, setPages]);

  useEffect(() => {
    const preventFileNavigation = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    window.addEventListener("dragover", preventFileNavigation);
    window.addEventListener("drop", preventFileNavigation);
    return () => {
      window.removeEventListener("dragover", preventFileNavigation);
      window.removeEventListener("drop", preventFileNavigation);
    };
  }, []);

  const sidebarVisible = isMobile ? mobileOpen : !collapsed;
  const sidebar = (
    <Sidebar
      username={username}
      childrenOf={childrenOf}
      favorites={favorites}
      activeId={activeId}
      expanded={expanded}
      renamingId={renamingId}
      handlers={treeHandlers}
      onNewPage={() => void createPage(null)}
      onSearch={() => {
        setMobileOpen(false);
        setDialog("search");
      }}
      onTrash={() => {
        setMobileOpen(false);
        setDialog("trash");
      }}
      onHide={() => (isMobile ? setMobileOpen(false) : setCollapsed(true))}
      isMobile={isMobile}
    />
  );

  const editorReady = activePage && pageData.pageId === activePage._id && pageData.blocks;

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden bg-white text-neutral-800 dark:bg-neutral-950 dark:text-neutral-200">
      {!isMobile && (
        <aside
          className={`hidden shrink-0 overflow-hidden border-neutral-200 transition-[width] duration-200 dark:border-neutral-800 md:block ${
            collapsed ? "w-0 border-r-0" : "w-64 border-r"
          }`}
          aria-hidden={collapsed}
        >
          <div className="h-full w-64">{sidebar}</div>
        </aside>
      )}

      {isMobile && (
        <div
          className={`fixed inset-0 z-50 ${mobileOpen ? "" : "pointer-events-none"}`}
          aria-hidden={!mobileOpen}
        >
          <div
            className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${mobileOpen ? "opacity-100" : "opacity-0"}`}
            onClick={() => setMobileOpen(false)}
          />
          <aside
            className={`absolute inset-y-0 left-0 w-[85%] max-w-[300px] shadow-2xl transition-transform duration-200 will-change-transform ${
              mobileOpen ? "translate-x-0" : "-translate-x-full"
            }`}
            inert={!mobileOpen}
          >
            {sidebar}
          </aside>
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <Topbar
          page={activePage}
          ancestors={ancestors}
          sidebarVisible={sidebarVisible}
          onShowSidebar={() => (isMobile ? setMobileOpen(true) : setCollapsed(false))}
          onOpenPage={(pageId) => openPage(pageId)}
          onSearch={() => setDialog("search")}
          onToggleFavorite={() =>
            activePage && updatePage(activePage._id, { favorite: !activePage.favorite })
          }
          onOpenMenu={(anchor) =>
            activePage && setPageMenu({ pageId: activePage._id, anchor, fromTopbar: true })
          }
        />

        {editorReady ? (
          <PageEditor
            key={activePage._id}
            page={activePage}
            pages={pages}
            initialBlocks={pageData.blocks as Block[]}
            remote={pageData.remote}
            autoFocusTitle={focusTitleFor === activePage._id}
            revealBlockId={reveal?.pageId === activePage._id ? reveal.blockId : null}
            onRevealed={() => setReveal(null)}
            onUpdatePage={(patch, options) => updatePage(activePage._id, patch, options)}
            onCreateSubPage={() => void createPage(activePage._id)}
            onOpenPage={(pageId) => openPage(pageId)}
            onBlocksMoved={(pageId) => cacheRef.current.delete(pageId)}
            onSnapshot={(pageId, blocks) => cacheRef.current.set(pageId, blocks)}
            onConflict={(pageId) => void loadBlocks(pageId)}
          />
        ) : activePage ? (
          pageData.failed ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-sm text-neutral-500">
              <p>Couldn&apos;t load this page.</p>
              <button
                type="button"
                onClick={() => {
                  setPageData((current) => ({ ...current, failed: false }));
                  void loadBlocks(activePage._id);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-2 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
              >
                <RotateCcw className="h-4 w-4" /> Retry
              </button>
            </div>
          ) : (
            <div className="flex flex-1 items-start justify-center pt-24 text-neutral-400" aria-busy="true">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
            <p className="text-sm text-neutral-500">No page selected.</p>
            <button
              type="button"
              onClick={() => void createPage(null)}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <FilePlus className="h-4 w-4" />
              New page
            </button>
          </div>
        )}
      </main>

      <div ref={lineRef} hidden className="drop-line" aria-hidden="true" />

      {pageMenu && menuPage && menuActions && (
        <PageMenu
          page={menuPage}
          anchor={pageMenu.anchor}
          actions={menuActions}
          onClose={() => setPageMenu(null)}
        />
      )}

      {movingPageId && (
        <PagePicker
          title="Move page to"
          pages={pages}
          excludeIds={movingExclusions}
          allowRoot
          onClose={() => setMovingPageId(null)}
          onPick={(target) => {
            const parentId = target === ROOT_TARGET ? null : target;
            const first =
              parentId === null
                ? (childrenOf.get(null) ?? []).find((page) => page._id !== movingPageId)
                : undefined;
            movePage(movingPageId, parentId, first?._id ?? null);
          }}
        />
      )}

      {dialog === "search" && (
        <SearchDialog
          pages={pages}
          onClose={() => setDialog(null)}
          onOpenPage={(pageId) => openPage(pageId)}
          onOpenBlock={(pageId, blockId) => openPage(pageId, { blockId })}
        />
      )}

      {dialog === "trash" && <TrashDialog onClose={() => setDialog(null)} onRestored={mergePages} />}
    </div>
  );
}
