/**
 * @file src/shared/knowledge/d3Validator.ts
 *
 * Deterministic PRD D-3 checks for servable-tier abstraction text at publish time.
 * Uses the same disclosure patterns as the runtime semantic firewall (§5.5a).
 */

import { collectDisclosureHits } from '../firewall/disclosureRules';
import type { D3ValidationHit, D3ValidationResult } from '../knowledgeTypes';

/** Validate a single abstraction body against PRD D-3 hard exclusions. */
export function validateD3(text: string): D3ValidationResult {
  const hits: D3ValidationHit[] = collectDisclosureHits(text).map((h) => ({
    rule: h.rule,
    message: h.message,
    ...(h.index !== undefined ? { index: h.index } : {}),
  }));
  return { ok: hits.length === 0, hits };
}

/** Exported for tests — rule ids that must fire on toxic fixtures. */
export { DISCLOSURE_RULE_IDS as D3_RULE_IDS } from '../firewall/disclosureRules';
