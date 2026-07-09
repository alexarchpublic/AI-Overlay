/**
 * @file tests/knowledge/knowledgeStoreState.spec.ts
 * Phase 0 task 2 — knowledge.backend config namespace.
 */

import { describe, it, expect } from 'vitest';
import { wrapKnowledgeStore, parseActiveAlgorithm } from '../../src/main/knowledgeStoreState';
import type { StoreLike } from '../../src/main/widgetState';

function makeFakeStore(initial: Record<string, unknown> = {}): StoreLike {
  const raw: Record<string, unknown> = { ...initial };
  return {
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

describe('wrapKnowledgeStore', () => {
  it('defaults backend to local', () => {
    const w = wrapKnowledgeStore(makeFakeStore());
    expect(w.getBackend()).toBe('local');
  });

  it('round-trips remote backend', () => {
    const w = wrapKnowledgeStore(makeFakeStore());
    w.setBackend('remote');
    expect(w.getBackend()).toBe('remote');
  });

  it('defaults activeAlgorithm to market-wave', () => {
    const w = wrapKnowledgeStore(makeFakeStore());
    expect(w.getActiveAlgorithm()).toBe('market-wave');
  });

  it('round-trips activeAlgorithm and rejects invalid values', () => {
    const w = wrapKnowledgeStore(makeFakeStore());
    expect(w.setActiveAlgorithm('arbitrage')).toBe('arbitrage');
    expect(w.getActiveAlgorithm()).toBe('arbitrage');
    expect(parseActiveAlgorithm('not-valid')).toBe('market-wave');
  });
});
