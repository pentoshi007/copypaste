"use client";

import { useMemo, useState } from "react";
import { Shuffle, Trash2 } from "lucide-react";
import { PAGE_EMOJIS } from "@/lib/editor/emoji";

export default function EmojiPicker({
  onSelect,
  onRemove,
}: {
  onSelect(emoji: string): void;
  onRemove?: () => void;
}) {
  const [query, setQuery] = useState("");
  const options = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? PAGE_EMOJIS.filter((option) => option.name.includes(needle)) : PAGE_EMOJIS;
  }, [query]);

  return (
    <div className="p-2">
      <div className="flex items-center gap-1.5">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter…"
          aria-label="Filter icons"
          maxLength={40}
          className="min-w-0 flex-1 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-base outline-none focus:border-blue-400 dark:border-neutral-700 dark:bg-neutral-800 sm:text-sm"
        />
        <button
          type="button"
          aria-label="Random icon"
          onClick={() => onSelect(PAGE_EMOJIS[Math.floor(Math.random() * PAGE_EMOJIS.length)].emoji)}
          className="rounded-md p-2 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <Shuffle className="h-4 w-4" />
        </button>
        {onRemove && (
          <button
            type="button"
            aria-label="Remove icon"
            onClick={onRemove}
            className="rounded-md p-2 text-neutral-500 hover:bg-neutral-100 hover:text-red-500 dark:hover:bg-neutral-800"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="mt-2 grid grid-cols-8 gap-0.5">
        {options.map((option) => (
          <button
            key={option.emoji}
            type="button"
            title={option.name}
            aria-label={option.name}
            onClick={() => onSelect(option.emoji)}
            className="flex aspect-square items-center justify-center rounded-md text-xl hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            {option.emoji}
          </button>
        ))}
      </div>
      {options.length === 0 && <p className="px-1 py-3 text-sm text-neutral-400">No matching icons</p>}
    </div>
  );
}
