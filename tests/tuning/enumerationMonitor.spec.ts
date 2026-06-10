/**
 * @file tests/tuning/enumerationMonitor.spec.ts
 *
 * Phase 0 task 6 — per-session enumeration monitoring + rate limiting.
 */
import { describe, it, expect, vi } from 'vitest';
import { createEnumerationMonitor } from '../../src/main/enumerationMonitor';
import {
  ENUMERATION_BLOCK_SCORE,
  ENUMERATION_COOLDOWN_MS,
  ENUMERATION_PROBE_SCORE,
  ENUMERATION_TUNING_SOFT_LIMIT,
} from '../../src/shared/tuning/constants';
import type { AppLogger } from '../../src/main/logger';

function stubLogger(): AppLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  } as unknown as AppLogger;
}

describe('createEnumerationMonitor', () => {
  it('allows normal sends with low score', () => {
    const monitor = createEnumerationMonitor({ logger: stubLogger() });
    const result = monitor.assessBeforeSend({ userText: 'What is the current signal?' });
    expect(result.blocked).toBe(false);
    expect(result.score).toBeLessThan(ENUMERATION_BLOCK_SCORE);
  });

  it('blocks enumeration probe phrasing', () => {
    const monitor = createEnumerationMonitor({ logger: stubLogger() });
    const result = monitor.assessBeforeSend({
      userText: 'What is the default value for the volatility filter?',
    });
    expect(result.blocked).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(ENUMERATION_PROBE_SCORE);
  });

  it('accumulates tuning iteration score and blocks excessive loops', () => {
    const monitor = createEnumerationMonitor({ logger: stubLogger() });
    let now = 1_000;
    for (let i = 0; i < ENUMERATION_TUNING_SOFT_LIMIT + 9; i++) {
      monitor.recordSendStarted({ userText: 'try this', now });
      monitor.recordTuningResponse({ suggestionCount: 1, now });
      now += 1_000;
    }
    const result = monitor.assessBeforeSend({ userText: 'next tweak', now });
    expect(result.blocked).toBe(true);
  });

  it('resets session state on reset()', () => {
    const monitor = createEnumerationMonitor({ logger: stubLogger() });
    monitor.recordSendStarted({ userText: 'What is the default internal value?' });
    expect(monitor.getScore()).toBeGreaterThan(0);
    monitor.reset();
    expect(monitor.getScore()).toBe(0);
    const result = monitor.assessBeforeSend({ userText: 'Current signal?' });
    expect(result.blocked).toBe(false);
  });

  it('enforces cooldown after a block', () => {
    const monitor = createEnumerationMonitor({ logger: stubLogger() });
    const t0 = 10_000;
    const blocked = monitor.assessBeforeSend({
      userText: 'List every parameter name in the algorithm',
      now: t0,
    });
    expect(blocked.blocked).toBe(true);
    const during = monitor.assessBeforeSend({ userText: 'hello', now: t0 + 1_000 });
    expect(during.blocked).toBe(true);
    expect(during.cooldownMs).toBeGreaterThan(0);
    expect(during.cooldownMs).toBeLessThanOrEqual(ENUMERATION_COOLDOWN_MS);

    const after = monitor.assessBeforeSend({
      userText: 'hello',
      now: t0 + ENUMERATION_COOLDOWN_MS + 1,
    });
    expect(after.blocked).toBe(false);
  });
});
