"use client";

import { memo, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronRight, Ellipsis, FileText, Plus } from "lucide-react";
import { displayTitle } from "@/lib/editor/titles";
import type { Page } from "@/lib/types";

export interface PageTreeHandlers {
  open(pageId: string): void;
  toggle(pageId: string): void;
  addChild(pageId: string): void;
  openMenu(pageId: string, anchor: HTMLElement): void;
  rename(pageId: string, title: string): void;
  startDrag(event: ReactPointerEvent, pageId: string): void;
}

interface PageTreeProps {
  parentId: string | null;
  depth: number;
  childrenOf: Map<string | null, Page[]>;
  activeId: string | null;
  expanded: ReadonlySet<string>;
  renamingId: string | null;
  handlers: PageTreeHandlers;
}

function RenameInput({ page, onDone }: { page: Page; onDone(title: string | null): void }) {
  const [value, setValue] = useState(page.title);
  return (
    <input
      autoFocus
      value={value}
      maxLength={200}
      aria-label="Page title"
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={() => onDone(value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") onDone(value);
        if (event.key === "Escape") onDone(null);
      }}
      className="min-w-0 flex-1 rounded border border-blue-400 bg-white px-1.5 py-0.5 text-base text-neutral-900 outline-none dark:bg-neutral-900 dark:text-white sm:text-sm"
    />
  );
}

const PageRow = memo(function PageRow({
  page,
  depth,
  active,
  open,
  hasChildren,
  renaming,
  handlers,
}: {
  page: Page;
  depth: number;
  active: boolean;
  open: boolean;
  hasChildren: boolean;
  renaming: boolean;
  handlers: PageTreeHandlers;
}) {
  return (
    <div
      data-page-drop={page._id}
      className={`group/page relative flex h-8 select-none items-center gap-0.5 rounded-md pr-1 text-sm transition-colors [-webkit-touch-callout:none] data-[drop-active=true]:bg-blue-500/15 data-[drop-active=true]:ring-1 data-[drop-active=true]:ring-blue-500/50 ${
        active
          ? "bg-neutral-200/80 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-white"
          : "text-neutral-600 hover:bg-neutral-200/50 dark:text-neutral-300 dark:hover:bg-neutral-800/60"
      }`}
      style={{ paddingLeft: 4 + depth * 14 }}
    >
      <button
        type="button"
        aria-label={open ? "Collapse" : "Expand"}
        aria-expanded={open}
        onClick={() => handlers.toggle(page._id)}
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-neutral-300/60 dark:hover:bg-neutral-700 ${
          hasChildren ? "" : "opacity-0 group-hover/page:opacity-100 pointer-coarse:opacity-40"
        }`}
      >
        <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>

      {renaming ? (
        <RenameInput page={page} onDone={(title) => handlers.rename(page._id, title ?? page.title)} />
      ) : (
        <button
          type="button"
          onClick={() => handlers.open(page._id)}
          onPointerDown={(event) => handlers.startDrag(event, page._id)}
          aria-current={active ? "page" : undefined}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <span className="flex w-5 shrink-0 justify-center">
            {page.icon ? (
              <span className="text-[15px] leading-none">{page.icon}</span>
            ) : (
              <FileText className="h-4 w-4 text-neutral-400" />
            )}
          </span>
          <span className="truncate">{displayTitle(page.title)}</span>
        </button>
      )}

      {!renaming && (
        <div className="flex shrink-0 items-center opacity-0 transition group-hover/page:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
          <button
            type="button"
            aria-label="Page options"
            onClick={(event) => handlers.openMenu(page._id, event.currentTarget)}
            className="flex h-6 w-6 items-center justify-center rounded text-neutral-400 hover:bg-neutral-300/60 hover:text-neutral-700 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
          >
            <Ellipsis className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Add a page inside"
            onClick={() => handlers.addChild(page._id)}
            className="flex h-6 w-6 items-center justify-center rounded text-neutral-400 hover:bg-neutral-300/60 hover:text-neutral-700 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
});

export default function PageTree({
  parentId,
  depth,
  childrenOf,
  activeId,
  expanded,
  renamingId,
  handlers,
}: PageTreeProps) {
  const pages = childrenOf.get(parentId) ?? [];
  if (pages.length === 0) {
    return depth > 0 ? (
      <p className="py-1 text-xs text-neutral-400" style={{ paddingLeft: 32 + depth * 14 }}>
        No pages inside
      </p>
    ) : null;
  }

  return (
    <ul role={depth === 0 ? "tree" : "group"} className="space-y-px">
      {pages.map((page) => {
        const open = expanded.has(page._id);
        const hasChildren = (childrenOf.get(page._id)?.length ?? 0) > 0;
        return (
          <li key={page._id} role="treeitem" aria-expanded={open} aria-selected={page._id === activeId}>
            <PageRow
              page={page}
              depth={depth}
              active={page._id === activeId}
              open={open}
              hasChildren={hasChildren}
              renaming={page._id === renamingId}
              handlers={handlers}
            />
            {open && (
              <PageTree
                parentId={page._id}
                depth={depth + 1}
                childrenOf={childrenOf}
                activeId={activeId}
                expanded={expanded}
                renamingId={renamingId}
                handlers={handlers}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
