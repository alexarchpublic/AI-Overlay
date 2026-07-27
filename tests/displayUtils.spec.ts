/**
 * @file tests/displayUtils.spec.ts
 *
 * Why it exists: PRD §6 flags Retina coord math as the single highest-risk
 * surface in Chunk 3 — and §5 DoD #11 requires explicit coverage at
 * scaleFactor 1, 2, 3. `displayUtils.ts` is the single source of truth, so
 * everything here is a pure-function test (no Electron, no DOM).
 */

import { describe, it, expect } from 'vitest';
import {
  buildCaptureRegion,
  displayPhysicalSize,
  hashRegionId,
  isRegionStillValid,
  logicalRectToPhysical,
  physicalRectToLogical,
  resolveDisplayForRegion,
  type DisplayInfoFull,
} from '../src/main/displayUtils';
import type { CaptureRegion } from '../src/shared/types';

const display1x: DisplayInfoFull = {
  id: 1,
  scaleFactor: 1,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  label: 'Built-in Display',
};
const display2x: DisplayInfoFull = {
  id: 2,
  scaleFactor: 2,
  bounds: { x: 0, y: 0, width: 1280, height: 720 },
  label: 'Studio Display',
};
const display3x: DisplayInfoFull = {
  id: 3,
  scaleFactor: 3,
  bounds: { x: 0, y: 0, width: 800, height: 600 },
  label: '',
};

describe('displayUtils — logicalRectToPhysical', () => {
  it('passes through unchanged at scaleFactor 1', () => {
    const phys = logicalRectToPhysical({ x: 100, y: 50, w: 800, h: 600 }, 1);
    expect(phys).toEqual({ px: 100, py: 50, pw: 800, ph: 600 });
  });

  it('doubles every coord at scaleFactor 2 (Retina)', () => {
    const phys = logicalRectToPhysical({ x: 100, y: 50, w: 800, h: 600 }, 2);
    expect(phys).toEqual({ px: 200, py: 100, pw: 1600, ph: 1200 });
  });

  it('triples every coord at scaleFactor 3', () => {
    const phys = logicalRectToPhysical({ x: 10, y: 20, w: 30, h: 40 }, 3);
    expect(phys).toEqual({ px: 30, py: 60, pw: 90, ph: 120 });
  });

  it('rounds sub-pixel logical coords (e.g. 1.5× scale)', () => {
    const phys = logicalRectToPhysical({ x: 10, y: 10, w: 100, h: 100 }, 1.5);
    expect(phys).toEqual({ px: 15, py: 15, pw: 150, ph: 150 });
  });

  it('throws on non-positive scaleFactor (defensive — Electron should never report this)', () => {
    expect(() => logicalRectToPhysical({ x: 0, y: 0, w: 1, h: 1 }, 0)).toThrow();
    expect(() => logicalRectToPhysical({ x: 0, y: 0, w: 1, h: 1 }, -1)).toThrow();
    expect(() => logicalRectToPhysical({ x: 0, y: 0, w: 1, h: 1 }, NaN)).toThrow();
  });
});

describe('displayUtils — physicalRectToLogical (round-trip)', () => {
  it('round-trips at every supported scaleFactor', () => {
    for (const sf of [1, 2, 3]) {
      const orig = { x: 64, y: 32, w: 800, h: 600 };
      const back = physicalRectToLogical(logicalRectToPhysical(orig, sf), sf);
      expect(back).toEqual(orig);
    }
  });
});

describe('displayUtils — displayPhysicalSize', () => {
  it('returns logical * scaleFactor for each axis', () => {
    expect(displayPhysicalSize(display1x)).toEqual({ width: 1920, height: 1080 });
    expect(displayPhysicalSize(display2x)).toEqual({ width: 2560, height: 1440 });
    expect(displayPhysicalSize(display3x)).toEqual({ width: 2400, height: 1800 });
  });
});

