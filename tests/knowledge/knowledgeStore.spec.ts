/**
 * @file tests/knowledge/knowledgeStore.spec.ts
 * LocalKnowledgeStore docs-bundle load + retrieval scope.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { writeDocsBundle } from '../../src/shared/knowledge/bundleBuilder';
import {
  createLocalKnowledgeStore,
  createNodeKnowledgeFs,
  resolveDocsBundlePath,
  type KnowledgeFsLike,
} from '../../src/main/knowledgeStore';
import type { DocChunk } from '../../src/shared/knowledgeTypes';

const SAMPLE: DocChunk = {
  id: 'mw-about',
  pageSlug: 'market-wave-algorithm-setup-guide',
  pageTitle: 'Market Wave Algorithm Setup Guide',
  sourceUrl: 'https://docs.archpublic.com/crypto/market-wave-algorithm-setup-guide.md',
  sectionPath: ['Market Wave Algorithm Setup Guide', 'About This Guide'],
  text: 'Behavioral summary of Market Wave inputs without proprietary source.',
  imageUrls: [],
  tokenEstimate: 30,
};

function makeSilentLogger() {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => makeSilentLogger(),
    raw: {} as never,
  };
}

describe('resolveDocsBundlePath', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'knowledge-resolve-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('finds docs-*.json bundle files', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path.join(tmp, 'docs-abc123def456.json'), '{}');
    const resolved = await resolveDocsBundlePath(tmp, createNodeKnowledgeFs());
    expect(resolved).toMatch(/docs-abc123def456\.json$/);
  });
});

describe('LocalKnowledgeStore', () => {
  let tmp: string;
  let bundleDir: string;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'knowledge-store-'));
    bundleDir = path.join(tmp, 'bundles');
    await writeDocsBundle({
      outputDir: bundleDir,
      chunks: [SAMPLE],
      pages: [
        {
          slug: SAMPLE.pageSlug,
          sourceUrl: SAMPLE.sourceUrl,
          contentHash: 'pagehash',
          tokenEstimate: SAMPLE.tokenEstimate,
        },
      ],
    });
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('loads the docs bundle and serves scoped retrieval', async () => {
    const store = createLocalKnowledgeStore({
      logger: makeSilentLogger(),
      bundleDir,
      fs: createNodeKnowledgeFs(),
    });

    await store.init();
    const version = await store.version();
    expect(version).toMatch(/^[a-f0-9]{64}$/);

    const chunks = await store.retrieve({ text: 'Market Wave inputs', k: 2 });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.pageSlug === SAMPLE.pageSlug)).toBe(true);
  });

  it('logs knowledge.loaded with docs-bundle source on init', async () => {
    const logs: { event: string; payload: unknown }[] = [];
    const logger = {
      debug: () => {},
      info: (event: string, payload?: unknown) => {
        logs.push({ event, payload });
      },
      warn: () => {},
      error: () => {},
      child: () => logger,
      raw: {} as never,
    };

    const store = createLocalKnowledgeStore({
      logger,
      bundleDir,
      fs: createNodeKnowledgeFs(),
    });

    await store.init();
    const loaded = logs.find((l) => l.event === 'knowledge.loaded');
    expect(loaded).toBeDefined();
    expect((loaded?.payload as { source?: string }).source).toBe('docs-bundle');
  });

  it('never reads deep-tier / harness paths — only bundleDir docs artifacts', async () => {
    const deepReads: string[] = [];
    const trackingFs: KnowledgeFsLike = {
      ...createNodeKnowledgeFs(),
      async readFile(p, enc) {
        if (p.includes('deep') || p.includes('arch-public-harness')) {
          deepReads.push(p);
        }
        return createNodeKnowledgeFs().readFile(p, enc);
      },
      readFileBuffer(p) {
        if (p.includes('deep') || p.includes('arch-public-harness')) {
          deepReads.push(p);
        }
        return createNodeKnowledgeFs().readFileBuffer(p);
      },
    };

    const store = createLocalKnowledgeStore({
      logger: makeSilentLogger(),
      bundleDir,
      fs: trackingFs,
    });
    await store.init();
    await store.retrieve({ text: 'test' });
    expect(deepReads).toHaveLength(0);
  });
});
