/**
 * @file src/shared/aiConstants.ts
 *
 * Why it exists: PRD §0 D2 / D8 / D9 / D12 / D20 / D21 / D22 — every Chunk 5
 * tunable lives in one place so reviewers can audit (and operators can
 * adjust) the behavior without spelunking through `geminiService.ts` or
 * `tokenBudget.ts`. Mirrors the discipline established by
 * `shared/constants.ts` (capture) and `shared/tokenEstimate.ts` (token math).
 */
import {
  CHARS_PER_TOKEN as TOKEN_CHARS_PER_TOKEN,
  PER_IMAGE_TOKEN_ESTIMATE as TOKEN_PER_IMAGE_ESTIMATE,
} from './tokenEstimate';

export { TOKEN_CHARS_PER_TOKEN as CHARS_PER_TOKEN };

// ---------------------------------------------------------------------------
// Models (PRD §0 D1 / D2 — Gemini 3 lineup)
// ---------------------------------------------------------------------------

/**
 * Default model used when `ai.model` is unset. PRD D-P8 — latency is a
 * top-line requirement for mid-call answers, so the default is the fastest
 * allowlisted Flash-class tier.
 *
 * If a stable (non-preview) Flash successor lands, flip the default here
 * and re-run the latency + JSON-mode reliability sweep before promoting.
 */
export const DEFAULT_MODEL = 'gemini-3.1-flash-lite-preview';

/**
 * Model picker allowlist (PRD D2). The settings UI surfaces these and main
 * rejects any value outside the list. Adding a model = updating this array
 * AND running the latency / JSON-mode sweep against the new default.
 *
 * Only conversational / vision models are included. The two image-generation
 * variants Google ships (`gemini-3.1-flash-image-preview` aka Nano Banana 2,
 * `gemini-3-pro-image-preview`) are **deliberately excluded** — this app
 * sends vision input and expects JSON text output, not image output, and
 * those models would produce malformed responses against `OUTPUT_SCHEMA`.
 */
export const MODEL_ALLOWLIST: readonly string[] = [
  // Fastest Flash-class (default): 1M / 64k context, lowest latency.
  'gemini-3.1-flash-lite-preview',
  // Mid-tier Flash: 1M / 64k context, faster + cheaper than Pro.
  'gemini-3-flash-preview',
  // Flagship: 1M / 64k context, best reasoning + vision quality.
  'gemini-3.1-pro-preview',
];

/**
 * Model used for the conversation-summary call (PRD D12). Hard-coded to
 * the cheapest tier — the summary is short, cheap, and never user-visible
 * verbatim, so paying for Pro tokens here is wasted spend.
 */
export const SUMMARY_MODEL = 'gemini-3.1-flash-lite-preview';

// ---------------------------------------------------------------------------
// Vision / image attachment (PRD §0 D9 / D10)
// ---------------------------------------------------------------------------

/** Number of most-recent screenshots auto-attached per turn (PRD D9). */
export const SCREENSHOTS_PER_TURN = 3;

/**
 * Per-image flat token budget used by `tokenBudget.ts` (PRD D22). Gemini
 * vision tokens are not exposed by the SDK at request build time, so we
 * use a conservative flat estimate. Tunable here without touching the
 * budget math.
 */
export const PER_IMAGE_TOKEN_ESTIMATE = TOKEN_PER_IMAGE_ESTIMATE;

// ---------------------------------------------------------------------------
// Conversation memory (PRD §0 D11 / D12)
// ---------------------------------------------------------------------------

/**
 * Soft history depth — keep the most recent `2 * KEEP_PAIRS` turns
 * verbatim. When exceeded the truncation path summarizes the OLDEST
 * `2 * KEEP_PAIRS` turns into a single `'system-summary'` turn.
 */
export const HISTORY_KEEP_PAIRS = 10;

/** Hard cap (PRD D12). Truncation runs once per send above this threshold. */
export const HISTORY_TRUNCATE_AT_PAIRS = 20;

/**
 * Output cap on the summary call so a runaway Flash response doesn't blow
 * the token budget on its own. ~1 KB of plain prose is plenty.
 */
export const SUMMARY_MAX_OUTPUT_TOKENS = 1_024;

// ---------------------------------------------------------------------------
// Token budget (PRD §0 D22)
// ---------------------------------------------------------------------------

/**
 * Soft ceiling on the estimated request size (PRD D-P8 — ~40k prompt budget
 * to protect prefill latency). Above this we trim history (oldest first)
 * then screenshots (oldest first) until the request fits.
 */
export const SOFT_CEILING_TOKENS = 40_000;

/**
 * Hard ceiling. Above this we fail with `<ChatError variant="token-ceiling" />`
 * BEFORE making the call. Kept well above the soft ceiling so a single
 * oversized knowledge block can still fail closed rather than hang.
 */
export const HARD_CEILING_TOKENS = 80_000;

/**
 * Reserved headroom for the response. Subtracted out implicitly by
 * `tokenBudget.fit()` — request + headroom must stay under the ceilings.
 */
export const OUTPUT_HEADROOM_TOKENS = 4_000;

// ---------------------------------------------------------------------------
// Network / latency (PRD §0 D20 / D21)
// ---------------------------------------------------------------------------

/** Per-call timeout (PRD D20). Aborts the in-flight Gemini request. */
export const GEMINI_TIMEOUT_MS = 30_000;

/** Backoff before the single auto-retry on transient errors (PRD D21). */
export const GEMINI_RETRY_BACKOFF_MS = 1_500;

/**
 * Max number of automatic retries on transient errors (PRD D21). User-
 * triggered "Retry" is unaffected — this only governs the silent retry.
 */
export const GEMINI_MAX_AUTO_RETRIES = 1;

// ---------------------------------------------------------------------------
// Stats window (PRD §0 D8 — JSON parse fail rate, latency)
// ---------------------------------------------------------------------------

/** Rolling-window length for `GeminiCallStats`. PRD D28. */
export const STATS_WINDOW_DAYS = 7 as const;

// ---------------------------------------------------------------------------
// Chat window geometry (PRD §0 D13 / §3.5)
// ---------------------------------------------------------------------------

/** Chat window width in CSS px (PRD D13). */
export const CHAT_WINDOW_WIDTH = 480;
/** Chat window height in CSS px (PRD D13). */
export const CHAT_WINDOW_HEIGHT = 640;
/** Gap between the widget pill and the chat window's anchor edge. */
export const CHAT_ANCHOR_GAP_PX = 8;

/** Open animation length (PRD D15). */
export const CHAT_OPEN_ANIM_MS = 220;
/** Close animation length (PRD D15). */
export const CHAT_CLOSE_ANIM_MS = 180;

// ---------------------------------------------------------------------------
// AI store keys (PRD §3.4)
// ---------------------------------------------------------------------------

export const AI_STORE_KEY_API_KEY = 'ai.apiKey';
export const AI_STORE_KEY_MODEL = 'ai.model';
export const AI_STORE_KEY_STATS_CALLS = 'ai.stats.calls';
