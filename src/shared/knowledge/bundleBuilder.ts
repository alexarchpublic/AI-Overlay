/**
 * @file src/shared/knowledge/bundleBuilder.ts
 *
 * Offline pipeline: servable-tier sources → versioned, content-hashed bundle (PRD §5.1).
 * Deep tier is never read into chunk text — only optional inventory for build logs.
 */
/// <reference types="node" />

import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { buildDeepFingerprintManifest } from '../firewall/deepFingerprints';
import type {
  AbstractionChunk,
  ServableAbstractionSource,
  ServableKnowledgeBundle,
} from '../knowledgeTypes';
import { validateD3 } from './d3Validator';

export interface BuildKnowledgeBundleOptions {
  servableRoot: string;
  outputDir: string;
  /** If set, log deep-tier file count at build time (inventory only — never bundled). */
  deepTierRoot?: string;
}

export interface BuildKnowledgeBundleResult {
  bundlePath: string;
  manifestPath: string;
  bundle: ServableKnowledgeBundle;
}

const ABSTRACTION_FILE = /\.abstraction\.json$/i;

function toChunk(source: ServableAbstractionSource): AbstractionChunk {
  return {
    id: source.id,
    strategyId: source.strategyId,
    kind: source.kind,
    text: source.text.trim(),
    version: source.version,
  };
}

function canonicalHashInput(chunks: readonly AbstractionChunk[]): string {
  const ordered = [...chunks].sort((a, b) => a.id.localeCompare(b.id));
  return ordered.map((c) => `${c.id}\0${c.version}\0${c.text}`).join('\n');
}

export function computeContentHash(chunks: readonly AbstractionChunk[]): string {
  return createHash('sha256').update(canonicalHashInput(chunks)).digest('hex');
}

async function walkAbstractionFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...(await walkAbstractionFiles(full)));
    } else if (ent.isFile() && ABSTRACTION_FILE.test(ent.name)) {
      out.push(full);
    }
  }
  return out.sort();
}

function parseSource(raw: string, filePath: string): ServableAbstractionSource {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`Invalid JSON in ${filePath}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Abstraction must be an object: ${filePath}`);
  }
  const o = parsed as Record<string, unknown>;
  const required = ['id', 'strategyId', 'kind', 'version', 'text', 'review'] as const;
  for (const key of required) {
    if (!(key in o)) {
      throw new Error(`Missing "${key}" in ${filePath}`);
    }
  }
  const review = o.review as Record<string, unknown>;
  if (review.d3Pass !== true) {
    throw new Error(`review.d3Pass must be true in ${filePath} — human sign-off required`);
  }
  const kinds = ['contract', 'param-role', 'tuning', 'risk'];
  if (!kinds.includes(String(o.kind))) {
    throw new Error(`Invalid kind in ${filePath}`);
  }
  return parsed as ServableAbstractionSource;
}

/** Count regular files under deep tier for build audit (never loaded into bundle). */
export async function inventoryDeepTier(deepRoot: string): Promise<number> {
  let count = 0;
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (['node_modules', '.git', 'dist', 'build'].includes(ent.name)) {
          continue;
        }
        await walk(full);
      } else if (ent.isFile()) {
        count += 1;
      }
    }
  }
  await walk(deepRoot);
  return count;
}

/**
 * Build the servable-tier bundle from human-reviewed abstraction sources.
 * Throws on D-3 violations or missing review attestation.
 */
export async function buildKnowledgeBundle(
  options: BuildKnowledgeBundleOptions,
): Promise<BuildKnowledgeBundleResult> {
  const files = await walkAbstractionFiles(options.servableRoot);
  if (files.length === 0) {
    throw new Error(`No *.abstraction.json files under ${options.servableRoot}`);
  }

  const chunks: AbstractionChunk[] = [];
  for (const filePath of files) {
    const raw = await readFile(filePath, 'utf8');
    const source = parseSource(raw, filePath);
    const d3 = validateD3(source.text);
    if (!d3.ok) {
      const detail = d3.hits.map((h) => h.rule).join(', ');
      throw new Error(`D-3 failed for ${source.id} (${filePath}): ${detail}`);
    }
    chunks.push(toChunk(source));
  }

  const contentHash = computeContentHash(chunks);
  const strategyIds = [...new Set(chunks.map((c) => c.strategyId))].sort();

  const bundle: ServableKnowledgeBundle = {
    manifest: {
      schemaVersion: 1,
      tier: 'servable',
      builtAt: new Date().toISOString(),
      contentHash,
      chunkCount: chunks.length,
      strategyIds,
    },
    chunks,
  };

  await mkdir(options.outputDir, { recursive: true });
  const shortHash = contentHash.slice(0, 12);
  const baseName = `servable-${shortHash}`;
  const bundlePath = path.join(options.outputDir, `${baseName}.json`);
  const manifestPath = path.join(options.outputDir, `${baseName}.manifest.json`);

  await writeFile(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
  await writeFile(manifestPath, `${JSON.stringify(bundle.manifest, null, 2)}\n`, 'utf8');

  if (options.deepTierRoot) {
    const deepFileCount = await inventoryDeepTier(options.deepTierRoot);
    if (deepFileCount === 0) {
      console.warn(
        `[knowledge] deep tier empty or missing at ${options.deepTierRoot} — abstractions should be authored from deep sources`,
      );
    } else {
      console.info(
        `[knowledge] deep tier inventory: ${String(deepFileCount)} files (build-time only, not in bundle)`,
      );
      const fingerprints = await buildDeepFingerprintManifest(options.deepTierRoot);
      const fpPath = path.join(options.outputDir, '..', 'deep-fingerprints.json');
      await writeFile(fpPath, `${JSON.stringify(fingerprints, null, 2)}\n`, 'utf8');
      console.info(
        `[knowledge] deep fingerprints: ${String(fingerprints.spans.length)} spans → ${fpPath}`,
      );
    }
  }

  console.info(
    `[knowledge] servable bundle ${baseName}: ${String(chunks.length)} chunks, hash ${contentHash}`,
  );

  return { bundlePath, manifestPath, bundle };
}
