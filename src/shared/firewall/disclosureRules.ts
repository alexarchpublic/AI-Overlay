/**
 * @file src/shared/firewall/disclosureRules.ts
 *
 * Curated regex disclosure patterns shared by D-3 publish-time validation and
 * the runtime deterministic gate (PRD §5.5a).
 */

import type { FirewallHit } from './types';

export interface DisclosureRule {
  id: string;
  message: string;
  test: (text: string) => FirewallHit | null;
}

const CODE_FENCE = /```[\s\S]*?```/;

const PATH_LINE = /\b[\w./-]+\.(?:ts|tsx|js|py|txt|md|pine):\d+\b/i;

const FILE_PATH_SHAPED =
  /\b(?:src\/|algorithm source code\/|arch-public-harness\/|knowledge\/deep\/)[^\s,)]+/i;

const PINE_RECONSTRUCTABLE = /\b(strategy\.entry|ta\.sma|ta\.stdev|input\.float|@version=)\b/;

const INTERNAL_VALUE_DISCLOSURE =
  /\b(?:the\s+)?(?:current|default|actual|configured|internal)\s+(?:value|setting|parameter)\s+is\b/i;

const ALGO_USES_DISCLOSURE = /\bthe\s+algorithm\s+(?:uses|is\s+set\s+to|defaults?\s+to)\b/i;

const PROPRIETARY_DEFAULT_PHRASE = /\b(?:proprietary|factory)\s+default\b/i;

const API_KEY_SHAPED = /\b(?:sk-[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,})\b/;

/** Code-shaped prose without a markdown fence (defense-in-depth). */
const CODE_SHAPED =
  /\b(?:function\s+\w+|const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=|if\s*\([^)]{3,}\)\s*\{)/;

const EXACT_FORMULA =
  /\b(?:ta\.|strategy\.|input\.|math\.|array\.)\w+\s*\([^)]*\)/;

const GUESS_CONFIRMATION =
  /\b(?:yes|correct|that(?:'s| is) right)(?:,|\s).{0,40}\b(?:default|internal|actual|configured)\b/i;

const MATCHES_INTERNAL_SETTING =
  /\bmatches?\s+(?:the\s+)?(?:default|internal|proprietary|factory)\s+(?:value|setting)\b/i;

const INTERNAL_CONFIRM_DENY =
  /\b(?:confirm|deny)\s+(?:the\s+)?(?:default|internal|proprietary)\b/i;

export const DISCLOSURE_RULES: readonly DisclosureRule[] = [
  {
    id: 'code-fence',
    message: 'Code fences are forbidden in model output (§1.1).',
    test(text) {
      const m = CODE_FENCE.exec(text);
      return m ? { rule: 'code-fence', message: DISCLOSURE_RULES[0].message, index: m.index } : null;
    },
  },
  {
    id: 'code-shaped',
    message: 'Code-shaped spans are forbidden (§5.5a).',
    test(text) {
      const m = CODE_SHAPED.exec(text);
      return m ? { rule: 'code-shaped', message: DISCLOSURE_RULES[1].message, index: m.index } : null;
    },
  },
  {
    id: 'path-line',
    message: 'File path or path:line references are forbidden (G2).',
    test(text) {
      const m = PATH_LINE.exec(text);
      return m ? { rule: 'path-line', message: DISCLOSURE_RULES[2].message, index: m.index } : null;
    },
  },
  {
    id: 'file-path',
    message: 'Repository or harness path references are forbidden.',
    test(text) {
      const m = FILE_PATH_SHAPED.exec(text);
      return m ? { rule: 'file-path', message: DISCLOSURE_RULES[3].message, index: m.index } : null;
    },
  },
  {
    id: 'pine-source',
    message: 'Pine Script source constructs are forbidden — use behavioral language.',
    test(text) {
      const m = PINE_RECONSTRUCTABLE.exec(text);
      return m ? { rule: 'pine-source', message: DISCLOSURE_RULES[4].message, index: m.index } : null;
    },
  },
  {
    id: 'exact-formula',
    message: 'Exact formula expressions are forbidden (§1.1).',
    test(text) {
      const m = EXACT_FORMULA.exec(text);
      return m ? { rule: 'exact-formula', message: DISCLOSURE_RULES[5].message, index: m.index } : null;
    },
  },
  {
    id: 'value-disclosure',
    message: 'Internal/default value disclosure framing is forbidden (§1.1).',
    test(text) {
      const m = INTERNAL_VALUE_DISCLOSURE.exec(text);
      return m ? { rule: 'value-disclosure', message: DISCLOSURE_RULES[6].message, index: m.index } : null;
    },
  },
  {
    id: 'algo-uses',
    message: 'Statements that the algorithm uses a specific internal value are forbidden.',
    test(text) {
      const m = ALGO_USES_DISCLOSURE.exec(text);
      return m ? { rule: 'algo-uses', message: DISCLOSURE_RULES[7].message, index: m.index } : null;
    },
  },
  {
    id: 'proprietary-default',
    message: 'References to proprietary or factory defaults are forbidden.',
    test(text) {
      const m = PROPRIETARY_DEFAULT_PHRASE.exec(text);
      return m
        ? { rule: 'proprietary-default', message: DISCLOSURE_RULES[8].message, index: m.index }
        : null;
    },
  },
  {
    id: 'guess-confirmation',
    message: 'Confirming or denying internal/default values is forbidden (§6 D-13).',
    test(text) {
      const m = GUESS_CONFIRMATION.exec(text);
      return m ? { rule: 'guess-confirmation', message: DISCLOSURE_RULES[9].message, index: m.index } : null;
    },
  },
  {
    id: 'matches-internal-setting',
    message: 'Affirming that a value matches an internal setting is forbidden.',
    test(text) {
      const m = MATCHES_INTERNAL_SETTING.exec(text);
      return m
        ? { rule: 'matches-internal-setting', message: DISCLOSURE_RULES[10].message, index: m.index }
        : null;
    },
  },
  {
    id: 'internal-confirm-deny',
    message: 'Confirm/deny framing of proprietary internals is forbidden.',
    test(text) {
      const m = INTERNAL_CONFIRM_DENY.exec(text);
      return m
        ? { rule: 'internal-confirm-deny', message: DISCLOSURE_RULES[11].message, index: m.index }
        : null;
    },
  },
  {
    id: 'secret-shaped',
    message: 'Secret- or API-key-shaped strings are forbidden.',
    test(text) {
      const m = API_KEY_SHAPED.exec(text);
      return m ? { rule: 'secret-shaped', message: DISCLOSURE_RULES[12].message, index: m.index } : null;
    },
  },
];

export const DISCLOSURE_RULE_IDS = DISCLOSURE_RULES.map((r) => r.id);

/** Run all disclosure rules; optional rule filter for D-3-only subsets. */
export function collectDisclosureHits(
  text: string,
  options?: { ruleIds?: readonly string[] },
): FirewallHit[] {
  const allow = options?.ruleIds ? new Set(options.ruleIds) : null;
  const hits: FirewallHit[] = [];
  for (const rule of DISCLOSURE_RULES) {
    if (allow !== null && !allow.has(rule.id)) continue;
    const hit = rule.test(text);
    if (hit) hits.push(hit);
  }
  return hits;
}
