#!/usr/bin/env node
/**
 * scripts/ingest-docs.mjs
 *
 * Offline docs-corpus ingest (PRD D-P2 / D-P3):
 *   1. Fetch https://docs.archpublic.com/llms.txt
 *   2. Fetch each page's `.md` endpoint
 *   3. Snapshot to knowledge/docs-corpus/<slug>.md
 *   4. Chunk by heading → knowledge/bundles/docs-<hash>.json
 *
 * Bundles the TypeScript pipeline with esbuild (same approach as preload)
 * so we can share pure helpers with the unit-test suite.
 *
 * Usage: npm run ingest:docs
 */

import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const cacheDir = path.join(root, 'scripts', '.cache');
const outfile = path.join(cacheDir, 'ingest-docs.mjs');
const entry = path.join(root, 'src', 'shared', 'knowledge', 'runDocsIngest.ts');

async function main() {
  await mkdir(cacheDir, { recursive: true });
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    logLevel: 'warning',
  });

  const mod = await import(`${pathToFileURL(outfile).href}?t=${String(Date.now())}`);
  const { runDocsIngest } = mod;
  if (typeof runDocsIngest !== 'function') {
    throw new Error('ingest bundle did not export runDocsIngest');
  }

  try {
    await runDocsIngest({ rootDir: root });
  } finally {
    // Best-effort cleanup of the ephemeral bundle (keep .cache dir).
    await rm(outfile, { force: true }).catch(() => {});
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[ingest:docs] FAILED: ${message}`);
  process.exitCode = 1;
});
