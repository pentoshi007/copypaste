import { syncQueue } from "@/lib/client/syncQueue";
import type { Block, Page, SearchResults, TrashedPage } from "@/lib/types";

export class RequestError extends Error {
  constructor(readonly status: number) {
    super(`Request failed (${status})`);
  }
}

export interface Snapshot<T> {
  data: T;
  requestedAt: number;
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: "no-store", credentials: "same-origin" });
  if (!response.ok) throw new RequestError(response.status);
  return (await response.json()) as T;
}

async function snapshot<T>(
  url: string,
  pick: (body: never) => T,
  signal?: AbortSignal,
): Promise<Snapshot<T>> {
  await syncQueue.idle();
  const requestedAt = Date.now();
  const body = await getJson<never>(url, signal);
  return { data: pick(body), requestedAt };
}

export function fetchPageBlocks(pageId: string, signal?: AbortSignal): Promise<Snapshot<Block[]>> {
  return snapshot(
    `/api/pages/${encodeURIComponent(pageId)}/blocks`,
    (body: { blocks: Block[] }) => body.blocks,
    signal,
  );
}

export function fetchPages(signal?: AbortSignal): Promise<Snapshot<Page[]>> {
  return snapshot("/api/pages", (body: { pages: Page[] }) => body.pages, signal);
}

export async function fetchTrash(signal?: AbortSignal): Promise<TrashedPage[]> {
  await syncQueue.idle();
  const data = await getJson<{ pages: TrashedPage[] }>("/api/trash", signal);
  return data.pages;
}

export function searchWorkspace(query: string, signal?: AbortSignal): Promise<SearchResults> {
  return getJson<SearchResults>(`/api/search?q=${encodeURIComponent(query)}`, signal);
}
