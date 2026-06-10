/**
 * @file src/main/tokenBudget.ts
 *
 * Why it exists: PRD §3.8 — pure-function home for the token-budget math.
 * `geminiService.send()` is the only sanctioned caller. Splitting this out
 * keeps the SDK wrapper thin and gives Vitest a tight surface to assert
 * boundary behavior (PRD §5 DoD #25 / §7 #22).
 *
 * Algorithm (PRD §3.8):
 *
 *   estimatedRequestTokens =
 *       PERSONA_TOKEN_ESTIMATE
 *     + knowledgeApproxTokens
 *     + historyTokens(history)
 *     + (PER_IMAGE_TOKEN_ESTIMATE * screenshotCount)
 *     + userTextTokens
 *     + OUTPUT_HEADROOM_TOKENS
 *
 *   if > SOFT_CEILING_TOKENS:
 *     drop oldest history pairs, log each drop
 *     drop oldest screenshots, log each drop
 *     fail with 'token-ceiling' if still over
 *   if > HARD_CEILING_TOKENS at any point:
 *     fail immediately
 *
 * The function is deliberately stateless — caller passes the trimmed
 * history + screenshot list to `geminiService.send()`; this module never
 * mutates either.
 */

import type { ChatTurn, Screenshot } from '../shared/types';
import {
  HARD_CEILING_TOKENS,
  OUTPUT_HEADROOM_TOKENS,
  PER_IMAGE_TOKEN_ESTIMATE,
  SOFT_CEILING_TOKENS,
} from '../shared/aiConstants';
import { PERSONA_TOKEN_ESTIMATE } from '../shared/persona';
import {
  estimateTokensFromChars,
} from '../shared/tokenEstimate';

export { estimateTokensFromChars };

/** Sum the per-turn text estimates. Both user and assistant text counted. */
export function historyTokens(history: readonly ChatTurn[]): number {
  let sum = 0;
  for (const t of history) {
    sum += estimateTokensFromChars(t.text.length);
  }
  return sum;
}

export interface FitInputs {
  /** Scoped servable-tier context size for this turn (Phase 0 task 3). */
  knowledgeApproxTokens: number;
  history: readonly ChatTurn[];
  screenshots: readonly Screenshot[];
  userText: string;
}

export interface FitResult {
  /** Whether the request fits under the soft ceiling AFTER trimming. */
  ok: boolean;
  /** History after oldest-first trimming. Always a prefix-anchored slice. */
  history: readonly ChatTurn[];
  /** Screenshots after oldest-first trimming. */
  screenshots: readonly Screenshot[];
  /** The estimated request size after trimming (or before, if `!ok`). */
  estimatedTokens: number;
  /** Per-trim record so the caller can emit `gemini.tokenBudgetTrim` lines. */
  trims: readonly TrimRecord[];
  /**
   * When `!ok`, which ceiling we tripped — `'soft'` means we trimmed all
   * the way down and the floor is still over the soft limit; `'hard'`
   * means the *initial* request was over the hard limit (no trim could
   * have rescued it).
   */
  ceilingHit?: 'soft' | 'hard';
  /** Concrete ceiling value that was tripped (for the error payload). */
  ceiling?: number;
}

export interface TrimRecord {
  /** What was dropped. */
  what: 'historyPair' | 'screenshot';
  /** Identifier for the dropped item — turn id or screenshot id. */
  id: string;
  /** Estimated tokens reclaimed by this drop. */
  reclaimedTokens: number;
  /** The estimated total AFTER the drop. */
  remainingEstimate: number;
}

/**
 * Run the budget pass. Pure / synchronous. Caller decides what to do with
 * the result — `geminiService.send()` reads `result.ok` to know whether to
 * proceed and uses `result.trims` to emit the structured log lines.
 *
 * Trim order:
 *   1. Drop oldest history PAIRS (user+assistant or user+system-summary).
 *   2. If still over, drop screenshots oldest-first.
 *
 * Pair-aware trimming preserves the user/assistant alternation Gemini
 * expects. If the oldest turn is unpaired (e.g., a single trailing user
 * turn from a cancelled previous call), it is dropped on its own.
 */
export function fit(inputs: FitInputs): FitResult {
  const baseFloor =
    PERSONA_TOKEN_ESTIMATE +
    inputs.knowledgeApproxTokens +
    OUTPUT_HEADROOM_TOKENS +
    estimateTokensFromChars(inputs.userText.length);

  let history = [...inputs.history];
  let screenshots = [...inputs.screenshots];
  const trims: TrimRecord[] = [];

  function currentEstimate(): number {
    return (
      baseFloor +
      historyTokens(history) +
      PER_IMAGE_TOKEN_ESTIMATE * screenshots.length
    );
  }

  // Hard ceiling check is performed against the INITIAL request — even
  // trimming everything trimmable cannot rescue it (the persona + knowledge +
  // user text + headroom are unconditionally part of the request).
  const initial = currentEstimate();
  if (initial > HARD_CEILING_TOKENS) {
    return {
      ok: false,
      history,
      screenshots,
      estimatedTokens: initial,
      trims,
      ceilingHit: 'hard',
      ceiling: HARD_CEILING_TOKENS,
    };
  }

  // Trim history (oldest-pair-first) until under the soft ceiling. The
  // `length > 0` guard makes `history[0]` non-undefined per TypeScript
  // (without noUncheckedIndexedAccess), so we read it directly.
  while (currentEstimate() > SOFT_CEILING_TOKENS && history.length > 0) {
    // Take the oldest turn(s). If the oldest is a `'user'` turn followed
    // by an assistant turn, treat them as a pair; otherwise drop the
    // single oldest turn on its own.
    const oldest = history[0];
    const next = history[1] as ChatTurn | undefined;
    const isPair =
      oldest.role === 'user' &&
      history.length > 1 &&
      (next?.role === 'assistant' || next?.role === 'system-summary');
    const drop = isPair ? history.slice(0, 2) : history.slice(0, 1);
    const reclaimed = historyTokens(drop);
    history = history.slice(drop.length);
    trims.push({
      what: 'historyPair',
      id: oldest.id,
      reclaimedTokens: reclaimed,
      remainingEstimate: currentEstimate(),
    });
  }

  // Then trim screenshots (oldest-first).
  while (currentEstimate() > SOFT_CEILING_TOKENS && screenshots.length > 0) {
    // `screenshots` is oldest-first by caller contract — index 0 is the
    // oldest. Caller composes `getRecent(N)` newest-first then reverses.
    const oldest = screenshots[0];
    screenshots = screenshots.slice(1);
    trims.push({
      what: 'screenshot',
      id: oldest.id,
      reclaimedTokens: PER_IMAGE_TOKEN_ESTIMATE,
      remainingEstimate: currentEstimate(),
    });
  }

  const final = currentEstimate();
  if (final > SOFT_CEILING_TOKENS) {
    return {
      ok: false,
      history,
      screenshots,
      estimatedTokens: final,
      trims,
      ceilingHit: 'soft',
      ceiling: SOFT_CEILING_TOKENS,
    };
  }

  return {
    ok: true,
    history,
    screenshots,
    estimatedTokens: final,
    trims,
  };
}
