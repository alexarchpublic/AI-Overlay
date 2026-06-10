/**
 * @file src/shared/knowledge/deepTierLoader.ts
 *
 * Build-time deep-tier reader for the Phase 1 automated abstraction pipeline.
 * Loads raw IP from the deep tier for LLM summarization only — never bundled.
 */
/// <reference types="node" />

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AbstractionKind } from '../knowledgeTypes';

export interface GenerationChunkPlan {
  id: string;
  kind: AbstractionKind;
  fileName: string;
  focus: string;
}

export interface GenerationStrategyConfig {
  strategyId: string;
  displayName: string;
  version: string;
  deepTierInclude: readonly string[];
  chunkPlan: readonly GenerationChunkPlan[];
}

export interface GenerationManifest {
  schemaVersion: number;
  description?: string;
  strategies: readonly GenerationStrategyConfig[];
}

export interface DeepTierSourceBundle {
  strategyId: string;
  displayName: string;
  version: string;
  chunkPlan: readonly GenerationChunkPlan[];
  /** Concatenated deep-tier text blocks for LLM input (build-time only). */
  sourceText: string;
  includedPaths: readonly string[];
}

const MAX_SOURCE_CHARS = 120_000;

function parseGenerationManifest(raw: unknown, filePath: string): GenerationManifest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Generation manifest root must be an object: ${filePath}`);
  }
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== 1) {
    throw new Error(`Unsupported generation manifest schema in ${filePath}`);
  }
  if (!Array.isArray(o.strategies) || o.strategies.length === 0) {
    throw new Error(`Generation manifest must list at least one strategy: ${filePath}`);
  }
  const strategies: GenerationStrategyConfig[] = [];
  for (const entry of o.strategies) {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Invalid strategy entry in ${filePath}`);
    }
    const s = entry as Record<string, unknown>;
    for (const key of [
      'strategyId',
      'displayName',
      'version',
      'deepTierInclude',
      'chunkPlan',
    ] as const) {
      if (!(key in s)) {
        throw new Error(`Strategy missing "${key}" in ${filePath}`);
      }
    }
    if (!Array.isArray(s.deepTierInclude) || !Array.isArray(s.chunkPlan)) {
      throw new Error(`Strategy arrays invalid in ${filePath}`);
    }
    strategies.push({
      strategyId: String(s.strategyId),
      displayName: String(s.displayName),
      version: String(s.version),
      deepTierInclude: s.deepTierInclude as readonly string[],
      chunkPlan: (s.chunkPlan as GenerationChunkPlan[]).map((c) => {
        for (const key of ['id', 'kind', 'fileName', 'focus'] as const) {
          if (!(key in c)) {
            throw new Error(`Chunk plan missing "${key}" for ${String(s.strategyId)}`);
          }
        }
        return c;
      }),
    });
  }
  return { schemaVersion: 1, strategies };
}

/** Load and validate `knowledge/deep/GENERATION_MANIFEST.json`. */
export async function loadGenerationManifest(manifestPath: string): Promise<GenerationManifest> {
  const raw = await readFile(manifestPath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`Invalid JSON in ${manifestPath}`);
  }
  return parseGenerationManifest(parsed, manifestPath);
}

/**
 * Read the configured deep-tier files for one strategy. Throws if any include
 * path is missing — the pipeline should not hallucinate from partial source.
 */
export async function loadDeepTierSources(
  deepRoot: string,
  strategy: GenerationStrategyConfig,
): Promise<DeepTierSourceBundle> {
  const blocks: string[] = [];
  const includedPaths: string[] = [];

  for (const relPath of strategy.deepTierInclude) {
    const abs = path.join(deepRoot, relPath);
    let text: string;
    try {
      text = await readFile(abs, 'utf8');
    } catch {
      throw new Error(`Deep-tier source missing for ${strategy.strategyId}: ${relPath}`);
    }
    includedPaths.push(relPath);
    blocks.push(`--- DEEP SOURCE: ${relPath} ---\n${text.trim()}`);
  }

  let sourceText = blocks.join('\n\n');
  if (sourceText.length > MAX_SOURCE_CHARS) {
    sourceText = `${sourceText.slice(0, MAX_SOURCE_CHARS)}\n\n[truncated for pipeline token budget]`;
  }

  return {
    strategyId: strategy.strategyId,
    displayName: strategy.displayName,
    version: strategy.version,
    chunkPlan: strategy.chunkPlan,
    sourceText,
    includedPaths,
  };
}
