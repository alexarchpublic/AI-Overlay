/**
 * @file tests/knowledge/knowledgeStoreFactory.spec.ts
 * Config-selected backend factory + interface conformance (docs bundles).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { writeDocsBundle } from '../../src/shared/knowledge/bundleBuilder';
import {
  createKnowledgeStore,
  resolveKnowledgeBundleDir,
} from '../../src/main/knowledgeStoreFactory';
import { RemoteKnowledgeStoreNotImplementedError } from '../../src/main/knowledgeStore';
import type { DocChunk, KnowledgeStore } from '../../src/shared/knowledgeTypes';

const SAMPLE: DocChunk = {
  id: 'factory-about',
  pageSlug: 'market-wave-algorithm-setup-guide',
  pageTitle: 'Market Wave Algorithm Setup Guide',
  sourceUrl: 'https://docs.archpublic.com/crypto/market-wave-algorithm-setup-guide.md',
  sectionPath: ['Market Wave Algorithm Setup Guide', 'About'],
  text: 'Factory test docs chunk.',
  imageUrls: [],
  tokenEstimate: 10,
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

function assertKnowledgeStoreInterface(store: KnowledgeStore): void {
  expect(typeof store.init).toBe('function');
  expect(typeof store.retrieve).toBe('function');
  expect(typeof store.version).toBe('function');
}

describe('resolveKnowledgeBundleDir', () => {
  it('points dev builds at repo knowledge/bundles', () => {
    const dir = resolveKnowledgeBundleDir(true, '/repo/root');
    expect(dir).toBe(path.join('/repo/root', 'knowledge/bundles'));
  });
});

describe('createKnowledgeStore', () => {
  let tmp: string;
  let bundleDir: string;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'knowledge-factory-'));
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

  it('selects local backend and initializes from the docs bundle', async () => {
    const store = await createKnowledgeStore({
      backend: 'local',
      logger: makeSilentLogger(),
      isDev: true,
      bundleDir,
    });
    assertKnowledgeStoreInterface(store);
    expect(await store.version()).toMatch(/^[a-f0-9]{64}$/);
  });

  it('remote stub conforms to interface but throws on use', async () => {
    const store = await createKnowledgeStore({
      backend: 'remote',
      logger: makeSilentLogger(),
      isDev: true,
      bundleDir,
    });
    assertKnowledgeStoreInterface(store);
    await expect(store.init()).rejects.toBeInstanceOf(RemoteKnowledgeStoreNotImplementedError);
    await expect(store.retrieve({ text: 'x' })).rejects.toBeInstanceOf(
      RemoteKnowledgeStoreNotImplementedError,
    );
    await expect(store.version()).rejects.toBeInstanceOf(RemoteKnowledgeStoreNotImplementedError);
  });
});
