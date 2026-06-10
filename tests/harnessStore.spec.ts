/**
 * @file tests/harnessStore.spec.ts
 *
 * Why it exists: PRD §3.4 — round-trip tests for the `harness.*` electron-store
 * wrapper. Mirrors the captureStore.spec pattern: a fake `StoreLike` keeps
 * the test independent of `electron-store`'s ESM module graph.
 */

import { describe, it, expect } from 'vitest';
import { wrapHarnessStore } from '../src/main/harnessStore';
import type { StoreLike } from '../src/main/widgetState';

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

describe('wrapHarnessStore — harness.* namespace facade', () => {
  it('rootPath is null by default and round-trips on set', () => {
    const store = makeFakeStore();
    const w = wrapHarnessStore(store);
    expect(w.getRootPath()).toBeNull();
    w.setRootPath('/Users/x/harness');
    expect(w.getRootPath()).toBe('/Users/x/harness');
    w.clearRootPath();
    expect(w.getRootPath()).toBeNull();
  });

  it('last-load fields default to null and round-trip', () => {
    const w = wrapHarnessStore(makeFakeStore());
    expect(w.getLastLoadedAt()).toBeNull();
    expect(w.getLastLoadDurationMs()).toBeNull();
    expect(w.getLastFileCount()).toBeNull();
    expect(w.getLastApproxTokens()).toBeNull();

    w.setLastLoadedAt(123);
    w.setLastLoadDurationMs(456);
    w.setLastFileCount(20);
    w.setLastApproxTokens(45_000);

    expect(w.getLastLoadedAt()).toBe(123);
    expect(w.getLastLoadDurationMs()).toBe(456);
    expect(w.getLastFileCount()).toBe(20);
    expect(w.getLastApproxTokens()).toBe(45_000);
  });

  it('rejects malformed types defensively', () => {
    const store = makeFakeStore({
      'harness.rootPath': 42, // wrong type
      'harness.lastLoadedAt': 'not a number', // wrong type
    });
    const w = wrapHarnessStore(store);
    expect(w.getRootPath()).toBeNull();
    expect(w.getLastLoadedAt()).toBeNull();
  });

  it('showInspector defaults to false and respects truthy override', () => {
    const store = makeFakeStore();
    const w = wrapHarnessStore(store);
    expect(w.getShowInspector()).toBe(false);
    store.raw['harness.showInspector'] = true;
    expect(w.getShowInspector()).toBe(true);
  });
});
