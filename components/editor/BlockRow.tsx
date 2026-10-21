"use client";

import { memo } from "react";
import { GripVertical, Plus } from "lucide-react";
import TextualBlock from "@/components/blocks/TextualBlock";
import CodeBlock from "@/components/blocks/CodeBlock";
import LinkBlock from "@/components/blocks/LinkBlock";
import ImageBlock from "@/components/blocks/ImageBlock";
import FileBlock from "@/components/blocks/FileBlock";
import GroupBlock from "@/components/blocks/GroupBlock";
import CopyButton from "@/components/blocks/CopyButton";
import { useEditor } from "./EditorContext";
import type { LocalBlock } from "@/lib/client/blockStore";
import type { BlockType } from "@/lib/editor/blockTypes";

export const INDENT_PX = 24;

const SPACING: Partial<Record<BlockType, string>> = {
  h1: "mt-7 mb-1",
  h2: "mt-5 mb-0.5",
  h3: "mt-4",
  divider: "my-1",
  code: "my-1.5",
  image: "my-2",
  file: "my-1.5",
  group: "my-1.5",
  link: "my-1",
  callout: "my-1",
  quote: "my-1",
};

const GUTTER_OFFSET: Partial<Record<BlockType, string>> = {
  h1: "top-1.5",
  h2: "top-1",
  h3: "top-0.5",
  callout: "top-3",
  code: "top-1",
};

const COPYABLE: ReadonlySet<BlockType> = new Set([
  "text",
  "h1",
  "h2",
  "h3",
  "todo",
  "bullet",
  "numbered",
  "quote",
  "callout",
  "toggle",
]);

interface BlockRowProps {
  block: LocalBlock;
  number: number;
  editing: boolean;
  selected: boolean;
  highlighted: boolean;
}

function BlockBody({ block, number, editing }: { block: LocalBlock; number: number; editing: boolean }) {
  switch (block.type) {
    case "code":
      return <CodeBlock block={block} editing={editing} />;
    case "link":
      return <LinkBlock block={block} editing={editing} />;
    case "divider":
      return (
        <div className="flex h-7 items-center" role="separator">
          <hr className="w-full border-neutral-200 dark:border-neutral-700" />
        </div>
      );
    case "image":
      return <ImageBlock block={block} />;
    case "file":
      return <FileBlock block={block} />;
    case "group":
      return <GroupBlock block={block} />;
    default:
      return (
        <TextualBlock block={block as LocalBlock & { type: "text" }} number={number} editing={editing} />
      );
  }
}

function BlockRow({ block, number, editing, selected, highlighted }: BlockRowProps) {
  const api = useEditor();
  const showCopy = COPYABLE.has(block.type) && block.content.trim().length > 0;
  const gutterTop = GUTTER_OFFSET[block.type] ?? "top-0.5";

  return (
    <div
      data-block-key={block.key}
      data-block-id={block._id}
      className={`group/block relative rounded-md transition-colors ${SPACING[block.type] ?? ""} ${
        selected ? "bg-blue-500/10 ring-1 ring-blue-400/40" : ""
      } ${highlighted ? "animate-highlight" : ""}`}
      style={{ paddingLeft: block.indent * INDENT_PX }}
      onClick={(event) => {
        if (event.target === event.currentTarget) api.select(block.key, event.shiftKey);
      }}
    >
      <div
        className={`absolute ${gutterTop} flex items-center gap-0.5 opacity-0 transition-opacity group-hover/block:opacity-100 pointer-coarse:opacity-60 ${
          selected ? "opacity-100" : ""
        }`}
        style={{ left: block.indent * INDENT_PX }}
      >
        <div className="flex -translate-x-full items-center pr-1">
          <button
            type="button"
            aria-label="Add block below"
            title="Add block below"
            onClick={() => api.insertBelow(block.key)}
            className="hidden h-6 w-6 items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 md:flex"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Drag to move, click for options"
            title="Drag to move · Click for options"
            onPointerDown={(event) => api.startDrag(event, block.key)}
            onClick={(event) => api.openBlockMenu(block.key, event.currentTarget)}
            className="flex h-6 w-5 cursor-grab touch-none items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 active:cursor-grabbing dark:hover:bg-neutral-800"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className={`min-w-0 ${showCopy ? "pr-8" : ""}`}>
        <BlockBody block={block} number={number} editing={editing} />
      </div>

      {showCopy && (
        <div
          className={`absolute right-0 ${gutterTop} opacity-0 transition-opacity group-hover/block:opacity-100 pointer-coarse:opacity-70`}
        >
          <CopyButton text={block.content} label="Copy text" className="p-1" />
        </div>
      )}
    </div>
  );
}

export default memo(BlockRow);
