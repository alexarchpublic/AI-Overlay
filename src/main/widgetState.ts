/**
 * @file src/main/widgetState.ts
 *
 * Why it exists: Thin wrapper around `electron-store` for the PRD §3.4
 * `widget.*` namespace. Two jobs:
 *
 *   1. Persist last-known widget position across relaunches (PRD D3).
 *   2. Persist first-run permission flags and the `autoCapture` default that
 *      Chunk 3 will read.
 *
 * Chunks 3 and 5 will add their own top-level keys (`capture.*`, `ai.*`).
 * This module must not touch anything outside `widget.*`.
 *
 * Note on electron-store v10: the package is ESM-only. Our main bundle is
 * CommonJS (tsconfig.main.json), so `createWidgetStateStore()` uses
 * dynamic `import()` to load it. All sync reads/writes afterward go through
 * the typed wrapper; tests inject a minimal `StoreLike` fake so they don't
 * drag the ESM package into Vitest's module graph.
 */

import type { PersistedWidgetState, WidgetPosition, WidgetStatus } from '../shared/types';
import { importESM } from './importESM';

/**
 * Minimal slice of electron-store's surface we actually use. Defined here so
 * tests can inject a fake without depending on electron-store at all.
 *
 * `get` is typed permissively — electron-store stores unknown JSON shapes and
 * the wrapper below re-validates every read.
 */
export interface StoreLike {
  get(key: string, defaultValue?: unknown): unknown;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  clear(): void;
}

/** Wrapper return type — stable regardless of how the underlying store was obtained. */
export interface WidgetStateStore {
  getPosition(): WidgetPosition | null;
  setPosition(position: WidgetPosition): void;
  getStatus(): WidgetStatus;
  setStatus(status: WidgetStatus): void;
  getAutoCapture(): boolean;
  setAutoCapture(next: boolean): void;
  getPermissionsPromptSeen(): boolean;
  setPermissionsPromptSeen(seen: boolean): void;
  /** Full snapshot — used by tests and by `contextMenu` for logging. */
  snapshot(): PersistedWidgetState;
}

/** Seed values written on first launch if no config file exists. */
export const DEFAULT_WIDGET_STATE: PersistedWidgetState = {
  position: { x: 0, y: 0, displayId: null }, // overwritten by clampPosition at first restore
  status: 'ready',
  autoCapture: false,
  permissionsPromptSeen: false,
};

const KEY_POSITION = 'widget.position';
const KEY_STATUS = 'widget.status';
const KEY_AUTO_CAPTURE = 'widget.autoCapture';
const KEY_PROMPT_SEEN = 'widget.permissionsPromptSeen';

/**
 * Build a wrapper around any `StoreLike`. Public for dependency injection in
 * tests; production calls `createWidgetStateStore()` below.
 */
export function wrapStore(store: StoreLike): WidgetStateStore {
  return {
    getPosition() {
      const raw = store.get(KEY_POSITION);
      if (!isWidgetPosition(raw)) return null;
      return raw;
    },
    setPosition(position) {
      store.set(KEY_POSITION, position);
    },
    getStatus() {
      const raw = store.get(KEY_STATUS);
      if (raw === 'ready' || raw === 'paused' || raw === 'permDenied' || raw === 'captureUnhealthy') {
        return raw;
      }
      return DEFAULT_WIDGET_STATE.status;
    },
    setStatus(status) {
      store.set(KEY_STATUS, status);
    },
    getAutoCapture() {
      const raw = store.get(KEY_AUTO_CAPTURE);
      return typeof raw === 'boolean' ? raw : DEFAULT_WIDGET_STATE.autoCapture;
    },
    setAutoCapture(next) {
      store.set(KEY_AUTO_CAPTURE, next);
    },
    getPermissionsPromptSeen() {
      const raw = store.get(KEY_PROMPT_SEEN);
      return typeof raw === 'boolean' ? raw : DEFAULT_WIDGET_STATE.permissionsPromptSeen;
    },
    setPermissionsPromptSeen(seen) {
      store.set(KEY_PROMPT_SEEN, seen);
    },
    snapshot() {
      return {
        position: this.getPosition() ?? DEFAULT_WIDGET_STATE.position,
        status: this.getStatus(),
        autoCapture: this.getAutoCapture(),
        permissionsPromptSeen: this.getPermissionsPromptSeen(),
      };
    },
  };
}

