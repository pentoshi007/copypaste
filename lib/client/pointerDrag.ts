export interface Point {
  x: number;
  y: number;
}

export interface DragHandlers {
  move(point: Point): void;
  drop(point: Point): void;
  cancel(): void;
}

export interface PointerDragOptions {
  threshold?: number;
  touchHoldMs?: number;
  onStart(point: Point): DragHandlers | null;
}

const TOUCH_SLOP = 8;
const CLICK_SUPPRESSION_MS = 350;

function preventTouchScroll(event: TouchEvent) {
  event.preventDefault();
}

function suppressNextClick() {
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  window.setTimeout(
    () => window.removeEventListener("click", swallow, { capture: true }),
    CLICK_SUPPRESSION_MS,
  );
}

export function trackPointerDrag(event: PointerEvent, options: PointerDragOptions): void {
  if (event.button !== 0) return;

  const pointerId = event.pointerId;
  const origin: Point = { x: event.clientX, y: event.clientY };
  const holdForTouch = event.pointerType === "touch" && options.touchHoldMs !== undefined;
  const threshold = options.threshold ?? 5;
  let handlers: DragHandlers | null = null;
  let holdTimer = 0;
  let last = origin;

  const cleanup = () => {
    window.clearTimeout(holdTimer);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("keydown", onKey, true);
    document.removeEventListener("touchmove", preventTouchScroll);
    document.documentElement.classList.remove("is-dragging");
  };

  const activate = (point: Point) => {
    handlers = options.onStart(point);
    if (!handlers) {
      cleanup();
      return;
    }
    document.addEventListener("touchmove", preventTouchScroll, { passive: false });
    document.documentElement.classList.add("is-dragging");
    window.getSelection()?.removeAllRanges();
    navigator.vibrate?.(10);
    handlers.move(point);
  };

  function onMove(moveEvent: PointerEvent) {
    if (moveEvent.pointerId !== pointerId) return;
    last = { x: moveEvent.clientX, y: moveEvent.clientY };
    if (handlers) {
      moveEvent.preventDefault();
      handlers.move(last);
      return;
    }
    const distance = Math.hypot(last.x - origin.x, last.y - origin.y);
    if (holdForTouch) {
      if (distance > TOUCH_SLOP) cleanup();
      return;
    }
    if (distance >= threshold) activate(last);
  }

  function onUp(upEvent: PointerEvent) {
    if (upEvent.pointerId !== pointerId) return;
    const active = handlers;
    cleanup();
    if (active) {
      suppressNextClick();
      active.drop({ x: upEvent.clientX, y: upEvent.clientY });
    }
  }

  function onCancel(cancelEvent: PointerEvent) {
    if (cancelEvent.pointerId !== pointerId) return;
    const active = handlers;
    cleanup();
    active?.cancel();
  }

  function onKey(keyEvent: KeyboardEvent) {
    if (keyEvent.key !== "Escape" || !handlers) return;
    keyEvent.preventDefault();
    keyEvent.stopPropagation();
    const active = handlers;
    cleanup();
    active.cancel();
  }

  if (holdForTouch) holdTimer = window.setTimeout(() => activate(last), options.touchHoldMs);

  window.addEventListener("pointermove", onMove, { passive: false });
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  window.addEventListener("keydown", onKey, true);
}

export function createDragGhost(label: string, count: number): HTMLElement {
  const ghost = document.createElement("div");
  ghost.className = "drag-ghost";
  ghost.textContent = count > 1 ? `${label}  +${count - 1}` : label;
  document.body.appendChild(ghost);
  return ghost;
}

export function moveGhost(ghost: HTMLElement, point: Point) {
  ghost.style.transform = `translate3d(${point.x + 14}px, ${point.y + 10}px, 0)`;
}

export function startAutoScroll(container: HTMLElement, getPoint: () => Point | null, onFrame: () => void) {
  const EDGE = 64;
  const MAX_SPEED = 18;
  let frame = 0;

  const tick = () => {
    const point = getPoint();
    if (point) {
      const rect = container.getBoundingClientRect();
      const fromTop = point.y - rect.top;
      const fromBottom = rect.bottom - point.y;
      let delta = 0;
      if (fromTop < EDGE) delta = -MAX_SPEED * (1 - Math.max(0, fromTop) / EDGE);
      else if (fromBottom < EDGE) delta = MAX_SPEED * (1 - Math.max(0, fromBottom) / EDGE);
      if (delta !== 0 && point.x >= rect.left && point.x <= rect.right) {
        container.scrollTop += delta;
        onFrame();
      }
    }
    frame = requestAnimationFrame(tick);
  };

  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}
