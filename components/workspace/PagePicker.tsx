"use client";

import { useMemo, useState } from "react";
import { CornerDownLeft, FileText, Search } from "lucide-react";
import Dialog from "@/components/ui/Dialog";
import { useListNavigation } from "@/lib/client/hooks";
import { ancestorsOf } from "@/lib/editor/pageTree";
import { displayTitle } from "@/lib/editor/titles";
import type { Page } from "@/lib/types";

export const ROOT_TARGET = "__root__";

interface PagePickerProps {
  title: string;
  pages: Page[];
  excludeIds: ReadonlySet<string>;
  allowRoot?: boolean;
  onPick(pageId: string): void;
  onClose(): void;
}

export default function PagePicker({
  title,
  pages,
  excludeIds,
  allowRoot = false,
  onPick,
  onClose,
}: PagePickerProps) {
  const [query, setQuery] = useState("");

  const options = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const candidates = pages
      .filter((page) => !excludeIds.has(page._id))
      .map((page) => ({
        id: page._id,
        icon: page.icon,
        title: displayTitle(page.title),
        path: ancestorsOf(pages, page._id)
          .map((ancestor) => displayTitle(ancestor.title))
          .join(" / "),
      }))
      .filter(
        (option) =>
          !needle ||
          option.title.toLowerCase().includes(needle) ||
          option.path.toLowerCase().includes(needle),
      );
    const root =
      allowRoot && (!needle || "top level root".includes(needle))
        ? [{ id: ROOT_TARGET, icon: "", title: "Top level", path: "No parent page" }]
        : [];
    return [...root, ...candidates];
  }, [pages, excludeIds, allowRoot, query]);

  const { index, setIndex, handleKey } = useListNavigation(options.length, query);

  const choose = (id: string) => {
    onClose();
    onPick(id);
  };

  return (
    <Dialog title={title} onClose={onClose} size="md">
      <div className="flex items-center gap-2 border-b border-neutral-200 px-4 dark:border-neutral-800">
        <Search className="h-4 w-4 shrink-0 text-neutral-400" />
        <input
          data-autofocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (handleKey(event) === "select" && options[index]) choose(options[index].id);
          }}
          placeholder="Search pages…"
          aria-label="Search pages"
          maxLength={100}
          className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-neutral-400 sm:text-sm"
        />
      </div>
      <ul className="max-h-[50dvh] overflow-y-auto py-1" role="listbox" aria-label="Pages">
        {options.map((option, position) => (
          <li key={option.id} role="option" aria-selected={position === index}>
            <button
              type="button"
              onPointerMove={() => setIndex(position)}
              onClick={() => choose(option.id)}
              className={`flex w-full items-center gap-2.5 px-4 py-2 text-left ${
                position === index ? "bg-neutral-100 dark:bg-neutral-800" : ""
              }`}
            >
              <span className="flex w-5 shrink-0 justify-center text-base">
                {option.icon || <FileText className="h-4 w-4 text-neutral-400" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-neutral-800 dark:text-neutral-100">
                  {option.title}
                </span>
                {option.path && (
                  <span className="block truncate text-xs text-neutral-400">{option.path}</span>
                )}
              </span>
              {position === index && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-neutral-400" />}
            </button>
          </li>
        ))}
        {options.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-neutral-400">No pages found</li>
        )}
      </ul>
    </Dialog>
  );
}
