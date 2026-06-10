/**
 * @file tests/redteam/redteamSmoke.spec.ts
 *
 * Phase 0 task 8 — red-team smoke suite (scripted) against OWASP LLM02 / LLM07.
 * Manual-live cases are cataloged in `cases.ts` and exercised per RED_TEAM.md.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { inspectFirewallText } from '../../src/shared/firewall/deterministicGate';
import { PERSONA_PROMPT } from '../../src/shared/persona';
import { OUTPUT_GATE_CASES } from './cases';

const LEGACY_LEAKAGE_PHRASES = [
  /actual source code/i,
  /grounding your response in the actual source/i,
  /path:line/i,
  /cite harness files/i,
  /preserve parameter values/i,
];

describe('red-team smoke — output gate (OWASP LLM02 / LLM07)', () => {
  it('defines at least one scripted case per OWASP category', () => {
    const llm02 = OUTPUT_GATE_CASES.filter((c) => c.owasp === 'LLM02');
    const llm07 = OUTPUT_GATE_CASES.filter((c) => c.owasp === 'LLM07');
    expect(llm02.length).toBeGreaterThanOrEqual(8);
    expect(llm07.length).toBeGreaterThanOrEqual(3);
  });

  it.each(OUTPUT_GATE_CASES.map((c) => [c.id, c] as const))(
    '%s — %s',
    (_id, c) => {
      const verdict = inspectFirewallText(c.payload);
      expect(verdict.action, `${c.technique}: ${c.payload.slice(0, 80)}`).toBe(c.expected);
      if (c.expected === 'block') {
        expect(verdict.hits.length).toBeGreaterThan(0);
      } else {
        expect(verdict.hits).toEqual([]);
      }
    },
  );
});

describe('red-team smoke — structural LLM07 defenses', () => {
  it('persona states zero-leakage and forbids legacy source-grounding mandates (A1)', () => {
    expect(PERSONA_PROMPT).toMatch(/zero-leakage boundary/i);
    expect(PERSONA_PROMPT).toMatch(/never reveal raw source code/i);
    for (const re of LEGACY_LEAKAGE_PHRASES) {
      expect(PERSONA_PROMPT).not.toMatch(re);
    }
  });

  it('geminiService summarize prompt does not preserve proprietary parameter values (A3)', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'src/main/geminiService.ts'),
      'utf8',
    );
    const summarizeBlock = source.slice(
      source.indexOf('async function summarize'),
      source.indexOf('async function summarize') + 2_500,
    );
    expect(summarizeBlock).toMatch(/Never state or/i);
    expect(summarizeBlock).not.toMatch(/preserve parameter values/i);
    expect(summarizeBlock).toMatch(/inspectFirewallText/);
  });

  it('live serving path has no harness full-bundle injection (LLM07 context exfil)', () => {
    const gemini = readFileSync(
      path.join(process.cwd(), 'src/main/geminiService.ts'),
      'utf8',
    );
    expect(gemini.includes('getHarness')).toBe(false);
    expect(gemini.includes('HARNESS_ENVELOPE_OPENER')).toBe(false);
  });
});
