"use client";

import { useSyncExternalStore } from "react";

const FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

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

  return (
    <time dateTime={iso} className={className}>
      {hydrated ? formatLocal(iso) : formatDeterministic(iso)}
    </time>
  );
}
