/**
 * @file tests/widgetState.spec.ts
 *
 * Why it exists: PRD §5 DoD #9 — "new test files cover position clamp logic
 * with mocked displays" and "electron-store wrapper: get/set/default/clamp".
 * Split into two describes: one for the `wrapStore` facade against a fake
 * `StoreLike`, and one for `clampPosition` against synthetic display sets.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  clampPosition,
  DEFAULT_WIDGET_STATE,
  wrapStore,
  type ClampContext,
  type DisplayInfo,
  type StoreLike,
} from '../src/main/widgetState';

function makeFakeStore(initial: Record<string, unknown> = {}): StoreLike & {
  raw: Record<string, unknown>;
} {
  const raw: Record<string, unknown> = { ...initial };
  return {
    raw,
    get<T>(key: string, defaultValue?: T): T | undefined {
      const v = raw[key];
      if (v === undefined) return defaultValue;
      return v as T;
    },
    set(key, value) {
      raw[key] = value;
    },
    delete(key) {
      delete raw[key];
    },
    clear() {
      for (const k of Object.keys(raw)) delete raw[k];
    },
  };
}

describe('wrapStore — widget.* namespace facade', () => {
  let store: ReturnType<typeof makeFakeStore>;
  let wrapper: ReturnType<typeof wrapStore>;

  beforeEach(() => {
    store = makeFakeStore();
    wrapper = wrapStore(store);
  });

  it('returns null for position when nothing is persisted', () => {
    expect(wrapper.getPosition()).toBeNull();
  });

  it('round-trips a valid position', () => {
    wrapper.setPosition({ x: 120, y: 240, displayId: 7 });
    expect(wrapper.getPosition()).toEqual({ x: 120, y: 240, displayId: 7 });
    expect(store.raw['widget.position']).toEqual({ x: 120, y: 240, displayId: 7 });
  });

  it('rejects a malformed persisted position (defensive)', () => {
    store.raw['widget.position'] = { x: 'oops', y: 0, displayId: 1 };
    expect(wrapper.getPosition()).toBeNull();
  });

  it('defaults status to ready when nothing is set', () => {
    expect(wrapper.getStatus()).toBe(DEFAULT_WIDGET_STATE.status);
  });

  it('rejects an invalid status value and falls back to default', () => {
    // 'capturing' is a transient widget state Chunk 3 added — it must NEVER
    // be persisted (main only broadcasts it for the 600ms flash). The store
    // wrapper rejects it as a persisted value to defend against stale data
    // from a build that wrote it by mistake.
    store.raw['widget.status'] = 'capturing';
    expect(wrapper.getStatus()).toBe(DEFAULT_WIDGET_STATE.status);
    // A truly nonsensical value still falls back too.
    store.raw['widget.status'] = 'something-totally-invalid';
    expect(wrapper.getStatus()).toBe(DEFAULT_WIDGET_STATE.status);
  });

  it('defaults autoCapture to false and permissionsPromptSeen to false', () => {
    expect(wrapper.getAutoCapture()).toBe(false);
    expect(wrapper.getPermissionsPromptSeen()).toBe(false);
  });

  it('first-run → second-run transition flips permissionsPromptSeen', () => {
    expect(wrapper.getPermissionsPromptSeen()).toBe(false);
    wrapper.setPermissionsPromptSeen(true);
    expect(wrapper.getPermissionsPromptSeen()).toBe(true);
    // Simulate process restart by re-wrapping the same backing store.
    const reopened = wrapStore(store);
    expect(reopened.getPermissionsPromptSeen()).toBe(true);
  });

  it('snapshot composes defaults + overrides', () => {
    wrapper.setStatus('paused');
    wrapper.setAutoCapture(true);
    const snap = wrapper.snapshot();
    expect(snap.status).toBe('paused');
    expect(snap.autoCapture).toBe(true);
    expect(snap.permissionsPromptSeen).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// clampPosition — PRD D6
// ---------------------------------------------------------------------------

const SIZE = 56;
const INSET = 72;

function ctx(displays: DisplayInfo[], primaryId = displays[0]?.id ?? 1): ClampContext {
  return { windowWidth: SIZE, windowHeight: SIZE, defaultInset: INSET, displays, primaryId };
}

const primaryDisplay: DisplayInfo = {
  id: 1,
  workArea: { x: 0, y: 0, width: 1920, height: 1080 },
};

const secondaryDisplay: DisplayInfo = {
  id: 2,
  workArea: { x: 1920, y: 0, width: 1440, height: 900 },
};

describe('clampPosition — position restoration', () => {
  it('seeds default top-right on no saved position', () => {
    const res = clampPosition(null, ctx([primaryDisplay]));
    expect(res.clamped).toBe(true);
    expect(res.reason).toBe('no-saved-position');
    expect(res.position.x).toBe(1920 - SIZE - INSET);
    expect(res.position.y).toBe(INSET);
    expect(res.position.displayId).toBe(1);
  });

  it('restores verbatim when saved position fits in its saved display', () => {
    const saved = { x: 300, y: 300, displayId: 1 };
    const res = clampPosition(saved, ctx([primaryDisplay]));
    expect(res.clamped).toBe(false);
    expect(res.reason).toBe('in-saved-display');
    expect(res.position).toEqual(saved);
  });

  it('re-centers to default when saved position is off all displays', () => {
    const saved = { x: 99_999, y: 99_999, displayId: 1 };
    const res = clampPosition(saved, ctx([primaryDisplay]));
    expect(res.clamped).toBe(true);
    expect(res.reason).toBe('off-all-displays');
    expect(res.position.x).toBe(1920 - SIZE - INSET);
    expect(res.position.y).toBe(INSET);
  });

  it('falls back to another display if saved monitor is disconnected', () => {
    // Saved against display 2 (secondary) but only primary is connected now.
    // The saved x=2000 is inside secondary's old coordinates, outside primary,
    // so clampPosition must re-center instead of restoring.
    const saved = { x: 2000, y: 100, displayId: 2 };
    const res = clampPosition(saved, ctx([primaryDisplay]));
    expect(res.clamped).toBe(true);
    expect(res.reason).toBe('saved-display-gone');
  });

  it('accepts a saved position whose coords still fit a currently connected display', () => {
    // Saved against display 1 but only display 2 is attached; x=1950 lands in secondary's workArea.
    const saved = { x: 2000, y: 100, displayId: 1 };
    const res = clampPosition(saved, ctx([secondaryDisplay], 2));
    expect(res.clamped).toBe(false);
    expect(res.position.displayId).toBe(2);
    expect(res.position.x).toBe(2000);
  });
});
