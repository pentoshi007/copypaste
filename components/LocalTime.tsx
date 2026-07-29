"use client";

import { useSyncExternalStore } from "react";

/**
 * Renders a timestamp without breaking hydration.
 *
 * `toLocaleString()` resolves against the *host's* locale and time zone, so the
 * server (UTC on Vercel) and the reader's browser produce different text for the
 * same instant. React sees that as a hydration mismatch and throws error #418,
 * discarding the server-rendered tree and re-rendering it on the client.
 *
 * The fix is to render something deterministic first — an explicit `en-US`/UTC
 * format both sides agree on — then switch to the reader's local time once
 * hydration is done. `useSyncExternalStore` is the supported way to express
 * that: React uses `getServerSnapshot` for both the server render and the
 * hydration pass, so the markup matches, and only afterwards reads the client
 * snapshot. (Same trick as the theme toggle in Header.tsx.)
 *
 * `suppressHydrationWarning` would not work here: it silences the warning but
 * keeps the server's markup, which would leave every reader looking at UTC.
 */

const FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

/** Never emits a change: "are we past hydration" flips exactly once. */
function subscribe() {
  return () => {};
}

const getSnapshot = () => true;
const getServerSnapshot = () => false;

function formatDeterministic(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      ...FORMAT,
      timeZone: "UTC",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

function formatLocal(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, FORMAT);
  } catch {
    return "";
  }
}

export default function LocalTime({
  iso,
  className,
}: {
  iso: string;
  className?: string;
}) {
  const hydrated = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );

  // `dateTime` stays the raw ISO string: machine-readable and timezone-neutral,
  // so it can't introduce an attribute mismatch of its own.
  return (
    <time dateTime={iso} className={className}>
      {hydrated ? formatLocal(iso) : formatDeterministic(iso)}
    </time>
  );
}
