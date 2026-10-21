import { syncQueue } from "@/lib/client/syncQueue";
import type { Block, Page, SearchResults, TrashedPage } from "@/lib/types";

export class RequestError extends Error {
  constructor(readonly status: number) {
    super(`Request failed (${status})`);
  }
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: "no-store", credentials: "same-origin" });
  if (!response.ok) throw new RequestError(response.status);
  return (await response.json()) as T;
}

export async function fetchPageBlocks(pageId: string, signal?: AbortSignal): Promise<Block[]> {
  await syncQueue.idle();
  const data = await getJson<{ blocks: Block[] }>(`/api/pages/${encodeURIComponent(pageId)}/blocks`, signal);
  return data.blocks;
}

export async function fetchPages(signal?: AbortSignal): Promise<Page[]> {
  await syncQueue.idle();
  const data = await getJson<{ pages: Page[] }>("/api/pages", signal);
  return data.pages;
}

export async function fetchTrash(signal?: AbortSignal): Promise<TrashedPage[]> {
  await syncQueue.idle();
  const data = await getJson<{ pages: TrashedPage[] }>("/api/trash", signal);
  return data.pages;
}

export function searchWorkspace(query: string, signal?: AbortSignal): Promise<SearchResults> {
  return getJson<SearchResults>(`/api/search?q=${encodeURIComponent(query)}`, signal);
}
