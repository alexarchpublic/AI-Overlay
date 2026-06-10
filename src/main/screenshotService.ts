/**
 * @file src/main/screenshotService.ts
 *
 * Why it exists: PRD §3.1 / §3.3 — the capture engine. Owns:
 *
 *   - The self-correcting `setTimeout` chain (PRD D14) that drives the loop
 *     without drift or pile-up
 *   - The in-memory ring buffer of the last `N=5` `Screenshot` records
 *     (PRD §3.5) — newest-first, evictions happen synchronously on overflow
 *   - The on-disk pruner that deletes any capture file older than `M=30 min`
 *     on a 60s tick
 *   - Permission-revocation handling (PRD D12) — every capture pre-checks the
 *     OS state and throws `CapturePermissionError` if it has flipped, the
 *     loop halts, and the widget transitions to `'permDenied'`
 *   - The `EventEmitter` that the preload bridge fans out as
 *     `window.api.capture.onCaptured` and `onLoopStateChanged`
 *   - Manual `captureNow()` with a 500ms debounce (PRD D15) and an in-flight
 *     guard so a manual click during an auto-capture is logged but ignored
 *
 * What it does NOT own:
 *   - Display math (lives in `displayUtils.ts` — single source of truth)
 *   - Persistence (lives in `captureStore.ts`)
 *   - Picker UI (lives in `regionPicker.ts` + `RegionPicker.tsx`)
 *   - Widget visual state (the loop emits events; `main/index.ts` flips the
 *     widget via `IPC_WIDGET_STATUS_CHANGED`)
 *
 * Why injectable deps: makes the loop testable end-to-end against a fake
 * `desktopCapturer`, fake fs, and a fake clock. The production factory wires
 * in real Electron + sharp + node:fs.
 */

import { EventEmitter } from 'node:events';
import path from 'node:path';
import type {
  CaptureLoopState,
  CaptureRegion,
  Screenshot,
} from '../shared/types';
import { CapturePermissionError } from '../shared/types';
import {
  CAPTURE_JPEG_QUALITY,
  CAPTURE_MANUAL_DEBOUNCE_MS,
  CAPTURE_MAX_EDGE_PX,
  CAPTURE_PRUNE_INTERVAL_MS,
  CAPTURE_RING_BUFFER_SIZE,
  CAPTURE_DISK_TTL_MS,
} from '../shared/constants';
import type { CaptureStateStore } from './captureStore';
import type { AppLogger } from './logger';
import type { DisplayInfoFull } from './displayUtils';
import { isRegionStillValid } from './displayUtils';

// ---------------------------------------------------------------------------
// Injectable surfaces — kept narrow so tests don't need real Electron / fs
// ---------------------------------------------------------------------------

/** Slice of `desktopCapturer` we depend on. */
export interface DesktopCapturerLike {
  getSources(options: {
    types: readonly ('screen' | 'window')[];
    thumbnailSize?: { width: number; height: number };
  }): Promise<readonly DesktopCapturerSource[]>;
}

export interface DesktopCapturerSource {
  /** Electron's source id, e.g. `'screen:69734272:0'`. */
  id: string;
  /** Display id encoded in the source. Electron sets this for `'screen'` types. */
  display_id: string;
  /** The captured image. Slice of `Electron.NativeImage` we actually use. */
  thumbnail: NativeImageLike;
}

/** Slice of `Electron.NativeImage`. */
export interface NativeImageLike {
  toPNG(): Buffer;
  getSize(): { width: number; height: number };
}

/** Slice of `sharp` we depend on. The factory below wires the real package. */
export type SharpLike = (input: Buffer) => SharpInstanceLike;

export interface SharpInstanceLike {
  extract(opts: { left: number; top: number; width: number; height: number }): SharpInstanceLike;
  resize(opts: { width?: number; height?: number; fit?: 'inside' }): SharpInstanceLike;
  jpeg(opts: { quality: number; mozjpeg?: boolean }): SharpInstanceLike;
  withMetadata(opts: { density?: number }): SharpInstanceLike;
  toFile(filepath: string): Promise<{ size: number; width: number; height: number }>;
}

