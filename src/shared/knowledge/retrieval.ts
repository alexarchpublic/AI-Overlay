/**
 * @file src/shared/knowledge/retrieval.ts
 *
 * Pure scoped retrieval over docs-corpus chunks (PRD D-P4 / D-P11).
 * Keyword overlap + sectionPath boost + active-algorithm boost + token budget.
 */
import {
  ACTIVE_ALGORITHM_SCORE_BOOST,
  ALGORITHM_PAGE_SLUGS,
  DEFAULT_RETRIEVAL_K,
  DEFAULT_RETRIEVAL_TOKEN_BUDGET,
} from '../knowledgeConstants';
import type { ActiveAlgorithm, DocChunk, RetrievalQuery } from '../knowledgeTypes';
import { estimateTokensFromChars } from '../tokenEstimate';

export function estimateChunkTokens(text: string): number {
  return estimateTokensFromChars(text.length);
}

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'how',
  'i',
  'in',
  'is',
  'it',
  'my',
  'of',
  'on',
  'or',
  'that',
  'the',
  'their',
  'this',
  'to',
  'what',
  'why',
  'with',
  'you',
  'your',
]);

/** Tokenize query text for cheap lexical scoring. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

function slugsForAlgorithm(active: ActiveAlgorithm | undefined): ReadonlySet<string> | null {
  if (!active || active === 'all') return null;
  return new Set(ALGORITHM_PAGE_SLUGS[active]);
}

/** Score one chunk against query terms (higher = more relevant). */
export function scoreChunk(
  chunk: DocChunk,
  terms: readonly string[],
  activeAlgorithm?: ActiveAlgorithm,
): number {
  if (terms.length === 0) {
    const boostSlugs = slugsForAlgorithm(activeAlgorithm);
    return boostSlugs?.has(chunk.pageSlug) ? ACTIVE_ALGORITHM_SCORE_BOOST : 0;
  }

  const sectionHaystack = chunk.sectionPath.join(' ').toLowerCase();
  const haystack = `${chunk.id} ${chunk.pageTitle} ${sectionHaystack} ${chunk.text}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) {
      score += 1;
      // Heading / section-path hits are stronger relevance signals.
      if (sectionHaystack.includes(term)) {
        score += 0.75;
      }
    }
  }

  const boostSlugs = slugsForAlgorithm(activeAlgorithm);
  if (boostSlugs?.has(chunk.pageSlug)) {
    score += ACTIVE_ALGORITHM_SCORE_BOOST;
  }

  return score;
}

export interface RetrieveChunksOptions {
  chunks: readonly DocChunk[];
  query: RetrievalQuery;
}

/**
 * Select up to `k` chunks within the token budget, ranked by lexical score
 * with active-algorithm boosting.
 */
export function retrieveChunks(options: RetrieveChunksOptions): DocChunk[] {
  const k = options.query.k ?? DEFAULT_RETRIEVAL_K;
  const tokenBudget = options.query.tokenBudget ?? DEFAULT_RETRIEVAL_TOKEN_BUDGET;
  const terms = tokenize(`${options.query.text} ${options.query.chartContext ?? ''}`);
  const active = options.query.activeAlgorithm;

  const ranked = [...options.chunks]
    .map((chunk) => ({ chunk, score: scoreChunk(chunk, terms, active) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.chunk.id.localeCompare(b.chunk.id);
    });

  const selected: DocChunk[] = [];
  const selectedIds = new Set<string>();
  let usedTokens = 0;

  function tryAdd(chunk: DocChunk): boolean {
    if (selectedIds.has(chunk.id)) return false;
    const tokens = chunk.tokenEstimate || estimateChunkTokens(chunk.text);
    if (selected.length > 0 && usedTokens + tokens > tokenBudget) return false;
    selected.push(chunk);
    selectedIds.add(chunk.id);
    usedTokens += tokens;
    return true;
  }

  for (const { chunk, score } of ranked) {
    if (selected.length >= k) break;
    if (score <= 0 && selected.length > 0) break;
    tryAdd(chunk);
  }

  return selected;
}

/** Return all chunks for an algorithm's guide pages (full-guide injection). */
export function chunksForAlgorithm(
  chunks: readonly DocChunk[],
  algorithm: ActiveAlgorithm,
): DocChunk[] {
  if (algorithm === 'all') return [...chunks];
  const slugs = new Set(ALGORITHM_PAGE_SLUGS[algorithm]);
  return chunks.filter((c) => slugs.has(c.pageSlug));
}
