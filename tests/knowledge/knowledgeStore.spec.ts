/**
 * @file tests/knowledge/knowledgeStore.spec.ts
 * Phase 0 task 2 — LocalEncryptedKnowledgeStore encryption, cache, retrieval scope.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildKnowledgeBundle } from '../../src/shared/knowledge/bundleBuilder';
import { createTestSafeStorage } from '../../src/main/knowledgeCrypto';
import {
  createLocalEncryptedKnowledgeStore,
  createNodeKnowledgeFs,
  resolveServableBundlePath,
  type KnowledgeFsLike,
} from '../../src/main/knowledgeStore';
import {
  KNOWLEDGE_ENCRYPTED_INDEX_FILENAME,
  KNOWLEDGE_INDEX_META_FILENAME,
  KNOWLEDGE_USERDATA_SUBDIR,
} from '../../src/shared/knowledgeConstants';

const VALID_SOURCE = {
  id: 'test-contract',
  strategyId: 'test-strategy',
  kind: 'contract',
  version: '1',
  text: 'Behavioral summary without code paths or proprietary defaults.',
  review: { reviewer: 'test', reviewedAt: '2026-05-29', d3Pass: true },
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

describe('resolveServableBundlePath', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'knowledge-resolve-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('finds servable-*.json bundle files', async () => {
    await writeFile(path.join(tmp, 'servable-abc123.json'), '{}');
    const resolved = await resolveServableBundlePath(tmp, createNodeKnowledgeFs());
    expect(resolved).toMatch(/servable-abc123\.json$/);
  });
});

describe('LocalEncryptedKnowledgeStore', () => {
  let tmp: string;
  let bundleDir: string;
  let userDataDir: string;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'knowledge-store-'));
    bundleDir = path.join(tmp, 'bundles');
    userDataDir = path.join(tmp, 'userData');
    const servable = path.join(tmp, 'servable');
    await mkdir(path.join(servable, 'test-strategy'), { recursive: true });
    await writeFile(
      path.join(servable, 'test-strategy', 'contract.abstraction.json'),
      `${JSON.stringify(VALID_SOURCE, null, 2)}\n`,
    );
    await buildKnowledgeBundle({ servableRoot: servable, outputDir: bundleDir });
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('encrypts bundle at rest and serves scoped retrieval', async () => {
    const store = createLocalEncryptedKnowledgeStore({
      logger: makeSilentLogger(),
      userDataDir,
      bundleDir,
      fs: createNodeKnowledgeFs(),
      safeStorage: createTestSafeStorage('test-key-for-knowledge-store!!'),
    });

    await store.init();
    const version = await store.version();
    expect(version).toMatch(/^[a-f0-9]{64}$/);

    const chunks = await store.retrieve({ text: 'behavioral summary', k: 2 });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.strategyId === 'test-strategy')).toBe(true);

    const encPath = path.join(userDataDir, KNOWLEDGE_USERDATA_SUBDIR, KNOWLEDGE_ENCRYPTED_INDEX_FILENAME);
    const rawEnc = await readFile(encPath);
    expect(rawEnc.toString('utf8')).not.toContain('Behavioral summary');
  });

  it('reuses encrypted cache when content hash matches', async () => {
    const fs = createNodeKnowledgeFs();
    const safeStorage = createTestSafeStorage('cache-test-key-32-chars!!!!!');
    const logger = makeSilentLogger();
    const opts = {
      logger,
      userDataDir,
      bundleDir,
      fs,
      safeStorage,
    };

    await createLocalEncryptedKnowledgeStore(opts).init();
    const metaPath = path.join(
      userDataDir,
      KNOWLEDGE_USERDATA_SUBDIR,
      KNOWLEDGE_INDEX_META_FILENAME,
    );
    const metaBefore = await readFile(metaPath, 'utf8');

    await createLocalEncryptedKnowledgeStore(opts).init();
    const metaAfter = await readFile(metaPath, 'utf8');
    expect(metaAfter).toBe(metaBefore);
  });

  it('never reads deep-tier paths — only bundleDir servable artifacts', async () => {
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

    const store = createLocalEncryptedKnowledgeStore({
      logger: makeSilentLogger(),
      userDataDir,
      bundleDir,
      fs: trackingFs,
      safeStorage: createTestSafeStorage(),
    });
    await store.init();
    await store.retrieve({ text: 'test' });
    expect(deepReads).toHaveLength(0);
  });
});
