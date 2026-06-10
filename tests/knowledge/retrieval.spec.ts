/**
 * @file tests/knowledge/retrieval.spec.ts
 * Phase 0 task 2 — scoped retrieval scoring and token budget.
 */

import { describe, it, expect } from 'vitest';
import { retrieveChunks, scoreChunk, tokenize } from '../../src/shared/knowledge/retrieval';
import type { AbstractionChunk } from '../../src/shared/knowledgeTypes';

const CHUNKS: AbstractionChunk[] = [
  {
    id: 's-contract',
    strategyId: 's',
    kind: 'contract',
    text: 'Long-only behavioral contract summary.',
    version: '1',
  },
  {
    id: 's-param-vol',
    strategyId: 's',
    kind: 'param-role',
    text: 'Volatility filter controls signal frequency in choppy markets.',
    version: '1',
  },
  {
    id: 's-tuning',
    strategyId: 's',
    kind: 'tuning',
    text: 'To reduce drawdown sensitivity widen filters and cut size.',
    version: '1',
  },
];

describe('tokenize + scoreChunk', () => {
  it('scores chunks that match query terms', () => {
    const terms = tokenize('volatility filter choppy');
    expect(scoreChunk(CHUNKS[1]!, terms)).toBeGreaterThan(scoreChunk(CHUNKS[2]!, terms));
  });
});

describe('retrieveChunks', () => {
  it('includes contract chunk and relevant param-role', () => {
    const result = retrieveChunks({
      chunks: CHUNKS,
      query: { text: 'volatility filter', k: 2 },
    });
    expect(result.some((c) => c.kind === 'contract')).toBe(true);
    expect(result.some((c) => c.id === 's-param-vol')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('respects token budget', () => {
    const big: AbstractionChunk[] = [
      ...CHUNKS,
      {
        id: 'big',
        strategyId: 's',
        kind: 'risk',
        text: 'x'.repeat(40_000),
        version: '1',
      },
    ];
    const result = retrieveChunks({
      chunks: big,
      query: { text: 'risk drawdown', k: 4, tokenBudget: 500 },
    });
    const totalChars = result.reduce((n, c) => n + c.text.length, 0);
    expect(totalChars).toBeLessThan(40_000);
  });
});
