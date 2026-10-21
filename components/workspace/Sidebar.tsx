"use client";

import { ChevronsLeft, LogOut, Plus, Search, Star, Trash2, X } from "lucide-react";
import Logo from "@/components/Logo";
import PageTree, { type PageTreeHandlers } from "./PageTree";
import ThemeToggle from "./ThemeToggle";
import { logoutAction } from "@/actions/auth";
import { displayTitle } from "@/lib/editor/titles";
import type { Page } from "@/lib/types";

interface SidebarProps {
  username: string;
  childrenOf: Map<string | null, Page[]>;
  favorites: Page[];
  activeId: string | null;
  expanded: ReadonlySet<string>;
  renamingId: string | null;
  handlers: PageTreeHandlers;
  onNewPage(): void;
  onSearch(): void;
  onTrash(): void;
  onHide(): void;
  isMobile: boolean;
}

const NAV_ITEM =
  "flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm text-neutral-600 transition-colors hover:bg-neutral-200/60 dark:text-neutral-300 dark:hover:bg-neutral-800";

export default function Sidebar({
  username,
  childrenOf,
  favorites,
  activeId,
  expanded,
  renamingId,
  handlers,
  onNewPage,
  onSearch,
  onTrash,
  onHide,
  isMobile,
}: SidebarProps) {
  return (
    <nav aria-label="Workspace" className="flex h-full flex-col bg-neutral-50 dark:bg-[#1c1c1c]">
      <div className="flex h-12 shrink-0 items-center gap-2 px-3 pt-[env(safe-area-inset-top,0px)] box-content">
        <Logo className="h-6 w-6 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-800 dark:text-neutral-100">
          CopyPaste
        </span>
        <button
          type="button"
          onClick={onHide}
          aria-label="Close sidebar"
          title={isMobile ? "Close" : "Collapse sidebar (⌘\\)"}
          className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-200/60 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          {isMobile ? <X className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
        </button>
      </div>

      <div className="space-y-px px-2 pb-2">
        <button type="button" onClick={onSearch} className={NAV_ITEM}>
          <Search className="h-4 w-4" />
          <span className="flex-1 text-left">Search</span>
          <kbd className="hidden rounded border border-neutral-300 px-1 font-sans text-[10px] text-neutral-400 dark:border-neutral-700 md:inline">
            ⌘K
          </kbd>
        </button>
        <button type="button" onClick={onNewPage} className={NAV_ITEM}>
          <Plus className="h-4 w-4" />
          <span className="flex-1 text-left">New page</span>
        </button>
      </div>

      <div data-sidebar-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
        {favorites.length > 0 && (
          <section className="mb-3" aria-label="Favorites">
            <h3 className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-neutral-400">
              Favorites
            </h3>
            <ul className="space-y-px">
              {favorites.map((page) => (
                <li key={page._id}>
                  <button
                    type="button"
                    onClick={() => handlers.open(page._id)}
                    className={`${NAV_ITEM} ${page._id === activeId ? "bg-neutral-200/80 font-medium dark:bg-neutral-800" : ""}`}
                  >
                    <span className="flex w-5 justify-center">
                      {page.icon || <Star className="h-3.5 w-3.5 text-amber-500" />}
                    </span>
                    <span className="truncate">{displayTitle(page.title)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-label="Pages">
          <div
            data-page-root-drop
            className="flex items-center justify-between rounded-md px-2 pb-1 pt-2 data-[drop-active=true]:bg-blue-500/15"
          >
            <h3 className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">Pages</h3>
            <button
              type="button"
              onClick={onNewPage}
              aria-label="New page"
              className="flex h-5 w-5 items-center justify-center rounded text-neutral-400 hover:bg-neutral-200/60 hover:text-neutral-700 dark:hover:bg-neutral-800"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <PageTree
            parentId={null}
            depth={0}
            childrenOf={childrenOf}
            activeId={activeId}
            expanded={expanded}
            renamingId={renamingId}
            handlers={handlers}
          />
          {(childrenOf.get(null)?.length ?? 0) === 0 && (
            <p className="px-2 py-2 text-xs text-neutral-400">No pages yet.</p>
          )}
        </section>
      </div>

      <div className="shrink-0 space-y-px border-t border-neutral-200 px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))] dark:border-neutral-800">
        <button type="button" onClick={onTrash} className={NAV_ITEM}>
          <Trash2 className="h-4 w-4" />
          <span className="flex-1 text-left">Trash</span>
        </button>
        <div className="flex items-center gap-1 pl-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-neutral-200 text-xs font-semibold uppercase text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            {username.slice(0, 1)}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm text-neutral-600 dark:text-neutral-300">
            @{username}
          </span>
          <ThemeToggle />
          <form action={logoutAction}>
            <button
              type="submit"
              aria-label="Log out"
              title="Log out"
              className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-200/60 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </nav>
  );
}
