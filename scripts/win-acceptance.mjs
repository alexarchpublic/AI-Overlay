#!/usr/bin/env node
/**
 * Operator Windows acceptance — automated slice + log / grep audits.
 *
 * Usage:
 *   node scripts/win-acceptance.mjs           # automated checks only
 *   node scripts/win-acceptance.mjs --logs    # also audit today's app log
 *
 * Manual GUI steps (install, Zoom/Teams, picker, Gemini, update loop) still
 * require a real Windows machine; see WIN_ACCEPTANCE.md.
 *
 * Unlike mac-acceptance.mjs this script never shells out to `git grep` and
 * never hardcodes a darwin sharp install — use execFileSync + arg arrays and
 * the win32 sharp optionalDependencies (Chunk 7 task 6.2 / B24).
 */

import { execFileSync } from 'node:child_process';
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
  'chat',
  'knowledge',
  'ai',
  'app',
  'updates',
]);

const PLATFORM_PROCESS_EXEMPT = new Set([
  'src/main/platform.ts',
  'src/main/logger.ts',
  'src/main/bootstrap.ts',
  'src/main/permissions.ts',
]);

function npmBin() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function runNpm(script, label) {
  process.stdout.write(`\n▶ ${label}\n`);
  try {
    execFileSync(npmBin(), ['run', script], {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
    });
    return true;
  } catch {
    process.stdout.write(`✗ FAILED: ${label}\n`);
    return false;
  }
}

function rel(p) {
  return path.relative(root, p).replace(/\\/g, '/');
}

function walkTs(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkTs(p, acc);
    else if (/\.tsx?$/.test(ent.name)) acc.push(p);
  }
  return acc;
}

function walkFiles(dirs, pred) {
  const out = [];
  for (const dir of dirs) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    const stack = [abs];
    while (stack.length) {
      const cur = stack.pop();
      for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
        const p = path.join(cur, ent.name);
        if (ent.isDirectory()) {
          if (ent.name === 'node_modules' || ent.name === 'dist' || ent.name === 'release') continue;
          stack.push(p);
        } else if (pred(p, ent.name)) {
          out.push(p);
        }
      }
    }
  }
  return out;
}

function auditPreload() {
  const preload = fs.readFileSync(path.join(root, 'src/preload/index.ts'), 'utf8');
  const apiBlock = preload.match(/const api = \{([\s\S]*?)\} as const;/);
  if (!apiBlock) {
    console.log('✗ Could not parse preload api object');
    return false;
  }
  const keys = [...apiBlock[1].matchAll(/^\s{2}(\w+)(?:,|:)/gm)].map((m) => m[1]);
  const extra = keys.filter((k) => !ALLOWED_API_KEYS.has(k));
  const missing = [...ALLOWED_API_KEYS].filter((k) => !keys.includes(k));
  if (extra.length) {
    console.log(`✗ Unexpected window.api namespaces: ${extra.join(', ')}`);
    return false;
  }
  if (missing.length) {
    console.log(`✗ Missing window.api namespaces: ${missing.join(', ')}`);
    return false;
  }
  console.log(`✓ Preload IPC namespaces: ${keys.join(', ')}`);
  return true;
}

