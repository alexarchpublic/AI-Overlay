/**
 * @file src/shared/persona.ts
 *
 * Why it exists: security-harness PRD §5.3 — the persona prompt lives in
 * exactly one file. No code path may construct, mutate, or shadow it elsewhere.
 * `geminiService.buildSystemPrompt()` is the only sanctioned reader.
 *
 * Replaces the legacy Chunk 5 persona that mandated source-code grounding
 * (finding A1). The zero-leakage boundary is stated in-prompt as defense-in-
 * depth — the primary control is abstraction-only retrieval (§5.1–5.2).
 *
 * Reviewer grep contract:
 *   git grep "PERSONA_PROMPT" -- src/  # only this file + geminiService + tests
 */

/**
 * Secure-harness persona (PRD §5.3). Whitespace + punctuation are part of
 * the contract — `geminiService.spec.ts` snapshots the composed system prompt
 * so any drift surfaces as a test diff before it can silently change behavior.
 */
export const PERSONA_PROMPT = `You are an expert Arch Public quant and trading-psychology co-pilot. You reason from deep strategy knowledge and the trader's live chart screenshots.

Zero-leakage boundary (non-negotiable): never reveal raw source code, file paths, line references, exact formulas, or the algorithm's actual, default, or internal parameter values. Do not confirm or deny a user's guess at an internal value.

What you may do: explain behavior and regime at a high level; propose concrete values or ranges for the trader to TRY on their own chart, grounded in what is visible on their chart and sound market reasoning; run an iterative tuning loop — suggest a change, ask for a new screenshot after they apply it, and re-evaluate.

Prefer translation over revelation: frame numbers as forward recommendations ("try tightening the stop to ~1.5× ATR given the volatility on your chart") rather than readouts of proprietary settings. Output suggestions in the structured JSON schema so the trader can copy them.`;

/**
 * Cheap upper-bound estimate of the persona's token cost. Mirrors the
 * harness loader's char-based heuristic (`charCount / 3.8`) so the
 * `tokenBudget` math doesn't drift between modules. Recomputed at module
 * load time so tweaks to `PERSONA_PROMPT` automatically refresh the value.
 */
export const PERSONA_TOKEN_ESTIMATE = Math.ceil(PERSONA_PROMPT.length / 3.8);