describe('displayUtils — buildCaptureRegion', () => {
  it('produces a stable region id for the same physical rect on the same display', () => {
    const a = buildCaptureRegion(display2x, { x: 100, y: 100, w: 200, h: 200 }, 1);
    const b = buildCaptureRegion(display2x, { x: 100, y: 100, w: 200, h: 200 }, 999);
    expect(a.id).toBe(b.id); // ids ignore createdAt
  });

  it('produces different region ids when the displayId differs', () => {
    const a = buildCaptureRegion(display1x, { x: 0, y: 0, w: 100, h: 100 }, 0);
    const b = buildCaptureRegion(display2x, { x: 0, y: 0, w: 100, h: 100 }, 0);
    expect(a.id).not.toBe(b.id);
  });

  it('captures both logical and physical coords plus scaleFactor + displayId (PRD D8)', () => {
    const r = buildCaptureRegion(display2x, { x: 50, y: 25, w: 400, h: 300 }, 1234);
    expect(r.displayId).toBe(2);
    expect(r.scaleFactor).toBe(2);
    expect(r.x).toBe(50);
    expect(r.y).toBe(25);
    expect(r.w).toBe(400);
    expect(r.h).toBe(300);
    expect(r.px).toBe(100);
    expect(r.py).toBe(50);
    expect(r.pw).toBe(800);
    expect(r.ph).toBe(600);
    expect(r.createdAt).toBe(1234);
    expect(r.id).toMatch(/^rg_/);
  });

  it('stamps a displayFingerprint (label + bounds) for later fallback resolution (Chunk 7)', () => {
    const r = buildCaptureRegion(display2x, { x: 0, y: 0, w: 10, h: 10 }, 0);
    expect(r.displayFingerprint).toEqual({ label: display2x.label, bounds: { ...display2x.bounds } });
  });
});

describe('displayUtils — hashRegionId', () => {
  it('is deterministic for the same (displayId, physical rect)', () => {
    const a = hashRegionId(7, { px: 10, py: 20, pw: 30, ph: 40 });
    const b = hashRegionId(7, { px: 10, py: 20, pw: 30, ph: 40 });
    expect(a).toBe(b);
    expect(a).toMatch(/^rg_/);
  });

  it('changes when any input changes', () => {
    const baseline = hashRegionId(7, { px: 10, py: 20, pw: 30, ph: 40 });
    expect(hashRegionId(8, { px: 10, py: 20, pw: 30, ph: 40 })).not.toBe(baseline);
    expect(hashRegionId(7, { px: 11, py: 20, pw: 30, ph: 40 })).not.toBe(baseline);
    expect(hashRegionId(7, { px: 10, py: 21, pw: 30, ph: 40 })).not.toBe(baseline);
    expect(hashRegionId(7, { px: 10, py: 20, pw: 31, ph: 40 })).not.toBe(baseline);
    expect(hashRegionId(7, { px: 10, py: 20, pw: 30, ph: 41 })).not.toBe(baseline);
  });
});

