#!/usr/bin/env node
/**
 * scripts/dev.mjs
 *
 * Why it exists: `npm run dev` needs four things running together:
 *   (1) Vite, serving the renderer on localhost:5173
 *   (2) `tsc -p tsconfig.main.json --watch`, emitting `dist/main/index.js`
 *   (3) `node scripts/build-preload.mjs --watch`, emitting
 *       `dist/preload/index.js` as a sandbox-safe single-file bundle
 *       (Electron sandboxed preload cannot `require()` arbitrary CJS
 *       modules — see scripts/build-preload.mjs header for the full why)
 *   (4) `electron .`, which must NOT launch until (1), (2), and (3) are
 *       all ready
 *
 * A raw `concurrently` chain can race those starts and crash on first launch.
 * This orchestrator waits for readiness signals before spawning Electron, and
 * shuts every child process down together on SIGINT/SIGTERM.
 *
 * Keep this file small and dependency-free — Chunk 2 may add a hot-reload
 * loop for the overlay window, so the seams here must stay obvious.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const VITE_PORT = 5173;
// 127.0.0.1 (not `localhost`) — on Windows, `localhost` can resolve to `::1`
// first, which Vite's `--strictPort` dev server doesn't always bind to,
// causing spurious connection-refused loops in `waitForHttp` below.
const VITE_URL = `http://127.0.0.1:${VITE_PORT}`;
const MAIN_BUNDLE = path.join(root, 'dist', 'main', 'index.js');
const PRELOAD_BUNDLE = path.join(root, 'dist', 'preload', 'index.js');
const READY_TIMEOUT_MS = 45_000;

/** Tracked children so shutdown can kill them all. */
const children = [];
let shuttingDown = false;

function run(name, cmd, args, env = {}) {
  const child = spawn(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
    shell: process.platform === 'win32',
  });
  children.push({ name, child });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.log(`[dev] ${name} exited (code=${code}, signal=${signal}) — shutting down`);
    shutdown(code ?? 1);
  });
  return child;
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const { child } of children) {
    if (child.killed) continue;
    try {
      if (process.platform === 'win32') {
        // Windows has no SIGINT signal delivery for child processes spawned
        // without a shell — `taskkill /T` kills the whole process tree
        // (vite/tsc/esbuild/electron all spawn their own subprocesses).
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        child.kill('SIGINT');
      }
    } catch {
      /* noop */
    }
  }
  // Hard-exit shortly after, in case any child ignores SIGINT.
  setTimeout(() => process.exit(exitCode), 500).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

function waitForHttp(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`Timed out waiting for ${url}`));
      }
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => setTimeout(tick, 300));
    };
    tick();
  });
}

function waitForFile(filepath, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (existsSync(filepath)) return resolve();
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`Timed out waiting for ${filepath}`));
      }
      setTimeout(tick, 300);
    };
    tick();
  });
}

async function main() {
  console.log('[dev] starting vite + tsc:main + esbuild:preload watchers');
  run('vite', 'npx', [
    'vite',
    '--port',
    String(VITE_PORT),
    '--strictPort',
    '--host',
    '127.0.0.1',
  ]);
  run('tsc:main', 'npx', [
    'tsc',
    '-p',
    'tsconfig.main.json',
    '--watch',
    '--preserveWatchOutput',
  ]);
  // esbuild bundles `src/preload/index.ts` into a sandbox-safe single file.
  // Must not race with tsc:main on the same outfile — `tsconfig.main.json`
  // explicitly excludes `src/preload/**` so esbuild owns `dist/preload/`.
  run('esbuild:preload', 'node', ['scripts/build-preload.mjs', '--watch']);

  console.log('[dev] waiting for vite server + main bundle + preload bundle…');
  await Promise.all([
    waitForHttp(VITE_URL, READY_TIMEOUT_MS),
    waitForFile(MAIN_BUNDLE, READY_TIMEOUT_MS),
    waitForFile(PRELOAD_BUNDLE, READY_TIMEOUT_MS),
  ]);

  console.log('[dev] launching electron');
  // Cursor/IDE terminals often set ELECTRON_RUN_AS_NODE=1, which makes
  // `require('electron')` return a path string instead of the API — screen
  // recording checks then stay `denied` and the widget stays amber.
  const electronEnv = {
    ...process.env,
    NODE_ENV: 'development',
    VITE_DEV_SERVER_URL: VITE_URL, // 127.0.0.1 — see VITE_URL comment above
  };
  delete electronEnv.ELECTRON_RUN_AS_NODE;
  const child = spawn('npx', ['electron', '.'], {
    cwd: root,
    stdio: 'inherit',
    env: electronEnv,
    shell: process.platform === 'win32',
  });
  children.push({ name: 'electron', child });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.log(`[dev] electron exited (code=${code}, signal=${signal}) — shutting down`);
    shutdown(code ?? 1);
  });
}

main().catch((err) => {
  console.error('[dev] failed to start:', err);
  shutdown(1);
});
