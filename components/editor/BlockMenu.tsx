"use client";

import { useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronLeft,
  Copy,
  CopyPlus,
  Download,
  Palette,
  Replace,
  Trash2,
  Ungroup,
} from "lucide-react";
import Popover from "@/components/ui/Popover";
import { Menu, type MenuSection } from "@/components/ui/Menu";
import LocalTime from "@/components/LocalTime";
import { BLOCK_COLORS, isConvertible, type BlockColor, type BlockType } from "@/lib/editor/blockTypes";
import { COLOR_STYLES, CONVERSION_TARGETS, catalogEntry } from "./blockCatalog";
import { fileHref } from "@/components/blocks/AttachmentPreview";
import type { LocalBlock } from "@/lib/client/blockStore";

export interface BlockMenuActions {
  convert(type: BlockType): void;
  color(color: BlockColor): void;
  copy(): void;
  duplicate(): void;
  moveTo(): void;
  moveBy(direction: -1 | 1): void;
  ungroup(): void;
  remove(): void;
}

type View = "main" | "turn" | "color";

export default function BlockMenu({
  anchor,
  block,
  count,
  actions,
  onClose,
}: {
  anchor: HTMLElement;
  block: LocalBlock;
  count: number;
  actions: BlockMenuActions;
  onClose(): void;
}) {
  const [view, setView] = useState<View>("main");
  const multiple = count > 1;
  const convertible = isConvertible(block.type);
  const saved = Boolean(block._id) && !block.upload;

  const back = (
    <button
      type="button"
      onClick={() => setView("main")}
      className="flex w-full items-center gap-1 border-b border-neutral-100 px-3 py-2 text-xs font-medium text-neutral-500 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/60"
    >
      <ChevronLeft className="h-3.5 w-3.5" />
      Back
    </button>
  );

  const sections: MenuSection[] =
    view === "turn"
      ? [
          {
            id: "turn",
            title: "Turn into",
            items: CONVERSION_TARGETS.map((type) => {
              const entry = catalogEntry(type);
              return {
                id: type,
                label: entry?.label ?? type,
                icon: entry?.icon,
                active: type === block.type,
                onSelect: () => actions.convert(type),
              };
            }),
          },
        ]
      : view === "color"
        ? [
            {
              id: "color",
              title: "Color",
              items: BLOCK_COLORS.map((color) => ({
                id: color,
                label: COLOR_STYLES[color].label,
                leading: <span className={`h-4 w-4 shrink-0 rounded ${COLOR_STYLES[color].swatch}`} />,
                active: color === block.color,
                onSelect: () => actions.color(color),
              })),
            },
          ]
        : [
            {
              id: "format",
              items: [
                ...(convertible
                  ? [
                      {
                        id: "turn",
                        label: "Turn into",
                        icon: Replace,
                        hint: "›",
                        keepOpen: true,
                        onSelect: () => setView("turn"),
                      },
                    ]
                  : []),
                {
                  id: "color",
                  label: "Color",
                  icon: Palette,
                  hint: "›",
                  keepOpen: true,
                  onSelect: () => setView("color"),
                },
              ],
            },
            {
              id: "actions",
              items: [
                ...(block.type !== "divider"
                  ? [
                      {
                        id: "copy",
                        label: multiple ? "Copy text" : "Copy",
                        icon: Copy,
                        onSelect: actions.copy,
                      },
                    ]
                  : []),
                {
                  id: "duplicate",
                  label: "Duplicate",
                  icon: CopyPlus,
                  hint: "⌘D",
                  onSelect: actions.duplicate,
                },
                { id: "move", label: "Move to page…", icon: ArrowRight, onSelect: actions.moveTo },
                {
                  id: "up",
                  label: "Move up",
                  icon: ArrowUp,
                  hint: "⌘⇧↑",
                  onSelect: () => actions.moveBy(-1),
                },
                {
                  id: "down",
                  label: "Move down",
                  icon: ArrowDown,
                  hint: "⌘⇧↓",
                  onSelect: () => actions.moveBy(1),
                },
                ...(block.type === "group" && !multiple && saved
                  ? [{ id: "ungroup", label: "Split into blocks", icon: Ungroup, onSelect: actions.ungroup }]
                  : []),
                ...(block.type === "file" && !multiple && saved
                  ? [
                      {
                        id: "download",
                        label: "Download",
                        icon: Download,
                        onSelect: () => window.location.assign(fileHref(block._id)),
                      },
                    ]
                  : []),
              ],
            },
            {
              id: "danger",
              items: [
                {
                  id: "delete",
                  label: multiple ? `Delete ${count} blocks` : "Delete",
                  icon: Trash2,
                  hint: "Del",
                  danger: true,
                  onSelect: actions.remove,
                },
              ],
            },
          ];

  return (
    <Popover anchor={anchor} onClose={onClose} label="Block options" width={248} sheetOnMobile>
      <Menu key={view} sections={sections} header={view === "main" ? undefined : back} onClose={onClose} />
      {view === "main" && (
        <p className="border-t border-neutral-100 px-3 py-2 text-[11px] text-neutral-400 dark:border-neutral-800">
          {multiple ? (
            `${count} blocks selected`
          ) : (
            <>
              Edited <LocalTime iso={block.updatedAt} />
            </>
          )}
        </p>
      )}
    </Popover>
  );
}
