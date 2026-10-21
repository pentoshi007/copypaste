"use client";

import { useCallback, useState, type KeyboardEvent } from "react";
import { ExternalLink, Globe, Pencil } from "lucide-react";
import { toast } from "sonner";
import CopyButton from "./CopyButton";
import { useEditor } from "@/components/editor/EditorContext";
import { isHttpUrl } from "@/lib/guards";
import type { LocalBlock } from "@/lib/client/blockStore";

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function LinkInput({ block }: { block: LocalBlock }) {
  const api = useEditor();
  const [draft, setDraft] = useState(block.content);
  const key = block.key;

  const registerInput = useCallback(
    (element: HTMLInputElement | null) => api.registerInput(key, element),
    [api, key],
  );

  const commit = () => {
    const url = draft.trim();
    if (url && !isHttpUrl(url)) {
      toast.error("Please enter a valid http/https URL");
      return false;
    }
    if (url !== block.content) api.store.update(key, { content: url });
    return true;
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (commit() && draft.trim()) api.insertBelow(key);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      api.escape(key);
      return;
    }
    if (event.key === "Backspace" && !draft) {
      event.preventDefault();
      api.mergeBackward(key);
      return;
    }
    if (event.key === "ArrowUp" && api.focusNeighbor(key, -1, "end")) event.preventDefault();
    if (event.key === "ArrowDown" && api.focusNeighbor(key, 1, "start")) event.preventDefault();
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 dark:border-neutral-800 dark:bg-neutral-900">
      <Globe className="h-4 w-4 shrink-0 text-neutral-400" />
      <input
        ref={registerInput}
        type="url"
        inputMode="url"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (!commit()) setDraft(block.content);
          api.stopEditing(key);
        }}
        placeholder="Paste a link and press Enter…"
        aria-label="Link URL"
        maxLength={2048}
        className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-neutral-400 sm:text-sm"
      />
    </div>
  );
}

export default function LinkBlock({ block, editing }: { block: LocalBlock; editing: boolean }) {
  const api = useEditor();
  const url = block.content;

  if (editing || !url || !isHttpUrl(url)) return <LinkInput block={block} />;

  return (
    <div className="group/link flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2.5 transition hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800/60">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-neutral-500 dark:bg-neutral-800">
        <Globe className="h-4 w-4" />
      </span>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="min-w-0 flex-1"
        onClick={(event) => {
          if (event.shiftKey) {
            event.preventDefault();
            api.select(block.key, true);
          }
        }}
      >
        <span className="block truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">
          {hostnameOf(url)}
        </span>
        <span className="no-scrollbar block overflow-x-auto whitespace-nowrap text-xs text-blue-600 dark:text-blue-400">
          {url}
        </span>
      </a>
      <div className="flex shrink-0 items-center gap-0.5">
        <CopyButton text={url} label="Copy link" className="p-1.5" />
        <button
          type="button"
          aria-label="Edit link"
          onClick={() => api.focusBlock(block.key, "end")}
          className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          aria-label="Open link"
          className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>
    </div>
  );
}
