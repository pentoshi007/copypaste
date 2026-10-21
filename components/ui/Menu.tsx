"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { useListNavigation } from "@/lib/client/hooks";

export interface MenuItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  leading?: ReactNode;
  hint?: string;
  description?: string;
  danger?: boolean;
  active?: boolean;
  keepOpen?: boolean;
  onSelect(): void;
}

export interface MenuSection {
  id: string;
  title?: string;
  items: MenuItem[];
}

interface MenuListProps {
  sections: MenuSection[];
  activeIndex: number;
  onHover(index: number): void;
  onSelect(item: MenuItem): void;
  empty?: string;
}

export function flattenSections(sections: MenuSection[]): MenuItem[] {
  return sections.flatMap((section) => section.items);
}

export function MenuList({ sections, activeIndex, onHover, onSelect, empty }: MenuListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  let cursor = -1;

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-menu-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const visible = sections.filter((section) => section.items.length > 0);
  if (visible.length === 0) {
    return <p className="px-3 py-3 text-sm text-neutral-400">{empty ?? "No results"}</p>;
  }

  return (
    <div ref={listRef} role="menu" className="py-1">
      {visible.map((section) => (
        <div key={section.id} role="group" aria-label={section.title} className="py-0.5">
          {section.title && (
            <p className="px-3 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-neutral-400">
              {section.title}
            </p>
          )}
          {section.items.map((item) => {
            cursor += 1;
            const index = cursor;
            const Icon = item.icon;
            const highlighted = index === activeIndex;
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                data-menu-index={index}
                onPointerMove={() => onHover(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelect(item)}
                className={`mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                  highlighted ? "bg-neutral-100 dark:bg-neutral-800" : ""
                } ${item.danger ? "text-red-600 dark:text-red-400" : "text-neutral-700 dark:text-neutral-200"}`}
              >
                {item.leading ??
                  (Icon && (
                    <span
                      className={
                        item.description
                          ? "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900"
                          : "flex w-4 shrink-0 justify-center"
                      }
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                  ))}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{item.label}</span>
                  {item.description && (
                    <span className="block truncate text-xs text-neutral-400">{item.description}</span>
                  )}
                </span>
                {item.active && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />}
                {item.hint && <span className="shrink-0 text-xs text-neutral-400">{item.hint}</span>}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

interface MenuProps {
  sections: MenuSection[];
  header?: ReactNode;
  autoFocus?: boolean;
  onClose(): void;
}

export function Menu({ sections, header, autoFocus = true, onClose }: MenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const items = flattenSections(sections);

  useEffect(() => {
    if (autoFocus) rootRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);
  const { index, setIndex, handleKey } = useListNavigation(
    items.length,
    items.map((item) => item.id).join("|"),
  );

  const select = (item: MenuItem) => {
    if (!item.keepOpen) onClose();
    item.onSelect();
  };

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      data-autofocus={autoFocus || undefined}
      className="outline-none"
      onKeyDown={(event) => {
        if (handleKey(event) === "select" && items[index]) select(items[index]);
      }}
    >
      {header}
      <MenuList sections={sections} activeIndex={index} onHover={setIndex} onSelect={select} />
    </div>
  );
}
