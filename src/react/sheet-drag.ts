// Drag-to-dismiss for the phone sheet: pull the grab handle down 80 px, or
// flick it faster than 0.5 px/ms, to close. Pointer events only; keyboard
// users close with Esc or the × as before.

import { useCallback, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

export const DRAG_DISTANCE = 80;
export const DRAG_VELOCITY = 0.5;

/** Pure decision, exported for tests: does this gesture close the sheet? */
export function shouldDismiss(distance: number, elapsedMs: number): boolean {
  if (distance <= 0) return false;
  if (distance >= DRAG_DISTANCE) return true;
  return distance > 8 && distance / Math.max(1, elapsedMs) > DRAG_VELOCITY;
}

export interface SheetDragOptions {
  /** Element that follows the finger. */
  target: RefObject<HTMLElement | null>;
  /** False while issuing/verifying or when the host gave no way to close. */
  enabled: boolean;
  /** With reduced motion the sheet does not follow the finger; it only closes. */
  follow: boolean;
  onDismiss: () => void;
}

export function useSheetDrag({ target, enabled, follow, onDismiss }: SheetDragOptions) {
  const start = useRef<{ y: number; t: number; id: number } | null>(null);

  const reset = useCallback((animate: boolean) => {
    const el = target.current;
    if (!el) return;
    el.style.transition = animate ? "transform 0.2s ease-out" : "";
    el.style.transform = "";
    el.removeAttribute("data-dragging");
  }, [target]);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (!enabled || (e.pointerType === "mouse" && e.button !== 0)) return;
    start.current = { y: e.clientY, t: e.timeStamp, id: e.pointerId };
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch { /* synthetic events have no active pointer */ }
  }, [enabled]);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    const el = target.current;
    if (!follow || !el) return;
    const dy = Math.max(0, e.clientY - s.y);
    el.setAttribute("data-dragging", "");
    el.style.transition = "none";
    el.style.transform = `translateY(${dy}px)`;
  }, [target, follow]);

  const end = useCallback((e: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
    const s = start.current;
    if (!s || s.id !== e.pointerId) return;
    start.current = null;
    const dy = e.clientY - s.y;
    if (!cancelled && shouldDismiss(dy, e.timeStamp - s.t)) {
      onDismiss();
      return;
    }
    reset(follow);
  }, [follow, onDismiss, reset]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => end(e, false),
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => end(e, true),
  };
}
