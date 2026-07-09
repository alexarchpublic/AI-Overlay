#!/usr/bin/env node
/**
 * scripts/eval-bank.mjs
 *
 * Live Phase 6 eval bank — runs 20 call scenarios against Gemini.
 *
 * Usage:
 *   GEMINI_API_KEY=... npm run eval:bank
 *   GEMINI_API_KEY=... npm run eval:bank -- --scenario=3
 *
 * Offline corpus grounding checks: npm test -- tests/evalBank.spec.ts
 */

import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const cacheDir = path.join(root, 'scripts', '.cache');
const outfile = path.join(cacheDir, 'eval-bank.mjs');
const entry = path.join(root, 'src', 'eval', 'runEvalBank.ts');

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
    external: ['sharp', 'electron'],
  });

  await import(`${pathToFileURL(outfile).href}?t=${String(Date.now())}`);
}

main().catch((err) => {
  console.error('[eval:bank] fatal:', err);
  process.exit(1);
});
