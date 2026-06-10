/**
 * @file src/shared/firewall/deterministicGate.ts
 *
 * Phase 0 semantic firewall — deterministic gate (PRD §5.5a). Exact-match regex
 * and deep-tier fingerprint checks; permits forward suggestions over disclosure.
 */

import type { AnalysisResponse } from '../types';
import { collectDisclosureHits } from './disclosureRules';
import { matchDeepFingerprints, type DeepFingerprintManifest } from './deepFingerprints';
import { isForwardRecommendationContext } from './forwardSuggestion';
import {
  FIREWALL_BLOCKED_ANALYSIS,
  FIREWALL_BLOCKED_RISK_NOTES,
} from './constants';
import type { FirewallHit, FirewallVerdict } from './types';
import { FORWARD_OVERRIDABLE_RULES } from './types';

export interface InspectFirewallOptions {
  deepFingerprints?: DeepFingerprintManifest | null;
}

/** Strip zero-width / format chars so fuzz obfuscation cannot evade disclosure regexes (PRD §10). */
function normalizeInspectionText(text: string): string {
  return text.replace(/[\u200B-\u200D\uFEFF]/g, '');
}

function isHardDisclosurePhrase(text: string, hit: FirewallHit): boolean {
  const index = hit.index ?? 0;
  const slice = text.slice(index, index + 96);
  return (
    /\b(?:value|setting|parameter)\s+is\b/i.test(slice) ||
    /\b(?:uses|defaults?\s+to|is\s+set\s+to)\s+[\d.~]/i.test(slice)
  );
}

function applyForwardPermits(text: string, hits: FirewallHit[]): FirewallHit[] {
  return hits.filter((hit) => {
    if (!FORWARD_OVERRIDABLE_RULES.has(hit.rule)) return true;
    if (isHardDisclosurePhrase(text, hit)) return true;
    const index = hit.index ?? 0;
    return !isForwardRecommendationContext(text, index);
  });
}

/** Inspect arbitrary model or memory text. */
export function inspectFirewallText(
  text: string,
  options?: InspectFirewallOptions,
): FirewallVerdict {
  const normalized = normalizeInspectionText(text);
  let hits = collectDisclosureHits(normalized);
  hits = applyForwardPermits(normalized, hits);
  const deepHit = matchDeepFingerprints(normalized, options?.deepFingerprints ?? null);
  if (deepHit) hits.push(deepHit);
  if (hits.length === 0) return { action: 'allow', hits: [] };
  return { action: 'block', hits };
}

/** Flatten structured output into one inspectable string (answer path). */
export function serializeAnalysisForInspection(response: AnalysisResponse): string {
  const parts: string[] = [response.analysis, response.risk_notes];
  for (const row of response.suggested_parameter_changes) {
    parts.push(
      row.parameter,
      row.direction,
      row.suggested_value,
      row.chart_context,
      row.rationale,
    );
  }
  return parts.join('\n');
}

export function inspectAnalysisResponse(
  response: AnalysisResponse,
  options?: InspectFirewallOptions,
): FirewallVerdict {
  return inspectFirewallText(serializeAnalysisForInspection(response), options);
}

/** Safe structured response when the gate blocks after retry (§5.5a — no raw leak). */
export function rewriteBlockedAnalysisResponse(
  response: AnalysisResponse,
  hits: readonly FirewallHit[],
): AnalysisResponse {
  return {
    schema_version: '2',
    analysis: FIREWALL_BLOCKED_ANALYSIS,
    suggested_parameter_changes: [],
    confidence_score: Math.min(response.confidence_score, 0.35),
    risk_notes: `${FIREWALL_BLOCKED_RISK_NOTES} (${hits.map((h) => h.rule).join(', ')})`,
  };
}

/**
 * Sanitize a log snippet — replace blocked spans with a placeholder so logs
 * cannot carry IP (PRD §5.8).
 */
export function sanitizeLogSnippet(text: string): FirewallVerdict {
  return inspectFirewallText(text);
}

export function redactLogSnippet(text: string, maxLen = 256): string {
  const verdict = sanitizeLogSnippet(text);
  if (verdict.action === 'allow') return text.slice(0, maxLen);
  return `[firewall-redacted:${verdict.hits.map((h) => h.rule).join(',')}]`;
}
