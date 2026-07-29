"use client";

import { useEffect } from "react";

/**
 * Keeps the app's height in sync with the *visual* viewport.
 *
 * Why this is needed: on mobile, opening the software keyboard shrinks the
 * visual viewport but not always the layout viewport.
 *   - Android/Chrome: honours `interactiveWidget: "resizes-content"`, so the
 *     layout viewport (and `100dvh`) shrinks correctly.
 *   - iOS Safari: the layout viewport does NOT shrink. `100vh` and `100dvh`
 *     both stay at full height, so the bottom of a full-height flex column
 *     (our composer, including the send button) ends up underneath the
 *     keyboard. Because every ancestor sets `overflow: hidden`, it can't be
 *     scrolled into view either — the only way to submit was pressing Enter.
 *
 * Fix: mirror `visualViewport.height` / `.offsetTop` onto CSS custom
 * properties and let `.app-viewport` size itself from them. When the keyboard
 * is closed the properties simply equal the full viewport, so desktop is
 * unaffected.
 */
export default function ViewportFix() {
  useEffect(() => {
    const vv = window.visualViewport;
    // No visualViewport (very old browsers) → `.app-viewport` falls back to 100dvh.
    if (!vv) return;

    const root = document.documentElement;
    let frame = 0;

    const apply = () => {
      frame = 0;
      root.style.setProperty("--app-height", `${Math.round(vv.height)}px`);
      root.style.setProperty("--app-offset", `${Math.round(vv.offsetTop)}px`);
    };

    // visualViewport fires resize/scroll rapidly while the keyboard animates;
    // coalesce to one write per frame to avoid layout thrash.
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };

    apply();
    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    window.addEventListener("orientationchange", schedule);

    return () => {
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      window.removeEventListener("orientationchange", schedule);
      if (frame) cancelAnimationFrame(frame);
      root.style.removeProperty("--app-height");
      root.style.removeProperty("--app-offset");
    };
  }, []);

  return null;
}
