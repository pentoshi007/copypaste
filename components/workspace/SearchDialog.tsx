"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Code2,
  File as FileIcon,
  FileText,
  Image as ImageIcon,
  Images,
  Link2,
  Loader2,
  Search,
  Type,
} from "lucide-react";
import Dialog from "@/components/ui/Dialog";
import LocalTime from "@/components/LocalTime";
import { searchWorkspace } from "@/lib/client/api";
import { useListNavigation } from "@/lib/client/hooks";
import { buildSnippet } from "@/lib/highlight";
import { displayTitle } from "@/lib/editor/titles";
import type { Block, Page, SearchResults } from "@/lib/types";

const DEBOUNCE_MS = 160;
const MIN_QUERY = 2;
const RECENT_LIMIT = 8;

type Result = { kind: "page"; page: Page } | { kind: "block"; block: Block };

function Snippet({ text, query }: { text: string; query: string }) {
  const { segments, clippedStart, clippedEnd } = useMemo(() => buildSnippet(text, query), [text, query]);
  return (
    <span className="break-words">
      {clippedStart && "… "}
      {segments.map((segment, index) =>
        segment.match ? (
          <mark
            key={index}
            className="rounded bg-amber-200 px-0.5 text-neutral-900 dark:bg-amber-500/40 dark:text-amber-50"
          >
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
      {clippedEnd && " …"}
    </span>
  );
}

function blockIcon(type: Block["type"]) {
  const className = "h-4 w-4 shrink-0 text-neutral-400";
  if (type === "code") return <Code2 className={className} />;
  if (type === "link") return <Link2 className={className} />;
  if (type === "image") return <ImageIcon className={className} />;
  if (type === "file") return <FileIcon className={className} />;
  if (type === "group") return <Images className={className} />;
  return <Type className={className} />;
}

function blockHeading(block: Block): string {
  if (block.type === "file" || block.type === "image") return block.fileName;
  if (block.type === "group")
    return (block.attachments ?? []).map((attachment) => attachment.fileName).join(", ");
  return "";
}

export default function SearchDialog({
  pages,
  onClose,
  onOpenPage,
  onOpenBlock,
}: {
  pages: Page[];
  onClose(): void;
  onOpenPage(pageId: string): void;
  onOpenBlock(pageId: string, blockId: string): void;
}) {
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState<(SearchResults & { error?: boolean }) | null>(null);
  const trimmed = query.trim();
  const searching = trimmed.length >= MIN_QUERY;
  const current = searching && outcome?.query === trimmed ? outcome : null;
  const loading = searching && !current;

  const titles = useMemo(() => new Map(pages.map((page) => [page._id, page])), [pages]);

  const results = useMemo<Result[]>(() => {
    if (!searching) {
      return [...pages]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, RECENT_LIMIT)
        .map((page) => ({ kind: "page", page }));
    }
    if (!current) return [];
    return [
      ...current.pages.map((page) => ({ kind: "page" as const, page })),
      ...current.blocks
        .filter((block) => titles.has(block.pageId))
        .map((block) => ({ kind: "block" as const, block })),
    ];
  }, [searching, current, pages, titles]);

  const { index, setIndex, handleKey } = useListNavigation(results.length, `${trimmed}:${results.length}`);

  useEffect(() => {
    if (!searching) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      searchWorkspace(trimmed, controller.signal)
        .then((data) => setOutcome(data))
        .catch((error: Error) => {
          if (error.name !== "AbortError") {
            setOutcome({ query: trimmed, pages: [], blocks: [], truncated: false, error: true });
          }
        });
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, searching]);

  useEffect(() => {
    document.querySelector(`[data-search-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const choose = (result: Result) => {
    onClose();
    if (result.kind === "page") onOpenPage(result.page._id);
    else onOpenBlock(result.block.pageId, result.block._id);
  };

  return (
    <Dialog title="Search" onClose={onClose} size="lg" fullscreenOnMobile hideHeader>
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-neutral-200 bg-white px-4 pt-[env(safe-area-inset-top,0px)] dark:border-neutral-800 dark:bg-neutral-900">
        <Search className="h-4 w-4 shrink-0 text-neutral-400" />
        <input
          data-autofocus
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (handleKey(event) === "select" && results[index]) choose(results[index]);
          }}
          placeholder="Search pages, text, captions, file names…"
          aria-label="Search"
          maxLength={100}
          enterKeyHint="search"
          autoComplete="off"
          className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-neutral-400 sm:text-sm"
        />
        {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-neutral-400" />}
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-md px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          Esc
        </button>
      </div>

      {!searching && (
        <p className="px-4 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-neutral-400">
          Recent pages
        </p>
      )}
      {current?.error && <p className="p-4 text-sm text-red-500">Search failed. Try again.</p>}
      {current && !current.error && results.length === 0 && (
        <p className="p-6 text-center text-sm text-neutral-400">No results for &ldquo;{trimmed}&rdquo;</p>
      )}

      <ul role="listbox" aria-label="Results" className="py-1">
        {results.map((result, position) => {
          const highlighted = position === index;
          const base = `flex w-full items-start gap-3 px-4 py-2.5 text-left ${highlighted ? "bg-neutral-100 dark:bg-neutral-800" : ""}`;

          if (result.kind === "page") {
            const page = result.page;
            return (
              <li key={`page-${page._id}`} role="option" aria-selected={highlighted}>
                <button
                  type="button"
                  data-search-index={position}
                  onPointerMove={() => setIndex(position)}
                  onClick={() => choose(result)}
                  className={base}
                >
                  <span className="flex w-4 shrink-0 justify-center pt-0.5">
                    {page.icon || <FileText className="h-4 w-4 text-neutral-400" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">
                      {searching ? (
                        <Snippet text={displayTitle(page.title)} query={trimmed} />
                      ) : (
                        displayTitle(page.title)
                      )}
                    </span>
                    <LocalTime iso={page.updatedAt} className="text-xs text-neutral-400" />
                  </span>
                </button>
              </li>
            );
          }

          const block = result.block;
          const page = titles.get(block.pageId);
          const heading = blockHeading(block);
          return (
            <li key={`block-${block._id}`} role="option" aria-selected={highlighted}>
              <button
                type="button"
                data-search-index={position}
                onPointerMove={() => setIndex(position)}
                onClick={() => choose(result)}
                className={base}
              >
                <span className="pt-0.5">{blockIcon(block.type)}</span>
                <span className="min-w-0 flex-1 text-sm text-neutral-600 dark:text-neutral-300">
                  <span className="mb-0.5 flex items-center gap-1.5 text-xs text-neutral-400">
                    <span className="truncate">
                      {page?.icon} {displayTitle(page?.title ?? "")}
                    </span>
                    <span aria-hidden="true">·</span>
                    <LocalTime iso={block.createdAt} className="shrink-0" />
                  </span>
                  {heading && (
                    <span className="block truncate font-medium text-neutral-800 dark:text-neutral-100">
                      <Snippet text={heading} query={trimmed} />
                    </span>
                  )}
                  {block.content && (
                    <span className="block">
                      <Snippet text={block.content} query={trimmed} />
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {current?.truncated && (
        <p className="px-4 pb-4 text-xs text-neutral-400">
          Showing the most recent matches — refine your search to see more.
        </p>
      )}
    </Dialog>
  );
}
