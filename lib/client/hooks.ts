"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

function subscribeToQuery(query: string) {
  return (callback: () => void) => {
    const list = window.matchMedia(query);
    list.addEventListener("change", callback);
    return () => list.removeEventListener("change", callback);
  };
}

export function useMediaQuery(query: string, serverValue = false): boolean {
  const subscribe = useCallback((callback: () => void) => subscribeToQuery(query)(callback), [query]);
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

export function useIsTouch(): boolean {
  return useMediaQuery("(pointer: coarse)");
}

export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 767px)");
}

const noopSubscribe = () => () => {};

export function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export function useLocalStorage<T>(key: string, fallback: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(fallback);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {}
  }, [key]);

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {}
    },
    [key],
  );

  return [value, update];
}

export function useListNavigation(count: number, resetKey: unknown) {
  const [state, setState] = useState({ index: 0, resetKey });
  const index = state.resetKey === resetKey ? Math.min(state.index, Math.max(0, count - 1)) : 0;

  const setIndex = useCallback((next: number) => setState({ index: next, resetKey }), [resetKey]);

  const handleKey = useCallback(
    (event: { key: string; preventDefault(): void }): "select" | "handled" | null => {
      if (count === 0) return null;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setIndex((index + 1) % count);
        return "handled";
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setIndex((index - 1 + count) % count);
        return "handled";
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        return "select";
      }
      return null;
    },
    [count, index, setIndex],
  );

  return { index, setIndex, handleKey };
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function downloadText(fileName: string, text: string, type = "text/markdown") {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
