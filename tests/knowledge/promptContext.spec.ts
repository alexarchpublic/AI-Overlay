/**
 * @file tests/knowledge/promptContext.spec.ts
 * Phase 0 task 3 — scoped knowledge prompt formatting.
 */

import { describe, it, expect } from 'vitest';
import {
  composeSystemPrompt,
  formatRetrievedKnowledge,
} from '../../src/shared/knowledge/promptContext';
import { KNOWLEDGE_CONTEXT_OPENER } from '../../src/shared/knowledgeConstants';
import type { AbstractionChunk } from '../../src/shared/knowledgeTypes';

const CHUNKS: AbstractionChunk[] = [
  {
    id: 's-contract',
    strategyId: 's',
    kind: 'contract',
    text: 'Long-only behavioral contract.',
    version: '1',
  },
  {
    id: 's-param-vol',
    strategyId: 's',
    kind: 'param-role',
    text: 'Volatility filter role text.',
    version: '1',
  },
];

describe('formatRetrievedKnowledge', () => {
  it('wraps chunks under the strategy knowledge opener', () => {
    const formatted = formatRetrievedKnowledge(CHUNKS);
    expect(formatted.startsWith(KNOWLEDGE_CONTEXT_OPENER)).toBe(true);
    expect(formatted).toContain('#### s-contract (contract)');
    expect(formatted).toContain('Volatility filter role text.');
  });

  it('returns empty string for no chunks', () => {
    expect(formatRetrievedKnowledge([])).toBe('');
  });
});

describe('composeSystemPrompt', () => {
  it('orders persona → knowledge → schema', () => {
    const prompt = composeSystemPrompt('PERSONA', CHUNKS, 'SCHEMA');
    expect(prompt.indexOf('PERSONA')).toBe(0);
    expect(prompt.indexOf(KNOWLEDGE_CONTEXT_OPENER)).toBeGreaterThan(0);
    expect(prompt.indexOf('SCHEMA')).toBeGreaterThan(prompt.indexOf(KNOWLEDGE_CONTEXT_OPENER));
  });
});
