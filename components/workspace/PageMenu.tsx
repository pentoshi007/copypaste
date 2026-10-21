"use client";

import {
  ArrowRight,
  ClipboardCopy,
  CopyPlus,
  FileDown,
  FilePlus,
  Link2,
  Maximize2,
  Minimize2,
  Pencil,
  Star,
  Trash2,
} from "lucide-react";
import Popover from "@/components/ui/Popover";
import { Menu, type MenuItem } from "@/components/ui/Menu";
import type { Page } from "@/lib/types";

export interface PageMenuActions {
  rename?(): void;
  addChild(): void;
  toggleFavorite(): void;
  toggleFullWidth?(): void;
  duplicate(): void;
  moveTo(): void;
  copyLink(): void;
  copyMarkdown?(): void;
  exportMarkdown?(): void;
  trash(): void;
}

export default function PageMenu({
  page,
  anchor,
  actions,
  onClose,
}: {
  page: Page;
  anchor: HTMLElement;
  actions: PageMenuActions;
  onClose(): void;
}) {
  const optional = (item: MenuItem | null): MenuItem[] => (item ? [item] : []);

  return (
    <Popover anchor={anchor} onClose={onClose} label="Page options" align="end" width={250} sheetOnMobile>
      <Menu
        onClose={onClose}
        sections={[
          {
            id: "page",
            items: [
              ...optional(
                actions.rename
                  ? { id: "rename", label: "Rename", icon: Pencil, onSelect: actions.rename }
                  : null,
              ),
              { id: "child", label: "Add sub-page", icon: FilePlus, onSelect: actions.addChild },
              {
                id: "favorite",
                label: page.favorite ? "Remove from favorites" : "Add to favorites",
                icon: Star,
                onSelect: actions.toggleFavorite,
              },
              ...optional(
                actions.toggleFullWidth
                  ? {
                      id: "width",
                      label: page.fullWidth ? "Standard width" : "Full width",
                      icon: page.fullWidth ? Minimize2 : Maximize2,
                      onSelect: actions.toggleFullWidth,
                    }
                  : null,
              ),
            ],
          },
          {
            id: "share",
            items: [
              { id: "duplicate", label: "Duplicate", icon: CopyPlus, onSelect: actions.duplicate },
              { id: "move", label: "Move to…", icon: ArrowRight, onSelect: actions.moveTo },
              { id: "link", label: "Copy link", icon: Link2, onSelect: actions.copyLink },
              ...optional(
                actions.copyMarkdown
                  ? {
                      id: "markdown",
                      label: "Copy as Markdown",
                      icon: ClipboardCopy,
                      onSelect: actions.copyMarkdown,
                    }
                  : null,
              ),
              ...optional(
                actions.exportMarkdown
                  ? {
                      id: "export",
                      label: "Export Markdown",
                      icon: FileDown,
                      onSelect: actions.exportMarkdown,
                    }
                  : null,
              ),
            ],
          },
          {
            id: "danger",
            items: [
              { id: "trash", label: "Move to trash", icon: Trash2, danger: true, onSelect: actions.trash },
            ],
          },
        ]}
      />
    </Popover>
  );
}
