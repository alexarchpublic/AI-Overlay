/**
 * @file src/shared/tokenEstimate.ts
 *
 * Single source of truth for cheap character-based token estimates used by
 * budgeting, logging, retrieval, and any legacy harness math.
 */

/** Characters-per-token ratio (PRD D7 / Chunk 4 harness heuristic). */
export const CHARS_PER_TOKEN = 3.8;

/** Conservative per-image estimate for vision turns (PRD §3.8). */
export const PER_IMAGE_TOKEN_ESTIMATE = 2_000;

/** Cheap char-based token estimate shared across the project. */
export function estimateTokensFromChars(charCount: number): number {
  if (charCount <= 0) return 0;
  return Math.ceil(charCount / CHARS_PER_TOKEN);
}
