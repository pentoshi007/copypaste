import type { MetadataRoute } from "next";

/**
 * Web app manifest, served at /manifest.webmanifest.
 *
 * Installability needs, at minimum: HTTPS, a manifest with name and a
 * start_url, a `display` of standalone/fullscreen/minimal-ui, and both 192px
 * and 512px icons. Chromium also wants a service worker with a fetch handler
 * for the desktop install prompt — see public/sw.js.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "CopyPaste — Cross-device clipboard",
    short_name: "CopyPaste",
    description:
      "Sync text, code, links, images, and files across your devices instantly.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // `orientation` is deliberately omitted.
    //
    // Setting it — including to "any" — makes Chrome apply an explicit
    // orientation lock, which overrides the device's own rotation lock. The
    // installed app then rotates even when the user has rotation turned off.
    // With the field absent no lock is applied at all, so the OS setting wins.
    background_color: "#0f172a",
    theme_color: "#0f172a",
    categories: ["productivity", "utilities"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      // Separate maskable entries: Android crops icons to a device-specific
      // shape, and a non-maskable icon gets its edges clipped.
      {
        src: "/icons/maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
