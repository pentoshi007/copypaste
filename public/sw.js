/*
 * Service worker.
 *
 * Deliberately minimal. It exists for two reasons:
 *   1. Chromium wants a fetch handler before it offers the desktop install prompt.
 *   2. Repeat loads of the immutable build assets come straight from cache.
 *
 * SECURITY: this only ever caches `/_next/static/*` — content-hashed, public,
 * immutable build output. It must never cache HTML, RSC payloads, `/api/*`
 * responses, or anything from the storage origins, because those carry
 * per-user data that would then outlive a logout on a shared device.
 */

const VERSION = "v1";
const STATIC_CACHE = `copypaste-static-${VERSION}`;

self.addEventListener("install", () => {
  // Nothing is precached: the asset list changes every build, and a stale
  // precache manifest is worse than a cold cache.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("copypaste-static-") && k !== STATIC_CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Same-origin only, and only the immutable build output. Everything else —
  // pages, API routes, uploads, downloads — goes straight to the network.
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith("/_next/static/")) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;

      const response = await fetch(request);
      // Opaque/error responses are not worth persisting.
      if (response.ok && response.type === "basic") {
        cache.put(request, response.clone());
      }
      return response;
    })()
  );
});
