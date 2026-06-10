/**
 * @file src/shared/knowledge/retrieval.ts
 *
 * Pure scoped retrieval over servable-tier chunks (PRD §5.2 D-7/D-8).
 * Keyword overlap + token budget — vector search is an implementation detail
 * behind KnowledgeStore and may replace this scorer later.
 */
import {
  DEFAULT_RETRIEVAL_K,
  DEFAULT_RETRIEVAL_TOKEN_BUDGET,
} from '../knowledgeConstants';
import type { AbstractionChunk, RetrievalQuery } from '../knowledgeTypes';
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

/** Score one chunk against query terms (higher = more relevant). */
export function scoreChunk(chunk: AbstractionChunk, terms: readonly string[]): number {
  if (terms.length === 0) return 0;
  const haystack = `${chunk.id} ${chunk.kind} ${chunk.text}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) {
      score += 1;
      if (chunk.kind === 'contract' && term.length >= 4) {
        score += 0.25;
      }
    }
  }
  return score;
}

export interface RetrieveChunksOptions {
  chunks: readonly AbstractionChunk[];
  query: RetrievalQuery;
}

/**
 * Select up to `k` chunks within the token budget. Always tries to include the
 * strategy `contract` chunk when present so baseline behavior context ships.
 */
export function retrieveChunks(options: RetrieveChunksOptions): AbstractionChunk[] {
  const k = options.query.k ?? DEFAULT_RETRIEVAL_K;
  const tokenBudget = options.query.tokenBudget ?? DEFAULT_RETRIEVAL_TOKEN_BUDGET;
  const terms = tokenize(`${options.query.text} ${options.query.chartContext ?? ''}`);

  const ranked = [...options.chunks]
    .map((chunk) => ({ chunk, score: scoreChunk(chunk, terms) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.chunk.id.localeCompare(b.chunk.id);
    });

  const selected: AbstractionChunk[] = [];
  const selectedIds = new Set<string>();
  let usedTokens = 0;

  function tryAdd(chunk: AbstractionChunk): boolean {
    if (selectedIds.has(chunk.id)) return false;
    const tokens = estimateChunkTokens(chunk.text);
    if (selected.length > 0 && usedTokens + tokens > tokenBudget) return false;
    selected.push(chunk);
    selectedIds.add(chunk.id);
    usedTokens += tokens;
    return true;
  }

  const contract = options.chunks.find((c) => c.kind === 'contract');
  if (contract) {
    tryAdd(contract);
  }

  for (const { chunk, score } of ranked) {
    if (selected.length >= k) break;
    if (score <= 0 && selected.length > 0) break;
    tryAdd(chunk);
  }

  return selected;
}
