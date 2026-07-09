/**
 * @file tests/knowledge/bundleBuilder.spec.ts
 * Phase 0 task 1 — servable bundle build + content hash stability.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  buildKnowledgeBundle,
  computeContentHash,
} from '../../src/shared/knowledge/bundleBuilder';
import type { AbstractionChunk } from '../../src/shared/knowledgeTypes';

const VALID_SOURCE = {
  id: 'test-contract',
  strategyId: 'test-strategy',
  kind: 'contract',
  version: '1',
  text: 'Long-only behavioral summary without code or paths.',
  review: { reviewer: 'test', reviewedAt: '2026-05-29' },
};

describe('computeContentHash', () => {
  it('is stable for the same chunk set regardless of input order', () => {
    const a: AbstractionChunk = {
      id: 'a',
      strategyId: 's',
      kind: 'contract',
      text: 'one',
      version: '1',
    };
    const b: AbstractionChunk = {
      id: 'b',
      strategyId: 's',
      kind: 'risk',
      text: 'two',
      version: '1',
    };
    expect(computeContentHash([a, b])).toBe(computeContentHash([b, a]));
  });
});

describe('buildKnowledgeBundle', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'knowledge-build-'));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('builds a bundle from servable sources', async () => {
    const servable = path.join(tmp, 'servable');
    const out = path.join(tmp, 'bundles');
    await mkdir(path.join(servable, 'test-strategy'), { recursive: true });
    await writeFile(
      path.join(servable, 'test-strategy', 'contract.abstraction.json'),
      `${JSON.stringify(VALID_SOURCE)}\n`,
    );

    const result = await buildKnowledgeBundle({ servableRoot: servable, outputDir: out });
    expect(result.bundle.chunks).toHaveLength(1);
    expect(result.bundle.manifest.tier).toBe('servable');
    expect(result.bundle.manifest.chunkCount).toBe(1);

    const onDisk = JSON.parse(await readFile(result.bundlePath, 'utf8')) as {
      chunks: AbstractionChunk[];
    };
    expect(onDisk.chunks[0].id).toBe('test-contract');
    expect(onDisk.chunks[0]).not.toHaveProperty('review');
  });
});