/**
 * Dynamic-import `electron-store` (ESM-only as of v10) and return a typed
 * wrapper around it. Call once at `app.whenReady`.
 *
 * Why the `Function` indirection: TypeScript's CommonJS module emit
 * (tsconfig.main.json → `module: "CommonJS"`) downlevels a literal
 * `await import('electron-store')` into a `require()` call, which then
 * blows up at runtime with `ERR_REQUIRE_ESM` because electron-store v10
 * is ESM-only. Hiding the import behind `new Function(...)` keeps TS from
 * rewriting it; Node natively supports `import()` from CommonJS, so the
 * real loader handles the ESM module correctly. The alternative — switching
 * the main tsconfig to `module: "node16"` — would force `.js` extensions on
 * every relative import in the main bundle and is a larger change than this
 * surgical workaround warrants.
 */
interface ElectronStoreOptions {
  name?: string;
  defaults?: Record<string, unknown>;
  clearInvalidConfig?: boolean;
}

interface ElectronStoreModule {
  default: new (opts: ElectronStoreOptions) => StoreLike;
}

export async function createWidgetStateStore(): Promise<WidgetStateStore> {
  const mod = await importESM<ElectronStoreModule>('electron-store');
  const store: StoreLike = new mod.default({
    name: 'config',
    defaults: {
      widget: DEFAULT_WIDGET_STATE,
    },
    clearInvalidConfig: true,
  });
  return wrapStore(store);
}

// ---------------------------------------------------------------------------
// Position clamp helpers (PRD D6)
// ---------------------------------------------------------------------------

/**
 * Minimal display descriptor consumed by `clampPosition`. Mirrors Electron's
 * `Display` type (id + workArea) so tests can build one without pulling
 * Electron.
 */
export interface DisplayInfo {
  id: number;
  workArea: { x: number; y: number; width: number; height: number };
}

/**
 * Context passed to `clampPosition`. `primaryId` lets the clamp log the
 * reason it re-centered when the saved monitor is gone; all sizing defaults
 * come from constants so no magic numbers leak into the logic.
 */
export interface ClampContext {
  windowWidth: number;
  windowHeight: number;
  defaultInset: number;
  displays: readonly DisplayInfo[];
  primaryId: number;
}

export interface ClampResult {
  position: WidgetPosition;
  clamped: boolean;
  reason: 'in-saved-display' | 'saved-display-gone' | 'off-all-displays' | 'no-saved-position';
}

/**
 * Decide where to place the widget given a saved position and the current
 * display topology. Pure function — no Electron dependency — so tests can
 * pass a synthetic display set.
 */
export function clampPosition(
  saved: WidgetPosition | null,
  ctx: ClampContext,
): ClampResult {
  const { windowWidth, windowHeight, defaultInset, displays, primaryId } = ctx;
  if (displays.length === 0) {
    // Should never happen — Electron always reports at least one display.
    return {
      position: { x: 0, y: 0, displayId: null },
      clamped: true,
      reason: 'off-all-displays',
    };
  }
  const primary = displays.find((d) => d.id === primaryId) ?? displays[0];

  const defaultPosition: WidgetPosition = {
    x: primary.workArea.x + primary.workArea.width - windowWidth - defaultInset,
    y: primary.workArea.y + defaultInset,
    displayId: primary.id,
  };

  if (!saved) {
    return { position: defaultPosition, clamped: true, reason: 'no-saved-position' };
  }

  const savedDisplay =
    saved.displayId !== null
      ? displays.find((d) => d.id === saved.displayId)
      : undefined;

  if (savedDisplay && positionFitsInDisplay(saved, savedDisplay, windowWidth, windowHeight)) {
    return { position: saved, clamped: false, reason: 'in-saved-display' };
  }

  // Saved monitor is gone — try any current display.
  for (const d of displays) {
    if (positionFitsInDisplay(saved, d, windowWidth, windowHeight)) {
      return {
        position: { ...saved, displayId: d.id },
        clamped: false,
        reason: 'in-saved-display',
      };
    }
  }

  return {
    position: defaultPosition,
    clamped: true,
    reason: savedDisplay ? 'off-all-displays' : 'saved-display-gone',
  };
}

function positionFitsInDisplay(
  pos: WidgetPosition,
  d: DisplayInfo,
  windowWidth: number,
  windowHeight: number,
): boolean {
  const { x, y, width, height } = d.workArea;
  return (
    pos.x >= x &&
    pos.y >= y &&
    pos.x + windowWidth <= x + width &&
    pos.y + windowHeight <= y + height
  );
}

function isWidgetPosition(value: unknown): value is WidgetPosition {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.x !== 'number' || typeof v.y !== 'number') return false;
  if (v.displayId !== null && typeof v.displayId !== 'number') return false;
  return true;
}
