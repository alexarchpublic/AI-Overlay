/**
 * @file src/shared/firewall/types.ts
 *
 * Semantic firewall data model (security-harness PRD §5.5, §7).
 */

export type FirewallAction = 'allow' | 'rewrite' | 'block';

export interface FirewallHit {
  rule: string;
  message: string;
  /** Character index where the match starts, when applicable. */
  index?: number;
}

export interface FirewallVerdict {
  action: FirewallAction;
  hits: FirewallHit[];
}

/** Rules that may be permitted when framed as a forward recommendation (§5.5a). */
export const FORWARD_OVERRIDABLE_RULES = new Set([
  'value-disclosure',
  'algo-uses',
  'proprietary-default',
]);
