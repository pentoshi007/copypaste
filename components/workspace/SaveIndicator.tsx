"use client";

import { useSyncExternalStore } from "react";
import { CloudOff, Loader2 } from "lucide-react";
import { syncQueue } from "@/lib/client/syncQueue";

const serverStatus = () => "idle" as const;

export default function SaveIndicator() {
  const status = useSyncExternalStore(syncQueue.subscribe, syncQueue.getStatus, serverStatus);

  if (status === "saving") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-neutral-400" role="status">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span className="hidden sm:inline">Saving…</span>
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400" role="status">
        <CloudOff className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Not saved</span>
      </span>
    );
  }
  return (
    <span className="hidden text-xs text-neutral-400 sm:inline" role="status">
      Saved
    </span>
  );
}
