/**
 * @file tests/knowledge/knowledgeStoreFactory.spec.ts
 * Phase 0 task 2 — config-selected backend factory + interface conformance.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildKnowledgeBundle } from '../../src/shared/knowledge/bundleBuilder';
import {
  createKnowledgeStore,
  resolveKnowledgeBundleDir,
} from '../../src/main/knowledgeStoreFactory';
import { RemoteKnowledgeStoreNotImplementedError } from '../../src/main/knowledgeStore';
import type { KnowledgeStore } from '../../src/shared/knowledgeTypes';

const VALID_SOURCE = {
  id: 'factory-contract',
  strategyId: 'factory-strategy',
  kind: 'contract',
  version: '1',
  text: 'Factory test behavioral contract without leakage shapes.',
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

/** Assert both backends expose the same KnowledgeStore surface. */
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
    const servable = path.join(tmp, 'servable');
    await mkdir(path.join(servable, 'factory-strategy'), { recursive: true });
    await writeFile(
      path.join(servable, 'factory-strategy', 'contract.abstraction.json'),
      `${JSON.stringify(VALID_SOURCE, null, 2)}\n`,
    );
    await buildKnowledgeBundle({ servableRoot: servable, outputDir: bundleDir });
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('selects local backend and initializes from the servable bundle', async () => {
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
