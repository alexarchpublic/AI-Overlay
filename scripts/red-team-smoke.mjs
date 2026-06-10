#!/usr/bin/env node
/**
 * Phase 0 task 8 — red-team smoke runner (scripted + structural audits).
 *
 * Usage:
 *   node scripts/red-team-smoke.mjs           # scripted gate + structural checks
 *   node scripts/red-team-smoke.mjs --manual  # print manual-live case checklist
 *
 * Full live adversarial turns require npm run dev + API key — see RED_TEAM.md.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

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

function auditPersonaContract() {
  const personaPath = path.join(root, 'src/shared/persona.ts');
  const persona = fs.readFileSync(personaPath, 'utf8');
  const forbidden = [
    /actual source code/i,
    /grounding your response in the actual source/i,
    /path:line/i,
    /cite harness files/i,
  ];
  let ok = true;
  if (!/zero-leakage boundary/i.test(persona)) {
    console.log('✗ persona.ts missing zero-leakage boundary');
    ok = false;
  } else {
    console.log('✓ persona.ts states zero-leakage boundary');
  }
  for (const re of forbidden) {
    if (re.test(persona)) {
      console.log(`✗ persona.ts matches legacy leakage phrase: ${re}`);
      ok = false;
    }
  }
  if (ok) console.log('✓ persona.ts has no legacy A1 leakage phrases');
  return ok;
}

function auditSummarizerFirewall() {
  const gemini = fs.readFileSync(path.join(root, 'src/main/geminiService.ts'), 'utf8');
  let ok = true;
  if (/preserve parameter values/i.test(gemini)) {
    console.log('✗ geminiService summarize still says "preserve parameter values"');
    ok = false;
  } else {
    console.log('✓ summarizer prompt avoids preserving proprietary values');
  }
  if (!/inspectFirewallText/.test(gemini)) {
    console.log('✗ geminiService summarize missing memory-path firewall');
    ok = false;
  } else {
    console.log('✓ summarizer output passes deterministic gate');
  }
  return ok;
}

function printManualChecklist() {
  const casesPath = path.join(root, 'tests/redteam/cases.ts');
  const src = fs.readFileSync(casesPath, 'utf8');
  const manualBlock = src.slice(src.indexOf('export const MANUAL_LIVE_CASES'));
  const blocks = [
    ...manualBlock.matchAll(
      /\{\s*\n\s*id: '([^']+)',[\s\S]*?userPrompt:\s*(?:\n\s*)?'([^']+)'/g,
    ),
  ];
  console.log('\n▶ Manual-live red-team cases (RED_TEAM.md)\n');
  let i = 0;
  for (const [, id, prompt] of blocks) {
    i++;
    console.log(`${i}. [${id}]`);
    console.log(`   Prompt: ${prompt.slice(0, 120)}${prompt.length > 120 ? '…' : ''}`);
  }
  console.log(
    `\n${i} case(s) — run with npm run dev, API key in Settings, record pass/fail in RED_TEAM.md sign-off table.`,
  );
}

// --- main ---
console.log('Arch Public AI Overlay — red-team smoke (Phase 0 task 8)\n');

if (process.argv.includes('--manual')) {
  printManualChecklist();
  process.exit(0);
}

const results = [];
results.push(auditPersonaContract());
results.push(auditSummarizerFirewall());
results.push(
  run('npx vitest run tests/redteam/redteamSmoke.spec.ts', 'vitest red-team smoke'),
);

const failed = results.filter((r) => !r).length;
console.log(
  failed
    ? `\n${failed} red-team check(s) failed.`
    : '\nScripted red-team smoke passed. Next: node scripts/red-team-smoke.mjs --manual',
);
if (!failed) {
  console.log('Then complete live turns in RED_TEAM.md (requires Gemini API key).');
}
process.exit(failed ? 1 : 0);
