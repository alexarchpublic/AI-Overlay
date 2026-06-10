/**
 * @file src/renderer/regionPicker/regionGeometry.ts
 *
 * Why it exists: The "drag two points → produce a normalized rect" math is
 * the part of the picker that's worth unit-testing in isolation. Lives in a
 * pure module so the React component can stay focused on event handling and
 * the spec covers the math without a DOM.
 *
 * All coordinates are display-local logical CSS pixels (the picker window
 * covers exactly one display, so DOM coords ARE display-local).
 */

export interface Point {
  x: number;
  y: number;
}

export interface PickerRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Normalize a drag from `start` to `current` into a positive-area rect with
 * non-negative coordinates. The user can drag in any direction (top-left to
 * bottom-right, or bottom-right to top-left); this collapses both into the
 * same `{x, y, w, h}` form expected by `IPC_REGION_PICKER_CONFIRM`.
 *
 * Result coords are clamped to the display viewport so a drag that overshoots
 * the edge produces a rect entirely inside the screen.
 */
export function rectFromDrag(
  start: Point,
  current: Point,
  viewport: { width: number; height: number },
): PickerRect {
  const x1 = clamp(start.x, 0, viewport.width);
  const y1 = clamp(start.y, 0, viewport.height);
  const x2 = clamp(current.x, 0, viewport.width);
  const y2 = clamp(current.y, 0, viewport.height);
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const w = Math.abs(x2 - x1);
  const h = Math.abs(y2 - y1);
  return { x, y, w, h };
}

/**
 * Minimum useful rect — guards against an accidental click producing a 0x0
 * rect that the capture pipeline would crash on. PRD doesn't pin a value;
 * 8px in each axis is small enough to be intentional but big enough to
 * filter twitchy clicks.
 */
export const MIN_RECT_EDGE_PX = 8;

export function isRectViable(rect: PickerRect): boolean {
  return rect.w >= MIN_RECT_EDGE_PX && rect.h >= MIN_RECT_EDGE_PX;
}

function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}
