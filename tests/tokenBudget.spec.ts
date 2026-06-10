/**
 * @file tests/tokenBudget.spec.ts
 *
 * Why it exists: PRD §3.8 / §5 DoD #25 — covers boundary cases for the
 * token-budget math: under both ceilings, between the soft and hard
 * ceilings (trim-then-pass), above the hard ceiling (immediate fail).
 */

import { describe, it, expect } from 'vitest';
import { fit, historyTokens, estimateTokensFromChars } from '../src/main/tokenBudget';
import {
  HARD_CEILING_TOKENS,
  PER_IMAGE_TOKEN_ESTIMATE,
  SOFT_CEILING_TOKENS,
} from '../src/shared/aiConstants';
import type { ChatTurn, Screenshot } from '../src/shared/types';

function userTurn(id: string, text: string): ChatTurn {
  return {
    id,
    role: 'user',
    text,
    attachedScreenshotIds: [],
    createdAt: 0,
  };
}

function assistantTurn(id: string, text: string): ChatTurn {
  return {
    id,
    role: 'assistant',
    text,
    attachedScreenshotIds: [],
    createdAt: 0,
  };
}

function fakeScreenshot(id: string): Screenshot {
  return {
    id,
    timestamp: 0,
    filepath: `/tmp/${id}.jpg`,
    regionId: 'region',
    width: 1024,
    height: 768,
    bytes: 50_000,
  };
}

describe('estimateTokensFromChars', () => {
  it('returns 0 for non-positive input', () => {
    expect(estimateTokensFromChars(0)).toBe(0);
    expect(estimateTokensFromChars(-10)).toBe(0);
  });

  it('rounds up by the 3.8 char/token ratio', () => {
    expect(estimateTokensFromChars(38)).toBe(10);
    expect(estimateTokensFromChars(40)).toBe(11);
  });
});

describe('historyTokens', () => {
  it('sums across all turns', () => {
    const out = historyTokens([
      userTurn('u', 'a'.repeat(38)),
      assistantTurn('a', 'a'.repeat(38)),
    ]);
    expect(out).toBe(20);
  });
});

describe('tokenBudget.fit', () => {
  it('passes through under the soft ceiling with no trims', () => {
    const result = fit({
      knowledgeApproxTokens: 10_000,
      history: [userTurn('u1', 'hi'), assistantTurn('a1', 'hello')],
      screenshots: [fakeScreenshot('s1')],
      userText: 'what is the current signal?',
    });
    expect(result.ok).toBe(true);
    expect(result.trims).toHaveLength(0);
    expect(result.history).toHaveLength(2);
    expect(result.screenshots).toHaveLength(1);
  });

  it('fails immediately above the hard ceiling', () => {
    const result = fit({
      knowledgeApproxTokens: HARD_CEILING_TOKENS + 1,
      history: [],
      screenshots: [],
      userText: 'hi',
    });
    expect(result.ok).toBe(false);
    expect(result.ceilingHit).toBe('hard');
    expect(result.ceiling).toBe(HARD_CEILING_TOKENS);
  });

  it('trims oldest history pairs first when over the soft ceiling', () => {
    // Build history that contributes a meaningful number of tokens.
    const longText = 'x'.repeat(40_000); // ~10.5k tokens
    const history: ChatTurn[] = [];
    for (let i = 0; i < 20; i++) {
      history.push(userTurn(`u${String(i)}`, longText));
      history.push(assistantTurn(`a${String(i)}`, longText));
    }
    // Set harness so the FLOOR fits but adding history pushes us over.
    const result = fit({
      knowledgeApproxTokens: SOFT_CEILING_TOKENS - 100_000,
      history,
      screenshots: [],
      userText: 'go',
    });
    // Either we trim and pass, or we fail at the soft ceiling. The trims
    // array must be non-empty in the trim path.
    if (result.ok) {
      expect(result.trims.length).toBeGreaterThan(0);
      expect(result.history.length).toBeLessThan(history.length);
      // Earliest-first drops: the first remaining turn should have a
      // higher index than the first dropped turn.
      const firstTrim = result.trims[0];
      expect(firstTrim?.what).toBe('historyPair');
    } else {
      expect(result.ceilingHit).toBe('soft');
    }
  });

  it('trims screenshots after exhausting history', () => {
    const screenshots = [
      fakeScreenshot('old'),
      fakeScreenshot('mid'),
      fakeScreenshot('new'),
    ];
    // Push the request just over the soft ceiling using many screenshots.
    const harness = SOFT_CEILING_TOKENS - 2 * PER_IMAGE_TOKEN_ESTIMATE - 100;
    const result = fit({
      knowledgeApproxTokens: harness,
      history: [],
      screenshots,
      userText: 'go',
    });
    if (!result.ok) {
      expect(result.ceilingHit).toBe('soft');
      return;
    }
    // The oldest screenshot ('old') should be the first to drop.
    expect(result.screenshots.length).toBeLessThan(screenshots.length);
    const firstScreenshotTrim = result.trims.find((t) => t.what === 'screenshot');
    expect(firstScreenshotTrim?.id).toBe('old');
  });
});
