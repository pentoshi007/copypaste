"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface DialogProps {
  title: string;
  onClose(): void;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
  fullscreenOnMobile?: boolean;
  hideHeader?: boolean;
}

const WIDTHS = { sm: "sm:max-w-sm", md: "sm:max-w-lg", lg: "sm:max-w-2xl" } as const;

const openDialogs: symbol[] = [];

export default function Dialog({
  title,
  onClose,
  children,
  size = "md",
  fullscreenOnMobile = false,
  hideHeader = false,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const token = Symbol("dialog");
    openDialogs.push(token);
    const previous = document.activeElement as HTMLElement | null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (openDialogs[openDialogs.length - 1] !== token) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    panelRef.current
      ?.querySelector<HTMLElement>("[data-autofocus], input, button")
      ?.focus({ preventScroll: true });
    return () => {
      openDialogs.splice(openDialogs.indexOf(token), 1);
      window.removeEventListener("keydown", onKeyDown, true);
      previous?.focus?.({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <div
      className={`fixed inset-0 z-[60] flex justify-center bg-black/45 animate-fade-in ${
        fullscreenOnMobile ? "items-stretch sm:items-start" : "items-end sm:items-start"
      } sm:p-6 sm:pt-[10vh]`}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative flex w-full flex-col overflow-hidden bg-white dark:bg-neutral-900 shadow-2xl ${WIDTHS[size]} ${
          fullscreenOnMobile
            ? "h-[var(--app-height,100dvh)] sm:h-auto sm:max-h-[75vh] sm:rounded-2xl"
            : "max-h-[85dvh] rounded-t-2xl sm:max-h-[75vh] sm:rounded-2xl"
        } animate-pop-in`}
      >
        {!hideHeader && (
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-neutral-200 dark:border-neutral-800 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top,0px))] sm:pt-3">
            <h2 className="truncate text-sm font-semibold text-neutral-800 dark:text-neutral-100">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom,0px)]">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose,
  danger = false,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm(): void;
  onClose(): void;
  danger?: boolean;
}) {
  return (
    <Dialog title={title} onClose={onClose} size="sm">
      <div className="space-y-4 p-4">
        <p className="text-sm text-neutral-600 dark:text-neutral-300">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="button"
            data-autofocus
            onClick={() => {
              onClose();
              onConfirm();
            }}
            className={`rounded-lg px-3 py-2 text-sm font-medium text-white ${
              danger ? "bg-red-600 hover:bg-red-700" : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
