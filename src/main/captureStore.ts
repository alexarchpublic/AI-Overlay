/**
 * @file src/main/captureStore.ts
 *
 * Why it exists: Owns the `capture.*` namespace inside the same
 * `electron-store` config file that Chunk 2's `widgetState.ts` already
 * writes. PRD §3.4 locks this namespace and forbids reading/writing outside
 * it, save for the one-shot migration of `widget.autoCapture` →
 * `capture.autoCapture` (PRD §3.4 / §5 DoD #10).
 *
 * The wrapper mirrors `widgetState.ts`'s `wrapStore` pattern: a pure
 * `wrapCaptureStore(StoreLike)` that tests inject a fake into, plus a
 * production `createCaptureStore()` that dynamically `import()`s the
 * ESM-only `electron-store` v10. Both `wrapCaptureStore` and
 * `migrateAutoCaptureKey` are pure / synchronous so Vitest exercises the
 * full surface without an Electron binary.
 */

import type { CaptureRegion } from '../shared/types';
import type { StoreLike } from './widgetState';
import {
  CAPTURE_DEFAULT_INTERVAL_MS,
  CAPTURE_INTERVAL_MAX_MS,
  CAPTURE_INTERVAL_MIN_MS,
} from '../shared/constants';
import { importESM } from './importESM';

const KEY_INTERVAL_MS = 'capture.intervalMs';
const KEY_REGION = 'capture.region';
const KEY_AUTO_CAPTURE = 'capture.autoCapture';
const KEY_LAST_CAPTURE_TS = 'capture.lastCaptureTs';
const KEY_DEV_SHOW_RECENT = 'capture.dev.showRecentCaptures';
/** Seen-flag for the one-shot migration. Sticky across restarts. */
const KEY_MIGRATED_AUTO_CAPTURE = 'capture.migrations.autoCaptureFromWidget';

/** Old Chunk-2 key the migration moves into `capture.autoCapture`. */
const KEY_LEGACY_WIDGET_AUTO_CAPTURE = 'widget.autoCapture';

export interface CaptureStateStore {
  getIntervalMs(): number;
  /** Setter clamps to `[CAPTURE_INTERVAL_MIN_MS, CAPTURE_INTERVAL_MAX_MS]`. */
  setIntervalMs(ms: number): number;

  getRegion(): CaptureRegion | null;
  setRegion(region: CaptureRegion): void;
  clearRegion(): void;

  getAutoCapture(): boolean;
  setAutoCapture(next: boolean): void;

  getLastCaptureTs(): number | null;
  setLastCaptureTs(ts: number): void;

  /** Hidden flag — see CAPTURE_DEV_SHOW_RECENT_FLAG. */
  getDevShowRecentCaptures(): boolean;
}

/** Clamp + integer-coerce a slider value before persisting. Exported for tests. */
export function clampIntervalMs(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return CAPTURE_DEFAULT_INTERVAL_MS;
  const rounded = Math.round(raw);
  if (rounded < CAPTURE_INTERVAL_MIN_MS) return CAPTURE_INTERVAL_MIN_MS;
  if (rounded > CAPTURE_INTERVAL_MAX_MS) return CAPTURE_INTERVAL_MAX_MS;
  return rounded;
}

function isCaptureRegion(value: unknown): value is CaptureRegion {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.displayId === 'number' &&
    typeof v.scaleFactor === 'number' &&
    typeof v.x === 'number' &&
    typeof v.y === 'number' &&
    typeof v.w === 'number' &&
    typeof v.h === 'number' &&
    typeof v.px === 'number' &&
    typeof v.py === 'number' &&
    typeof v.pw === 'number' &&
    typeof v.ph === 'number' &&
    typeof v.createdAt === 'number'
  );
}

/**
 * Wrap an arbitrary `StoreLike` for the `capture.*` namespace. Public for
 * dependency injection in tests; production calls `createCaptureStore()`.
 */
