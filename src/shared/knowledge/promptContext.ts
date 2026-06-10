/**
 * @file src/shared/knowledge/promptContext.ts
 *
 * Formats scoped servable-tier retrieval for the model system prompt (Phase 0 task 3).
 * Raw harness bundles must never pass through here — only `AbstractionChunk[]`.
 */
import { KNOWLEDGE_CONTEXT_OPENER } from '../knowledgeConstants';
import type { AbstractionChunk } from '../knowledgeTypes';
import { estimateChunkTokens } from './retrieval';

/** Compose the knowledge block inserted between persona and schema instructions. */
export function formatRetrievedKnowledge(chunks: readonly AbstractionChunk[]): string {
  if (chunks.length === 0) return '';
  const parts: string[] = [KNOWLEDGE_CONTEXT_OPENER, ''];
  for (const chunk of chunks) {
    parts.push(`#### ${chunk.id} (${chunk.kind})`, '', chunk.text, '', '---', '');
  }
  return parts.join('\n').replace(/\n---\n\n$/, '').trimEnd();
}

/** Token estimate for the formatted knowledge block (matches retrieval budget math). */
export function estimateKnowledgeContextTokens(chunks: readonly AbstractionChunk[]): number {
  return estimateChunkTokens(formatRetrievedKnowledge(chunks));
}

/** PRD D4 order: persona → scoped knowledge → schema reminder. */
export function composeSystemPrompt(
  persona: string,
  chunks: readonly AbstractionChunk[],
  schemaInstructions: string,
): string {
  const knowledgeBlock = formatRetrievedKnowledge(chunks);
  if (knowledgeBlock.length === 0) {
    return `${persona}\n\n${schemaInstructions}`;
  }
  return `${persona}\n\n${knowledgeBlock}\n\n${schemaInstructions}`;
}
