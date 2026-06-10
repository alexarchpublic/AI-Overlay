/**
 * @file src/shared/knowledge/abstractionGenerator.ts
 *
 * Phase 1 automated abstraction pipeline — LLM-assisted authoring with
 * deterministic D-3 validation and auto-attestation (PRD §5.1, §8 Phase 1).
 */
/// <reference types="node" />

import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ServableAbstractionSource } from '../knowledgeTypes';
import {
  ABSTRACTION_AUTHOR_SYSTEM_PROMPT,
  buildInitialGenerationUserPrompt,
  buildRetryGenerationUserPrompt,
} from './abstractionAuthorPrompt';
import {
  parseGeneratedAbstractions,
  type GeneratedAbstractionDraft,
} from './abstractionGenerationSchema';
import type { DeepTierSourceBundle, GenerationChunkPlan } from './deepTierLoader';
import { validateD3 } from './d3Validator';

export const AUTOMATED_REVIEWER = 'automated-pipeline';

export const ABSTRACTION_GENERATION_MAX_D3_RETRIES = 3;

export interface AbstractionLlmAdapter {
  generate(args: {
    systemPrompt: string;
    userPrompt: string;
    signal?: AbortSignal;
  }): Promise<{ ok: true; rawJson: string } | { ok: false; reason: string }>;
}

export interface GenerateStrategyAbstractionsOptions {
  bundle: DeepTierSourceBundle;
  servableRoot: string;
  llm: AbstractionLlmAdapter;
  force?: boolean;
  dryRun?: boolean;
  maxD3Retries?: number;
}

export interface GeneratedAbstractionFile {
  relativePath: string;
  source: ServableAbstractionSource;
  d3Attempts: number;
}

export interface GenerateStrategyAbstractionsResult {
  strategyId: string;
  written: GeneratedAbstractionFile[];
  skipped: string[];
  failed: { id: string; reason: string }[];
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function toSource(
  bundle: DeepTierSourceBundle,
  draft: GeneratedAbstractionDraft,
  chunk: GenerationChunkPlan,
): ServableAbstractionSource {
  if (draft.id !== chunk.id) {
    throw new Error(`Draft id mismatch: expected ${chunk.id}, got ${draft.id}`);
  }
  if (draft.kind !== chunk.kind) {
    throw new Error(`Draft kind mismatch for ${chunk.id}`);
  }
  if (draft.fileName !== chunk.fileName) {
    throw new Error(`Draft fileName mismatch for ${chunk.id}`);
  }
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: draft.id,
    strategyId: bundle.strategyId,
    kind: draft.kind,
    version: bundle.version,
    text: draft.text,
    review: {
      reviewer: AUTOMATED_REVIEWER,
      reviewedAt: today,
      d3Pass: true,
    },
  };
}

async function generateDraftForChunks(
  llm: AbstractionLlmAdapter,
  bundle: DeepTierSourceBundle,
  chunks: readonly GenerationChunkPlan[],
  retryContext?: {
    chunk: GenerationChunkPlan;
    previousText: string;
    d3Failures: readonly { rule: string; message: string }[];
  },
): Promise<GeneratedAbstractionDraft[] | null> {
  const userPrompt = retryContext
    ? buildRetryGenerationUserPrompt({
        displayName: bundle.displayName,
        strategyId: bundle.strategyId,
        chunk: retryContext.chunk,
        previousText: retryContext.previousText,
        d3Failures: retryContext.d3Failures,
      })
    : buildInitialGenerationUserPrompt({
        displayName: bundle.displayName,
        strategyId: bundle.strategyId,
        version: bundle.version,
        chunkPlan: chunks,
        sourceText: bundle.sourceText,
      });

  const result = await llm.generate({
    systemPrompt: ABSTRACTION_AUTHOR_SYSTEM_PROMPT,
    userPrompt,
  });
  if (!result.ok) return null;

  const parsed = parseGeneratedAbstractions(result.rawJson);
  if (!parsed) return null;
  return parsed.documents;
}

async function validateAndWriteChunk(
  options: GenerateStrategyAbstractionsOptions,
  chunk: GenerationChunkPlan,
  initialDrafts: Map<string, GeneratedAbstractionDraft>,
): Promise<
  | { status: 'written'; file: GeneratedAbstractionFile }
  | { status: 'skipped'; fileName: string }
  | { status: 'failed'; id: string; reason: string }
