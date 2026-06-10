/**
 * @file src/main/displayUtils.ts
 *
 * Why it exists: PRD §6 flags `desktopCapturer` Retina handling as the
 * single highest-risk implementation surface in Chunk 3 — getting "logical
 * vs. physical pixels" wrong silently produces black borders, half-cropped
 * charts, or wildly off-screen rects on 2× / 3× displays. This module is the
 * one place that translates between the two coordinate spaces. Every other
 * file (regionPicker, screenshotService, captureStore) consumes its helpers
 * and never multiplies by `scaleFactor` itself.
 *
 * Pure functions wherever possible so tests at scaleFactor 1, 2, 3 stay
 * trivial and the whole module is import-safe from Vitest (no Electron at
 * the top level — `screen` is dynamically required only by the production
 * factory).
 */

import type { CaptureRegion } from '../shared/types';

/**
 * Minimal display descriptor we depend on. Mirrors Electron's
 * `Display.{ id, scaleFactor, bounds }` so tests can fabricate one without
 * importing Electron.
 */
export interface DisplayInfoFull {
  id: number;
  scaleFactor: number;
  /** Logical CSS pixels — Electron's `Display.bounds`. */
  bounds: { x: number; y: number; width: number; height: number };
}

/**
 * Logical CSS-pixel rectangle drawn by the user inside the picker. Always
 * relative to the picker's display origin (i.e. `0,0` is the top-left of
 * THAT display, not of the global virtual desktop).
 */
export interface LogicalRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Physical device-pixel rectangle on the same display. Coordinates are in
 * the display's *physical* space — what `desktopCapturer.getSources` returns
 * the thumbnail in, and what `sharp.extract({ left, top, width, height })`
 * needs.
 */
export interface PhysicalRect {
  px: number;
  py: number;
  pw: number;
  ph: number;
}

/**
 * Convert a logical rect drawn inside a display's coordinate system into the
 * physical-pixel rect on the same display. Rounds via `Math.round` so a 1.5×
 * scale (e.g. some Windows Surface devices that may eventually run this app)
 * doesn't accumulate sub-pixel drift.
 *
 * Both inputs and outputs are display-local — `LogicalRect.x = 0` means the
 * left edge of the display, NOT the left edge of the virtual desktop. The
 * picker window covers exactly one display, so its DOM coordinates are
 * already display-local.
 */
export function logicalRectToPhysical(rect: LogicalRect, scaleFactor: number): PhysicalRect {
  if (scaleFactor <= 0 || !Number.isFinite(scaleFactor)) {
    throw new Error(`displayUtils: invalid scaleFactor ${String(scaleFactor)}`);
  }
  return {
    px: Math.round(rect.x * scaleFactor),
    py: Math.round(rect.y * scaleFactor),
    pw: Math.round(rect.w * scaleFactor),
    ph: Math.round(rect.h * scaleFactor),
  };
}

/** Inverse of `logicalRectToPhysical` — only used by the dev panel for "show original draw". */
export function physicalRectToLogical(rect: PhysicalRect, scaleFactor: number): LogicalRect {
  if (scaleFactor <= 0 || !Number.isFinite(scaleFactor)) {
    throw new Error(`displayUtils: invalid scaleFactor ${String(scaleFactor)}`);
  }
  return {
    x: Math.round(rect.px / scaleFactor),
    y: Math.round(rect.py / scaleFactor),
    w: Math.round(rect.pw / scaleFactor),
    h: Math.round(rect.ph / scaleFactor),
  };
}

/**
 * Compute the full physical-pixel size of a display. `desktopCapturer` wants
 * `thumbnailSize` in physical pixels matching the source resolution so the
 * returned `NativeImage` is 1:1 with the screen and `sharp.extract()` lines
 * up exactly with the picker draw.
 */
export function displayPhysicalSize(d: DisplayInfoFull): { width: number; height: number } {
  return {
    width: Math.round(d.bounds.width * d.scaleFactor),
    height: Math.round(d.bounds.height * d.scaleFactor),
  };
}

/**
 * Build a `CaptureRegion` from a display + a logical rect. Pure — used by
 * the picker (with the live `Display`) and by the migration test (with a
 * fabricated one). The `id` and `regionId` are deterministic hashes of the
 * physical rect + displayId so the same draw produces the same id across
 * relaunches.
 */
export function buildCaptureRegion(
  display: DisplayInfoFull,
  logical: LogicalRect,
  now: number,
): CaptureRegion {
  const physical = logicalRectToPhysical(logical, display.scaleFactor);
  return {
    id: hashRegionId(display.id, physical),
    displayId: display.id,
    scaleFactor: display.scaleFactor,
    x: Math.round(logical.x),
    y: Math.round(logical.y),
    w: Math.round(logical.w),
    h: Math.round(logical.h),
    px: physical.px,
    py: physical.py,
    pw: physical.pw,
    ph: physical.ph,
    createdAt: now,
  };
}

/**
 * Stable string ID for a region. Tiny FNV-1a hash over the display + physical
 * rect so we don't pull a crypto dependency for what is essentially a
 * fingerprint, not a security primitive. Prefixed `rg_` so it's recognizable
 * in log lines next to ULIDs.
 */
export function hashRegionId(displayId: number, p: PhysicalRect): string {
  const seed = `${String(displayId)}:${String(p.px)}:${String(p.py)}:${String(p.pw)}:${String(p.ph)}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    // FNV prime: 16777619. Force into 32-bit unsigned space.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `rg_${hash.toString(36)}`;
}

/**
 * Decide whether a saved `CaptureRegion` is still usable given the current
 * display topology. PRD §0 D9: if the saved `displayId` is gone, the region
 * is invalid and the widget flips to amber rather than auto-falling-back.
 */
export function isRegionStillValid(
  region: CaptureRegion | null,
  displays: readonly DisplayInfoFull[],
): boolean {
  if (!region) return false;
  const d = displays.find((x) => x.id === region.displayId);
  if (!d) return false;
  // Sanity: physical rect must fit inside the display's physical bounds.
  // A user might unplug-and-replug a display whose bounds changed; in that
  // case the same `displayId` is present but the rect no longer fits.
  const phys = displayPhysicalSize(d);
  if (region.px < 0 || region.py < 0) return false;
  if (region.px + region.pw > phys.width) return false;
  if (region.py + region.ph > phys.height) return false;
  // Must also still match the scaleFactor at draw time — a Display.scaleFactor
  // change (rare, e.g. user changed scaling in System Settings) means the
  // physical rect is no longer self-consistent with the logical one.
  if (region.scaleFactor !== d.scaleFactor) return false;
  return true;
}

/**
 * Production factory that pulls the current display set from Electron's
 * `screen` module. Lazy-required so this file remains import-safe from
 * Vitest. Returns the same `DisplayInfoFull[]` shape the pure helpers above
 * consume, so callers don't see Electron's full `Display` type.
 */
export function getCurrentDisplays(): DisplayInfoFull[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { screen } = require('electron') as typeof import('electron');
  return screen.getAllDisplays().map((d) => ({
    id: d.id,
    scaleFactor: d.scaleFactor,
    bounds: { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height },
  }));
}
