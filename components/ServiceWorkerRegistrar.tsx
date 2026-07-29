"use client";

import { useEffect } from "react";

/**
 * Registers the service worker so the app is installable and repeat loads hit
 * the static cache.
 *
 * Registration is deferred until after `load` so it never competes with the
 * first paint, and skipped in development where a caching worker mostly gets in
 * the way of hot reloads.
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // Not fatal — the app works fine without it.
      });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
