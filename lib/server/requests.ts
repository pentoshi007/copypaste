import { NextResponse } from "next/server";

export const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" } as const;

export function parseAttachmentIndex(url: string): number | null {
  const raw = new URL(url).searchParams.get("i");
  if (raw === null) return null;
  if (!/^\d{1,5}$/.test(raw)) return -1;
  return Number(raw);
}

export function isCrossSiteSubresource(headers: Headers): boolean {
  const fetchSite = headers.get("sec-fetch-site");
  const fetchDest = headers.get("sec-fetch-dest");
  const sameOrigin = !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
  return !(sameOrigin || fetchDest === "document");
}

export function isCrossSiteRequest(headers: Headers): boolean {
  const fetchSite = headers.get("sec-fetch-site");
  return Boolean(fetchSite) && fetchSite !== "same-origin" && fetchSite !== "none";
}

export function jsonError(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status, headers: PRIVATE_HEADERS });
}

export function jsonPrivate<T>(body: T): NextResponse {
  return NextResponse.json(body, { headers: PRIVATE_HEADERS });
}