export function wrapCaptureStore(store: StoreLike): CaptureStateStore {
  return {
    getIntervalMs() {
      return clampIntervalMs(store.get(KEY_INTERVAL_MS));
    },
    setIntervalMs(ms) {
      const clamped = clampIntervalMs(ms);
      store.set(KEY_INTERVAL_MS, clamped);
      return clamped;
    },
    getRegion() {
      const raw = store.get(KEY_REGION);
      return isCaptureRegion(raw) ? raw : null;
    },
    setRegion(region) {
      store.set(KEY_REGION, region);
    },
    clearRegion() {
      store.delete(KEY_REGION);
    },
    getAutoCapture() {
      const raw = store.get(KEY_AUTO_CAPTURE);
      return typeof raw === 'boolean' ? raw : false;
    },
    setAutoCapture(next) {
      store.set(KEY_AUTO_CAPTURE, next);
    },
    getLastCaptureTs() {
      const raw = store.get(KEY_LAST_CAPTURE_TS);
      return typeof raw === 'number' ? raw : null;
    },
    setLastCaptureTs(ts) {
      store.set(KEY_LAST_CAPTURE_TS, ts);
    },
    getDevShowRecentCaptures() {
      const raw = store.get(KEY_DEV_SHOW_RECENT);
      return typeof raw === 'boolean' ? raw : false;
    },
  };
}

export interface MigrationOutcome {
  migrated: boolean;
  /** Value moved across (only meaningful when `migrated === true`). */
  value?: boolean;
  /** Why the migration was skipped — useful for the log line. */
  skipReason?: 'alreadyMigrated' | 'noLegacyKey' | 'invalidLegacyValue';
}

/**
 * One-shot migration of `widget.autoCapture` (Chunk 2 key) into
 * `capture.autoCapture` (Chunk 3 key). Sticky idempotency via
 * `capture.migrations.autoCaptureFromWidget` so subsequent launches no-op.
 *
 * Pure / synchronous — exported so a test can run it against a fake store.
 * The real boot sequence calls this exactly once, after the store opens and
 * before `screenshotService` reads `getAutoCapture()`.
 */
export function migrateAutoCaptureKey(store: StoreLike): MigrationOutcome {
  if (store.get(KEY_MIGRATED_AUTO_CAPTURE) === true) {
    return { migrated: false, skipReason: 'alreadyMigrated' };
  }
  const legacy = store.get(KEY_LEGACY_WIDGET_AUTO_CAPTURE);
  if (legacy === undefined) {
    // Mark as migrated even when nothing is there — a fresh install should
    // never re-attempt.
    store.set(KEY_MIGRATED_AUTO_CAPTURE, true);
    return { migrated: false, skipReason: 'noLegacyKey' };
  }
  if (typeof legacy !== 'boolean') {
    store.set(KEY_MIGRATED_AUTO_CAPTURE, true);
    return { migrated: false, skipReason: 'invalidLegacyValue' };
  }
  store.set(KEY_AUTO_CAPTURE, legacy);
  store.delete(KEY_LEGACY_WIDGET_AUTO_CAPTURE);
  store.set(KEY_MIGRATED_AUTO_CAPTURE, true);
  return { migrated: true, value: legacy };
}

// ---------------------------------------------------------------------------
// Production factory — shares the same electron-store file as widgetState.ts
// ---------------------------------------------------------------------------

interface ElectronStoreOptions {
  name?: string;
  defaults?: Record<string, unknown>;
  clearInvalidConfig?: boolean;
}

interface ElectronStoreModule {
  default: new (opts: ElectronStoreOptions) => StoreLike;
}

/**
 * Open the `capture.*` slice of the shared `config` electron-store file.
 * Pulls a fresh handle (the same JSON file the widget store uses); both
 * wrappers see each other's writes because electron-store reads from disk
 * lazily.
 */
export async function createCaptureStore(): Promise<{
  store: StoreLike;
  wrapper: CaptureStateStore;
}> {
  const mod = await importESM<ElectronStoreModule>('electron-store');
  const store: StoreLike = new mod.default({
    name: 'config',
    defaults: {
      capture: {
        intervalMs: CAPTURE_DEFAULT_INTERVAL_MS,
        autoCapture: false,
      },
    },
    clearInvalidConfig: true,
  });
  return { store, wrapper: wrapCaptureStore(store) };
}
