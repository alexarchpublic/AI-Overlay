/**
 * @file src/shared/knowledge/bundleBuilder.ts
 *
 * Docs-corpus bundle helpers: content hash + write `docs-<hash>.json`.
 * Page fetch / chunking lives in `docsIngest.ts`; the CLI orchestrates both.
 */
/// <reference types="node" />

import { writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { DOCS_BUNDLE_PREFIX } from '../knowledgeConstants';
import type { DocChunk, DocsBundleManifest, DocsKnowledgeBundle } from '../knowledgeTypes';
import { computeDocsContentHash } from './docsIngest';

export { computeDocsContentHash as computeContentHash };

export interface WriteDocsBundleOptions {
  outputDir: string;
  chunks: readonly DocChunk[];
  pages: DocsBundleManifest['pages'];
  fetchedAt?: string;
  /** When true, remove prior `docs-*.json` bundles in outputDir. */
  pruneOld?: boolean;
}

export interface WriteDocsBundleResult {
  bundlePath: string;
  bundle: DocsKnowledgeBundle;
}

/**
 * Build and write a content-hashed docs bundle.
 * Filename: `docs-<first12(contentHash)>.json`.
 */
export async function writeDocsBundle(
  options: WriteDocsBundleOptions,
): Promise<WriteDocsBundleResult> {
  const contentHash = computeDocsContentHash(options.chunks);
  const totalTokenEstimate = options.pages.reduce((n, p) => n + p.tokenEstimate, 0);

  const bundle: DocsKnowledgeBundle = {
    manifest: {
      schemaVersion: 1,
      tier: 'docs',
      fetchedAt: options.fetchedAt ?? new Date().toISOString(),
      contentHash,
      pages: [...options.pages],
      totalTokenEstimate,
      chunkCount: options.chunks.length,
    },
    chunks: [...options.chunks],
  };

  await mkdir(options.outputDir, { recursive: true });

  if (options.pruneOld !== false) {
    const existing = await readdir(options.outputDir);
    for (const name of existing) {
      if (name.startsWith(DOCS_BUNDLE_PREFIX) && name.endsWith('.json')) {
        await unlink(path.join(options.outputDir, name));
      }
    }
  }

  const shortHash = contentHash.slice(0, 12);
  const baseName = `${DOCS_BUNDLE_PREFIX}${shortHash}`;
  const bundlePath = path.join(options.outputDir, `${baseName}.json`);
  await writeFile(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');

  return { bundlePath, bundle };
}
