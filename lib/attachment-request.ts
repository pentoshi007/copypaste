export const OBJECT_ID = /^[a-f0-9]{24}$/i;

export function parseAttachmentIndex(url: string): number | null {
  const raw = new URL(url).searchParams.get("i");
  if (raw === null) return null;
  if (!/^\d{1,5}$/.test(raw)) return -1;
  return Number(raw);
}

export function isCrossSiteSubresource(headers: Headers): boolean {
  const fetchSite = headers.get("sec-fetch-site");
  const fetchDest = headers.get("sec-fetch-dest");
  const sameOrigin =
    !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
  return !(sameOrigin || fetchDest === "document");
}
