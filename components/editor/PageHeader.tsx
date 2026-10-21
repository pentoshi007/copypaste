"use client";

import { useState, type KeyboardEvent } from "react";
import { Smile } from "lucide-react";
import AutoTextarea from "@/components/blocks/AutoTextarea";
import Popover from "@/components/ui/Popover";
import EmojiPicker from "@/components/ui/EmojiPicker";
import LocalTime from "@/components/LocalTime";
import { MAX_TITLE_LENGTH, UNTITLED } from "@/lib/editor/titles";
import type { Page, PagePatch } from "@/lib/types";

interface PageHeaderProps {
  page: Page;
  blockCount: number;
  autoFocus: boolean;
  onUpdate(patch: PagePatch, options?: { debounce?: boolean }): void;
  onEnterBody(): void;
}

export default function PageHeader({ page, blockCount, autoFocus, onUpdate, onEnterBody }: PageHeaderProps) {
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.key === "Enter" && !event.nativeEvent.isComposing) || event.key === "ArrowDown") {
      if (event.key === "ArrowDown" && event.currentTarget.selectionEnd !== event.currentTarget.value.length)
        return;
      event.preventDefault();
      onEnterBody();
    }
  };

  const choose = (icon: string) => {
    setPickerAnchor(null);
    onUpdate({ icon });
  };

  return (
    <header className="group/header pb-4 pt-10 sm:pt-16">
      {page.icon ? (
        <button
          type="button"
          aria-label="Change icon"
          onClick={(event) => setPickerAnchor(event.currentTarget)}
          className="-ml-1 mb-2 flex h-16 w-16 items-center justify-center rounded-lg text-[3.25rem] leading-none transition hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          {page.icon}
        </button>
      ) : (
        <button
          type="button"
          onClick={(event) => setPickerAnchor(event.currentTarget)}
          className="-ml-1.5 mb-1 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-neutral-400 opacity-0 transition hover:bg-neutral-100 hover:text-neutral-600 focus:opacity-100 group-hover/header:opacity-100 pointer-coarse:opacity-100 dark:hover:bg-neutral-800"
        >
          <Smile className="h-4 w-4" />
          Add icon
        </button>
      )}

      <AutoTextarea
        value={page.title}
        onChange={(event) => onUpdate({ title: event.target.value.replace(/\n/g, " ") }, { debounce: true })}
        onKeyDown={handleKeyDown}
        placeholder={UNTITLED}
        aria-label="Page title"
        autoFocus={autoFocus}
        maxLength={MAX_TITLE_LENGTH}
        className="text-[2rem] font-bold leading-tight tracking-tight text-neutral-900 dark:text-neutral-50 sm:text-[2.5rem]"
      />

      <p className="mt-2 text-xs text-neutral-400">
        Edited <LocalTime iso={page.updatedAt} /> · {blockCount} block{blockCount === 1 ? "" : "s"}
      </p>

      {pickerAnchor && (
        <Popover
          anchor={pickerAnchor}
          onClose={() => setPickerAnchor(null)}
          label="Choose an icon"
          width={320}
          sheetOnMobile
        >
          <EmojiPicker onSelect={choose} onRemove={page.icon ? () => choose("") : undefined} />
        </Popover>
      )}
    </header>
  );
}
