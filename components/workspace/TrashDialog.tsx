"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { FileText, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import Dialog, { ConfirmDialog } from "@/components/ui/Dialog";
import LocalTime from "@/components/LocalTime";
import { deletePageForever, emptyTrash, restorePage } from "@/actions/pages";
import { fetchTrash } from "@/lib/client/api";
import { displayTitle } from "@/lib/editor/titles";
import type { Page, TrashedPage } from "@/lib/types";

const RETENTION_DAYS = 30;

type Confirm = { kind: "one"; page: TrashedPage } | { kind: "all" } | null;

export default function TrashDialog({
  onClose,
  onRestored,
}: {
  onClose(): void;
  onRestored(pages: Page[]): void;
}) {
  const [items, setItems] = useState<TrashedPage[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    const controller = new AbortController();
    fetchTrash(controller.signal)
      .then(setItems)
      .catch((error: Error) => {
        if (error.name !== "AbortError") setFailed(true);
      });
    return () => controller.abort();
  }, []);

  const restore = useCallback(
    (page: TrashedPage) => {
      setBusyId(page._id);
      startTransition(async () => {
        const result = await restorePage({ pageId: page._id });
        setBusyId(null);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        setItems((current) => current?.filter((item) => item._id !== page._id) ?? null);
        onRestored(result.pages);
        toast.success(`Restored “${displayTitle(page.title)}”`);
      });
    },
    [onRestored],
  );

  const destroy = useCallback((page: TrashedPage) => {
    setBusyId(page._id);
    startTransition(async () => {
      const result = await deletePageForever({ pageId: page._id });
      setBusyId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setItems((current) => current?.filter((item) => item._id !== page._id) ?? null);
    });
  }, []);

  const destroyAll = useCallback(() => {
    setBusyId("all");
    startTransition(async () => {
      const result = await emptyTrash();
      setBusyId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setItems([]);
      toast.success("Trash emptied");
    });
  }, []);

  return (
    <>
      <Dialog title="Trash" onClose={onClose} size="md">
        <div className="px-4 pt-3 text-xs text-neutral-400">
          Pages in the trash are deleted forever after {RETENTION_DAYS} days.
        </div>

        {failed && <p className="p-4 text-sm text-red-500">Couldn&apos;t load the trash.</p>}
        {!items && !failed && (
          <div className="flex items-center gap-2 p-4 text-sm text-neutral-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}
        {items?.length === 0 && (
          <p className="p-8 text-center text-sm text-neutral-400">The trash is empty.</p>
        )}

        {items && items.length > 0 && (
          <>
            <ul className="py-2">
              {items.map((page) => (
                <li key={page._id} className="flex items-center gap-3 px-4 py-2">
                  <span className="flex w-5 shrink-0 justify-center">
                    {page.icon || <FileText className="h-4 w-4 text-neutral-400" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-neutral-800 dark:text-neutral-100">
                      {displayTitle(page.title)}
                    </span>
                    <span className="text-xs text-neutral-400">
                      Deleted <LocalTime iso={page.deletedAt} />
                    </span>
                  </span>
                  {busyId === page._id ? (
                    <Loader2 className="h-4 w-4 animate-spin text-neutral-400" />
                  ) : (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => restore(page)}
                        aria-label={`Restore ${displayTitle(page.title)}`}
                        title="Restore"
                        className="rounded-md p-2 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                      >
                        <RotateCcw className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirm({ kind: "one", page })}
                        aria-label={`Delete ${displayTitle(page.title)} forever`}
                        title="Delete forever"
                        className="rounded-md p-2 text-neutral-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <div className="flex justify-end border-t border-neutral-200 p-3 dark:border-neutral-800">
              <button
                type="button"
                disabled={busyId !== null}
                onClick={() => setConfirm({ kind: "all" })}
                className="rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950/40"
              >
                Empty trash
              </button>
            </div>
          </>
        )}
      </Dialog>

      {confirm && (
        <ConfirmDialog
          title={confirm.kind === "all" ? "Empty trash?" : "Delete forever?"}
          message={
            confirm.kind === "all"
              ? "Every page in the trash, its blocks and its files will be permanently deleted. This can't be undone."
              : `“${displayTitle(confirm.page.title)}”, its sub-pages, blocks and files will be permanently deleted. This can't be undone.`
          }
          confirmLabel="Delete forever"
          danger
          onClose={() => setConfirm(null)}
          onConfirm={() => (confirm.kind === "all" ? destroyAll() : destroy(confirm.page))}
        />
      )}
    </>
  );
}