function auditGrep() {
  let ok = true;

  const genaiFiles = walkTs(path.join(root, 'src'))
    .concat(walkTs(path.join(root, 'tests')))
    .filter((f) => fs.readFileSync(f, 'utf8').includes('new GoogleGenerativeAI'))
    .map(rel);
  if (genaiFiles.length !== 1 || genaiFiles[0] !== 'src/main/geminiService.ts') {
    console.log(
      `✗ GoogleGenerativeAI must only be in geminiService.ts; found: ${genaiFiles.join(', ') || '(none)'}`,
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
        .filter(({ line }) => {
          // Allow presence flags / bridge calls — not raw key material in UI state.
          if (line.includes('getApiKey')) return false;
          if (line.includes('apiKey.present')) return false;
          if (line.includes('apiKeyPresent')) return false;
          if (line.includes('HasApiKey')) return false;
          if (line.includes('hasApiKey')) return false;
          if (line.includes('no-api-key')) return false;
          if (line.includes('ApiKeyPresence')) return false;
          if (line.includes('setApiKey')) return false;
          if (line.includes('setHasApiKey')) return false;
          if (/apiKey, harnessMeta/.test(line)) return false;
          // Destructuring binding from getApiKey() → { present } object
          if (/,\s*apiKey\s*,/.test(line)) return false;
          return true;
        });
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

function auditPivotGrep() {
  let ok = true;
  const patterns = [
    [/firewall|enumerationmonitor|d3pass|deep-fingerprints/i, 'security-harness remnants'],
    [/SCHEMA_V2/, 'leakage-era schema symbols'],
  ];
  // Product code only — skip acceptance scripts (they embed the patterns as
  // needles) and scripts/.cache (stale pipeline artifacts).
  const files = walkFiles(['src', 'tests'], (p, name) => /\.(ts|tsx|mjs|js)$/.test(name)).concat(
    walkFiles(['scripts'], (p, name) => {
      if (name.endsWith('-acceptance.mjs')) return false;
      if (p.includes(`${path.sep}.cache${path.sep}`)) return false;
      return /\.(ts|tsx|mjs|js)$/.test(name);
    }),
  );
  for (const [re, label] of patterns) {
    const hits = [];
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      if (re.test(text)) hits.push(rel(f));
    }
    if (hits.length) {
      console.log(`✗ Pivot grep contract failed (${label}): ${hits.join(', ')}`);
      ok = false;
    } else {
      console.log(`✓ Pivot grep contract clean (${label})`);
    }
  }
  return ok;
}

/** Chunk 7 §3.8 grep contracts — file walk, no `git grep` shell. */
function auditChunk7Contracts() {
  let ok = true;
  const srcFiles = walkTs(path.join(root, 'src'));

  const platformHits = [];
  for (const f of srcFiles) {
    const r = rel(f);
    if (PLATFORM_PROCESS_EXEMPT.has(r)) continue;
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (line.includes('process.platform')) {
        platformHits.push(`${r}:${i + 1}`);
      }
    });
  }
  if (platformHits.length) {
    console.log(
      `✗ process.platform outside exempt files:\n  ${platformHits.join('\n  ')}`,
    );
    ok = false;
  } else {
    console.log('✓ process.platform branching confined to platform.ts (+ pass-through exempts)');
  }

  const versionHits = [];
  for (const f of srcFiles) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/APP_VERSION\s*=\s*'/.test(line)) versionHits.push(`${rel(f)}:${i + 1}`);
    });
  }
  if (versionHits.length) {
    console.log(`✗ Hardcoded APP_VERSION string:\n  ${versionHits.join('\n  ')}`);
    ok = false;
  } else {
    console.log('✓ No hardcoded APP_VERSION string literal');
  }

  const secretLogHits = [];
  const logRe = /logger\.(info|warn|error|debug)\(.*(apiKey|geminiApiKey)/;
  for (const f of srcFiles) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (logRe.test(line)) secretLogHits.push(`${rel(f)}:${i + 1}`);
    });
  }
  if (secretLogHits.length) {
    console.log(`✗ Possible key material in log calls:\n  ${secretLogHits.join('\n  ')}`);
    ok = false;
  } else {
    console.log('✓ No apiKey/geminiApiKey in logger.* calls');
  }

  const tokenRe = /gh[pous]_[A-Za-z0-9]{20,}/;
  const tokenFiles = walkFiles(['src', 'scripts', 'build'], (p, name) => {
    if (name === '.DS_Store') return false;
    return true;
  });
  const tokenHits = [];
  for (const f of tokenFiles) {
    let text;
    try {
      text = fs.readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    if (tokenRe.test(text)) tokenHits.push(rel(f));
  }
  if (tokenHits.length) {
    console.log(`✗ Embedded GitHub token-like strings:\n  ${tokenHits.join('\n  ')}`);
    ok = false;
  } else {
    console.log('✓ No embedded gh*_ tokens in src/scripts/build');
  }

  const macOnlyApis = ['setVisibleOnAllWorkspaces', 'enableLargerThanScreen', 'roundedCorners'];
  for (const api of macOnlyApis) {
    for (const f of srcFiles) {
      const text = fs.readFileSync(f, 'utf8');
      if (!text.includes(api)) continue;
      if (!/\bisWindows\b|\bisMac\b/.test(text)) {
        console.log(`✗ ${api} in ${rel(f)} without isWindows/isMac in file — manual review`);
        ok = false;
      }
    }
  }
  console.log('✓ macOS-only window APIs co-located with isWindows/isMac guards (file-level)');

  return ok;
}

