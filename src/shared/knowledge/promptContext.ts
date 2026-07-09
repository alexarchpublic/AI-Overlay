/**
 * @file src/shared/knowledge/promptContext.ts
 *
 * Formats docs-corpus knowledge for the model system prompt (PRD D-P4 / D-P5).
 * Order: persona → active-doc (or full corpus) → retrieved remainder → schema.
 */
import {
  ACTIVE_DOC_TOKEN_BUDGET,
  DEFAULT_RETRIEVAL_K,
  DEFAULT_RETRIEVAL_TOKEN_BUDGET,
  KNOWLEDGE_CONTEXT_OPENER,
  USE_FULL_CORPUS_INJECTION,
} from '../knowledgeConstants';
import type { ActiveAlgorithm, DocChunk, RetrievalQuery } from '../knowledgeTypes';
import { chunksForAlgorithm, estimateChunkTokens, retrieveChunks } from './retrieval';

const ACTIVE_DOC_OPENER = '### ACTIVE ALGORITHM GUIDE';

function formatSectionLabel(chunk: DocChunk): string {
  return chunk.sectionPath.join(' → ');
}

function formatChunkBlock(chunks: readonly DocChunk[], opener: string): string {
  if (chunks.length === 0) return '';
  const parts: string[] = [opener, ''];
  for (const chunk of chunks) {
    parts.push(`#### ${formatSectionLabel(chunk)}`, '', chunk.text, '', '---', '');
  }
  return parts.join('\n').replace(/\n---\n\n$/, '').trimEnd();
}

/** Compose the knowledge block inserted between persona and schema instructions. */
export function formatRetrievedKnowledge(chunks: readonly DocChunk[]): string {
  return formatChunkBlock(chunks, KNOWLEDGE_CONTEXT_OPENER);
}

/** Active-algorithm full-guide block (D-P4). */
export function formatActiveDocKnowledge(chunks: readonly DocChunk[]): string {
  return formatChunkBlock(chunks, ACTIVE_DOC_OPENER);
}

export interface PromptKnowledgeBlocks {
  /**
   * When true, `activeDocChunks` is the full corpus (or all pages) and uses
   * the product-documentation opener; retrieval is empty.
   */
  fullCorpus: boolean;
  /** Full guide for the selected algorithm, or the full corpus in full-injection mode. */
  activeDocChunks: readonly DocChunk[];
  /** Lexical remainder; empty when full-corpus injection is active. */
  retrievedChunks: readonly DocChunk[];
}

/**
 * Select chunks for prompt composition (D-P4).
 *
 * - Full-corpus mode: inject everything; retrieval is a no-op.
 * - Otherwise: inject the active algorithm's guide (token-capped), then
 *   retrieve top-k from the remaining pages.
 */
export function selectPromptKnowledge(
  allChunks: readonly DocChunk[],
  query: RetrievalQuery,
  activeAlgorithm: ActiveAlgorithm = 'market-wave',
): PromptKnowledgeBlocks {
  if (USE_FULL_CORPUS_INJECTION || activeAlgorithm === 'all') {
    return {
      fullCorpus: true,
      activeDocChunks: [...allChunks],
      retrievedChunks: [],
    };
  }

  const guide = chunksForAlgorithm(allChunks, activeAlgorithm);
  const activeDocChunks: DocChunk[] = [];
  let used = 0;
  for (const chunk of guide) {
    const tokens = chunk.tokenEstimate || estimateChunkTokens(chunk.text);
    if (activeDocChunks.length > 0 && used + tokens > ACTIVE_DOC_TOKEN_BUDGET) break;
    activeDocChunks.push(chunk);
    used += tokens;
  }

  const activeIds = new Set(activeDocChunks.map((c) => c.id));
  const remainder = allChunks.filter((c) => !activeIds.has(c.id));
  const retrievedChunks = retrieveChunks({
    chunks: remainder,
    query: {
      ...query,
      activeAlgorithm,
      k: query.k ?? DEFAULT_RETRIEVAL_K,
      tokenBudget: query.tokenBudget ?? DEFAULT_RETRIEVAL_TOKEN_BUDGET,
    },
  });

  return { fullCorpus: false, activeDocChunks, retrievedChunks };
}

/** Flatten prompt blocks in injection order (active doc first). */
export function flattenPromptKnowledge(blocks: PromptKnowledgeBlocks): DocChunk[] {
  const seen = new Set<string>();
  const out: DocChunk[] = [];
  for (const chunk of [...blocks.activeDocChunks, ...blocks.retrievedChunks]) {
    if (seen.has(chunk.id)) continue;
    seen.add(chunk.id);
    out.push(chunk);
  }
  return out;
}

/** Format active-doc + retrieved blocks for the system prompt. */
export function formatPromptKnowledge(blocks: PromptKnowledgeBlocks): string {
  if (blocks.fullCorpus) {
    return formatRetrievedKnowledge(blocks.activeDocChunks);
  }
  const parts: string[] = [];
  const active = formatActiveDocKnowledge(blocks.activeDocChunks);
  if (active.length > 0) parts.push(active);
  const retrieved = formatRetrievedKnowledge(blocks.retrievedChunks);
  if (retrieved.length > 0) parts.push(retrieved);
  return parts.join('\n\n');
}

/** Token estimate for the formatted knowledge block. */
export function estimateKnowledgeContextTokens(chunks: readonly DocChunk[]): number {
  return estimateChunkTokens(formatRetrievedKnowledge(chunks));
}

/** Token estimate for structured prompt knowledge blocks. */
export function estimatePromptKnowledgeTokens(blocks: PromptKnowledgeBlocks): number {
  return estimateChunkTokens(formatPromptKnowledge(blocks));
}

function isPromptKnowledgeBlocks(
  value: readonly DocChunk[] | PromptKnowledgeBlocks,
): value is PromptKnowledgeBlocks {
  return !Array.isArray(value) && 'activeDocChunks' in value && 'retrievedChunks' in value;
}

/** Order: persona → knowledge → schema reminder. */
export function composeSystemPrompt(
  persona: string,
  chunksOrBlocks: readonly DocChunk[] | PromptKnowledgeBlocks,
  schemaInstructions: string,
): string {
  const knowledgeBlock = isPromptKnowledgeBlocks(chunksOrBlocks)
    ? formatPromptKnowledge(chunksOrBlocks)
    : formatRetrievedKnowledge(chunksOrBlocks);
  if (knowledgeBlock.length === 0) {
    return `${persona}\n\n${schemaInstructions}`;
  }
  return `${persona}\n\n${knowledgeBlock}\n\n${schemaInstructions}`;
}
