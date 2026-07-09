/**
 * @file src/shared/knowledge/promptContext.ts
 *
 * Formats docs-corpus retrieval for the model system prompt.
 * Chunks are labeled with `sectionPath` for grounded citations (D-P5).
 */
import { KNOWLEDGE_CONTEXT_OPENER } from '../knowledgeConstants';
import type { DocChunk } from '../knowledgeTypes';
import { estimateChunkTokens } from './retrieval';

function formatSectionLabel(chunk: DocChunk): string {
  return chunk.sectionPath.join(' → ');
}

/** Compose the knowledge block inserted between persona and schema instructions. */
export function formatRetrievedKnowledge(chunks: readonly DocChunk[]): string {
  if (chunks.length === 0) return '';
  const parts: string[] = [KNOWLEDGE_CONTEXT_OPENER, ''];
  for (const chunk of chunks) {
    parts.push(`#### ${formatSectionLabel(chunk)}`, '', chunk.text, '', '---', '');
  }
  return parts.join('\n').replace(/\n---\n\n$/, '').trimEnd();
}

/** Token estimate for the formatted knowledge block (matches retrieval budget math). */
export function estimateKnowledgeContextTokens(chunks: readonly DocChunk[]): number {
  return estimateChunkTokens(formatRetrievedKnowledge(chunks));
}

/** Order: persona → scoped knowledge → schema reminder. */
export function composeSystemPrompt(
  persona: string,
  chunks: readonly DocChunk[],
  schemaInstructions: string,
): string {
  const knowledgeBlock = formatRetrievedKnowledge(chunks);
  if (knowledgeBlock.length === 0) {
    return `${persona}\n\n${schemaInstructions}`;
  }
  return `${persona}\n\n${knowledgeBlock}\n\n${schemaInstructions}`;
}
