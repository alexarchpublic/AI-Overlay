/**
 * @file tests/widgetPointer.spec.ts
 *
 * Why it exists: Pointer-drag on the pill body must distinguish clicks from
 * drags at the locked 5px threshold without spinning up Electron.
 */

import { describe, expect, it } from 'vitest';
import {
  createPointerDragState,
  pointerUpIsClick,
  shouldStartPointerDrag,
  stepPointerDrag,
} from '../src/renderer/widget/widgetPointer';

describe('widgetPointer — click vs drag threshold', () => {
  it('does not start drag below the 5px threshold', () => {
    const state = createPointerDragState(100, 100);
    expect(shouldStartPointerDrag(state, 103, 103)).toBe(false);
    expect(stepPointerDrag(state, 103, 103).dragging).toBe(false);
    expect(stepPointerDrag(state, 103, 103).dx).toBe(0);
  });

  it('starts drag at or beyond the 5px threshold', () => {
    const state = createPointerDragState(100, 100);
    expect(shouldStartPointerDrag(state, 106, 100)).toBe(true);
    const step = stepPointerDrag(state, 106, 100);
    expect(step.dragging).toBe(true);
    expect(step.dx).toBe(6);
    expect(step.dy).toBe(0);
  });

  it('emits incremental deltas after drag starts', () => {
    const state = createPointerDragState(0, 0);
    stepPointerDrag(state, 10, 0);
    const second = stepPointerDrag(state, 14, 2);
    expect(second.dragging).toBe(true);
    expect(second.dx).toBe(4);
    expect(second.dy).toBe(2);
  });

  it('pointerUpIsClick is true only when drag never started', () => {
    const click = createPointerDragState(0, 0);
    expect(pointerUpIsClick(click)).toBe(true);

    const drag = createPointerDragState(0, 0);
    stepPointerDrag(drag, 20, 0);
    expect(pointerUpIsClick(drag)).toBe(false);
    expect(pointerUpIsClick(null)).toBe(false);
  });
});
