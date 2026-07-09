/**
 * @file tests/evalBank.spec.ts
 *
 * Phase 6 offline eval bank — corpus spot-checks (PRD §6.2) and retrieval
 * grounding for all 20 scenarios without live Gemini calls.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  CORPUS_SPOT_CHECKS,
  EVAL_SCENARIOS,
  matchesMustHitGroups,
  findPerformancePromises,
  latencyPercentiles,
} from '../src/shared/evalBank';
import {
  DEFAULT_RETRIEVAL_K,
  DEFAULT_RETRIEVAL_TOKEN_BUDGET,
  DOCS_BUNDLE_PREFIX,
} from '../src/shared/knowledgeConstants';
import {
  flattenPromptKnowledge,
  selectPromptKnowledge,
} from '../src/shared/knowledge/promptContext';
import { extractChartContextForRetrieval } from '../src/shared/tuning/chartContext';
import type { DocChunk, DocsKnowledgeBundle } from '../src/shared/knowledgeTypes';

const root = path.resolve(__dirname, '..');
const bundleDir = path.join(root, 'knowledge', 'bundles');

async function loadCommittedBundle(): Promise<{
  bundle: DocsKnowledgeBundle;
  path: string;
}> {
  const files = await readdir(bundleDir);
  const name = files.find((f) => f.startsWith(DOCS_BUNDLE_PREFIX) && f.endsWith('.json'));
  if (!name) throw new Error(`No ${DOCS_BUNDLE_PREFIX}*.json in ${bundleDir}`);
  const filePath = path.join(bundleDir, name);
  const raw = await readFile(filePath, 'utf8');
  return { bundle: JSON.parse(raw) as DocsKnowledgeBundle, path: filePath };
}

describe('evalBank (Phase 6 offline)', () => {
  let allChunks: DocChunk[];
  let corpusText: string;

  beforeAll(async () => {
    const { bundle } = await loadCommittedBundle();
    allChunks = bundle.chunks;
    corpusText = allChunks
      .map((c) => `${c.sectionPath.join(' ')}\n${c.text}`)
      .join('\n');
    expect(bundle.manifest.pages.length).toBeGreaterThanOrEqual(13);
  });

  it('PRD §6.2 spot-check strings are present in the committed corpus', () => {
    const hay = corpusText.toLowerCase();
    for (const needle of CORPUS_SPOT_CHECKS) {
      expect(hay, `missing spot-check: ${needle}`).toContain(needle.toLowerCase());
    }
  });

  it('defines exactly 20 eval scenarios', () => {
    expect(EVAL_SCENARIOS).toHaveLength(20);
    const ids = EVAL_SCENARIOS.map((s) => s.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(new Set(ids).size).toBe(20);
  });

  it.each(EVAL_SCENARIOS.map((s) => [s.id, s] as const))(
    'scenario #%i prompt knowledge grounds must-hit content',
    (_id, scenario) => {
      const activeAlgorithm = scenario.activeAlgorithm ?? 'market-wave';
      const chartContext = extractChartContextForRetrieval([], scenario.prompt);
      const blocks = selectPromptKnowledge(
        allChunks,
        {
          text: scenario.prompt,
          chartContext,
          k: DEFAULT_RETRIEVAL_K,
          tokenBudget: DEFAULT_RETRIEVAL_TOKEN_BUDGET,
          activeAlgorithm,
        },
        activeAlgorithm,
      );
      const injected = flattenPromptKnowledge(blocks)
        .map((c) => c.text)
        .join('\n');

      const { ok, missing } = matchesMustHitGroups(injected, scenario.mustHitGroups);
      expect(ok, `missing in injected knowledge: ${JSON.stringify(missing)}`).toBe(true);
    },
  );

  it('performance-promise detector catches obvious violations', () => {
    expect(findPerformancePromises('This will return 20% profit guaranteed.')).not.toHaveLength(0);
    expect(
      findPerformancePromises('Try widening buffers to reduce chop trades.'),
    ).toHaveLength(0);
  });

  it('latencyPercentiles computes p50/p95 (aiStore formula)', () => {
    const { p50, p95 } = latencyPercentiles([1000, 2000, 3000, 4000, 10000]);
    expect(p50).toBe(3000);
    expect(p95).toBe(10000);
  });
});
