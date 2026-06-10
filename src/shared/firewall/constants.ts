/**
 * @file src/shared/firewall/constants.ts
 *
 * Firewall reminders and safe fallback copy (PRD §5.5a).
 */

/** Appended on one regeneration attempt when the deterministic gate blocks output. */
export const FIREWALL_RETRY_REMINDER =
  'Your previous response was blocked for a potential IP disclosure. Respond again with valid JSON only. ' +
  'Never include source code, file paths, path:line citations, formulas, or statements of the algorithm default/internal values. ' +
  'You may propose rounded values or ranges to TRY, grounded in the visible chart. Do not confirm or deny internal defaults.';

/** Shown when the gate blocks after retry — never surface raw model output (§5.5a). */
export const FIREWALL_BLOCKED_ANALYSIS =
  'I cannot share that detail in a form that meets our safety rules. ' +
  'Ask about regime or behavior on your chart, or request a concrete value to try on your settings — ' +
  'for example a stop width or filter range grounded in what you see.';

export const FIREWALL_BLOCKED_RISK_NOTES =
  'Response withheld: output matched a blocked disclosure pattern. Rephrase your question toward chart-visible behavior or forward tuning suggestions.';
