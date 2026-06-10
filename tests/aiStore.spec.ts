/**
 * @file tests/aiStore.spec.ts
 *
 * Why it exists: PRD §5 DoD #25 — covers the `ai.*` electron-store wrapper
 * (get/set/default/mask), the rolling-stats prune logic, and the
 * single-source-of-truth API key contract. We never construct a real
 * `electron-store`; a tiny `StoreLike` fake is enough.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  maskApiKey,
  percentile,
  pruneStatsCalls,
  wrapAiStore,
} from '../src/main/aiStore';
import { createTestSafeStorage } from '../src/main/knowledgeCrypto';
import {
  SecretEncryptionUnavailableError,
  createUnavailableSafeStorage,
  isEncryptedSecret,
} from '../src/main/secretsStore';
import {
  AI_STORE_KEY_API_KEY,
  AI_STORE_KEY_MODEL,
  DEFAULT_MODEL,
} from '../src/shared/aiConstants';
import type { StoreLike } from '../src/main/widgetState';
import type { RecordedCall } from '../src/shared/types';

function makeFakeStore(initial: Record<string, unknown> = {}): StoreLike & {
  raw: Record<string, unknown>;
} {
  const raw: Record<string, unknown> = { ...initial };
  return {
    raw,
    get(key: string, defaultValue?: unknown): unknown {
      return raw[key] === undefined ? defaultValue : raw[key];
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

describe('maskApiKey', () => {
  it('returns empty string for null / empty input', () => {
    expect(maskApiKey(null)).toBe('');
    expect(maskApiKey('')).toBe('');
  });

  it('masks short keys completely', () => {
    expect(maskApiKey('abcd1234')).toBe('••••••••');
  });

  it('shows the first three and last four characters of a long key', () => {
    const masked = maskApiKey('AIzaSyABCDEFGHIJKLMNOPQR');
    expect(masked.startsWith('AIz')).toBe(true);
    expect(masked.endsWith('NOPQR'.slice(-4))).toBe(true);
    expect(masked).not.toContain('SyABCDEFGHIJKLM');
  });
});

describe('percentile', () => {
  it('returns 0 for empty input', () => {
    expect(percentile([], 50)).toBe(0);
  });

  it('returns the median for an odd-length sorted array', () => {
    expect(percentile([10, 20, 30, 40, 50], 50)).toBe(30);
  });

  it('approximates p95 from a small sample', () => {
    const ms = [100, 110, 120, 130, 200];
    expect(percentile(ms, 95)).toBe(200);
  });

  it('handles unsorted input', () => {
    expect(percentile([300, 100, 200], 50)).toBe(200);
  });
});

describe('pruneStatsCalls', () => {
  it('keeps records inside the 7-day window', () => {
    const now = 1_000_000_000_000;
    const oneHour = 60 * 60 * 1000;
    const records: RecordedCall[] = [
      { ts: now - oneHour, latencyMs: 1, promptTokenEstimate: 1, jsonOk: true },
      { ts: now - 8 * 24 * oneHour, latencyMs: 1, promptTokenEstimate: 1, jsonOk: true },
    ];
    const out = pruneStatsCalls(records, now);
    expect(out).toHaveLength(1);
    expect(out[0]?.ts).toBe(now - oneHour);
  });
});

describe('wrapAiStore — facade', () => {
  let store: ReturnType<typeof makeFakeStore>;
  let wrapper: ReturnType<typeof wrapAiStore>;
  const safeStorage = createTestSafeStorage();

  beforeEach(() => {
    store = makeFakeStore();
    wrapper = wrapAiStore(store, { safeStorage });
  });

  it('returns null when no api key is set', () => {
    expect(wrapper.getApiKey()).toBeNull();
  });

  it('round-trips a non-empty api key', () => {
    wrapper.setApiKey('AIzaXYZ123');
    expect(wrapper.getApiKey()).toBe('AIzaXYZ123');
    const stored = store.raw[AI_STORE_KEY_API_KEY];
    expect(typeof stored).toBe('string');
    expect(isEncryptedSecret(stored as string)).toBe(true);
  });

  it('clears the api key on empty-string set', () => {
    wrapper.setApiKey('AIzaXYZ123');
    wrapper.setApiKey('');
    expect(wrapper.getApiKey()).toBeNull();
    expect(store.raw[AI_STORE_KEY_API_KEY]).toBeUndefined();
  });

  it('clearApiKey removes the persisted value', () => {
    wrapper.setApiKey('AIzaXYZ123');
    wrapper.clearApiKey();
    expect(wrapper.getApiKey()).toBeNull();
  });

  it('falls back to DEFAULT_MODEL when nothing is persisted', () => {
    expect(wrapper.getModel()).toBe(DEFAULT_MODEL);
  });

  it('rejects models outside the allowlist', () => {
    const result = wrapper.setModel('gpt-4o');
    expect(result).toBe(DEFAULT_MODEL);
    expect(store.raw[AI_STORE_KEY_MODEL]).toBeUndefined();
  });

  it('persists allowlisted models', () => {
    const result = wrapper.setModel('gemini-3.1-flash-lite-preview');
    expect(result).toBe('gemini-3.1-flash-lite-preview');
    expect(wrapper.getModel()).toBe('gemini-3.1-flash-lite-preview');
  });

  it('migrates legacy plaintext api keys on read', () => {
    store.set(AI_STORE_KEY_API_KEY, 'legacy-plain-key');
    expect(wrapper.getApiKey()).toBe('legacy-plain-key');
    const stored = store.raw[AI_STORE_KEY_API_KEY];
    expect(isEncryptedSecret(stored as string)).toBe(true);
  });

  it('refuses to persist api keys when encryption is unavailable', () => {
    const unavailable = createUnavailableSafeStorage();
    const locked = wrapAiStore(store, { safeStorage: unavailable });
    expect(() => locked.setApiKey('AIzaXYZ123')).toThrow(SecretEncryptionUnavailableError);
    expect(store.raw[AI_STORE_KEY_API_KEY]).toBeUndefined();
  });

  it('appends call records and computes rolling stats', () => {
    const t0 = 1_700_000_000_000;
    wrapper.appendCall({ ts: t0, latencyMs: 1000, promptTokenEstimate: 100, jsonOk: true });
    wrapper.appendCall({ ts: t0 + 1000, latencyMs: 2000, promptTokenEstimate: 200, jsonOk: false });
    const stats = wrapper.getStats(t0 + 2000);
    expect(stats.callCount).toBe(2);
    expect(stats.jsonParseFailRate).toBe(0.5);
    expect(stats.lastCallTs).toBe(t0 + 1000);
    expect(stats.windowDays).toBe(7);
  });
});
