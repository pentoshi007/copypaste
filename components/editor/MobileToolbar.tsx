"use client";

import { useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  CopyPlus,
  Paperclip,
  Replace,
  Trash2,
} from "lucide-react";
import Popover from "@/components/ui/Popover";
import { Menu } from "@/components/ui/Menu";
import { CONVERSION_TARGETS, catalogEntry } from "./blockCatalog";
import { isConvertible, type BlockType } from "@/lib/editor/blockTypes";

export interface MobileToolbarActions {
  convert(type: BlockType): void;
  indent(delta: 1 | -1): void;
  moveBy(direction: -1 | 1): void;
  attach(): void;
  duplicate(): void;
  remove(): void;
  done(): void;
}

function ToolButton({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress(element: HTMLElement): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={(event) => event.preventDefault()}
      onClick={(event) => onPress(event.currentTarget)}
      className="flex h-10 min-w-10 shrink-0 items-center justify-center rounded-lg px-2 text-neutral-600 active:bg-neutral-200 dark:text-neutral-300 dark:active:bg-neutral-800"
    >
      {children}
    </button>
  );
}

export default function MobileToolbar({ type, actions }: { type: BlockType; actions: MobileToolbarActions }) {
  const [turnAnchor, setTurnAnchor] = useState<HTMLElement | null>(null);

  return (
    <div
      className="shrink-0 border-t border-neutral-200 bg-white/95 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95"
      role="toolbar"
      aria-label="Block tools"
    >
      <div className="no-scrollbar flex items-center gap-0.5 overflow-x-auto px-1.5 py-1">
        {isConvertible(type) && (
          <ToolButton label="Turn into" onPress={setTurnAnchor}>
            <Replace className="h-5 w-5" />
          </ToolButton>
        )}
        <ToolButton label="Attach files" onPress={actions.attach}>
          <Paperclip className="h-5 w-5" />
        </ToolButton>
        <ToolButton label="Outdent" onPress={() => actions.indent(-1)}>
          <ChevronLeft className="h-5 w-5" />
        </ToolButton>
        <ToolButton label="Indent" onPress={() => actions.indent(1)}>
          <ChevronRight className="h-5 w-5" />
        </ToolButton>
        <ToolButton label="Move up" onPress={() => actions.moveBy(-1)}>
          <ArrowUp className="h-5 w-5" />
        </ToolButton>
        <ToolButton label="Move down" onPress={() => actions.moveBy(1)}>
          <ArrowDown className="h-5 w-5" />
        </ToolButton>
        <ToolButton label="Duplicate" onPress={actions.duplicate}>
          <CopyPlus className="h-5 w-5" />
        </ToolButton>
        <ToolButton label="Delete block" onPress={actions.remove}>
          <Trash2 className="h-5 w-5" />
        </ToolButton>
        <div className="flex-1" />
        <ToolButton label="Done" onPress={actions.done}>
          <Check className="h-5 w-5 text-blue-600" />
        </ToolButton>
      </div>

      {turnAnchor && (
        <Popover
          anchor={turnAnchor}
          onClose={() => setTurnAnchor(null)}
          label="Turn into"
          sheetOnMobile
          keepFocus
        >
          <Menu
            autoFocus={false}
            onClose={() => setTurnAnchor(null)}
            sections={[
              {
                id: "turn",
                title: "Turn into",
                items: CONVERSION_TARGETS.map((target) => {
                  const entry = catalogEntry(target);
                  return {
                    id: target,
                    label: entry?.label ?? target,
                    icon: entry?.icon,
                    active: target === type,
                    onSelect: () => actions.convert(target),
                  };
                }),
              },
            ]}
          />
        </Popover>
      )}
    </div>
  );
}
