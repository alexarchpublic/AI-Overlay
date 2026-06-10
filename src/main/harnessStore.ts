/**
 * @file src/main/harnessStore.ts
 *
 * Why it exists: PRD §3.4 — owns the `harness.*` namespace inside the same
 * `electron-store` config file Chunks 2 + 3 already share. Mirrors the
 * `widgetState.ts` / `captureStore.ts` pattern: pure `wrapHarnessStore`
 * adapter for tests, plus a `createHarnessStore()` factory that dynamically
 * imports the ESM-only `electron-store` v10 at runtime.
 *
 * The full `HarnessBundle.text` is NEVER persisted to disk per PRD §3.4 —
 * only the small projection (rootPath + last-load summary) lives here.
 */

import type { StoreLike } from './widgetState';
import {
  HARNESS_STORE_KEY_LAST_APPROX_TOKENS,
  HARNESS_STORE_KEY_LAST_FILE_COUNT,
  HARNESS_STORE_KEY_LAST_LOADED_AT,
  HARNESS_STORE_KEY_LAST_LOAD_DURATION,
  HARNESS_STORE_KEY_ROOT_PATH,
  HARNESS_STORE_KEY_SHOW_INSPECTOR,
} from '../shared/harnessConstants';

export interface HarnessStateStore {
  getRootPath(): string | null;
  setRootPath(path: string): void;
  clearRootPath(): void;

  getLastLoadedAt(): number | null;
  setLastLoadedAt(ts: number): void;

  getLastLoadDurationMs(): number | null;
  setLastLoadDurationMs(ms: number): void;

  getLastFileCount(): number | null;
  setLastFileCount(n: number): void;

  getLastApproxTokens(): number | null;
  setLastApproxTokens(n: number): void;

  /** Hidden flag — see PRD §0 D17. Defaults to `false`. */
  getShowInspector(): boolean;
}

/**
 * Wrap an arbitrary `StoreLike` for the `harness.*` namespace. Public for
 * dependency injection in tests; production calls `createHarnessStore()`.
 */
export function wrapHarnessStore(store: StoreLike): HarnessStateStore {
  return {
    getRootPath() {
      const raw = store.get(HARNESS_STORE_KEY_ROOT_PATH);
      return typeof raw === 'string' && raw.length > 0 ? raw : null;
    },
    setRootPath(p) {
      store.set(HARNESS_STORE_KEY_ROOT_PATH, p);
    },
    clearRootPath() {
      store.delete(HARNESS_STORE_KEY_ROOT_PATH);
    },
    getLastLoadedAt() {
      const raw = store.get(HARNESS_STORE_KEY_LAST_LOADED_AT);
      return typeof raw === 'number' ? raw : null;
    },
    setLastLoadedAt(ts) {
      store.set(HARNESS_STORE_KEY_LAST_LOADED_AT, ts);
    },
    getLastLoadDurationMs() {
      const raw = store.get(HARNESS_STORE_KEY_LAST_LOAD_DURATION);
      return typeof raw === 'number' ? raw : null;
    },
    setLastLoadDurationMs(ms) {
      store.set(HARNESS_STORE_KEY_LAST_LOAD_DURATION, ms);
    },
    getLastFileCount() {
      const raw = store.get(HARNESS_STORE_KEY_LAST_FILE_COUNT);
      return typeof raw === 'number' ? raw : null;
    },
    setLastFileCount(n) {
      store.set(HARNESS_STORE_KEY_LAST_FILE_COUNT, n);
    },
    getLastApproxTokens() {
      const raw = store.get(HARNESS_STORE_KEY_LAST_APPROX_TOKENS);
      return typeof raw === 'number' ? raw : null;
    },
    setLastApproxTokens(n) {
      store.set(HARNESS_STORE_KEY_LAST_APPROX_TOKENS, n);
    },
    getShowInspector() {
      const raw = store.get(HARNESS_STORE_KEY_SHOW_INSPECTOR);
      return typeof raw === 'boolean' ? raw : false;
    },
  };
}

// ---------------------------------------------------------------------------
// Production factory — same dynamic-import dance as widgetState.ts
// ---------------------------------------------------------------------------

interface ElectronStoreOptions {
  name?: string;
  defaults?: Record<string, unknown>;
  clearInvalidConfig?: boolean;
}

interface ElectronStoreModule {
  default: new (opts: ElectronStoreOptions) => StoreLike;
}

// eslint-disable-next-line @typescript-eslint/no-implied-eval
const importESM: (specifier: string) => Promise<unknown> = new Function(
  'specifier',
  'return import(specifier);',
) as (specifier: string) => Promise<unknown>;

/**
 * Open the `harness.*` slice of the shared `config` electron-store file.
 * Same JSON file `widgetState` and `captureStore` open — all three see each
 * other's writes because electron-store reads from disk lazily.
 */
export async function createHarnessStore(): Promise<{
  store: StoreLike;
  wrapper: HarnessStateStore;
}> {
  const mod = (await importESM('electron-store')) as ElectronStoreModule;
  const store: StoreLike = new mod.default({
    name: 'config',
    defaults: {
      harness: {
        showInspector: false,
      },
    },
    clearInvalidConfig: true,
  });
  return { store, wrapper: wrapHarnessStore(store) };
}
