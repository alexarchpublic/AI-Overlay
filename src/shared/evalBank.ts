/**
 * @file src/shared/evalBank.ts
 *
 * Phase 6 eval bank — 20 call-scenario definitions with must-hit content
 * groups (EXECUTION_PLAN §Phase 6). Used by offline corpus tests and the
 * live `npm run eval:bank` runner.
 */
import type { ActiveAlgorithm } from './knowledgeTypes';

/** One eval scenario: user message + grounding expectations. */
export interface EvalScenario {
  id: number;
  prompt: string;
  /** Persisted algorithm picker value for prompt composition (D-P10). */
  activeAlgorithm?: ActiveAlgorithm;
  /**
   * Must-hit groups: at least one term from each inner array must appear in
   * the checked text (corpus injection for offline; full response for live).
   */
  mustHitGroups: readonly (readonly string[])[];
  /** Parameter labels the live response should mention when suggestions exist. */
  suggestParamHints?: readonly string[];
}

/** Phrases that indicate a performance promise (compliance violation). */
export const PERFORMANCE_PROMISE_PATTERNS: readonly RegExp[] = [
  /\bguarantee(d|s)?\b/i,
  /\bwill (?:make|earn|return|profit)\b/i,
  /\bcertain(?:ly)? (?:profit|return|gain)\b/i,
  /\b(?:always|never) (?:win|lose|profit)\b/i,
  /\b\d+\s*%\s*(?:return|gain|profit|ROI)\b/i,
];

/** PRD §6.2 corpus spot-check strings (Market Wave guide). */
export const CORPUS_SPOT_CHECKS: readonly string[] = [
  '$5 minimum',
  'three calendar days',
  'edge',
  'Input Reference Guide',
];

