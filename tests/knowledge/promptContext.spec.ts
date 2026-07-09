/**
 * @file tests/knowledge/promptContext.spec.ts
 * Docs-corpus prompt formatting with sectionPath labels + D-P4 selection.
 */

import { describe, it, expect } from 'vitest';
import {
  composeSystemPrompt,
  formatPromptKnowledge,
  formatRetrievedKnowledge,
  selectPromptKnowledge,
} from '../../src/shared/knowledge/promptContext';
import {
  KNOWLEDGE_CONTEXT_OPENER,
  USE_FULL_CORPUS_INJECTION,
} from '../../src/shared/knowledgeConstants';
import type { DocChunk } from '../../src/shared/knowledgeTypes';

const CHUNKS: DocChunk[] = [
  {
    id: 'mw-about',
    pageSlug: 'market-wave-algorithm-setup-guide',
    pageTitle: 'Market Wave Algorithm Setup Guide',
    sourceUrl: 'https://docs.archpublic.com/crypto/market-wave-algorithm-setup-guide.md',
    sectionPath: ['Market Wave Algorithm Setup Guide', 'About This Guide'],
    text: 'This guide explains the Market Wave algorithm inputs.',
    imageUrls: [],
    tokenEstimate: 20,
  },
  {
    id: 'mw-trade-size',
    pageSlug: 'market-wave-algorithm-setup-guide',
    pageTitle: 'Market Wave Algorithm Setup Guide',
    sourceUrl: 'https://docs.archpublic.com/crypto/market-wave-algorithm-setup-guide.md',
    sectionPath: ['Market Wave Algorithm Setup Guide', 'Trade Size'],
    text: 'All trades have a $5 minimum.',
    imageUrls: [],
    tokenEstimate: 10,
  },
  {
    id: 'arb-about',
    pageSlug: 'arbitrage-algorithm-setup-guide',
    pageTitle: 'Arbitrage Algorithm Setup Guide',
    sourceUrl: 'https://docs.archpublic.com/crypto/arbitrage-algorithm-setup-guide.md',
    sectionPath: ['Arbitrage Algorithm Setup Guide', 'About'],
    text: 'Arbitrage guide body.',
    imageUrls: [],
    tokenEstimate: 8,
  },
];

describe('formatRetrievedKnowledge', () => {
  it('wraps chunks under the product documentation opener with sectionPath', () => {
    const formatted = formatRetrievedKnowledge(CHUNKS);
    expect(formatted.startsWith(KNOWLEDGE_CONTEXT_OPENER)).toBe(true);
    expect(formatted).toContain('#### Market Wave Algorithm Setup Guide → About This Guide');
    expect(formatted).toContain('All trades have a $5 minimum.');
  });

  it('returns empty string for no chunks', () => {
    expect(formatRetrievedKnowledge([])).toBe('');
  });
});

describe('selectPromptKnowledge', () => {
  it('injects the full corpus when USE_FULL_CORPUS_INJECTION is true', () => {
    expect(USE_FULL_CORPUS_INJECTION).toBe(true);
    const blocks = selectPromptKnowledge(CHUNKS, { text: 'buffers' }, 'market-wave');
    expect(blocks.fullCorpus).toBe(true);
    expect(blocks.activeDocChunks).toHaveLength(CHUNKS.length);
    expect(blocks.retrievedChunks).toHaveLength(0);
    expect(formatPromptKnowledge(blocks)).toContain(KNOWLEDGE_CONTEXT_OPENER);
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
