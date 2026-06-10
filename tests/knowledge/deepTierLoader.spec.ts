/**
 * @file tests/knowledge/deepTierLoader.spec.ts
 * Phase 1 — deep tier loader + generation manifest parsing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  loadDeepTierSources,
  loadGenerationManifest,
} from '../../src/shared/knowledge/deepTierLoader';

const MINI_MANIFEST = {
  schemaVersion: 1,
  strategies: [
    {
      strategyId: 'test-strategy',
      displayName: 'Test Strategy',
      version: '1',
      deepTierInclude: ['docs/readme.md'],
      chunkPlan: [
        {
          id: 'test-contract',
          kind: 'contract',
          fileName: 'contract.abstraction.json',
          focus: 'Behavioral contract only.',
        },
      ],
    },
  ],
};

describe('loadGenerationManifest', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'gen-manifest-'));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('parses a valid generation manifest', async () => {
    const manifestPath = path.join(tmp, 'GENERATION_MANIFEST.json');
    await writeFile(manifestPath, `${JSON.stringify(MINI_MANIFEST)}\n`);
    const manifest = await loadGenerationManifest(manifestPath);
    expect(manifest.strategies).toHaveLength(1);
    expect(manifest.strategies[0]?.strategyId).toBe('test-strategy');
  });

  it('rejects unsupported schema version', async () => {
    const manifestPath = path.join(tmp, 'bad.json');
    await writeFile(
      manifestPath,
      `${JSON.stringify({ ...MINI_MANIFEST, schemaVersion: 99 })}\n`,
    );
    await expect(loadGenerationManifest(manifestPath)).rejects.toThrow(/schema/);
  });
});

describe('loadDeepTierSources', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'deep-load-'));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('loads configured deep-tier files into a source bundle', async () => {
    await mkdir(path.join(tmp, 'docs'), { recursive: true });
    await writeFile(path.join(tmp, 'docs', 'readme.md'), 'Strategy behavior notes.\n');

    const bundle = await loadDeepTierSources(tmp, MINI_MANIFEST.strategies[0]!);
    expect(bundle.includedPaths).toEqual(['docs/readme.md']);
    expect(bundle.sourceText).toContain('Strategy behavior notes.');
    expect(bundle.chunkPlan).toHaveLength(1);
  });

  it('throws when a configured deep file is missing', async () => {
    await expect(loadDeepTierSources(tmp, MINI_MANIFEST.strategies[0]!)).rejects.toThrow(
      /missing/,
    );
  });
});

describe('repo generation manifest', () => {
  it('loads the committed GENERATION_MANIFEST for market-wave', async () => {
    const repoRoot = path.resolve(__dirname, '../..');
    const manifestPath = path.join(repoRoot, 'knowledge', 'deep', 'GENERATION_MANIFEST.json');
    const manifest = await loadGenerationManifest(manifestPath);
    const mw = manifest.strategies.find((s) => s.strategyId === 'market-wave');
    expect(mw).toBeDefined();
    expect(mw!.chunkPlan.length).toBeGreaterThanOrEqual(7);
  });
});
