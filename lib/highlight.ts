/** A run of text, flagged if it matches the search query. */
export type Segment = { text: string; match: boolean };

export type Snippet = {
  segments: Segment[];
  /** True when text was trimmed from the front, so the UI can prefix an ellipsis. */
  clippedStart: boolean;
  clippedEnd: boolean;
};

const LEAD = 40; // characters of context before the first match
const TRAIL = 140; // characters after it

/**
 * Builds a preview of `text` centred on the first occurrence of `query`, split
 * into matched and unmatched runs.
 *
 * Returning segments rather than an HTML string keeps this safe: the caller
 * renders each run as a text node, so note content can never be interpreted as
 * markup no matter what a user pasted.
 */
export function buildSnippet(text: string, query: string): Snippet {
  const source = text ?? "";
  const needle = query.trim();

  if (!needle) {
    return {
      segments: [{ text: source.slice(0, LEAD + TRAIL), match: false }],
      clippedStart: false,
      clippedEnd: source.length > LEAD + TRAIL,
    };
  }

  const haystack = source.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const first = haystack.indexOf(lowerNeedle);

  // No match (e.g. the hit was in the filename, not the body): show the opening.
  const start = first === -1 ? 0 : Math.max(0, first - LEAD);
  const end =
    first === -1
      ? Math.min(source.length, LEAD + TRAIL)
      : Math.min(source.length, first + lowerNeedle.length + TRAIL);

  const window = source.slice(start, end);
  const windowLower = window.toLowerCase();

  const segments: Segment[] = [];
  let cursor = 0;

  for (;;) {
    const hit = windowLower.indexOf(lowerNeedle, cursor);
    if (hit === -1) break;
    if (hit > cursor) {
      segments.push({ text: window.slice(cursor, hit), match: false });
    }
    segments.push({
      text: window.slice(hit, hit + lowerNeedle.length),
      match: true,
    });
    cursor = hit + lowerNeedle.length;
  }

  if (cursor < window.length) {
    segments.push({ text: window.slice(cursor), match: false });
  }
  if (segments.length === 0) {
    segments.push({ text: window, match: false });
  }

  return {
    segments,
    clippedStart: start > 0,
    clippedEnd: end < source.length,
  };
}
