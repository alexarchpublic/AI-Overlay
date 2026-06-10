/**
 * @file src/shared/firewall/forwardSuggestion.ts
 *
 * Distinguishes forward recommendations ("try ~1.5× ATR") from internal-value
 * disclosure ("the default is 1.5") per PRD §5.5a / §1.1.
 */

const FORWARD_MARKERS = [
  /\btry\b/i,
  /\bsuggest(?:ed|ing|ion)?\b/i,
  /\bset\s+(?:it\s+)?to\b/i,
  /\bconsider\b/i,
  /\bexperiment\s+with\b/i,
  /\b(?:you\s+could|I'd|I would)\s+(?:try|use|set)\b/i,
  /\bforward[- ]looking\b/i,
  /\bon your chart\b/i,
  /\bto\s+try\b/i,
  /~\s*[\d.]/,
  /\b\d+(?:\.\d+)?\s*[–-]\s*\d+(?:\.\d+)?\s*(?:×|x|ATR|%)/i,
];

const LOOKBACK_CHARS = 96;

/**
 * True when text before `matchIndex` reads as a forward recommendation, so
 * value-disclosure-shaped regexes should not fire (§5.5a permit path).
 */
export function isForwardRecommendationContext(text: string, matchIndex: number): boolean {
  const start = Math.max(0, matchIndex - LOOKBACK_CHARS);
  const window = text.slice(start, matchIndex + 48);
  return FORWARD_MARKERS.some((re) => re.test(window));
}
