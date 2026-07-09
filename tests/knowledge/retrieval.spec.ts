/**
 * @file tests/knowledge/retrieval.spec.ts
 * Docs-corpus retrieval scoring, sectionPath boost, active-algorithm boost.
 */

import { describe, it, expect } from 'vitest';
import {
  chunksForAlgorithm,
  retrieveChunks,
  scoreChunk,
  tokenize,
} from '../../src/shared/knowledge/retrieval';
import type { DocChunk } from '../../src/shared/knowledgeTypes';

function chunk(partial: Partial<DocChunk> & Pick<DocChunk, 'id' | 'text'>): DocChunk {
  return {
    pageSlug: 'market-wave-algorithm-setup-guide',
    pageTitle: 'Market Wave Algorithm Setup Guide',
    sourceUrl: 'https://docs.archpublic.com/crypto/market-wave-algorithm-setup-guide.md',
    sectionPath: ['Market Wave Algorithm Setup Guide'],
    imageUrls: [],
    tokenEstimate: Math.ceil(partial.text.length / 3.8),
    ...partial,
  };
}

const CHUNKS: DocChunk[] = [
  chunk({
    id: 'mw-about',
    sectionPath: ['Market Wave Algorithm Setup Guide', 'About This Guide'],
    text: 'This guide explains the Market Wave algorithm inputs with illustrative examples.',
  }),
  chunk({
    id: 'mw-buffers',
    sectionPath: ['Market Wave Algorithm Setup Guide', 'Buffers, Scope, and Timeframe'],
    text: 'Positive Sell and Buy Buffers widen the no-action zone during choppy markets.',
  }),
  chunk({
    id: 'arb-setup',
    pageSlug: 'arbitrage-algorithm-setup-guide',
    pageTitle: 'Arbitrage Algorithm Setup Guide',
    sourceUrl: 'https://docs.archpublic.com/crypto/arbitrage-algorithm-setup-guide.md',
    sectionPath: ['Arbitrage Algorithm Setup Guide', 'Overview'],
    text: 'Arbitrage pairs two legs and manages inventory across venues.',
  }),
];

describe('tokenize + scoreChunk', () => {
  it('scores chunks that match query terms', () => {
    const terms = tokenize('buffers choppy');
    expect(scoreChunk(CHUNKS[1]!, terms)).toBeGreaterThan(scoreChunk(CHUNKS[0]!, terms));
  });

  it('boosts sectionPath heading hits', () => {
    const terms = tokenize('timeframe');
    const withPath = scoreChunk(CHUNKS[1]!, terms);
    const bodyOnly = scoreChunk(
      chunk({
        id: 'body',
        sectionPath: ['Market Wave Algorithm Setup Guide', 'Other'],
        text: 'Mentions timeframe once in the body.',
      }),
      terms,
    );
    expect(withPath).toBeGreaterThan(bodyOnly);
  });

  it('applies active-algorithm boost', () => {
    const terms = tokenize('algorithm');
    const boosted = scoreChunk(CHUNKS[0]!, terms, 'market-wave');
    const plain = scoreChunk(CHUNKS[0]!, terms, 'arbitrage');
    expect(boosted).toBeGreaterThan(plain);
  });
});

describe('retrieveChunks', () => {
  it('returns relevant docs chunks within k', () => {
    const result = retrieveChunks({
      chunks: CHUNKS,
      query: { text: 'buffers chop', k: 2, activeAlgorithm: 'market-wave' },
    });
    expect(result.some((c) => c.id === 'mw-buffers')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('respects token budget after the first selected chunk', () => {
    const smallRisk = chunk({
      id: 'small-risk',
      sectionPath: ['Market Wave Algorithm Setup Guide', 'Risk', 'Drawdown'],
      text: 'Drawdown risk notes for buffers and scope.',
    });
    const big = chunk({
      id: 'big',
      sectionPath: ['Market Wave Algorithm Setup Guide', 'Risk'],
      text: 'x'.repeat(40_000),
      tokenEstimate: Math.ceil(40_000 / 3.8),
    });
    const result = retrieveChunks({
      chunks: [...CHUNKS, smallRisk, big],
      query: { text: 'risk drawdown', k: 4, tokenBudget: 500 },
    });
    expect(result.some((c) => c.id === 'small-risk')).toBe(true);
    expect(result.some((c) => c.id === 'big')).toBe(false);
    const totalChars = result.reduce((n, c) => n + c.text.length, 0);
    expect(totalChars).toBeLessThan(40_000);
  });
});

describe('chunksForAlgorithm', () => {
  it('filters to algorithm page slugs', () => {
    const mw = chunksForAlgorithm(CHUNKS, 'market-wave');
    expect(mw.every((c) => c.pageSlug === 'market-wave-algorithm-setup-guide')).toBe(true);
    expect(chunksForAlgorithm(CHUNKS, 'all')).toHaveLength(CHUNKS.length);
  });
});
