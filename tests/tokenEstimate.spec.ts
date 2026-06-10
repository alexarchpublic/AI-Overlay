/**
 * @file tests/tokenEstimate.spec.ts
 * Milestone 2 T2.3 — token estimate constants agree across consumers.
 */

import { describe, it, expect } from 'vitest';
import { estimateTokensFromChars } from '../src/shared/tokenEstimate';
import { estimateTokensFromChars as budgetEstimate } from '../src/main/tokenBudget';
import { estimateChunkTokens } from '../src/shared/knowledge/retrieval';

describe('tokenEstimate — single source', () => {
  it('estimateTokensFromChars matches tokenBudget and retrieval', () => {
    const samples = [0, 1, 42, 380, 3_800, 12_345];
    for (const n of samples) {
      expect(budgetEstimate(n)).toBe(estimateTokensFromChars(n));
      expect(estimateChunkTokens('x'.repeat(n))).toBe(estimateTokensFromChars(n));
    }
  });
});
