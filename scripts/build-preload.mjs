#!/usr/bin/env node
/**
 * scripts/build-preload.mjs
 *
 * Why it exists: Electron sandboxed preload scripts (`sandbox: true`,
 * locked in PRD Chunk 1 §0 D-list) cannot `require()` arbitrary CommonJS
 * modules — only `electron`, `events`, `timers`, and `url`. That means any
 * preload that does `import { X } from '../shared/foo'` at runtime breaks:
 * the compiled `require('../shared/foo')` call throws inside the sandbox,
 * the preload never finishes, and `contextBridge.exposeInMainWorld()`
 * never fires — leaving `window.api` undefined in the renderer.
 *
 * The fix is to bundle the preload into a single self-contained CommonJS
 * file before Electron loads it. esbuild handles this well:
 *   - Bundles `src/preload/index.ts` plus everything it imports
 *     (`shared/types.ts`, `shared/ipcChannels.ts`, …) into one file.
 *   - Marks `electron` as external so the runtime require for `electron`
 *     stays intact (the only require the sandbox actually allows).
 *   - Emits a sourcemap so Chunk 6's logging can map renderer-side errors
 *     back to TS line numbers.
 *
 * Usage:
 *   node scripts/build-preload.mjs            # one-shot build
 *   node scripts/build-preload.mjs --watch    # watch mode for `npm run dev`
 */

import { build, context as esbuildContext } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const ENTRY = path.join(root, 'src', 'preload', 'index.ts');
const OUTFILE = path.join(root, 'dist', 'preload', 'index.js');

/**
 * esbuild config for the preload bundle. Kept here (not split into a
 * separate config file) because every option ties directly back to the
 * sandbox constraints documented above.
 */
const buildOptions = {
  entryPoints: [ENTRY],
  outfile: OUTFILE,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: true,
  // `electron` is the ONLY runtime require the sandbox allows. Marking it
  // external ensures the bundle leaves it as `require('electron')` instead
  // of trying (and failing) to inline it.
  external: ['electron'],
  logLevel: 'info',
  // Keep the bundle readable so future Claude sessions debugging a sandbox
  // failure can still find the contextBridge call by name.
  minify: false,
};

const watchMode = process.argv.includes('--watch');

if (watchMode) {
  const ctx = await esbuildContext(buildOptions);
  await ctx.watch();
  console.log('[build-preload] watching src/preload/**/*.ts');
} else {
  await build(buildOptions);
  console.log(`[build-preload] wrote ${path.relative(root, OUTFILE)}`);
}
