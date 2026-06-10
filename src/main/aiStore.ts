/**
 * @file src/main/aiStore.ts
 *
 * Why it exists: PRD §3.4 — owns the `ai.*` namespace inside the same
 * `electron-store` config file Chunks 2 / 3 / 4 already share. Mirrors the
 * `widgetState.ts` / `captureStore.ts` / `harnessStore.ts` pattern: pure
 * `wrapAiStore` adapter for tests, plus a `createAiStore()` factory that
 * dynamically imports the ESM-only `electron-store` v10.
 *
 * Key invariants:
 *   - **Raw API key never leaves main.** `getApiKey()` returns the plain
 *     value here (main-only); the IPC surface (`window.api.ai.getApiKey`)
 *     only ever returns `{ present, masked }`. Reviewer enforces this in
 *     PRD §5 DoD #24 by greping the renderer for the raw value.
 *   - **API key encrypted at rest (Phase 0 task 7 / D-11).** Cleartext is
 *     wrapped with OS keychain-backed `safeStorage` before persistence.
 *     Legacy plaintext values migrate transparently on first read.
 *   - **Stats are pruned on read AND write.** The rolling 7-day window is
 *     enforced in one place (`pruneStatsCalls`) so settings reads can't
 *     drift from what the writer thinks is current.
 */

import type { GeminiCallStats, RecordedCall } from '../shared/types';
import {
  AI_STORE_KEY_API_KEY,
  AI_STORE_KEY_MODEL,
  AI_STORE_KEY_STATS_CALLS,
  DEFAULT_MODEL,
  MODEL_ALLOWLIST,
  STATS_WINDOW_DAYS,
} from '../shared/aiConstants';
import type { StoreLike } from './widgetState';
import type { SafeStorageLike } from './knowledgeCrypto';
import {
  isEncryptedSecret,
  migratePlaintextSecret,
  readStoredSecret,
  resolveSafeStorage,
  writeStoredSecret,
} from './secretsStore';

export interface WrapAiStoreOptions {
  safeStorage?: SafeStorageLike;
}

export interface AiStateStore {
  /**
   * Raw API key. **Main-process only.** Never expose this return value
   * across the IPC boundary — the preload surface (`window.api.ai.getApiKey`)
   * returns `{ present, masked }` instead.
   *
   * Returns `null` when unset.
   */
  getApiKey(): string | null;
  /**
   * Persist a new raw API key. Empty string clears the field — callers
   * should prefer `clearApiKey()` for clarity.
   */
  setApiKey(key: string): void;
  /** Drop the persisted key entirely. Equivalent to `setApiKey('')`. */
  clearApiKey(): void;

  /** Selected model id. Falls back to `DEFAULT_MODEL` if unset/invalid. */
  getModel(): string;
  /**
   * Set the active model. Must be a member of `MODEL_ALLOWLIST` (PRD D2);
   * otherwise the call is a no-op and returns the previous value.
   * Returns the value actually persisted.
   */
  setModel(model: string): string;

  /**
   * Append one call record. Triggers an inline prune of records older than
   * `STATS_WINDOW_DAYS` so the stored array can't grow unbounded.
   */
  appendCall(record: RecordedCall): void;
  /** Compute the rolling 7-day stats from the current ring. */
  getStats(now: number): GeminiCallStats;
}

/** Mask helper used by both the IPC bridge and the settings panel preview. */
export function maskApiKey(raw: string | null): string {
  if (raw === null || raw.length === 0) return '';
  if (raw.length <= 8) return '•'.repeat(raw.length);
  // Show the first three and the last four characters with bullets in
  // between. Three at the front so a typical "AI…" prefix is recognisable;
  // four at the back is the de facto convention for masked secrets.
  const head = raw.slice(0, 3);
  const tail = raw.slice(-4);
  return `${head}${'•'.repeat(Math.min(8, raw.length - 7))}${tail}`;
}

/**
 * Compute p50 / p95 from an unsorted latency array. Returns `0` when the
 * array is empty. Pure / synchronous so tests and the IPC handler share
 * one path.
 */
export function percentile(latencies: readonly number[], p: number): number {
  if (latencies.length === 0) return 0;
  const sorted = [...latencies].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((p / 100) * sorted.length)),
  );
  return sorted[idx] ?? 0;
}

/**
 * Drop call records older than the rolling window. Pure / synchronous —
 * exported so the spec can assert the boundary case.
 */
