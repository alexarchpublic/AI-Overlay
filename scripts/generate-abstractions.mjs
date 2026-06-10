#!/usr/bin/env node
/**
 * Phase 1 automated abstraction pipeline (PRD §8 Phase 1 — less human curation).
 *
 * Reads deep-tier source via GENERATION_MANIFEST.json, LLM-authors servable
 * abstractions, validates D-3, auto-attests review.d3Pass, writes servable JSON files.
 *
 * Requires GEMINI_API_KEY in the environment.
 *
 * Usage:
 *   npm run generate:abstractions
 *   npm run generate:abstractions -- --strategy market-wave
 *   npm run generate:abstractions -- --force
 *   npm run generate:abstractions -- --dry-run
 */

import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(__dirname, '.cache');
const CACHE_BUNDLE = path.join(CACHE_DIR, 'abstraction-generate.mjs');

function parseArgs(argv) {
  const out = {
    strategyId: undefined,
    force: false,
    dryRun: false,
    skipLlm: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--force') out.force = true;
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--skip-llm') out.skipLlm = true;
    else if (arg === '--strategy' && argv[i + 1]) {
      out.strategyId = argv[++i];
    }
  }
  return out;
}

await mkdir(CACHE_DIR, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(REPO_ROOT, 'src/shared/knowledge/generatePipeline.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: CACHE_BUNDLE,
  packages: 'external',
  sourcemap: false,
  logLevel: 'silent',
});

const { runAbstractionGeneratePipeline } = await import(
  `${pathToFileURL(CACHE_BUNDLE).href}?t=${Date.now()}`
);

const args = parseArgs(process.argv.slice(2));

try {
  await runAbstractionGeneratePipeline({
    repoRoot: REPO_ROOT,
    strategyId: args.strategyId,
    force: args.force,
    dryRun: args.dryRun,
    skipLlm: args.skipLlm,
  });
} catch (err) {
  console.error('[abstraction] generate failed:', err instanceof Error ? err.message : err);
  process.exit(1);
}
