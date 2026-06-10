/**
 * @file tests/knowledge/abstractionGenerator.spec.ts
 * Phase 1 — automated abstraction pipeline with mock LLM adapter.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  AUTOMATED_REVIEWER,
  buildReviewManifest,
  generateStrategyAbstractions,
  type AbstractionLlmAdapter,
} from '../../src/shared/knowledge/abstractionGenerator';
import { parseGeneratedAbstractions } from '../../src/shared/knowledge/abstractionGenerationSchema';
import type { DeepTierSourceBundle } from '../../src/shared/knowledge/deepTierLoader';
import { validateD3 } from '../../src/shared/knowledge/d3Validator';

const TEST_BUNDLE: DeepTierSourceBundle = {
  strategyId: 'test-strategy',
  displayName: 'Test Strategy',
  version: '1',
  includedPaths: ['docs/readme.md'],
  sourceText: 'Deep source for testing.',
  chunkPlan: [
    {
      id: 'test-contract',
      kind: 'contract',
      fileName: 'contract.abstraction.json',
      focus: 'Behavioral contract.',
    },
    {
      id: 'test-tuning',
      kind: 'tuning',
      fileName: 'tuning.abstraction.json',
      focus: 'Tuning guidance.',
    },
  ],
};

const SAFE_TEXT = {
  'test-contract':
    'Long-only behavioral summary for spot crypto. Entries arm on confirmed bar dips; exits on bar rallies. Envelope gating can defer signals. Intended for iterative chart tuning — never infer hidden factory settings.',
  'test-tuning':
    'Conservative posture: tighten entry dip requirement and reduce sizing. Aggressive posture: shallow thresholds and larger clips. Phrase try-values as rounded ranges grounded in visible volatility.',
};

function createMockLlm(failIdOnce?: string): AbstractionLlmAdapter {
  const failCounts = new Map<string, number>();

  return {
    async generate({ userPrompt }) {
      const isRetry = userPrompt.includes('D-3 FAILURES');
      const ids = isRetry
        ? [TEST_BUNDLE.chunkPlan.find((c) => userPrompt.includes(c.id))!.id]
        : TEST_BUNDLE.chunkPlan.map((c) => c.id);

      const documents = ids.map((id) => {
        let text = SAFE_TEXT[id as keyof typeof SAFE_TEXT] ?? 'Safe generic abstraction text.';
        if (failIdOnce === id && (failCounts.get(id) ?? 0) === 0) {
          failCounts.set(id, 1);
          text = 'The algorithm uses 42 for everything.';
        }
        const chunk = TEST_BUNDLE.chunkPlan.find((c) => c.id === id)!;
        return {
          id,
          kind: chunk.kind,
          fileName: chunk.fileName,
          text,
        };
      });

      return { ok: true, rawJson: JSON.stringify({ documents }) };
    },
  };
}

describe('parseGeneratedAbstractions', () => {
  it('parses valid structured output', () => {
    const raw = JSON.stringify({
      documents: [
        {
          id: 'x',
          kind: 'contract',
          fileName: 'contract.abstraction.json',
          text: '  trimmed  ',
        },
      ],
    });
    const parsed = parseGeneratedAbstractions(raw);
    expect(parsed?.documents[0]?.text).toBe('trimmed');
  });

  it('rejects malformed payloads', () => {
    expect(parseGeneratedAbstractions('not json')).toBeNull();
    expect(parseGeneratedAbstractions('{}')).toBeNull();
  });
});

describe('generateStrategyAbstractions', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'abs-gen-'));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('writes D-3-valid abstractions with automated review attestation', async () => {
    const servableRoot = path.join(tmp, 'servable');
    const result = await generateStrategyAbstractions({
      bundle: TEST_BUNDLE,
      servableRoot,
      llm: createMockLlm(),
    });

    expect(result.failed).toHaveLength(0);
    expect(result.written).toHaveLength(2);

    const contractPath = path.join(
      servableRoot,
      'test-strategy',
      'contract.abstraction.json',
    );
    const raw = await readFile(contractPath, 'utf8');
    const source = JSON.parse(raw) as {
      review: { reviewer: string; d3Pass: boolean };
      text: string;
    };
    expect(source.review.reviewer).toBe(AUTOMATED_REVIEWER);
    expect(source.review.d3Pass).toBe(true);
    expect(validateD3(source.text).ok).toBe(true);
  });

  it('retries when initial draft fails D-3', async () => {
    const servableRoot = path.join(tmp, 'servable-retry');
    const result = await generateStrategyAbstractions({
      bundle: TEST_BUNDLE,
      servableRoot,
      llm: createMockLlm('test-contract'),
      maxD3Retries: 3,
    });

    expect(result.failed).toHaveLength(0);
    expect(result.written.find((w) => w.source.id === 'test-contract')?.d3Attempts).toBe(2);
  });

  it('skips existing files unless force is set', async () => {
    const servableRoot = path.join(tmp, 'servable-skip');
    await generateStrategyAbstractions({
      bundle: TEST_BUNDLE,
      servableRoot,
      llm: createMockLlm(),
    });

    const second = await generateStrategyAbstractions({
      bundle: TEST_BUNDLE,
      servableRoot,
      llm: createMockLlm(),
    });
    expect(second.skipped).toHaveLength(2);
    expect(second.written).toHaveLength(0);

    const forced = await generateStrategyAbstractions({
      bundle: TEST_BUNDLE,
      servableRoot,
      llm: createMockLlm(),
      force: true,
    });
    expect(forced.written).toHaveLength(2);
  });

  it('dry-run validates without writing files', async () => {
    const servableRoot = path.join(tmp, 'servable-dry');
    const result = await generateStrategyAbstractions({
      bundle: TEST_BUNDLE,
      servableRoot,
      llm: createMockLlm(),
      dryRun: true,
    });
    expect(result.written).toHaveLength(2);
    await expect(access(path.join(servableRoot, 'test-strategy'))).rejects.toThrow();
  });
});

describe('buildReviewManifest', () => {
  it('records automated pipeline attestation', () => {
    const manifest = buildReviewManifest('/tmp/servable', [
      {
        strategyId: 'test-strategy',
        written: [
          {
            relativePath: 'test-strategy/contract.abstraction.json',
            source: {
              id: 'test-contract',
              strategyId: 'test-strategy',
              kind: 'contract',
              version: '1',
              text: 'x',
              review: {
                reviewer: AUTOMATED_REVIEWER,
                reviewedAt: '2026-05-29',
                d3Pass: true,
              },
            },
            d3Attempts: 1,
          },
        ],
        skipped: [],
        failed: [],
      },
    ]);
    expect(manifest.phase).toBe('1');
    expect(manifest.strategies[0]?.reviewer).toBe(AUTOMATED_REVIEWER);
  });
});