/** All 20 Phase 6 eval scenarios. */
export const EVAL_SCENARIOS: readonly EvalScenario[] = [
  {
    id: 1,
    prompt: 'Client wants fewer trades during chop',
    mustHitGroups: [
      ['sell buffer', 'buy buffer', 'buffer'],
      ['scope', 'threshold'],
    ],
    suggestParamHints: ['Buffer', 'Scope', 'Threshold'],
  },
  {
    id: 2,
    prompt: 'Client wants to deploy cash faster',
    mustHitGroups: [
      ['long threshold', 'entry'],
      ['buffer'],
    ],
    suggestParamHints: ['Long Threshold', 'Entry'],
  },
  {
    id: 3,
    prompt: "Client's algo hasn't traded in weeks — Trend Filter on, Scope 0.5",
    mustHitGroups: [
      ['trend filter'],
      ['scope'],
      ['reversal', 'candle', 'wave'],
    ],
    suggestParamHints: ['Scope', 'Trend Filter', 'Buffer'],
  },
  {
    id: 4,
    prompt: 'Client is 100% cash with Percentage sizing — why no sells?',
    mustHitGroups: [
      ['percentage', 'percent'],
      ['crypto', 'available'],
      ['sell'],
    ],
  },
  {
    id: 5,
    prompt: 'Fixed $1,000 buy but only $500 cash left — what fires?',
    mustHitGroups: [
      ['auto-sized last trade', 'auto sized last trade', 'last trade'],
      ['500', 'cash'],
      ['fee', 'slippage', 'headroom'],
    ],
  },
  {
    id: 6,
    prompt: 'What do both Fixed + Percentage checked do?',
    mustHitGroups: [
      ['percentage'],
      ['fixed'],
      ['floor', 'minimum', '$5', '5 minimum'],
    ],
  },
  {
    id: 7,
    prompt: 'Client wants to never sell below $100K',
    mustHitGroups: [
      ['market price filter', 'price filter'],
      ['only sell above', '100'],
    ],
    suggestParamHints: ['Market Price Filter', 'Only Sell Above'],
  },
  {
    id: 8,
    prompt: 'Client scared of catching a falling knife',
    mustHitGroups: [
      ['trend filter'],
      ['change of trend', 'trend change', 'green candle'],
    ],
    suggestParamHints: ['Trend Filter'],
  },
  {
    id: 9,
    prompt: "Explain Scope like I'm the client",
    mustHitGroups: [
      ['scope'],
      ['micro', 'macro', 'fast', 'smooth'],
      ['cycle', 'timeframe'],
    ],
  },
  {
    id: 10,
    prompt: 'Client set -5/-5 buffers on a 15-minute chart',
    mustHitGroups: [
      ['edge', 'flip', 'cross'],
      ['buffer'],
      ['15', 'minute', 'timeframe'],
    ],
  },
  {
    id: 11,
    prompt: 'Same buffer % on 4H vs Daily — same effect?',
    mustHitGroups: [
      ['buffer'],
      ['timeframe', '4h', 'daily', 'hour'],
      ['narrow', 'sensitive', 'different', 'not the same'],
    ],
  },
  {
    id: 12,
    prompt: "Client's backtest report numbers look wrong",
    mustHitGroups: [
      ['initial capital', 'starting cash'],
      ['strategy report', 'properties', 'inputs'],
    ],
  },
  {
    id: 13,
    prompt: 'Client starts with 2 BTC — how does the algo know?',
    mustHitGroups: [
      ['starting crypto', 'crypto quantity'],
      ['seed', '3', 'calendar'],
    ],
  },
  {
    id: 14,
    prompt: "What's the minimum trade size?",
    mustHitGroups: [
      ['$5', '5 minimum', 'minimum trade'],
      ['gemini', 'exchange', '10'],
    ],
  },
  {
    id: 15,
    prompt: 'Client asks "what Scope should I use?"',
    mustHitGroups: [
      ['scope'],
      ['objective', 'timeframe', 'trade-off', 'depends'],
    ],
  },
  {
    id: 16,
    prompt: 'TradingView shows a look-ahead caution banner',
    mustHitGroups: [
      ['look-ahead', 'lookahead', 'look ahead'],
      ['market wave', 'dismiss'],
    ],
  },
  {
    id: 17,
    prompt: 'Trade fired on TradingView but not on the exchange',
    mustHitGroups: [
      ['currency', 'pair', 'funding'],
      ['exchange', 'webhook', 'mismatch'],
    ],
  },
  {
    id: 18,
    prompt: 'Client wants more sells, buys unchanged',
    mustHitGroups: [
      ['sell buffer', 'exit threshold'],
      ['sell'],
    ],
    suggestParamHints: ['Sell Buffer', 'Exit Threshold'],
  },
  {
    id: 19,
    prompt: 'Exchange balance drifted from what the algo shows',
    mustHitGroups: [
      ['internally', 'internal', 'tracks'],
      ['deposit', 'withdrawal', 'drift'],
      ['fee', 'slippage', 'reconcile'],
    ],
  },
  {
    id: 20,
    prompt: "Read the client's current settings off the latest screenshot",
    mustHitGroups: [
      ['input', 'setting', 'screenshot'],
      ['current', 'value', 'visible'],
    ],
  },
];

/** Normalize text for substring / regex checks. */
export function normalizeEvalText(text: string): string {
  return text.toLowerCase();
}

/** True when at least one term from each must-hit group appears in `text`. */
export function matchesMustHitGroups(
  text: string,
  groups: readonly (readonly string[])[],
): { ok: boolean; missing: string[][] } {
  const hay = normalizeEvalText(text);
  const missing: string[][] = [];

  for (const group of groups) {
    const hit = group.some((term) => hay.includes(term.toLowerCase()));
    if (!hit) missing.push([...group]);
  }

  return { ok: missing.length === 0, missing };
}

/** Detect performance-promise language in talk track or analysis. */
export function findPerformancePromises(text: string): string[] {
  const hits: string[] = [];
  for (const pattern of PERFORMANCE_PROMISE_PATTERNS) {
    const match = text.match(pattern);
    if (match) hits.push(match[0]);
  }
  return hits;
}

/** Compute p50 / p95 from latency samples (milliseconds). Matches aiStore.percentile. */
export function latencyPercentiles(samples: readonly number[]): {
  p50: number;
  p95: number;
} {
  if (samples.length === 0) return { p50: 0, p95: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p: number) => {
    const idx = Math.min(
      sorted.length - 1,
      Math.max(0, Math.floor((p / 100) * sorted.length)),
    );
    return sorted[idx] ?? 0;
  };
  return { p50: at(50), p95: at(95) };
}
