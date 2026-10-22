"use client";

import { useCallback, useRef, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from "react";
import { ChevronRight, Check } from "lucide-react";
import AutoTextarea from "./AutoTextarea";
import InlineText from "./InlineText";
import { useEditor } from "@/components/editor/EditorContext";
import { COLOR_STYLES } from "@/components/editor/blockCatalog";
import {
  caretAtEnd,
  caretAtStart,
  caretOffsetFromPoint,
  caretOnFirstLine,
  caretOnLastLine,
  toggleWrap,
  wrapAsLink,
} from "@/lib/client/textarea";
import { inlineToPlainText, parseInline } from "@/lib/editor/inline";
import { matchMarkdownShortcut } from "@/lib/editor/shortcuts";
import { isHttpUrl } from "@/lib/guards";
import type { LocalBlock } from "@/lib/client/blockStore";
import type { TextBlockType } from "@/lib/editor/blockTypes";

const TYPOGRAPHY: Record<Exclude<TextBlockType, "code">, string> = {
  text: "text-base leading-7",
  h1: "text-[1.7rem] sm:text-[1.875rem] font-bold leading-tight tracking-tight",
  h2: "text-[1.35rem] sm:text-2xl font-semibold leading-snug tracking-tight",
  h3: "text-lg sm:text-xl font-semibold leading-snug",
  todo: "text-base leading-7",
  bullet: "text-base leading-7",
  numbered: "text-base leading-7",
  quote: "text-base sm:text-lg leading-7",
  callout: "text-base leading-7",
  toggle: "text-base leading-7",
};

const PLACEHOLDERS: Record<Exclude<TextBlockType, "code">, string> = {
  text: "Type '/' for commands",
  h1: "Heading 1",
  h2: "Heading 2",
  h3: "Heading 3",
  todo: "To-do",
  bullet: "List",
  numbered: "List",
  quote: "Quote",
  callout: "Callout",
  toggle: "Toggle",
};

const BULLETS = ["•", "◦", "▪"];

type TextualType = Exclude<TextBlockType, "code">;

interface TextualBlockProps {
  block: LocalBlock & { type: TextualType };
  number: number;
  editing: boolean;
}

function Marker({ block, number }: { block: LocalBlock; number: number }) {
  const api = useEditor();
  const box = "flex h-7 shrink-0 items-center justify-center";

  if (block.type === "todo") {
    return (
      <span className={`${box} w-6`}>
        <button
          type="button"
          role="checkbox"
          aria-checked={block.checked}
          aria-label={block.checked ? "Mark as not done" : "Mark as done"}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => api.store.update(block.key, { checked: !block.checked })}
          className={`flex h-[18px] w-[18px] items-center justify-center rounded-[4px] border transition ${
            block.checked
              ? "border-blue-500 bg-blue-500 text-white"
              : "border-neutral-400 hover:bg-neutral-100 dark:border-neutral-500 dark:hover:bg-neutral-800"
          }`}
        >
          {block.checked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
        </button>
      </span>
    );
  }
  if (block.type === "bullet") {
    return (
      <span className={`${box} w-6 text-lg`} aria-hidden="true">
        {BULLETS[block.indent % BULLETS.length]}
      </span>
    );
  }
  if (block.type === "numbered") {
    return (
      <span className={`${box} min-w-6 pr-1 tabular-nums`} aria-hidden="true">
        {number}.
      </span>
    );
  }
  if (block.type === "toggle") {
    const open = !block.collapsed;
    return (
      <span className={`${box} w-6`}>
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? "Collapse" : "Expand"}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => api.store.update(block.key, { collapsed: !block.collapsed })}
          className="rounded p-0.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <ChevronRight className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`} />
        </button>
      </span>
    );
  }
  if (block.type === "callout") {
    return (
      <span className={`${box} w-7 text-lg`} aria-hidden="true">
        💡
      </span>
    );
  }
  return null;
}

