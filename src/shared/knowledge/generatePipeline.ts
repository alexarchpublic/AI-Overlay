/**
 * @file src/shared/knowledge/generatePipeline.ts
 *
 * CLI entry for Phase 1 automated abstraction generation (esbuild-bundled by
 * scripts/generate-abstractions.mjs).
 */
/// <reference types="node" />

import path from 'node:path';
import {
  buildReviewManifest,
  generateStrategyAbstractions,
  writeReviewManifest,
} from './abstractionGenerator';
import { createGeminiAbstractionAdapter } from './geminiAbstractionAdapter';
import {
  loadDeepTierSources,
  loadGenerationManifest,
  type GenerationStrategyConfig,
} from './deepTierLoader';

export interface GeneratePipelineCliOptions {
  repoRoot: string;
  /** Generate only this strategy id; default all in manifest. */
  strategyId?: string;
  servableRoot?: string;
  deepTierRoot?: string;
  generationManifestPath?: string;
  force?: boolean;
  dryRun?: boolean;
  /** Skip live LLM — for tests / wiring checks only. */
  skipLlm?: boolean;
}

function selectStrategies(
  all: readonly GenerationStrategyConfig[],
  strategyId?: string,
): GenerationStrategyConfig[] {
  if (!strategyId) return [...all];
  const match = all.filter((s) => s.strategyId === strategyId);
  if (match.length === 0) {
    throw new Error(`Unknown strategyId "${strategyId}" in generation manifest`);
  }
  return match;
}

export async function runAbstractionGeneratePipeline(
  cli: GeneratePipelineCliOptions,
): Promise<void> {
  const servableRoot =
    cli.servableRoot ?? path.join(cli.repoRoot, 'knowledge', 'servable');
  const deepTierRoot =
    cli.deepTierRoot ?? path.join(cli.repoRoot, 'arch-public-harness');
  const manifestPath =
    cli.generationManifestPath ??
    path.join(cli.repoRoot, 'knowledge', 'deep', 'GENERATION_MANIFEST.json');

  const manifest = await loadGenerationManifest(manifestPath);
  const strategies = selectStrategies(manifest.strategies, cli.strategyId);

  if (cli.skipLlm) {
    console.info('[abstraction] skipLlm set — no files written');
    return;
  }

  const llm = createGeminiAbstractionAdapter();
  const results = [];

  for (const strategy of strategies) {
    console.info(`[abstraction] generating ${strategy.strategyId} from deep tier…`);
    const bundle = await loadDeepTierSources(deepTierRoot, strategy);
    console.info(
      `[abstraction] loaded ${String(bundle.includedPaths.length)} deep source(s), ${String(bundle.chunkPlan.length)} planned chunks`,
    );

    const result = await generateStrategyAbstractions({
      bundle,
      servableRoot,
      llm,
      force: cli.force,
      dryRun: cli.dryRun,
    });

    results.push(result);

    console.info(
      `[abstraction] ${strategy.strategyId}: wrote ${String(result.written.length)}, skipped ${String(result.skipped.length)}, failed ${String(result.failed.length)}`,
    );
    for (const f of result.failed) {
      console.error(`[abstraction] FAILED ${f.id}: ${f.reason}`);
    }
  }

  const anyFailed = results.some((r) => r.failed.length > 0);
  if (anyFailed) {
    throw new Error('One or more abstraction chunks failed generation — see logs above');
  }

  if (!cli.dryRun && results.some((r) => r.written.length > 0)) {
    const reviewManifest = buildReviewManifest(servableRoot, results);
    const reviewPath = await writeReviewManifest(servableRoot, reviewManifest);
    console.info(`[abstraction] updated ${reviewPath}`);
    console.info('[abstraction] run `npm run build:knowledge` to publish the servable bundle');
  }
}
