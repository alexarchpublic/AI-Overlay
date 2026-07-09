/**
 * @file tests/knowledge/promptContext.spec.ts
 * Docs-corpus prompt formatting with sectionPath labels.
 */

import { describe, it, expect } from 'vitest';
import {
  composeSystemPrompt,
  formatRetrievedKnowledge,
} from '../../src/shared/knowledge/promptContext';
import { KNOWLEDGE_CONTEXT_OPENER } from '../../src/shared/knowledgeConstants';
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

describe('composeSystemPrompt', () => {
  it('orders persona → knowledge → schema', () => {
    const prompt = composeSystemPrompt('PERSONA', CHUNKS, 'SCHEMA');
    expect(prompt.indexOf('PERSONA')).toBe(0);
    expect(prompt.indexOf(KNOWLEDGE_CONTEXT_OPENER)).toBeGreaterThan(0);
    expect(prompt.indexOf('SCHEMA')).toBeGreaterThan(prompt.indexOf(KNOWLEDGE_CONTEXT_OPENER));
  });
});