export default function TextualBlock({ block, number, editing }: TextualBlockProps) {
  const api = useEditor();
  const viewRef = useRef<HTMLDivElement>(null);
  const key = block.key;

  const registerInput = useCallback(
    (element: HTMLTextAreaElement | null) => api.registerInput(key, element),
    [api, key],
  );

  const startEditing = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("a")) return;
    if (event.shiftKey) {
      api.select(key, true);
      return;
    }
    const view = viewRef.current;
    let caret: number | "end" = "end";
    if (view && block.content && inlineToPlainText(parseInline(block.content)) === block.content) {
      caret = caretOffsetFromPoint(view, event.clientX, event.clientY) ?? "end";
    }
    api.focusBlock(key, caret);
  };

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const element = event.target;
    const value = element.value;
    const caret = element.selectionStart;

    if (block.type === "text") {
      const shortcut = matchMarkdownShortcut(block.content, value, caret);
      if (shortcut) {
        api.convert(key, shortcut.type, { checked: shortcut.checked, content: shortcut.content });
        return;
      }
    }

    api.store.update(key, { content: value }, { debounce: true });

    const typed = value.length === block.content.length + 1 ? value[caret - 1] : null;
    if (typed === "/" && (caret === 1 || /\s/.test(value[caret - 2] ?? ""))) {
      api.slashOpen(key, element, caret - 1);
    } else {
      api.slashUpdate(key, value, caret);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (api.slashKeyDown(event)) return;
    const element = event.currentTarget;
    const mod = event.metaKey || event.ctrlKey;
    const lower = event.key.toLowerCase();
    const collapsed = element.selectionStart === element.selectionEnd;

    if (mod && !event.shiftKey && !event.altKey) {
      const marker = lower === "b" ? "**" : lower === "i" ? "*" : lower === "e" ? "`" : null;
      if (marker) {
        event.preventDefault();
        toggleWrap(element, marker);
        return;
      }
      if (lower === "d") {
        event.preventDefault();
        api.duplicate(key);
        return;
      }
    }
    if (mod && event.shiftKey && (lower === "s" || lower === "x")) {
      event.preventDefault();
      toggleWrap(element, "~~");
      return;
    }
    if (mod && event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      api.moveBy(key, event.key === "ArrowUp" ? -1 : 1);
      return;
    }
    if (mod && event.key === "Enter") {
      event.preventDefault();
      if (block.type === "todo") api.store.update(key, { checked: !block.checked });
      else if (block.type === "toggle") api.store.update(key, { collapsed: !block.collapsed });
      else api.insertBelow(key);
      return;
    }
    if (event.nativeEvent.isComposing) return;

    switch (event.key) {
      case "Enter":
        if (event.shiftKey) return;
        event.preventDefault();
        api.splitBlock(
          key,
          element.value.slice(0, element.selectionStart),
          element.value.slice(element.selectionEnd),
        );
        return;
      case "Backspace":
        if (caretAtStart(element)) {
          event.preventDefault();
          api.mergeBackward(key);
        }
        return;
      case "Delete":
        if (caretAtEnd(element)) {
          event.preventDefault();
          api.mergeForward(key);
        }
        return;
      case "Tab":
        event.preventDefault();
        api.indent(key, event.shiftKey ? -1 : 1);
        return;
      case "ArrowUp":
        if (collapsed && caretOnFirstLine(element) && element.selectionStart === 0) {
          if (api.focusNeighbor(key, -1, "end")) event.preventDefault();
        }
        return;
      case "ArrowDown":
        if (collapsed && caretOnLastLine(element) && caretAtEnd(element)) {
          if (api.focusNeighbor(key, 1, "start")) event.preventDefault();
        }
        return;
      case "ArrowLeft":
        if (caretAtStart(element) && api.focusNeighbor(key, -1, "end")) event.preventDefault();
        return;
      case "ArrowRight":
        if (caretAtEnd(element) && api.focusNeighbor(key, 1, "start")) event.preventDefault();
        return;
      case "Escape":
        event.preventDefault();
        api.escape(key);
        return;
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files ?? []);
    if (files.length > 0) {
      event.preventDefault();
      api.uploadFiles(files, key);
      return;
    }
    const text = event.clipboardData.getData("text/plain").trim();
    if (!isHttpUrl(text) || /\s/.test(text)) return;
    const element = event.currentTarget;
    if (element.selectionStart !== element.selectionEnd) {
      event.preventDefault();
      wrapAsLink(element, text);
      return;
    }
    if (!block.content.trim() && api.pasteUrlIntoEmpty(key, text)) event.preventDefault();
  };

  const type = block.type;
  const color = COLOR_STYLES[block.color];
  const typography = TYPOGRAPHY[type];
  const muted =
    type === "todo" && block.checked ? "text-neutral-400 line-through decoration-neutral-400/70" : "";
  const textClass = `${typography} ${color.text} ${muted} whitespace-pre-wrap break-words`;

  const body = editing ? (
    <AutoTextarea
      ref={registerInput}
      value={block.content}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onBlur={() => api.stopEditing(key)}
      placeholder={PLACEHOLDERS[type]}
      aria-label={PLACEHOLDERS[type]}
      enterKeyHint="enter"
      maxLength={20000}
      className={textClass}
    />
  ) : (
    <div ref={viewRef} onClick={startEditing} className={`${textClass} cursor-text`}>
      {block.content ? (
        <InlineText text={block.content} />
      ) : (
        <span className={type === "text" ? "" : "text-neutral-300 dark:text-neutral-600"}>
          {type === "text" ? "\u200b" : PLACEHOLDERS[type]}
        </span>
      )}
    </div>
  );

  if (type === "quote") {
    return (
      <div className="border-l-[3px] border-current pl-4 text-neutral-800 dark:text-neutral-200 py-0.5">
        {body}
      </div>
    );
  }

  if (type === "callout") {
    return (
      <div
        className={`flex gap-2 rounded-lg border border-neutral-200 py-3 pl-3 pr-10 transition-colors hover:border-neutral-300 focus-within:border-blue-400 dark:border-neutral-800 dark:hover:border-neutral-700 dark:focus-within:border-blue-500 ${
          block.color === "default" ? "bg-neutral-100 dark:bg-neutral-800/70" : color.background
        }`}
      >
        <Marker block={block} number={number} />
        <div className="min-w-0 flex-1">{body}</div>
      </div>
    );
  }

  const hasMarker = type === "todo" || type === "bullet" || type === "numbered" || type === "toggle";
  if (!hasMarker) return body;

  return (
    <div className="flex items-start gap-1">
      <Marker block={block} number={number} />
      <div className="min-w-0 flex-1">{body}</div>
    </div>
  );
}
