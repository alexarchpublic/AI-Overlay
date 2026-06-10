/**
 * @file src/renderer/widget/widgetPointer.ts
 *
 * Why it exists: The pill body must stay `-webkit-app-region: no-drag` so
 * left-clicks open chat, but that leaves only a 4px halo for native drag —
 * too small to use. Pointer-drag math is pure so we can unit-test the
 * click-vs-drag threshold without Electron.
 */

import { WIDGET_DRAG_THRESHOLD_PX } from '../../shared/constants';

export interface PointerDragState {
  readonly startScreenX: number;
  readonly startScreenY: number;
  lastScreenX: number;
  lastScreenY: number;
  dragging: boolean;
}

export function createPointerDragState(screenX: number, screenY: number): PointerDragState {
  return {
    startScreenX: screenX,
    startScreenY: screenY,
    lastScreenX: screenX,
    lastScreenY: screenY,
    dragging: false,
  };
}

/** True once total movement from pointer-down meets the drag threshold. */
export function shouldStartPointerDrag(
  state: PointerDragState,
  screenX: number,
  screenY: number,
  thresholdPx = WIDGET_DRAG_THRESHOLD_PX,
): boolean {
  const totalDx = screenX - state.startScreenX;
  const totalDy = screenY - state.startScreenY;
  return Math.hypot(totalDx, totalDy) >= thresholdPx;
}

/**
 * Update drag state for a pointer-move event. Returns a screen-space delta
 * to apply when dragging is active; `{ dx: 0, dy: 0 }` before the threshold
 * is crossed or when the cursor did not move since the last sample.
 */
export function stepPointerDrag(
  state: PointerDragState,
  screenX: number,
  screenY: number,
  thresholdPx = WIDGET_DRAG_THRESHOLD_PX,
): { dx: number; dy: number; dragging: boolean } {
  if (!state.dragging && shouldStartPointerDrag(state, screenX, screenY, thresholdPx)) {
    state.dragging = true;
  }

  const dx = screenX - state.lastScreenX;
  const dy = screenY - state.lastScreenY;
  state.lastScreenX = screenX;
  state.lastScreenY = screenY;

  if (!state.dragging || (dx === 0 && dy === 0)) {
    return { dx: 0, dy: 0, dragging: state.dragging };
  }

  return { dx, dy, dragging: true };
}

/** A pointer-up with no drag in progress is treated as a click. */
export function pointerUpIsClick(state: PointerDragState | null): state is PointerDragState {
  return state !== null && !state.dragging;
}
