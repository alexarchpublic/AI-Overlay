/**
 * @file tests/captureStore.spec.ts
 *
 * Why it exists: PRD §5 DoD #5/#10 — `wrapCaptureStore` round-trips and the
 * one-shot `widget.autoCapture` → `capture.autoCapture` migration are
 * unit-tested against a fake `StoreLike` so Vitest never touches the
 * ESM-only `electron-store` package.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  clampIntervalMs,
  migrateAutoCaptureKey,
  wrapCaptureStore,
} from '../src/main/captureStore';
import {
  CAPTURE_DEFAULT_INTERVAL_MS,
  CAPTURE_INTERVAL_MAX_MS,
  CAPTURE_INTERVAL_MIN_MS,
} from '../src/shared/constants';
import type { StoreLike } from '../src/main/widgetState';
import type { CaptureRegion } from '../src/shared/types';

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

const sampleRegion: CaptureRegion = {
  id: 'rg_test',
  displayId: 1,
  scaleFactor: 2,
  x: 10,
  y: 20,
  w: 100,
  h: 200,
  px: 20,
  py: 40,
  pw: 200,
  ph: 400,
  createdAt: 1234,
};

describe('clampIntervalMs', () => {
  it('clamps below minimum', () => {
    expect(clampIntervalMs(1000)).toBe(CAPTURE_INTERVAL_MIN_MS);
  });
  it('clamps above maximum', () => {
    expect(clampIntervalMs(120_000)).toBe(CAPTURE_INTERVAL_MAX_MS);
  });
  it('returns default for non-numeric input', () => {
    expect(clampIntervalMs('15000')).toBe(CAPTURE_DEFAULT_INTERVAL_MS);
    expect(clampIntervalMs(NaN)).toBe(CAPTURE_DEFAULT_INTERVAL_MS);
    expect(clampIntervalMs(undefined)).toBe(CAPTURE_DEFAULT_INTERVAL_MS);
  });
  it('rounds fractional inputs', () => {
    expect(clampIntervalMs(15499)).toBe(15499);
    expect(clampIntervalMs(15500.7)).toBe(15501);
  });
  it('passes valid mid-range values through', () => {
    expect(clampIntervalMs(20_000)).toBe(20_000);
  });
});

describe('wrapCaptureStore — capture.* namespace facade', () => {
  let store: ReturnType<typeof makeFakeStore>;
  let wrapper: ReturnType<typeof wrapCaptureStore>;

  beforeEach(() => {
    store = makeFakeStore();
    wrapper = wrapCaptureStore(store);
  });

  it('defaults intervalMs to CAPTURE_DEFAULT_INTERVAL_MS', () => {
    expect(wrapper.getIntervalMs()).toBe(CAPTURE_DEFAULT_INTERVAL_MS);
  });

  it('setIntervalMs clamps to bounds and persists clamped value', () => {
    expect(wrapper.setIntervalMs(1000)).toBe(CAPTURE_INTERVAL_MIN_MS);
    expect(wrapper.getIntervalMs()).toBe(CAPTURE_INTERVAL_MIN_MS);
    expect(wrapper.setIntervalMs(120_000)).toBe(CAPTURE_INTERVAL_MAX_MS);
    expect(wrapper.getIntervalMs()).toBe(CAPTURE_INTERVAL_MAX_MS);
  });

  it('round-trips a region', () => {
    expect(wrapper.getRegion()).toBeNull();
    wrapper.setRegion(sampleRegion);
    expect(wrapper.getRegion()).toEqual(sampleRegion);
  });

  it('clearRegion removes a previously-set region', () => {
    wrapper.setRegion(sampleRegion);
    wrapper.clearRegion();
    expect(wrapper.getRegion()).toBeNull();
  });

  it('rejects malformed persisted region (defensive)', () => {
    store.raw['capture.region'] = { displayId: 'oops' };
    expect(wrapper.getRegion()).toBeNull();
  });

  it('autoCapture defaults to false and round-trips', () => {
    expect(wrapper.getAutoCapture()).toBe(false);
    wrapper.setAutoCapture(true);
    expect(wrapper.getAutoCapture()).toBe(true);
  });

  it('lastCaptureTs defaults to null and round-trips', () => {
    expect(wrapper.getLastCaptureTs()).toBeNull();
    wrapper.setLastCaptureTs(98765);
    expect(wrapper.getLastCaptureTs()).toBe(98765);
  });

  it('getDevShowRecentCaptures defaults to false and respects truthy override', () => {
    expect(wrapper.getDevShowRecentCaptures()).toBe(false);
    store.raw['capture.dev.showRecentCaptures'] = true;
    expect(wrapper.getDevShowRecentCaptures()).toBe(true);
  });
});

describe('migrateAutoCaptureKey — one-shot widget→capture migration (PRD §3.4 / §5 DoD #10)', () => {
  it('moves widget.autoCapture=true into capture.autoCapture and deletes the legacy key', () => {
    const store = makeFakeStore({ 'widget.autoCapture': true });
    const outcome = migrateAutoCaptureKey(store);
    expect(outcome.migrated).toBe(true);
    expect(outcome.value).toBe(true);
    expect(store.raw['capture.autoCapture']).toBe(true);
    expect(store.raw['widget.autoCapture']).toBeUndefined();
    expect(store.raw['capture.migrations.autoCaptureFromWidget']).toBe(true);
  });

  it('moves widget.autoCapture=false correctly', () => {
    const store = makeFakeStore({ 'widget.autoCapture': false });
    const outcome = migrateAutoCaptureKey(store);
    expect(outcome.migrated).toBe(true);
    expect(outcome.value).toBe(false);
    expect(store.raw['capture.autoCapture']).toBe(false);
  });

  it('does NOT re-migrate on a second invocation (idempotent via sticky flag)', () => {
    const store = makeFakeStore({ 'widget.autoCapture': true });
    const first = migrateAutoCaptureKey(store);
    expect(first.migrated).toBe(true);

    // Simulate a re-add of the legacy key by some other code (shouldn't
    // happen in production, but the sticky flag must defend against it).
    store.raw['widget.autoCapture'] = true;
    const second = migrateAutoCaptureKey(store);
    expect(second.migrated).toBe(false);
    expect(second.skipReason).toBe('alreadyMigrated');
    // Old key is preserved here because we don't migrate — the user never
    // asked us to clean their legacy data after the one-shot opportunity.
    expect(store.raw['widget.autoCapture']).toBe(true);
  });

  it('marks as migrated even when no legacy key exists (so a fresh install never re-attempts)', () => {
    const store = makeFakeStore();
    const outcome = migrateAutoCaptureKey(store);
    expect(outcome.migrated).toBe(false);
    expect(outcome.skipReason).toBe('noLegacyKey');
    expect(store.raw['capture.migrations.autoCaptureFromWidget']).toBe(true);
  });

  it('skips migration when legacy value is the wrong type', () => {
    const store = makeFakeStore({ 'widget.autoCapture': 'yes' });
    const outcome = migrateAutoCaptureKey(store);
    expect(outcome.migrated).toBe(false);
    expect(outcome.skipReason).toBe('invalidLegacyValue');
    expect(store.raw['capture.autoCapture']).toBeUndefined();
  });
});
