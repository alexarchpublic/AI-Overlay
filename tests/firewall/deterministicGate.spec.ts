/**
 * @file tests/firewall/deterministicGate.spec.ts
 * Phase 0 task 5 — deterministic gate blocks disclosure; permits forward suggestions (PRD §10).
 */

import { describe, it, expect } from 'vitest';
import {
  inspectFirewallText,
  inspectAnalysisResponse,
  serializeAnalysisForInspection,
  rewriteBlockedAnalysisResponse,
  redactLogSnippet,
} from '../../src/shared/firewall/deterministicGate';
import type { AnalysisResponse } from '../../src/shared/types';
import type { DeepFingerprintManifest } from '../../src/shared/firewall/deepFingerprints';
import { extractDeepSpansFromSource } from '../../src/shared/firewall/deepFingerprints';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const CLEAN_RESPONSE: AnalysisResponse = {
  schema_version: '2',
  analysis:
    'Volatility is elevated on your chart. Try tightening the stop to ~1.5× ATR and re-screenshot after you apply it.',
  suggested_parameter_changes: [
    {
      parameter: 'volatility_filter',
      direction: 'increase',
      suggested_value: '1.4–1.6× ATR',
      chart_context: 'Wide envelopes on the last three sessions visible in your screenshot.',
      rationale: 'Higher filter reduces churn when ATR is expanded.',
    },
  ],
  confidence_score: 0.72,
  risk_notes: 'If liquidity thins, widen again.',
};

describe('inspectFirewallText', () => {
  it('allows forward suggestions and chart-grounded advice', () => {
    expect(
      inspectFirewallText(
        'Given the volatility you are showing, try setting the stop to ~1.5× ATR on your chart.',
      ).action,
    ).toBe('allow');
    expect(inspectFirewallText(CLEAN_RESPONSE.analysis).action).toBe('allow');
  });

  it('blocks code fences and path:line citations', () => {
    const fence = inspectFirewallText('Here:\n```\nlong x = 1;\n```');
    expect(fence.action).toBe('block');
    expect(fence.hits.some((h) => h.rule === 'code-fence')).toBe(true);

    const pathLine = inspectFirewallText('See algorithm source code/foo.txt:42 for details.');
    expect(pathLine.action).toBe('block');
    expect(pathLine.hits.some((h) => h.rule === 'path-line')).toBe(true);
  });

  it('blocks internal value disclosure framing', () => {
    const r = inspectFirewallText('The current value is 2.0 for the stop.');
    expect(r.action).toBe('block');
    expect(r.hits.some((h) => h.rule === 'value-disclosure')).toBe(true);
  });

  it('does not permit disclosure even when try appears earlier in the sentence', () => {
    const r = inspectFirewallText('Try this, but the default value is 2.0 internally.');
    expect(r.action).toBe('block');
  });

  it('blocks algorithm-uses disclosure', () => {
    const r = inspectFirewallText('The algorithm uses 2.0 for exits.');
    expect(r.action).toBe('block');
    expect(r.hits.some((h) => h.rule === 'algo-uses')).toBe(true);
  });

  it('blocks disclosure with zero-width characters between tokens (fuzz)', () => {
    const r = inspectFirewallText('The default\u200b value is 2.0 for the envelope.');
    expect(r.action).toBe('block');
    expect(r.hits.some((h) => h.rule === 'value-disclosure')).toBe(true);
  });

  it('blocks secret-shaped strings', () => {
    const r = inspectFirewallText('Key: sk-abcdefghijklmnopqrstuvwxyz123456');
    expect(r.action).toBe('block');
    expect(r.hits.some((h) => h.rule === 'secret-shaped')).toBe(true);
  });

  it('blocks verbatim deep-tier spans when fingerprints are provided', () => {
    const pinePath = path.join(
      process.cwd(),
      'arch-public-harness',
      'algorithm source code',
      'Market Wave Pine Script.txt',
    );
    const raw = readFileSync(pinePath, 'utf8');
    const spans = extractDeepSpansFromSource(raw);
    expect(spans.length).toBeGreaterThan(0);
    const manifest: DeepFingerprintManifest = {
      schemaVersion: 1,
      builtAt: new Date().toISOString(),
      spans,
    };
    const leak = spans[0];
    const r = inspectFirewallText(`The model said: ${leak}`, { deepFingerprints: manifest });
    expect(r.action).toBe('block');
    expect(r.hits.some((h) => h.rule === 'deep-verbatim')).toBe(true);
  });
});

describe('inspectAnalysisResponse', () => {
  it('allows clean schema v2 payloads', () => {
    expect(inspectAnalysisResponse(CLEAN_RESPONSE).action).toBe('allow');
  });

  it('blocks leakage embedded in structured fields', () => {
    const toxic: AnalysisResponse = {
      ...CLEAN_RESPONSE,
      suggested_parameter_changes: [
        {
          ...CLEAN_RESPONSE.suggested_parameter_changes[0],
          chart_context: 'The algorithm uses 2.0 for the envelope.',
        },
      ],
    };
    const r = inspectAnalysisResponse(toxic);
    expect(r.action).toBe('block');
  });

  it('rewrite produces safe copy without leaking fields', () => {
    const toxic: AnalysisResponse = {
      ...CLEAN_RESPONSE,
      analysis: 'The default value is 2.0× ATR.',
    };
    const verdict = inspectAnalysisResponse(toxic);
    const safe = rewriteBlockedAnalysisResponse(toxic, verdict.hits);
    expect(inspectAnalysisResponse(safe).action).toBe('allow');
    expect(safe.suggested_parameter_changes).toHaveLength(0);
  });
});

describe('serializeAnalysisForInspection', () => {
  it('includes all structured fields in the inspected blob', () => {
    const blob = serializeAnalysisForInspection(CLEAN_RESPONSE);
    expect(blob).toContain('volatility_filter');
    expect(blob).toContain('1.4–1.6× ATR');
  });
});

describe('redactLogSnippet', () => {
  it('redacts blocked snippets for logging', () => {
    expect(redactLogSnippet('The algorithm uses 2.0 for exits.')).toMatch(/firewall-redacted/);
    expect(redactLogSnippet('Try ~1.5× ATR on your chart.')).toBe('Try ~1.5× ATR on your chart.');
  });
});