/** Slice of `node:fs/promises` we depend on. */
export interface FsLike {
  mkdir(dir: string, opts: { recursive: true }): Promise<unknown>;
  readdir(dir: string): Promise<readonly string[]>;
  stat(path: string): Promise<{ mtimeMs: number; isFile(): boolean }>;
  unlink(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

export interface PermissionsCheckLike {
  /** Returns `true` if the current OS state still permits screen recording. */
  isGranted(): boolean;
}

export interface ScreenshotServiceDeps {
  logger: AppLogger;
  store: CaptureStateStore;
  desktopCapturer: DesktopCapturerLike;
  sharp: SharpLike;
  fs: FsLike;
  permissions: PermissionsCheckLike;
  /** Returns the live display set + a `findById` helper. */
  getDisplays: () => readonly DisplayInfoFull[];
  /** Captures directory (already exists on disk by the time the service runs). */
  capturesDir: string;
  /** ULID minter — injected so tests can produce stable ids. */
  newId: () => string;
  /** `Date.now` analogue — injected so tests can advance a fake clock. */
  now?: () => number;
  /** `setTimeout` analogue — injected for fake timers. */
  setTimer?: (cb: () => void, ms: number) => NodeJS.Timeout | number;
  clearTimer?: (handle: NodeJS.Timeout | number) => void;
  /** `setInterval` analogue — used only by the pruner. */
  setIntervalFn?: (cb: () => void, ms: number) => NodeJS.Timeout | number;
  clearIntervalFn?: (handle: NodeJS.Timeout | number) => void;
}

export interface ScreenshotService {
  start(): void;
  stop(): void;
  /**
   * Manual capture. Resolves `null` (not throws) when:
   *   - debounced (called within `CAPTURE_MANUAL_DEBOUNCE_MS`)
   *   - region is missing / invalid
   *   - permission is missing
   *   - an in-flight capture is already running
   * All four cases are logged so the dev panel and Chunk 6 observability can
   * tell them apart.
   */
  captureNow(): Promise<Screenshot | null>;
  setIntervalMs(ms: number): number;
  getLoopState(): CaptureLoopState;
  /** Newest-first slice of the in-memory ring buffer. */
  getRecent(limit?: number): readonly Screenshot[];
  /** Look up a ring-buffer entry by ULID. Returns `null` if evicted or unknown. */
  getById(id: string): Screenshot | null;
  /** Re-evaluate `regionValid` against the current display set. */
  refreshRegionValidity(): void;
  /** Subscribe to per-capture events; returns an unsubscribe fn. */
  onCaptured(cb: (s: Screenshot) => void): () => void;
  onLoopStateChanged(cb: (s: CaptureLoopState) => void): () => void;
  /** Tear down timers + listeners. Idempotent. Called from `app.before-quit`. */
  shutdown(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

interface InternalState {
  running: boolean;
  intervalMs: number;
  inFlight: boolean;
  lastManualTs: number;
  lastCaptureTs: number | null;
  regionValid: boolean;
}

export function createScreenshotService(deps: ScreenshotServiceDeps): ScreenshotService {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? setTimeout;
  const clearTimer = deps.clearTimer ?? clearTimeout;
  const setIntervalFn = deps.setIntervalFn ?? setInterval;
  const clearIntervalFn = deps.clearIntervalFn ?? clearInterval;

  const emitter = new EventEmitter();
  // Generous default — every renderer that subscribes adds one listener; we
  // only ever expect a small constant number, so 100 is well above the watermark.
  emitter.setMaxListeners(100);

  /** Newest-first ring buffer of metadata records. NEVER holds NativeImage refs. */
  const ring: Screenshot[] = [];

  const internal: InternalState = {
    running: false,
    intervalMs: deps.store.getIntervalMs(),
    inFlight: false,
    // `-Infinity` so the very first manual captureNow is never debounced
    // against the (non-existent) prior call. Subsequent calls compare
    // against the actual previous timestamp.
    lastManualTs: Number.NEGATIVE_INFINITY,
    lastCaptureTs: deps.store.getLastCaptureTs(),
    regionValid: isRegionStillValid(deps.store.getRegion(), deps.getDisplays()),
  };

  let loopHandle: ReturnType<typeof setTimer> | null = null;
  let prunerHandle: ReturnType<typeof setIntervalFn> | null = null;

  function snapshotLoopState(): CaptureLoopState {
    return {
      running: internal.running,
      intervalMs: internal.intervalMs,
      lastCaptureTs: internal.lastCaptureTs,
      regionValid: internal.regionValid,
    };
  }

  function emitLoopState(): void {
    emitter.emit('loopStateChanged', snapshotLoopState());
  }

  function clearLoopTimer(): void {
    if (loopHandle !== null) {
      clearTimer(loopHandle);
      loopHandle = null;
    }
  }

  function scheduleNextTick(): void {
    if (!internal.running) return;
    clearLoopTimer();
    loopHandle = setTimer(() => {
      void runCaptureCycle('auto');
    }, internal.intervalMs);
  }

  /**
   * Run one capture cycle. The `trigger` distinguishes the auto-loop from a
   * manual `captureNow()` so the log lines are unambiguous and the
   * post-capture re-arm only happens on the auto path (manual captures don't
   * schedule the next one).
   */
  async function runCaptureCycle(trigger: 'auto' | 'manual'): Promise<Screenshot | null> {
    if (internal.inFlight) {
      deps.logger.info('capture.skipped', { reason: 'inFlight', trigger });
      if (trigger === 'auto') scheduleNextTick();
      return null;
    }

    const region = deps.store.getRegion();
    if (!region) {
      deps.logger.info('capture.skipped', { reason: 'noRegion', trigger });
      if (trigger === 'auto') scheduleNextTick();
      return null;
    }

    // Re-evaluate validity at every tick — the user may have unplugged a
    // display since the loop started.
    const valid = isRegionStillValid(region, deps.getDisplays());
    if (!valid) {
      if (internal.regionValid) {
        internal.regionValid = false;
        emitLoopState();
        deps.logger.warn('capture.regionInvalidated', { regionId: region.id });
      }
      if (trigger === 'auto') {
        // Halt the loop until the user re-draws — auto-retrying on a missing
        // display would just spam the log.
        internal.running = false;
        emitLoopState();
        deps.logger.info('capture.stopped', { reason: 'regionInvalidated' });
      }
      return null;
    }

    if (!deps.permissions.isGranted()) {
      handlePermissionLost();
      return null;
    }

    internal.inFlight = true;
    const startTs = now();
    let result: Screenshot | null = null;
    try {
      result = await capture(region, startTs);
      ring.unshift(result);
      while (ring.length > CAPTURE_RING_BUFFER_SIZE) ring.pop();

      internal.lastCaptureTs = result.timestamp;
      deps.store.setLastCaptureTs(result.timestamp);

      const latencyMs = now() - startTs;
      deps.logger.info('capture.captured', {
        id: result.id,
        timestamp: result.timestamp,
        filepath: result.filepath,
        regionId: result.regionId,
        width: result.width,
        height: result.height,
        bytes: result.bytes,
        trigger,
        latencyMs,
      });
      emitter.emit('captured', result);
      emitLoopState();
    } catch (err) {
      if (err instanceof CapturePermissionError) {
        handlePermissionLost();
        return null;
      }
      deps.logger.error('capture.failed', {
        message: err instanceof Error ? err.message : String(err),
        trigger,
      });
    } finally {
      internal.inFlight = false;
      if (trigger === 'auto') scheduleNextTick();
    }
    return result;
  }

  /**
   * The actual desktopCapturer + sharp pipeline for one frame. Pulled out of
   * `runCaptureCycle` so the loop logic above stays readable.
   */
  async function capture(region: CaptureRegion, startTs: number): Promise<Screenshot> {
    const display = deps.getDisplays().find((d) => d.id === region.displayId);
    if (!display) {
      throw new Error(`capture: displayId ${String(region.displayId)} not present`);
    }

    const physicalSize = {
      width: Math.round(display.bounds.width * display.scaleFactor),
      height: Math.round(display.bounds.height * display.scaleFactor),
    };

    let sources: readonly DesktopCapturerSource[];
    try {
      sources = await deps.desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: physicalSize,
      });
    } catch (err) {
      // Permission revocation surfaces here on macOS as a thrown error from
      // the underlying ScreenCaptureKit shim. Re-check the OS state — if it
      // says denied, surface as the typed error so the loop halts.
      if (!deps.permissions.isGranted()) {
        throw new CapturePermissionError();
      }
      throw err;
    }

    // After the capturer call, do one more permission check. macOS will
    // happily return a black-frame thumbnail after permission is revoked
    // mid-capture without throwing; the explicit check is the safety net.
    if (!deps.permissions.isGranted()) {
      throw new CapturePermissionError();
    }

    const source = pickSourceForDisplay(sources, region.displayId);
    if (!source) {
      throw new Error(`capture: no source returned for displayId ${String(region.displayId)}`);
    }

    const png = source.thumbnail.toPNG();
    const id = deps.newId();
    const finalPath = path.join(deps.capturesDir, `${id}.jpg`);
    const tmpPath = `${finalPath}.tmp`;

    // Compute the resize so the LONGEST edge equals CAPTURE_MAX_EDGE_PX while
    // preserving aspect ratio (PRD D4). Use sharp's `fit: 'inside'` with both
    // dimensions set so a tall region doesn't end up with the wrong axis.
    const resizeWidth =
      region.pw >= region.ph ? CAPTURE_MAX_EDGE_PX : undefined;
    const resizeHeight =
      region.ph > region.pw ? CAPTURE_MAX_EDGE_PX : undefined;

    const meta = await deps
      .sharp(png)
      .extract({
        left: region.px,
        top: region.py,
        width: region.pw,
        height: region.ph,
      })
      .resize({
        ...(resizeWidth !== undefined ? { width: resizeWidth } : {}),
        ...(resizeHeight !== undefined ? { height: resizeHeight } : {}),
        fit: 'inside',
      })
      .jpeg({ quality: CAPTURE_JPEG_QUALITY, mozjpeg: true })
      .withMetadata({ density: 72 })
      .toFile(tmpPath);

    await deps.fs.rename(tmpPath, finalPath);

    return {
      id,
      timestamp: startTs,
      filepath: finalPath,
      regionId: region.id,
      width: meta.width,
      height: meta.height,
      bytes: meta.size,
    };
  }

  /**
   * Pick the right desktopCapturer source for a given displayId. Electron's
   * `Source.display_id` is a string match against `Display.id` for the
   * `'screen'` type. Falls back to first source if `display_id` is empty
   * (older Electron builds on a single-display setup).
   */
  function pickSourceForDisplay(
    sources: readonly DesktopCapturerSource[],
    displayId: number,
  ): DesktopCapturerSource | null {
    if (sources.length === 0) return null;
    const target = String(displayId);
    const match = sources.find((s) => s.display_id === target);
    if (match) return match;
    if (sources.length === 1 && (sources[0]?.display_id ?? '') === '') {
      return sources[0] ?? null;
    }
    return null;
  }

  function handlePermissionLost(): void {
    if (!internal.running && !internal.inFlight) {
      // Already quiesced — log once and return.
      deps.logger.warn('capture.permissionLost', { wasRunning: false });
      return;
    }
    internal.running = false;
    clearLoopTimer();
    deps.logger.warn('capture.permissionLost', { wasRunning: true });
    emitLoopState();
  }

  // -------------------------------------------------------------------------
  // Pruner — runs every CAPTURE_PRUNE_INTERVAL_MS while the service is alive
  // -------------------------------------------------------------------------

  async function pruneOnce(): Promise<void> {
    let entries: readonly string[];
    try {
      entries = await deps.fs.readdir(deps.capturesDir);
    } catch (err) {
      deps.logger.warn('capture.prunerReadDirFailed', {
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    const cutoff = now() - CAPTURE_DISK_TTL_MS;
    let deleted = 0;
    for (const name of entries) {
      // Only touch our own jpg files — never delete an unrelated file that
      // somehow ended up in the directory.
      if (!name.endsWith('.jpg')) continue;
      const full = path.join(deps.capturesDir, name);
      try {
        const stat = await deps.fs.stat(full);
        if (!stat.isFile()) continue;
        if (stat.mtimeMs < cutoff) {
          await deps.fs.unlink(full);
          deleted++;
        }
      } catch (err) {
        deps.logger.debug('capture.prunerFileFailed', {
          path: full,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (deleted > 0) {
      deps.logger.info('capture.pruned', { deleted, cutoff });
    }
  }

  function startPruner(): void {
    if (prunerHandle !== null) return;
    prunerHandle = setIntervalFn(() => {
      void pruneOnce();
    }, CAPTURE_PRUNE_INTERVAL_MS);
  }

  function stopPruner(): void {
    if (prunerHandle !== null) {
      clearIntervalFn(prunerHandle);
      prunerHandle = null;
    }
  }

  // Pruner runs for the entire app lifetime. Starting it here (not in `start`)
  // means a stopped loop still has its disk garbage-collected.
  startPruner();

  // -------------------------------------------------------------------------
  // Public surface
  // -------------------------------------------------------------------------

  return {
    start() {
      if (internal.running) return;
      // Refresh state in case the user re-drew the region while paused.
      internal.regionValid = isRegionStillValid(deps.store.getRegion(), deps.getDisplays());
      if (!internal.regionValid) {
        deps.logger.warn('capture.startRefused', { reason: 'regionInvalid' });
        emitLoopState();
        return;
      }
      if (!deps.permissions.isGranted()) {
        deps.logger.warn('capture.startRefused', { reason: 'permissionDenied' });
        return;
      }
      internal.running = true;
      deps.store.setAutoCapture(true);
      deps.logger.info('capture.started', { intervalMs: internal.intervalMs });
      emitLoopState();
      // Fire one capture immediately so the user sees the first frame
      // without waiting `intervalMs`. The cycle re-arms `setTimer` itself.
      void runCaptureCycle('auto');
    },

    stop() {
      if (!internal.running) return;
      internal.running = false;
      clearLoopTimer();
      deps.store.setAutoCapture(false);
      deps.logger.info('capture.stopped', { reason: 'user' });
      emitLoopState();
    },

    async captureNow() {
      const t = now();
      if (t - internal.lastManualTs < CAPTURE_MANUAL_DEBOUNCE_MS) {
        deps.logger.info('capture.skipped', { reason: 'debounced', trigger: 'manual' });
        return null;
      }
      internal.lastManualTs = t;
      return runCaptureCycle('manual');
    },

    setIntervalMs(ms) {
      const next = deps.store.setIntervalMs(ms);
      if (next === internal.intervalMs) return next;
      internal.intervalMs = next;
      deps.logger.info('capture.intervalChanged', { intervalMs: next });
      // Re-arm only if we're currently running — otherwise the new value
      // will be picked up on the next `start()`.
      if (internal.running) {
        scheduleNextTick();
      }
      emitLoopState();
      return next;
    },

    getLoopState() {
      return snapshotLoopState();
    },

    getRecent(limit?: number) {
      const n = typeof limit === 'number' && limit > 0 ? Math.min(limit, ring.length) : ring.length;
      return ring.slice(0, n);
    },

    getById(id) {
      return ring.find((s) => s.id === id) ?? null;
    },

    refreshRegionValidity() {
      const next = isRegionStillValid(deps.store.getRegion(), deps.getDisplays());
      if (next !== internal.regionValid) {
        internal.regionValid = next;
        emitLoopState();
      }
    },

    onCaptured(cb) {
      emitter.on('captured', cb);
      return () => emitter.off('captured', cb);
    },

    onLoopStateChanged(cb) {
      emitter.on('loopStateChanged', cb);
      return () => emitter.off('loopStateChanged', cb);
    },

    async shutdown() {
      internal.running = false;
      clearLoopTimer();
      stopPruner();
      // Final pruner sweep so the next launch finds a tidy directory.
      await pruneOnce();
      emitter.removeAllListeners();
    },
  };
}