> {
  const outDir = path.join(options.servableRoot, options.bundle.strategyId);
  const outPath = path.join(outDir, chunk.fileName);
  const relativePath = path.join(options.bundle.strategyId, chunk.fileName);

  if (!options.force && (await fileExists(outPath))) {
    return { status: 'skipped', fileName: chunk.fileName };
  }

  const maxRetries = options.maxD3Retries ?? ABSTRACTION_GENERATION_MAX_D3_RETRIES;
  let draft = initialDrafts.get(chunk.id);
  let attempts = 0;

  while (attempts < maxRetries) {
    attempts += 1;
    if (!draft) {
      const retried = await generateDraftForChunks(options.llm, options.bundle, [chunk]);
      draft = retried?.find((d) => d.id === chunk.id);
      if (!draft) {
        return { status: 'failed', id: chunk.id, reason: 'LLM returned no parseable draft' };
      }
    }

    const d3 = validateD3(draft.text);
    if (d3.ok) {
      const source = toSource(options.bundle, draft, chunk);
      if (!options.dryRun) {
        await mkdir(outDir, { recursive: true });
        await writeFile(outPath, `${JSON.stringify(source, null, 2)}\n`, 'utf8');
      }
      return {
        status: 'written',
        file: { relativePath, source, d3Attempts: attempts },
      };
    }

    if (attempts >= maxRetries) {
      const detail = d3.hits.map((h) => h.rule).join(', ');
      return {
        status: 'failed',
        id: chunk.id,
        reason: `D-3 failed after ${String(maxRetries)} attempts: ${detail}`,
      };
    }

    const retried = await generateDraftForChunks(options.llm, options.bundle, [chunk], {
      chunk,
      previousText: draft.text,
      d3Failures: d3.hits,
    });
    draft = retried?.find((d) => d.id === chunk.id);
    if (!draft) {
      return { status: 'failed', id: chunk.id, reason: 'LLM retry returned no parseable draft' };
    }
  }

  return { status: 'failed', id: chunk.id, reason: 'unexpected generation loop exit' };
}

/**
 * Generate servable abstractions for one strategy from deep-tier source.
 * Existing files are skipped unless `force` is set.
 */
export async function generateStrategyAbstractions(
  options: GenerateStrategyAbstractionsOptions,
): Promise<GenerateStrategyAbstractionsResult> {
  const initial = await generateDraftForChunks(
    options.llm,
    options.bundle,
    options.bundle.chunkPlan,
  );
  if (!initial) {
    return {
      strategyId: options.bundle.strategyId,
      written: [],
      skipped: [],
      failed: options.bundle.chunkPlan.map((c) => ({
        id: c.id,
        reason: 'Initial LLM batch returned no parseable documents',
      })),
    };
  }

  const draftMap = new Map<string, GeneratedAbstractionDraft>();
  for (const d of initial) {
    draftMap.set(d.id, d);
  }

  const written: GeneratedAbstractionFile[] = [];
  const skipped: string[] = [];
  const failed: { id: string; reason: string }[] = [];

  for (const chunk of options.bundle.chunkPlan) {
    const result = await validateAndWriteChunk(options, chunk, draftMap);
    switch (result.status) {
      case 'written':
        written.push(result.file);
        break;
      case 'skipped':
        skipped.push(result.fileName);
        break;
      case 'failed':
        failed.push({ id: result.id, reason: result.reason });
        break;
    }
  }

  return {
    strategyId: options.bundle.strategyId,
    written,
    skipped,
    failed,
  };
}

export interface ReviewManifestUpdate {
  phase: string;
  policy: string;
  strategies: {
    strategyId: string;
    reviewer: string;
    reviewedAt: string;
    documents: string[];
  }[];
}

/** Build an updated REVIEW_MANIFEST.json snapshot from generation results. */
export function buildReviewManifest(
  servableRoot: string,
  results: readonly GenerateStrategyAbstractionsResult[],
): ReviewManifestUpdate {
  const today = new Date().toISOString().slice(0, 10);
  void servableRoot;
  return {
    phase: '1',
    policy:
      'Abstractions may be authored by automated-pipeline (D-3 validated) or human curation; bundle build requires review.d3Pass true.',
    strategies: results.map((r) => ({
      strategyId: r.strategyId,
      reviewer: AUTOMATED_REVIEWER,
      reviewedAt: today,
      documents: r.written.map((w) => w.relativePath.replace(/\\/g, '/')),
    })),
  };
}

export async function writeReviewManifest(
  servableRoot: string,
  manifest: ReviewManifestUpdate,
): Promise<string> {
  const outPath = path.join(servableRoot, 'REVIEW_MANIFEST.json');
  await writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return outPath;
}