export function pruneStatsCalls(
  calls: readonly RecordedCall[],
  now: number,
): RecordedCall[] {
  const cutoff = now - STATS_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return calls.filter((c) => c.ts >= cutoff);
}

/**
 * Wrap an arbitrary `StoreLike` for the `ai.*` namespace. Public for
 * dependency injection in tests; production calls `createAiStore()`.
 */
export function wrapAiStore(store: StoreLike, options: WrapAiStoreOptions = {}): AiStateStore {
  const safeStorage =
    options.safeStorage ?? resolveSafeStorage({ allowFallback: false });

  function readCalls(): RecordedCall[] {
    const raw = store.get(AI_STORE_KEY_STATS_CALLS);
    if (!Array.isArray(raw)) return [];
    return raw.filter(isRecordedCall);
  }

  return {
    getApiKey() {
      const raw = store.get(AI_STORE_KEY_API_KEY);
      const plain = readStoredSecret(raw, safeStorage);
      if (plain === null) return null;

      // One-time migration from legacy plaintext (pre task 7).
      if (typeof raw === 'string' && !isEncryptedSecret(raw)) {
        migratePlaintextSecret(AI_STORE_KEY_API_KEY, plain, safeStorage, store);
      }

      return plain;
    },
    setApiKey(key) {
      if (typeof key !== 'string' || key.length === 0) {
        store.delete(AI_STORE_KEY_API_KEY);
        return;
      }
      writeStoredSecret(AI_STORE_KEY_API_KEY, key, safeStorage, store);
    },
    clearApiKey() {
      store.delete(AI_STORE_KEY_API_KEY);
    },
    getModel() {
      const raw = store.get(AI_STORE_KEY_MODEL);
      if (typeof raw === 'string' && MODEL_ALLOWLIST.includes(raw)) return raw;
      return DEFAULT_MODEL;
    },
    setModel(model) {
      if (typeof model !== 'string' || !MODEL_ALLOWLIST.includes(model)) {
        return this.getModel();
      }
      store.set(AI_STORE_KEY_MODEL, model);
      return model;
    },
    appendCall(record) {
      const next = pruneStatsCalls([...readCalls(), record], record.ts);
      store.set(AI_STORE_KEY_STATS_CALLS, next);
    },
    getStats(now) {
      const calls = pruneStatsCalls(readCalls(), now);
      const latencies = calls.map((c) => c.latencyMs);
      const failures = calls.filter((c) => !c.jsonOk).length;
      return {
        windowDays: STATS_WINDOW_DAYS,
        callCount: calls.length,
        p50LatencyMs: Math.round(percentile(latencies, 50)),
        p95LatencyMs: Math.round(percentile(latencies, 95)),
        jsonParseFailRate: calls.length === 0 ? 0 : failures / calls.length,
        lastCallTs:
          calls.length === 0
            ? null
            : calls.reduce((m, c) => (c.ts > m ? c.ts : m), 0),
      };
    },
  };
}

function isRecordedCall(v: unknown): v is RecordedCall {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  const firewallOk =
    o.firewallAction === undefined ||
    o.firewallAction === 'allow' ||
    o.firewallAction === 'block' ||
    o.firewallAction === 'rewrite';
  const enumOk = o.enumerationScore === undefined || typeof o.enumerationScore === 'number';
  return (
    typeof o.ts === 'number' &&
    typeof o.latencyMs === 'number' &&
    typeof o.promptTokenEstimate === 'number' &&
    typeof o.jsonOk === 'boolean' &&
    firewallOk &&
    enumOk
  );
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

export interface CreateAiStoreOptions {
  safeStorage?: SafeStorageLike;
}

/**
 * Open the `ai.*` slice of the shared `config` electron-store file. Pulls
 * a fresh handle (the same JSON file Chunks 2 / 3 / 4 use); all wrappers
 * see each other's writes because electron-store reads from disk lazily.
 */
export async function createAiStore(
  options: CreateAiStoreOptions = {},
): Promise<{
  store: StoreLike;
  wrapper: AiStateStore;
}> {
  const mod = (await importESM('electron-store')) as ElectronStoreModule;
  const store: StoreLike = new mod.default({
    name: 'config',
    defaults: {
      ai: {
        apiKey: '',
        model: DEFAULT_MODEL,
        stats: { calls: [] },
      },
    },
    clearInvalidConfig: true,
  });
  return {
    store,
    wrapper: wrapAiStore(store, { safeStorage: options.safeStorage }),
  };
}
