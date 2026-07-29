"use client";

import { Moon, RefreshCw, Sun, LogOut } from "lucide-react";
import { useSyncExternalStore } from "react";
import { logoutAction } from "@/actions/auth";
import {
  getRefreshing,
  getRefreshingServerSnapshot,
  requestRefresh,
  subscribeRefreshing,
} from "@/lib/refresh";
import Logo from "./Logo";

// --- Client-only theme detection (hydration-safe via useSyncExternalStore) ---
// We listen for a custom "themechange" event that toggleTheme dispatches
// after mutating the DOM class + localStorage. This ensures the store
// re-reads the snapshot on every toggle, not just the first one.
function subscribe(callback: () => void) {
  window.addEventListener("themechange", callback);
  return () => window.removeEventListener("themechange", callback);
}

function getSnapshot() {
  return document.documentElement.classList.contains("dark");
}

// Server snapshot: always false (light) — the inline script in layout.tsx
// corrects the class before paint, so there's no FOUC.
function getServerSnapshot() {
  return false;
}

export default function Header({ username }: { username: string }) {
  const isDark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // AppShell does the actual refetching; this only fires the request and
  // reflects whether one is in flight. See lib/refresh.ts for why.
  const refreshing = useSyncExternalStore(
    subscribeRefreshing,
    getRefreshing,
    getRefreshingServerSnapshot
  );

  function toggleTheme() {
    const next = !isDark;
    if (next) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
    // Dispatch a custom event so useSyncExternalStore re-reads the snapshot
    window.dispatchEvent(new Event("themechange"));
  }

  return (
    // The top inset is zero in a normal browser tab; it only matters once the
    // app is installed and painting behind the status bar.
    <header className="shrink-0 z-30 border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md pt-[env(safe-area-inset-top,0px)]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Logo className="w-8 h-8" />
          <span className="font-bold text-lg tracking-tight text-slate-900 dark:text-white">
            CopyPaste
          </span>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <span className="hidden sm:inline text-sm text-slate-500 dark:text-slate-400">
            @{username}
          </span>

          <button
            onClick={requestRefresh}
            disabled={refreshing}
            aria-label="Refresh chats and notes"
            aria-busy={refreshing}
            title="Refresh"
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 disabled:opacity-60 transition"
          >
            <RefreshCw
              className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`}
            />
          </button>

          <button
            onClick={toggleTheme}
            aria-label="Toggle dark mode"
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition"
          >
            {isDark ? (
              <Sun className="w-4 h-4" />
            ) : (
              <Moon className="w-4 h-4" />
            )}
          </button>

          <form action={logoutAction}>
            <button
              type="submit"
              aria-label="Log out"
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
