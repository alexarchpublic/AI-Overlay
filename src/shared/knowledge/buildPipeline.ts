/**
 * @file src/shared/knowledge/buildPipeline.ts
 *
 * CLI entry for the offline abstraction pipeline (esbuild-bundled by
 * scripts/build-knowledge-bundle.mjs).
 */
/// <reference types="node" />

import path from 'node:path';
import { buildKnowledgeBundle } from './bundleBuilder';

export interface PipelineCliOptions {
  /** Repository root — required when invoked from the esbuild cache bundle. */
  repoRoot: string;
  servableRoot?: string;
  outputDir?: string;
  deepTierRoot?: string;
}

export async function runKnowledgeBuildPipeline(cli: PipelineCliOptions): Promise<void> {
  const servableRoot =
    cli.servableRoot ?? path.join(cli.repoRoot, 'knowledge', 'servable');
  const outputDir = cli.outputDir ?? path.join(cli.repoRoot, 'knowledge', 'bundles');
  const deepTierRoot =
    cli.deepTierRoot ?? path.join(cli.repoRoot, 'arch-public-harness');

  const result = await buildKnowledgeBundle({
    servableRoot,
    outputDir,
    deepTierRoot,
  });

  console.info(`[knowledge] wrote ${result.bundlePath}`);
  console.info(`[knowledge] wrote ${result.manifestPath}`);
}
