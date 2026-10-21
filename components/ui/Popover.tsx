"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useIsMobile } from "@/lib/client/hooks";

export type PopoverAnchor = HTMLElement | DOMRect;

interface PopoverProps {
  anchor: PopoverAnchor;
  onClose(): void;
  children: ReactNode;
  label: string;
  align?: "start" | "end";
  width?: number;
  sheetOnMobile?: boolean;
  keepFocus?: boolean;
}

const MARGIN = 8;

function rectOf(anchor: PopoverAnchor): DOMRect {
  return anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;
}

function viewport() {
  const visual = window.visualViewport;
  return {
    top: visual?.offsetTop ?? 0,
    left: visual?.offsetLeft ?? 0,
    width: visual?.width ?? window.innerWidth,
    height: visual?.height ?? window.innerHeight,
  };
}

export default function Popover({
  anchor,
  onClose,
  children,
  label,
  align = "start",
  width = 280,
  sheetOnMobile = false,
  keepFocus = false,
}: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const asSheet = sheetOnMobile && isMobile;
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: "hidden" });

  const position = useCallback(() => {
    const panel = panelRef.current;
    if (!panel || asSheet) return;
    const rect = rectOf(anchor);
    const view = viewport();
    const panelWidth = Math.min(width, view.width - MARGIN * 2);
    const panelHeight = panel.scrollHeight;

    const below = view.top + view.height - rect.bottom - MARGIN;
    const above = rect.top - view.top - MARGIN;
    const placeBelow = below >= Math.min(panelHeight, 240) || below >= above;
    const maxHeight = Math.max(160, (placeBelow ? below : above) - 4);

    let left = align === "end" ? rect.right - panelWidth : rect.left;
    left = Math.max(view.left + MARGIN, Math.min(left, view.left + view.width - panelWidth - MARGIN));
    const top = placeBelow
      ? rect.bottom + 4
      : Math.max(view.top + MARGIN, rect.top - 4 - Math.min(panelHeight, maxHeight));

    setStyle({ top, left, width: panelWidth, maxHeight, visibility: "visible" });
  }, [anchor, align, width, asSheet]);

  useLayoutEffect(() => {
    position();
  }, [position, children]);

  useEffect(() => {
    const reposition = () => position();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    window.visualViewport?.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      window.visualViewport?.removeEventListener("resize", reposition);
    };
  }, [position]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchor instanceof HTMLElement && anchor.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [anchor, onClose]);

  useEffect(() => {
    if (keepFocus) return;
    const panel = panelRef.current;
    const focusable = panel?.querySelector<HTMLElement>("[data-autofocus], input, button, [tabindex]");
    focusable?.focus({ preventScroll: true });
  }, [keepFocus]);

  if (asSheet) {
    return createPortal(
      <div className="fixed inset-0 z-[70] flex flex-col justify-end" role="presentation">
        <div className="absolute inset-0 bg-black/40 animate-fade-in" aria-hidden="true" />
        <div
          ref={panelRef}
          role="dialog"
          aria-label={label}
          className="relative max-h-[75dvh] overflow-y-auto overscroll-contain rounded-t-2xl bg-white dark:bg-neutral-900 shadow-2xl pb-[env(safe-area-inset-bottom,0px)] animate-sheet-in"
        >
          <div className="sticky top-0 flex justify-center bg-inherit pt-2 pb-1">
            <span className="h-1 w-10 rounded-full bg-neutral-300 dark:bg-neutral-700" />
          </div>
          {children}
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label}
      style={style}
      className="fixed z-[70] overflow-y-auto overscroll-contain rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-xl animate-pop-in"
    >
      {children}
    </div>,
    document.body,
  );
}
