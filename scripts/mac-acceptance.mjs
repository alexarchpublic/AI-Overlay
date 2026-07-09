#!/usr/bin/env node
/**
 * Operator Mac acceptance — automated slice + log audit.
 *
 * Usage:
 *   node scripts/mac-acceptance.mjs           # run automated checks only
 *   node scripts/mac-acceptance.mjs --logs    # also audit today's app log
 *
 * Manual GUI steps (widget, picker, chat, Gemini) still require npm run dev
 * and your interaction; see MAC_ACCEPTANCE.md in the repo root.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const ALLOWED_API_KEYS = new Set([
  'log',
  'widget',
  'perms',
  'capture',
  'region',
  'harness',
  'chat',
  'ai',
]);

function run(cmd, label) {
  process.stdout.write(`\n▶ ${label}\n`);
  try {
    execSync(cmd, { cwd: root, stdio: 'inherit' });
    return true;
  } catch {
    process.stdout.write(`✗ FAILED: ${label}\n`);
    return false;
  }
}

function auditPreload() {
  const preload = fs.readFileSync(
    path.join(root, 'src/preload/index.ts'),
    'utf8',
  );
  const apiBlock = preload.match(/const api = \{([\s\S]*?)\} as const;/);
  if (!apiBlock) {
    console.log('✗ Could not parse preload api object');
    return false;
  }
  const keys = [...apiBlock[1].matchAll(/^\s{2}(\w+)(?:,|:)/gm)].map((m) => m[1]);
  const extra = keys.filter((k) => !ALLOWED_API_KEYS.has(k));
  if (extra.length) {
    console.log(`✗ Unexpected window.api namespaces: ${extra.join(', ')}`);
    return false;
  }
  console.log(`✓ Preload IPC namespaces: ${keys.join(', ')}`);
  return true;
}

function walkTs(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkTs(p, acc);
    else if (/\.tsx?$/.test(ent.name)) acc.push(p);
  }
  return acc;
}

function auditGrep() {
  let ok = true;
  const rel = (p) => path.relative(root, p).replace(/\\/g, '/');

  const genaiFiles = walkTs(path.join(root, 'src'))
    .concat(walkTs(path.join(root, 'tests')))
    .filter((f) => fs.readFileSync(f, 'utf8').includes('new GoogleGenerativeAI'))
    .map(rel);
  if (genaiFiles.length !== 1 || genaiFiles[0] !== 'src/main/geminiService.ts') {
    console.log(
      `✗ GoogleGenerativeAI must only be in geminiService.ts; found: ${genaiFiles.join(', ')}`,
    );
    ok = false;
  } else {
    console.log('✓ GoogleGenerativeAI only in src/main/geminiService.ts');
  }

  const personaFiles = walkTs(path.join(root, 'src'))
    .concat(walkTs(path.join(root, 'tests')))
    .filter((f) => fs.readFileSync(f, 'utf8').includes('PERSONA_PROMPT'))
    .map(rel);
  const allowedPersona = new Set([
    'src/shared/persona.ts',
    'src/main/geminiService.ts',
    'tests/geminiService.spec.ts',
  ]);
  const badPersona = personaFiles.filter((f) => !allowedPersona.has(f));
  if (badPersona.length) {
    console.log(`✗ PERSONA_PROMPT in unexpected files: ${badPersona.join(', ')}`);
    ok = false;
  } else {
    console.log('✓ PERSONA_PROMPT only in persona.ts, geminiService.ts, tests');
  }

  const rendererDir = path.join(root, 'src/renderer');
  const rawKeyHits = walkTs(rendererDir)
    .flatMap((f) => {
      const lines = fs.readFileSync(f, 'utf8').split('\n');
      return lines
        .map((line, i) => ({ line, i, file: rel(f) }))
        .filter(({ line }) => line.includes('apiKey'))
        .filter(
          ({ line }) =>
            !line.includes('getApiKey') &&
            !line.includes('apiKey.present') &&
            !line.includes('apiKeyPresent') &&
            !line.includes('HasApiKey') &&
            !line.includes('no-api-key') &&
            !line.includes('ApiKeyPresence') &&
            !line.includes('setApiKey') &&
            !/apiKey, harnessMeta/.test(line),
        );
    })
    .map(({ file, i, line }) => `${file}:${i + 1}: ${line.trim()}`);
  if (rawKeyHits.length) {
    console.log('✗ Possible raw API key usage in renderer:\n', rawKeyHits.join('\n'));
    ok = false;
  } else {
    console.log('✓ Renderer uses masked getApiKey / present flag only');
  }

  return ok;
}

function auditSharp() {
  try {
    execSync('node -e "require(\'sharp\')"', { cwd: root, stdio: 'pipe' });
    console.log('✓ sharp loads on this machine');
    return true;
  } catch {
    console.log('✗ sharp failed — run: npm install --os=darwin --cpu=arm64 sharp');
    return false;
  }
}

function auditLogs() {
  const today = new Date().toISOString().slice(0, 10);
  const logPath = path.join(root, 'logs', `app-${today}.jsonl`);
  if (!fs.existsSync(logPath)) {
    console.log(`\n⚠ No log file yet: ${logPath}`);
    console.log('  Run npm run dev, exercise the app, then re-run with --logs');
    return false;
  }

  const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
  const events = lines.map((l) => {
    try {
      return JSON.parse(l).msg ?? JSON.parse(l).message;
    } catch {
      return null;
    }
  });

  const want = {
    chunk1: ['app.ready', 'renderer.ready', 'app.quit'],
    chunk2: ['widget.shown', 'widget.click', 'widget.menuAction', 'widget.positionPersisted'],
    chunk2Perms: (e) => String(e).startsWith('perms.screen'),
    chunk3: ['capture.intervalChanged', 'capture.permissionLost', 'migration.captureAutoCapture'],
    chunk4: ['harness.loaded', 'harness.reloaded', 'harness.empty'],
    chunk5: ['gemini.callStarted', 'gemini.callCompleted', 'ai.apiKeyUpdated', 'chat.messageSent'],
  };

  const has = (name) => events.some((e) => e === name);
  const hasPrefix = (pred) => events.some(pred);

  console.log(`\n▶ Log audit (${logPath}, ${lines.length} lines)`);

  const report = (label, ok) => console.log(`${ok ? '✓' : '○'} ${label}`);

  report('Chunk 1: app.ready', has('app.ready'));
  report('Chunk 1: renderer.ready', has('renderer.ready'));
  report('Chunk 1: app.quit', has('app.quit'));
  report('Chunk 2: widget.shown', has('widget.shown'));
  report('Chunk 2: widget.click', has('widget.click'));
  report('Chunk 2: widget.menuAction', has('widget.menuAction'));
  report('Chunk 2: widget.positionPersisted', has('widget.positionPersisted'));
  report('Chunk 2: perms.screen.*', hasPrefix(want.chunk2Perms));
  report('Chunk 3: capture.* (any)', events.some((e) => String(e).startsWith('capture.')));
  report('Chunk 4: harness.loaded', has('harness.loaded'));
  report('Chunk 5: gemini.callStarted', has('gemini.callStarted'));
  report('Chunk 5: gemini.callCompleted', has('gemini.callCompleted'));
  report('Chunk 5: ai.apiKeyUpdated', has('ai.apiKeyUpdated'));

  return true;
}

function nodeVersionNote() {
  const v = process.version;
  const major = Number(v.slice(1).split('.')[0]);
  if (major !== 20) {
    console.log(
      `\n⚠ Node is ${v}; project pins Node 20 (.nvmrc). Prefer: nvm use && npm install`,
    );
  }
}

// --- main ---
console.log('Arch Public AI Overlay — Mac acceptance (automated)\n');
nodeVersionNote();

const results = [];
results.push(auditSharp());
results.push(auditPreload());
results.push(auditGrep());
results.push(run('npm run typecheck', 'typecheck'));
results.push(run('npm run lint', 'lint'));
results.push(run('npm test', 'vitest'));
results.push(run('npm run build', 'build'));

if (process.argv.includes('--logs')) {
  auditLogs();
}

const failed = results.filter((r) => !r).length;
console.log(
  failed
    ? `\n${failed} automated check(s) failed. Fix before manual acceptance.`
    : '\nAutomated checks passed. Next: npm run dev — then work through MAC_ACCEPTANCE.md',
);
process.exit(failed ? 1 : 0);
