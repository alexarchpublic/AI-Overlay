#!/usr/bin/env node
/**
 * Offline abstraction pipeline — Phase 0 task 1 (PRD §5.1, §8 item 1).
 *
 * Validates servable-tier *.abstraction.json (D-3 + human review flag) and writes
 * a content-hashed bundle under knowledge/bundles/. Deep tier is inventory-only.
 */

import * as esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(__dirname, '.cache');
const CACHE_BUNDLE = path.join(CACHE_DIR, 'knowledge-pipeline.mjs');

await mkdir(CACHE_DIR, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(REPO_ROOT, 'src/shared/knowledge/buildPipeline.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: CACHE_BUNDLE,
  packages: 'external',
  sourcemap: false,
  logLevel: 'silent',
});

const { runKnowledgeBuildPipeline } = await import(
  `${pathToFileURL(CACHE_BUNDLE).href}?t=${Date.now()}`
);

try {
  await runKnowledgeBuildPipeline({ repoRoot: REPO_ROOT });
} catch (err) {
  console.error('[knowledge] build failed:', err instanceof Error ? err.message : err);
  process.exit(1);
}
