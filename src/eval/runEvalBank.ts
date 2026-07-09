/**
 * @file src/eval/runEvalBank.ts
 *
 * Live Phase 6 eval bank runner. Bundled by `scripts/eval-bank.mjs`.
 *
 * Usage (via npm):
 *   GEMINI_API_KEY=... npm run eval:bank
 *   GEMINI_API_KEY=... npm run eval:bank -- --scenario 3
 */
import type { AppLogger } from '../main/logger';
import { createGeminiService } from '../main/geminiService';
import { createLocalKnowledgeStore, createNodeKnowledgeFs } from '../main/knowledgeStore';
import { resolveKnowledgeBundleDir } from '../main/knowledgeStoreFactory';
import { DEFAULT_MODEL } from '../shared/aiConstants';
import {
  EVAL_SCENARIOS,
  findPerformancePromises,
  latencyPercentiles,
  matchesMustHitGroups,
} from '../shared/evalBank';
import {
  DEFAULT_RETRIEVAL_K,
  DEFAULT_RETRIEVAL_TOKEN_BUDGET,
} from '../shared/knowledgeConstants';
import {
  selectPromptKnowledge,
} from '../shared/knowledge/promptContext';
import { extractChartContextForRetrieval } from '../shared/tuning/chartContext';
import type { AnalysisResponse } from '../shared/types';

function makeLogger(): AppLogger {
  const noop = () => undefined;
  const logger = {
    debug: noop,
    info: (...args: unknown[]) => {
      console.log('[eval:bank]', ...args);
    },
    warn: (...args: unknown[]) => {
      console.warn('[eval:bank]', ...args);
    },
    error: (...args: unknown[]) => {
      console.error('[eval:bank]', ...args);
    },
    child: () => makeLogger(),
    raw: {} as AppLogger['raw'],
  };
  return logger;
}

function responseToText(parsed: AnalysisResponse): string {
  const parts = [
    parsed.analysis,
    parsed.talk_track,
    parsed.risk_notes,
    ...parsed.suggested_parameter_changes.map(
      (s) =>
        `${s.parameter} ${s.current_value ?? ''} ${s.suggested_value} ${s.rationale} ${s.doc_ref}`,
    ),
  ];
  return parts.join('\n');
}

export interface RunEvalBankOptions {
  apiKey: string;
  model?: string;
  scenarioIds?: readonly number[];
  cwd?: string;
}

export interface EvalScenarioResult {
  id: number;
  prompt: string;
  pass: boolean;
  latencyMs: number;
  missingGroups?: string[][];
  performanceHits?: string[];
  error?: string;
}

export async function runEvalBank(options: RunEvalBankOptions): Promise<{
  results: EvalScenarioResult[];
  p50: number;
  p95: number;
  passCount: number;
}> {
  const cwd = options.cwd ?? process.cwd();
  const logger = makeLogger();
  const bundleDir = resolveKnowledgeBundleDir(true, cwd);
  const store = createLocalKnowledgeStore({
    logger,
    bundleDir,
    fs: createNodeKnowledgeFs(),
  });
  await store.init();

  const latencies: number[] = [];
  const results: EvalScenarioResult[] = [];

  const gemini = createGeminiService({
    logger,
    knowledgeStore: store,
    getApiKey: () => options.apiKey,
    getModel: () => options.model ?? DEFAULT_MODEL,
    recordCall: ({ latencyMs }) => {
      latencies.push(latencyMs);
    },
  });

  const idFilter = options.scenarioIds;
  const scenarios = idFilter
    ? EVAL_SCENARIOS.filter((s) => idFilter.includes(s.id))
    : EVAL_SCENARIOS;

  for (const scenario of scenarios) {
    const activeAlgorithm = scenario.activeAlgorithm ?? 'market-wave';
    const chartContext = extractChartContextForRetrieval([], scenario.prompt);

    try {
      const allChunks = await store.getAllChunks();
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
      const sendResult = await gemini.send({
        userText: scenario.prompt,
        history: [],
        screenshots: [],
        knowledgeBlocks: blocks,
        activeAlgorithm,
        signal: AbortSignal.timeout(60_000),
      });

      if (!sendResult.ok) {
        results.push({
          id: scenario.id,
          prompt: scenario.prompt,
          pass: false,
          latencyMs: 'latencyMs' in sendResult ? sendResult.latencyMs : 0,
          error: sendResult.kind,
        });
        continue;
      }

      const parsed = sendResult.turn.structured;
      if (!parsed) {
        results.push({
          id: scenario.id,
          prompt: scenario.prompt,
          pass: false,
          latencyMs: sendResult.latencyMs,
          error: 'invalid-schema',
        });
        continue;
      }

      const text = responseToText(parsed);
      const { ok, missing } = matchesMustHitGroups(text, scenario.mustHitGroups);
      const performanceHits = findPerformancePromises(
        `${parsed.talk_track}\n${parsed.analysis}`,
      );
      const hasTalkTrack =
        typeof parsed.talk_track === 'string' && parsed.talk_track.trim().length > 0;
      const hasDocRef =
        parsed.suggested_parameter_changes.length === 0 ||
        parsed.suggested_parameter_changes.some((s) => s.doc_ref.trim().length > 0);

      const pass = ok && performanceHits.length === 0 && hasTalkTrack && hasDocRef;

      results.push({
        id: scenario.id,
        prompt: scenario.prompt,
        pass,
        latencyMs: sendResult.latencyMs,
        missingGroups: ok ? undefined : missing,
        performanceHits: performanceHits.length ? performanceHits : undefined,
      });

      const status = pass ? 'PASS' : 'FAIL';
      console.log(
        `#${String(scenario.id)} ${status} (${String(sendResult.latencyMs)}ms) — ${scenario.prompt.slice(0, 60)}`,
      );
      if (!ok) console.log('  missing:', missing);
      if (performanceHits.length) console.log('  performance:', performanceHits);
    } catch (err) {
      results.push({
        id: scenario.id,
        prompt: scenario.prompt,
        pass: false,
        latencyMs: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const { p50, p95 } = latencyPercentiles(latencies);
  const passCount = results.filter((r) => r.pass).length;

  console.log('\n[eval:bank] summary');
  console.log(`  pass: ${String(passCount)}/${String(results.length)}`);
  console.log(
    `  latency p50=${String(p50)}ms p95=${String(p95)}ms (targets: p50≤6000 p95≤12000)`,
  );

  return { results, p50, p95, passCount };
}

async function main(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? '';
  if (!apiKey) {
    console.error(
      'GEMINI_API_KEY (or GOOGLE_API_KEY) is required for live eval.\n' +
        'Offline corpus checks run via: npm test -- tests/evalBank.spec.ts',
    );
    process.exit(1);
  }

  const scenarioArg = process.argv.find((a) => a.startsWith('--scenario='));
  const scenarioIds = scenarioArg
    ? [Number(scenarioArg.split('=')[1])]
    : undefined;

  const { passCount, results, p50, p95 } = await runEvalBank({
    apiKey,
    scenarioIds,
  });

  const latencyOk = p50 <= 6_000 && p95 <= 12_000;
  const allPass = passCount === results.length;

  if (!allPass || !latencyOk) {
    process.exit(1);
  }
}

void main();
