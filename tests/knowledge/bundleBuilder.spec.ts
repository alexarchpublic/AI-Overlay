/**
 * @file tests/knowledge/bundleBuilder.spec.ts
 * Docs bundle write + content hash stability.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { writeDocsBundle, computeContentHash } from '../../src/shared/knowledge/bundleBuilder';
import type { DocChunk } from '../../src/shared/knowledgeTypes';

function makeChunk(id: string, text: string): DocChunk {
  return {
    id,
    pageSlug: 'market-wave-algorithm-setup-guide',
    pageTitle: 'Market Wave Algorithm Setup Guide',
    sourceUrl: 'https://docs.archpublic.com/crypto/market-wave-algorithm-setup-guide.md',
    sectionPath: ['Market Wave Algorithm Setup Guide', id],
    text,
    imageUrls: [],
    tokenEstimate: Math.ceil(text.length / 3.8),
  };
}

describe('computeContentHash', () => {
  it('is stable for the same chunk set regardless of input order', () => {
    const a = makeChunk('a', 'one');
    const b = makeChunk('b', 'two');
    expect(computeContentHash([a, b])).toBe(computeContentHash([b, a]));
  });
});

describe('writeDocsBundle', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'docs-bundle-'));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('writes a docs-*.json bundle with manifest metadata', async () => {
    const chunks = [makeChunk('about', 'About the guide.')];
    const result = await writeDocsBundle({
      outputDir: tmp,
      chunks,
      pages: [
        {
          slug: 'market-wave-algorithm-setup-guide',
          sourceUrl: chunks[0]!.sourceUrl,
          contentHash: 'abc',
          tokenEstimate: chunks[0]!.tokenEstimate,
        },
      ],
      fetchedAt: '2026-07-09T12:00:00.000Z',
    });

    expect(result.bundle.manifest.tier).toBe('docs');
    expect(result.bundle.manifest.chunkCount).toBe(1);
    expect(result.bundlePath).toMatch(/docs-[a-f0-9]{12}\.json$/);

    const onDisk = JSON.parse(await readFile(result.bundlePath, 'utf8')) as {
      chunks: DocChunk[];
      manifest: { totalTokenEstimate: number };
    };
    expect(onDisk.chunks[0]!.id).toBe('about');
    expect(onDisk.manifest.totalTokenEstimate).toBe(chunks[0]!.tokenEstimate);
  });
});
