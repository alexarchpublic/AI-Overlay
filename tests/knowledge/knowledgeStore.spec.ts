/**
 * @file tests/knowledge/knowledgeStore.spec.ts
 * Phase 0 task 2 — LocalKnowledgeStore bundle load + retrieval scope.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildKnowledgeBundle } from '../../src/shared/knowledge/bundleBuilder';
import {
  createLocalKnowledgeStore,
  createNodeKnowledgeFs,
  resolveServableBundlePath,
  type KnowledgeFsLike,
} from '../../src/main/knowledgeStore';

const VALID_SOURCE = {
  id: 'test-contract',
  strategyId: 'test-strategy',
  kind: 'contract',
  version: '1',
  text: 'Behavioral summary without code paths or proprietary defaults.',
  review: { reviewer: 'test', reviewedAt: '2026-05-29' },
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

describe('LocalKnowledgeStore', () => {
  let tmp: string;
  let bundleDir: string;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'knowledge-store-'));
    bundleDir = path.join(tmp, 'bundles');
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

  it('loads the servable bundle and serves scoped retrieval', async () => {
    const store = createLocalKnowledgeStore({
      logger: makeSilentLogger(),
      bundleDir,
      fs: createNodeKnowledgeFs(),
    });

    await store.init();
    const version = await store.version();
    expect(version).toMatch(/^[a-f0-9]{64}$/);

    const chunks = await store.retrieve({ text: 'behavioral summary', k: 2 });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.strategyId === 'test-strategy')).toBe(true);
  });

  it('logs knowledge.loaded with servable-bundle source on init', async () => {
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
    expect((loaded?.payload as { source?: string }).source).toBe('servable-bundle');
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