describe('displayUtils — isRegionStillValid (PRD D9)', () => {
  function makeRegion(overrides: Partial<CaptureRegion> = {}): CaptureRegion {
    return {
      id: 'rg_x',
      displayId: 2,
      scaleFactor: 2,
      x: 100,
      y: 100,
      w: 200,
      h: 200,
      px: 200,
      py: 200,
      pw: 400,
      ph: 400,
      createdAt: 0,
      ...overrides,
    };
  }

  it('returns false for a null region', () => {
    expect(isRegionStillValid(null, [display1x, display2x])).toBe(false);
  });

  it('returns false when the saved displayId is gone', () => {
    expect(isRegionStillValid(makeRegion(), [display1x])).toBe(false);
  });

  it('returns true when the region fits in its still-present display', () => {
    expect(isRegionStillValid(makeRegion(), [display1x, display2x])).toBe(true);
  });

  it('returns false when the region overflows the physical bounds (e.g. display rebooted with new bounds)', () => {
    // display2x is 1280x720 logical → 2560x1440 physical. A region with
    // px=2500, pw=200 is still inside (2500+200=2700 > 2560 — overflow).
    expect(
      isRegionStillValid(makeRegion({ px: 2500, pw: 200 }), [display2x]),
    ).toBe(false);
  });

  it('returns false when the saved scaleFactor no longer matches', () => {
    // Same displayId 2, but the live scaleFactor changed from 2 to 1.
    const live: DisplayInfoFull = { ...display2x, scaleFactor: 1 };
    expect(isRegionStillValid(makeRegion({ scaleFactor: 2 }), [live])).toBe(false);
  });

  it('tolerates small negative coords within the ±2px rounding-noise tolerance', () => {
    expect(isRegionStillValid(makeRegion({ px: -1 }), [display2x])).toBe(true);
  });

  it('still rejects coords beyond the ±2px tolerance', () => {
    expect(isRegionStillValid(makeRegion({ px: -3 }), [display2x])).toBe(false);
  });

  it('accepts scaleFactor within the 1e-3 float tolerance', () => {
    const live: DisplayInfoFull = { ...display2x, scaleFactor: 2.0005 };
    expect(isRegionStillValid(makeRegion({ scaleFactor: 2 }), [live])).toBe(true);
  });

  it('still rejects scaleFactor 1 vs 2 (far beyond the tolerance)', () => {
    const live: DisplayInfoFull = { ...display2x, scaleFactor: 1 };
    expect(isRegionStillValid(makeRegion({ scaleFactor: 2 }), [live])).toBe(false);
  });

  it('returns false when displayId is gone and there is no fingerprint', () => {
    expect(isRegionStillValid(makeRegion({ displayId: 999 }), [display1x, display2x])).toBe(false);
  });

  it('survives a displayId change when a matching fingerprint is present (fallback bounds match)', () => {
    const region = makeRegion({
      displayId: 999,
      displayFingerprint: { label: display2x.label, bounds: { ...display2x.bounds } },
    });
    expect(isRegionStillValid(region, [display1x, display2x])).toBe(true);
  });
});

describe('displayUtils — resolveDisplayForRegion (Chunk 7 B11/B12)', () => {
  function makeRegion(overrides: Partial<CaptureRegion> = {}): CaptureRegion {
    return {
      id: 'rg_x',
      displayId: 2,
      scaleFactor: 2,
      x: 100,
      y: 100,
      w: 200,
      h: 200,
      px: 200,
      py: 200,
      pw: 400,
      ph: 400,
      createdAt: 0,
      ...overrides,
    };
  }

  it('resolves by displayId when present', () => {
    expect(resolveDisplayForRegion(makeRegion(), [display1x, display2x])).toBe(display2x);
  });

  it('returns null when displayId is gone and there is no fingerprint', () => {
    expect(resolveDisplayForRegion(makeRegion({ displayId: 999 }), [display1x, display2x])).toBeNull();
  });

  it('falls back to the closest bounds match via fingerprint when displayId changed', () => {
    const region = makeRegion({
      displayId: 999,
      displayFingerprint: { label: display2x.label, bounds: { ...display2x.bounds } },
    });
    expect(resolveDisplayForRegion(region, [display1x, display2x])).toBe(display2x);
  });

  it('rejects a fingerprint fallback whose bounds distance exceeds the tolerance', () => {
    const region = makeRegion({
      displayId: 999,
      displayFingerprint: { label: '', bounds: { x: 0, y: 0, width: 50, height: 50 } },
    });
    expect(resolveDisplayForRegion(region, [display1x, display2x])).toBeNull();
  });

  it('prefers an exact label match over a closer-but-differently-labeled bounds candidate', () => {
    // Both are within the ≤8 fallback tolerance, but closeButWrongLabel is
    // numerically closer (distance 4 vs 8) — the label match must still win.
    const closeButWrongLabel: DisplayInfoFull = {
      id: 30,
      scaleFactor: 2,
      bounds: { x: 1, y: 1, width: 1281, height: 721 },
      label: 'Other Monitor',
    };
    const exactLabelFartherBounds: DisplayInfoFull = {
      id: 40,
      scaleFactor: 2,
      bounds: { x: 2, y: 2, width: 1282, height: 722 },
      label: 'Studio Display',
    };
    const region = makeRegion({
      displayId: 999,
      displayFingerprint: { label: 'Studio Display', bounds: { ...display2x.bounds } },
    });
    expect(resolveDisplayForRegion(region, [closeButWrongLabel, exactLabelFartherBounds])).toBe(
      exactLabelFartherBounds,
    );
  });
});
