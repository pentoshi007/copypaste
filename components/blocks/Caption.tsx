"use client";

import { useEditor } from "@/components/editor/EditorContext";
import AutoTextarea from "./AutoTextarea";
import type { LocalBlock } from "@/lib/client/blockStore";
import { MAX_CAPTION_LENGTH } from "@/lib/editor/blockTypes";

export default function Caption({ block }: { block: LocalBlock }) {
  const api = useEditor();
  const empty = !block.content;

  return (
    <AutoTextarea
      value={block.content}
      onChange={(event) => api.store.update(block.key, { content: event.target.value }, { debounce: true })}
      onBlur={() => api.committed(block.key)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          api.insertBelow(block.key);
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      placeholder="Add a caption…"
      aria-label="Caption"
      maxLength={MAX_CAPTION_LENGTH}
      className={`mt-1.5 text-sm text-neutral-500 dark:text-neutral-400 transition-opacity ${
        empty ? "opacity-0 focus:opacity-100 group-hover/block:opacity-100 pointer-coarse:opacity-100" : ""
      }`}
    />
  );
}
