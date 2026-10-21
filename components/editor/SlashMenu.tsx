"use client";

import Popover from "@/components/ui/Popover";
import { MenuList } from "@/components/ui/Menu";
import type { CatalogEntry } from "./blockCatalog";

interface SlashMenuProps {
  anchor: HTMLElement;
  entries: CatalogEntry[];
  activeIndex: number;
  onHover(index: number): void;
  onSelect(entry: CatalogEntry): void;
  onClose(): void;
}

export default function SlashMenu({
  anchor,
  entries,
  activeIndex,
  onHover,
  onSelect,
  onClose,
}: SlashMenuProps) {
  const byAction = new Map(entries.map((entry) => [entry.action, entry]));

  return (
    <Popover anchor={anchor} onClose={onClose} label="Insert block" width={300} keepFocus>
      <MenuList
        activeIndex={activeIndex}
        onHover={onHover}
        empty="No matching blocks"
        onSelect={(item) => {
          const entry = byAction.get(item.id as CatalogEntry["action"]);
          if (entry) onSelect(entry);
        }}
        sections={[
          {
            id: "blocks",
            title: "Blocks",
            items: entries.map((entry) => ({
              id: entry.action,
              label: entry.label,
              description: entry.description,
              icon: entry.icon,
              hint: entry.shortcut,
              onSelect: () => onSelect(entry),
            })),
          },
        ]}
      />
    </Popover>
  );
}
