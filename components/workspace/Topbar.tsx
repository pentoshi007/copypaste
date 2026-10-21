"use client";

import { Ellipsis, FileText, Menu as MenuIcon, PanelLeft, Search, Star } from "lucide-react";
import SaveIndicator from "./SaveIndicator";
import { displayTitle } from "@/lib/editor/titles";
import type { Page } from "@/lib/types";

interface TopbarProps {
  page: Page | null;
  ancestors: Page[];
  sidebarVisible: boolean;
  onShowSidebar(): void;
  onOpenPage(pageId: string): void;
  onSearch(): void;
  onToggleFavorite(): void;
  onOpenMenu(anchor: HTMLElement): void;
}

const ICON_BUTTON =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100";

function Crumb({ page, onOpen, current }: { page: Page; onOpen(): void; current?: boolean }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={current ? "page" : undefined}
      className={`flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
        current ? "text-neutral-800 dark:text-neutral-100" : "text-neutral-500 dark:text-neutral-400"
      }`}
    >
      <span className="shrink-0">{page.icon || <FileText className="h-3.5 w-3.5" />}</span>
      <span className="truncate">{displayTitle(page.title)}</span>
    </button>
  );
}

export default function Topbar({
  page,
  ancestors,
  sidebarVisible,
  onShowSidebar,
  onOpenPage,
  onSearch,
  onToggleFavorite,
  onOpenMenu,
}: TopbarProps) {
  const hiddenAncestors = ancestors.length > 2 ? ancestors.slice(0, ancestors.length - 2) : [];
  const shownAncestors = ancestors.slice(-2);

  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b border-transparent bg-white/90 px-2 pt-[env(safe-area-inset-top,0px)] box-content backdrop-blur dark:bg-neutral-950/90 sm:px-3">
      {!sidebarVisible && (
        <button type="button" onClick={onShowSidebar} aria-label="Open sidebar" className={ICON_BUTTON}>
          <MenuIcon className="h-5 w-5 md:hidden" />
          <PanelLeft className="hidden h-4 w-4 md:block" />
        </button>
      )}

      <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center">
        {page && (
          <>
            {hiddenAncestors.length > 0 && (
              <span className="hidden px-1 text-sm text-neutral-400 md:inline">…</span>
            )}
            {shownAncestors.map((ancestor) => (
              <span key={ancestor._id} className="hidden min-w-0 max-w-[10rem] items-center md:flex">
                <Crumb page={ancestor} onOpen={() => onOpenPage(ancestor._id)} />
                <span className="px-0.5 text-neutral-300 dark:text-neutral-600">/</span>
              </span>
            ))}
            <span className="flex min-w-0 max-w-full items-center">
              <Crumb page={page} onOpen={() => undefined} current />
            </span>
          </>
        )}
      </nav>

      <div className="flex shrink-0 items-center gap-0.5">
        <span className="px-1.5">
          <SaveIndicator />
        </span>
        <button
          type="button"
          onClick={onSearch}
          aria-label="Search"
          title="Search (⌘K)"
          className={ICON_BUTTON}
        >
          <Search className="h-4 w-4" />
        </button>
        {page && (
          <>
            <button
              type="button"
              onClick={onToggleFavorite}
              aria-label={page.favorite ? "Remove from favorites" : "Add to favorites"}
              aria-pressed={page.favorite}
              title={page.favorite ? "Remove from favorites" : "Add to favorites"}
              className={ICON_BUTTON}
            >
              <Star className={`h-4 w-4 ${page.favorite ? "fill-amber-400 text-amber-400" : ""}`} />
            </button>
            <button
              type="button"
              onClick={(event) => onOpenMenu(event.currentTarget)}
              aria-label="Page options"
              className={ICON_BUTTON}
            >
              <Ellipsis className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    </header>
  );
}
