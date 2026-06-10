/**
 * @file src/shared/knowledge/abstractionAuthorPrompt.ts
 *
 * Offline LLM prompts for Phase 1 automated abstraction authoring (PRD §5.1).
 * The model reads deep-tier source once at build time; output must pass D-3.
 */

import type { GenerationChunkPlan } from './deepTierLoader';

export const ABSTRACTION_AUTHOR_SYSTEM_PROMPT = `You are an offline abstraction author for a secure trading co-pilot.

Your job: convert proprietary strategy source into servable-tier abstraction documents that will be retrieved at runtime. The live model will NEVER see the raw source you read now.

HARD EXCLUSIONS (PRD D-3 — any violation fails automated publish):
- No raw or paraphrased source code, pseudocode, or Pine/JS/Python snippets
- No file paths, path:line references, or repository names
- No exact formulas or function-call syntax (ta.*, strategy.*, input.*, etc.)
- No proprietary default, factory, configured, or internal parameter values
- No phrases like "the algorithm uses N", "the default is N", "the current value is N"
- No API keys or secrets

REQUIRED CONTENT STYLE:
- Natural-language behavioral contracts and parameter ROLES
- Safe operating ranges expressed generically for retail experimentation (bands, "~", rounded)
- Directional tuning guidance ("to reduce drawdown sensitivity, widen X and cut Y")
- Forward-looking try-values grounded in chart reasoning — never readouts of hidden constants
- Split parameter knowledge across separate param-role documents (D-4 chunking)

Write dense, expert prose a quant co-pilot can reason from without reconstructing strategy logic.`;

export function buildInitialGenerationUserPrompt(args: {
  displayName: string;
  strategyId: string;
  version: string;
  chunkPlan: readonly GenerationChunkPlan[];
  sourceText: string;
}): string {
  const planLines = args.chunkPlan
    .map(
      (c) =>
        `- id=${c.id} kind=${c.kind} file=${c.fileName}\n  focus: ${c.focus}`,
    )
    .join('\n');

  return `Strategy: ${args.displayName} (${args.strategyId}), version ${args.version}

Produce one abstraction document per chunk plan entry below. Return JSON only.

CHUNK PLAN:
${planLines}

DEEP-TIER SOURCE (build-time only — do not quote verbatim spans longer than a short phrase):
${args.sourceText}`;
}

export function buildRetryGenerationUserPrompt(args: {
  displayName: string;
  strategyId: string;
  chunk: GenerationChunkPlan;
  previousText: string;
  d3Failures: readonly { rule: string; message: string }[];
}): string {
  const failures = args.d3Failures
    .map((h) => `- ${h.rule}: ${h.message}`)
    .join('\n');

  return `Strategy: ${args.displayName} (${args.strategyId})

Rewrite ONLY this abstraction document. Your previous draft failed automated D-3 validation.

DOCUMENT:
- id=${args.chunk.id}
- kind=${args.chunk.kind}
- file=${args.chunk.fileName}
- focus: ${args.chunk.focus}

PREVIOUS DRAFT (fix violations, do not copy forbidden patterns):
${args.previousText}

D-3 FAILURES:
${failures}

Return JSON with a single "documents" array containing exactly one item for this chunk.`;
}
