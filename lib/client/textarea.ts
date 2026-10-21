export type Caret = "start" | "end" | number;

export function placeCaret(element: HTMLTextAreaElement | HTMLInputElement, caret: Caret) {
  const length = element.value.length;
  const offset = caret === "start" ? 0 : caret === "end" ? length : Math.max(0, Math.min(caret, length));
  element.focus({ preventScroll: true });
  element.setSelectionRange(offset, offset);
  element.scrollIntoView({ block: "nearest" });
}

export function autoResize(element: HTMLTextAreaElement) {
  element.style.height = "0px";
  element.style.height = `${element.scrollHeight}px`;
}

export function caretAtStart(element: HTMLTextAreaElement): boolean {
  return element.selectionStart === 0 && element.selectionEnd === 0;
}

export function caretAtEnd(element: HTMLTextAreaElement): boolean {
  const length = element.value.length;
  return element.selectionStart === length && element.selectionEnd === length;
}

export function caretOnFirstLine(element: HTMLTextAreaElement): boolean {
  return !element.value.slice(0, element.selectionStart).includes("\n");
}

export function caretOnLastLine(element: HTMLTextAreaElement): boolean {
  return !element.value.slice(element.selectionEnd).includes("\n");
}

export function insertText(element: HTMLTextAreaElement | HTMLInputElement, text: string) {
  element.focus();
  const inserted =
    typeof document.execCommand === "function" && document.execCommand("insertText", false, text);
  if (!inserted) {
    element.setRangeText(text, element.selectionStart ?? 0, element.selectionEnd ?? 0, "end");
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

export function toggleWrap(element: HTMLTextAreaElement, marker: string) {
  const { selectionStart: start, selectionEnd: end, value } = element;
  const selected = value.slice(start, end);
  const wrapped =
    value.slice(start - marker.length, start) === marker && value.slice(end, end + marker.length) === marker;

  if (wrapped) {
    element.setSelectionRange(start - marker.length, end + marker.length);
    insertText(element, selected);
    element.setSelectionRange(start - marker.length, end - marker.length);
    return;
  }

  insertText(element, `${marker}${selected}${marker}`);
  if (selected) element.setSelectionRange(start + marker.length, end + marker.length);
  else element.setSelectionRange(start + marker.length, start + marker.length);
}

export function wrapAsLink(element: HTMLTextAreaElement, url: string): boolean {
  const { selectionStart: start, selectionEnd: end, value } = element;
  if (start === end) return false;
  const label = value.slice(start, end).replace(/[[\]]/g, "");
  insertText(element, `[${label}](${url})`);
  return true;
}

export function caretOffsetFromPoint(container: HTMLElement, x: number, y: number): number | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  let node: Node | null = null;
  let offset = 0;

  const position = doc.caretPositionFromPoint?.(x, y);
  if (position) {
    node = position.offsetNode;
    offset = position.offset;
  } else if (typeof document.caretRangeFromPoint === "function") {
    const range = document.caretRangeFromPoint(x, y);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  }

  if (!node || !container.contains(node)) return null;
  const range = document.createRange();
  range.selectNodeContents(container);
  range.setEnd(node, offset);
  return range.toString().length;
}