function auditSharp() {
  try {
    execFileSync(process.execPath, ['-e', "require('sharp')"], {
      cwd: root,
      stdio: 'pipe',
    });
    console.log(`✓ sharp loads on this machine (platform=${process.platform})`);
    return true;
  } catch {
    if (process.platform === 'win32') {
      console.log(
        '✗ sharp failed — run: npm install --os=win32 --cpu=x64 sharp',
      );
      console.log(
        '  (optionalDependencies @img/sharp-win32-x64 + @img/sharp-libvips-win32-x64 should resolve via npm ci)',
      );
    } else {
      console.log(
        `✗ sharp failed on ${process.platform} — install the platform-native binding; win acceptance is intended to run on Windows`,
      );
    }
    return false;
  }
}

function auditPlatformHint() {
  if (process.platform !== 'win32') {
    console.log(
      `\n⚠ Running on ${process.platform}; WIN_ACCEPTANCE.md manual phases require Windows 10/11 x64.`,
    );
  } else {
    console.log('✓ process.platform is win32');
  }
  return true;
}

function resolveUserDataLogPath() {
  const today = new Date().toISOString().slice(0, 10);
  const name = `app-${today}.jsonl`;
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    if (appData) {
      return path.join(appData, 'arch-public-ai-overlay', 'logs', name);
    }
  }
  // Dev / non-Windows fallback: repo-local logs (dev mode) then typical mac path
  const local = path.join(root, 'logs', name);
  if (fs.existsSync(local)) return local;
  if (process.platform === 'darwin') {
    return path.join(
      process.env.HOME ?? '',
      'Library',
      'Application Support',
      'arch-public-ai-overlay',
      'logs',
      name,
    );
  }
  return local;
}

function auditLogs() {
  const logPath = resolveUserDataLogPath();
  if (!fs.existsSync(logPath)) {
    console.log(`\n⚠ No log file yet: ${logPath}`);
    console.log('  Launch the packaged app or npm run dev, then re-run with --logs');
    return false;
  }

  const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
  const events = lines.map((l) => {
    try {
      const row = JSON.parse(l);
      return row.msg ?? row.message ?? row.event;
    } catch {
      return null;
    }
  });

  const has = (name) => events.some((e) => e === name);
  const hasPrefix = (prefix) => events.some((e) => String(e).startsWith(prefix));

  console.log(`\n▶ Log audit (${logPath}, ${lines.length} lines)`);
  const report = (label, passed) => console.log(`${passed ? '✓' : '○'} ${label}`);

  report('app.ready', has('app.ready'));
  report('renderer.ready', has('renderer.ready'));
  report('capture.*', hasPrefix('capture.'));
  report('gemini.callStarted (if chat exercised)', has('gemini.callStarted'));
  report('gemini.callCompleted (if chat exercised)', has('gemini.callCompleted'));
  report('provisioning.* or ai.apiKeyUpdated', hasPrefix('provisioning.') || has('ai.apiKeyUpdated'));
  report('update.* (if update checked)', hasPrefix('update.'));

  return true;
}

function nodeVersionNote() {
  const v = process.version;
  const major = Number(v.slice(1).split('.')[0]);
  if (major !== 20) {
    console.log(
      `\n⚠ Node is ${v}; project pins Node 20 (.nvmrc). Prefer Node 20 before packaging.`,
    );
  }
}

// --- main ---
console.log('Arch Public AI Overlay — Windows acceptance (automated)\n');
nodeVersionNote();
auditPlatformHint();

const results = [];
results.push(auditSharp());
results.push(auditPreload());
results.push(auditGrep());
results.push(auditPivotGrep());
results.push(auditChunk7Contracts());
results.push(runNpm('typecheck', 'typecheck'));
results.push(runNpm('lint', 'lint'));
results.push(runNpm('test', 'vitest'));
results.push(runNpm('build', 'build'));

if (process.argv.includes('--logs')) {
  auditLogs();
}

const failed = results.filter((r) => !r).length;
console.log(
  failed
    ? `\n${failed} automated check(s) failed. Fix before manual acceptance.`
    : '\nAutomated checks passed. Next: install the NSIS build and work through WIN_ACCEPTANCE.md Phases A–H.',
);
process.exit(failed ? 1 : 0);
