/**
 * @file tests/regionPicker.spec.ts
 *
 * Why it exists: The picker geometry — drag in any direction → normalized
 * positive-area rect — is the part worth unit-testing. The window orchestration
 * (`regionPicker.ts` in main) is exercised end-to-end by the operator's Mac
 * acceptance run since it requires real `BrowserWindow`s on real displays.
 */

import { describe, it, expect } from 'vitest';
import {
  isRectViable,
  MIN_RECT_EDGE_PX,
  rectFromDrag,
} from '../src/renderer/regionPicker/regionGeometry';

const VIEWPORT = { width: 1920, height: 1080 };

describe('regionGeometry — rectFromDrag normalizes to positive-area rect', () => {
  it('top-left → bottom-right drag yields the obvious rect', () => {
    const r = rectFromDrag({ x: 100, y: 100 }, { x: 500, y: 400 }, VIEWPORT);
    expect(r).toEqual({ x: 100, y: 100, w: 400, h: 300 });
  });

  it('bottom-right → top-left drag normalizes to the same rect', () => {
    const r = rectFromDrag({ x: 500, y: 400 }, { x: 100, y: 100 }, VIEWPORT);
    expect(r).toEqual({ x: 100, y: 100, w: 400, h: 300 });
  });

  it('top-right → bottom-left drag normalizes to the same rect', () => {
    const r = rectFromDrag({ x: 500, y: 100 }, { x: 100, y: 400 }, VIEWPORT);
    expect(r).toEqual({ x: 100, y: 100, w: 400, h: 300 });
  });

  it('bottom-left → top-right drag normalizes to the same rect', () => {
    const r = rectFromDrag({ x: 100, y: 400 }, { x: 500, y: 100 }, VIEWPORT);
    expect(r).toEqual({ x: 100, y: 100, w: 400, h: 300 });
  });

  it('clamps overshoot to the viewport edges', () => {
    const r = rectFromDrag({ x: 100, y: 100 }, { x: 5000, y: 5000 }, VIEWPORT);
    expect(r).toEqual({
      x: 100,
      y: 100,
      w: VIEWPORT.width - 100,
      h: VIEWPORT.height - 100,
    });
  });

  it('clamps negative coords to 0', () => {
    const r = rectFromDrag({ x: -50, y: -50 }, { x: 200, y: 200 }, VIEWPORT);
    expect(r).toEqual({ x: 0, y: 0, w: 200, h: 200 });
  });

  it('zero-width drag (single click) yields a 0×0 rect', () => {
    const r = rectFromDrag({ x: 100, y: 100 }, { x: 100, y: 100 }, VIEWPORT);
    expect(r).toEqual({ x: 100, y: 100, w: 0, h: 0 });
  });
});

describe('regionGeometry — isRectViable filters twitchy clicks', () => {
  it('returns false for a 0×0 rect', () => {
    expect(isRectViable({ x: 0, y: 0, w: 0, h: 0 })).toBe(false);
  });

  it(`returns false for any rect smaller than ${String(MIN_RECT_EDGE_PX)}px on either axis`, () => {
    expect(isRectViable({ x: 0, y: 0, w: MIN_RECT_EDGE_PX - 1, h: 100 })).toBe(false);
    expect(isRectViable({ x: 0, y: 0, w: 100, h: MIN_RECT_EDGE_PX - 1 })).toBe(false);
  });

  it('returns true for a rect at exactly the minimum edge', () => {
    expect(
      isRectViable({ x: 0, y: 0, w: MIN_RECT_EDGE_PX, h: MIN_RECT_EDGE_PX }),
    ).toBe(true);
  });

  it('returns true for any reasonable rect', () => {
    expect(isRectViable({ x: 100, y: 100, w: 800, h: 600 })).toBe(true);
  });
});
