/**
 * @file tests/harnessLoader.spec.ts
 *
 * Why it exists: PRD §5 DoD #19 — `harnessLoader.spec.ts` covers ≥ 8 cases:
 *
 *   1. Cold load on `harness-fixture-a` returns the right counts + classification
 *   2. Bundle text matches the D5 header / D6 envelope format byte-for-byte
 *   3. Loading the same fixture twice produces byte-identical bundle text (D4 determinism)
 *   4. Empty directory returns `fileCount: 0` + `warnings: ['empty harness directory']`
 *   5. The mixed fixture excludes .json/.png/node_modules/.env/oversize/.pdf,
 *      and the suspicious-content rule keeps a high-entropy blob out of the bundle
 *   6. Concurrent `getHarness()` calls dedupe (D11)
 *   7. `reload()` invalidates the cache; modifying a file appears in the new bundle
 *   8. Manifest applied → manifestUsed true, ordering reflects priority
 *   9. Malformed manifest → MANIFEST_INVALID, previous cache preserved
 *  10. Token ceiling exceeded → TOKEN_CEILING_EXCEEDED, previous cache preserved
 *  11. setRootPath rejects ROOT_NOT_FOUND without persisting
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fsp from 'node:fs/promises';
import {
  createHarnessLoader,
  createNodeHarnessFs,
  HarnessLoadError,
  type HarnessLoader,
} from '../src/main/harnessLoader';
import type { AppLogger } from '../src/main/logger';
import type { LogContext } from '../src/shared/types';
import {
  HARNESS_ENVELOPE_OPENER,
  HARNESS_FILE_HEADER_PREFIX,
  HARNESS_FILE_SEPARATOR,
} from '../src/shared/harnessConstants';

const FIXTURES = path.resolve(__dirname, 'fixtures');

/** Pino-shaped logger fake — collects every record so tests can introspect. */
function makeFakeLogger(): AppLogger & { records: { level: string; event: string; ctx?: LogContext }[] } {
  const records: { level: string; event: string; ctx?: LogContext }[] = [];
  const log: AppLogger & { records: typeof records } = {
    records,
    debug: (event, ctx) => {
      records.push({ level: 'debug', event, ctx });
    },
    info: (event, ctx) => {
      records.push({ level: 'info', event, ctx });
    },
    warn: (event, ctx) => {
      records.push({ level: 'warn', event, ctx });
    },
    error: (event, ctx) => {
      records.push({ level: 'error', event, ctx });
    },
    child(): AppLogger {
      return log;
    },
    raw: undefined as unknown as AppLogger['raw'],
  };
  return log;
}

function buildLoader(rootPath: string): HarnessLoader {
  return createHarnessLoader({
    logger: makeFakeLogger(),
    initialRootPath: rootPath,
    fs: createNodeHarnessFs(),
  });
}

describe('harnessLoader — cold load on fixture-a', () => {
  it('returns 20 files with 12 algorithms + 8 docs', async () => {
    const loader = buildLoader(path.join(FIXTURES, 'harness-fixture-a'));
    const bundle = await loader.getHarness();
    expect(bundle.metadata.fileCount).toBe(20);
    expect(bundle.metadata.algorithms.length).toBe(12);
    expect(bundle.metadata.docs.length).toBe(8);
    expect(bundle.metadata.other.length).toBe(0);
    // Token estimate is positive and bounded — actual bytes-per-token depends
    // on the fixture; assert it sits in a reasonable band.
    expect(bundle.metadata.approxTokens).toBeGreaterThan(50);
    expect(bundle.metadata.approxTokens).toBeLessThan(50_000);
    expect(bundle.metadata.warnings).toEqual([]);
    expect(bundle.metadata.manifestUsed).toBe(false);
  });

  it('text envelope matches the D5/D6 byte-for-byte format', async () => {
    const loader = buildLoader(path.join(FIXTURES, 'harness-fixture-a'));
    const bundle = await loader.getHarness();
    expect(bundle.text.startsWith(`${HARNESS_ENVELOPE_OPENER}\n`)).toBe(true);
    // Each included file shows up as exactly one `### FILE: <relPath>\n\n`
    // header. Counting headers should equal fileCount.
    const headerCount = bundle.text.split(HARNESS_FILE_HEADER_PREFIX).length - 1;
    expect(headerCount).toBe(bundle.metadata.fileCount);
    // The canonical separator `\n\n---\n\n` appears once at the end of the
    // envelope header AND once after each file body — so the total is
    // fileCount + 1.
    const sepCount = bundle.text.split(HARNESS_FILE_SEPARATOR).length - 1;
    expect(sepCount).toBe(bundle.metadata.fileCount + 1);
    // Spot-check the first header — alphabetical first file is breakout/filter.ts.
    expect(bundle.text).toContain('### FILE: algorithms/breakout/filter.ts\n\n');
  });

  it('two cold loads produce byte-identical bundle text (deterministic ordering — D4)', async () => {
    const a = await buildLoader(path.join(FIXTURES, 'harness-fixture-a')).getHarness();
    const b = await buildLoader(path.join(FIXTURES, 'harness-fixture-a')).getHarness();
    // Strip the envelope header — it carries the load timestamp which is
    // expected to differ. The post-envelope body is what must be deterministic.
    const stripEnvelope = (s: string): string => s.split('---\n\n').slice(1).join('---\n\n');
    expect(stripEnvelope(a.text)).toBe(stripEnvelope(b.text));
  });
});

describe('harnessLoader — empty directory (PRD §0 D19)', () => {
  it('returns fileCount=0 with the empty-directory warning, no throw', async () => {
    const loader = buildLoader(path.join(FIXTURES, 'harness-fixture-empty'));
    const bundle = await loader.getHarness();
    expect(bundle.metadata.fileCount).toBe(0);
    expect(bundle.metadata.warnings).toContain('empty harness directory');
  });
});

describe('harnessLoader — mixed fixture (PRD §0 D2/D3/D12/D13)', () => {
  it('excludes .json/.png/node_modules/.env/oversize/.pdf and the suspicious-content blob', async () => {
    const loader = buildLoader(path.join(FIXTURES, 'harness-fixture-mixed'));
    const bundle = await loader.getHarness();
    // Only `algorithms/keep.ts` survives.
    expect(bundle.metadata.fileCount).toBe(1);
    expect(bundle.metadata.algorithms).toEqual(['algorithms/keep.ts']);
    // The bundle must NOT include the secret blob anywhere.
    expect(bundle.text).not.toContain('SECRET_API_KEY');
    expect(bundle.text).not.toContain('X8aF42BqWmZ9pLkQv6hN3rTuJyEsCxDgVbHcMnPo7');
    // Warnings should mention the suspicious + oversize + pdf skips.
    const joined = bundle.metadata.warnings.join(' | ');
    expect(joined).toMatch(/suspicious filename/i);
    expect(joined).toMatch(/suspicious content/i);
    expect(joined).toMatch(/oversize/i);
    expect(joined).toMatch(/pdf files skipped/i);
  });
});

describe('harnessLoader — concurrent getHarness() dedup (PRD §0 D11)', () => {
  it('ten concurrent calls share one in-flight load, all resolve to the same reference', async () => {
    const loader = buildLoader(path.join(FIXTURES, 'harness-fixture-a'));
    const results = await Promise.all(
      Array.from({ length: 10 }, () => loader.getHarness()),
    );
    for (const r of results) {
      expect(r).toBe(results[0]);
    }
  });
});

describe('harnessLoader — reload invalidates the cache', () => {
  let scratchRoot: string;

  beforeEach(async () => {
    scratchRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'harness-loader-'));
    await fsp.mkdir(path.join(scratchRoot, 'algorithms'), { recursive: true });
    await fsp.writeFile(
      path.join(scratchRoot, 'algorithms', 'a.ts'),
      'export const A = 1;\n',
      'utf8',
    );
  });

  afterEach(async () => {
    await fsp.rm(scratchRoot, { recursive: true, force: true });
  });

  it('reload() picks up file edits + bumps loadedAt', async () => {
    const loader = buildLoader(scratchRoot);
    const first = await loader.getHarness();
    expect(first.text).toContain('export const A = 1;');

    // Sleep just enough that loadedAt has a chance to differ.
    await new Promise<void>((r) => setTimeout(r, 5));

    await fsp.writeFile(
      path.join(scratchRoot, 'algorithms', 'a.ts'),
      'export const A = 2;\n',
      'utf8',
    );
    const second = await loader.reload();
    expect(second.text).toContain('export const A = 2;');
    expect(second.text).not.toContain('export const A = 1;');
    expect(second.metadata.loadedAt).toBeGreaterThanOrEqual(first.metadata.loadedAt);
  });
});

describe('harnessLoader — manifest applied (PRD §0 D14)', () => {
  it('honors include/exclude/priority and reports manifestUsed=true', async () => {
    const loader = buildLoader(path.join(FIXTURES, 'harness-fixture-manifested'));
    const bundle = await loader.getHarness();
    expect(bundle.metadata.manifestUsed).toBe(true);
    // Excluded file is not in the bundle.
    expect(bundle.text).not.toContain('# Exclude me');
    expect(bundle.text).toContain('# Keep this');
    // Priority order: zeta.ts comes before alpha.ts despite alphabetical
    // ordering otherwise.
    const zetaIdx = bundle.text.indexOf('algorithms/zeta.ts');
    const alphaIdx = bundle.text.indexOf('algorithms/alpha.ts');
    const betaIdx = bundle.text.indexOf('algorithms/beta.ts');
    expect(zetaIdx).toBeLessThan(alphaIdx);
    expect(alphaIdx).toBeLessThan(betaIdx);
  });
});

describe('harnessLoader — malformed manifest preserves the previous cache', () => {
  let scratchRoot: string;

  beforeEach(async () => {
    scratchRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'harness-loader-bad-'));
    await fsp.writeFile(path.join(scratchRoot, 'a.ts'), 'export const A = 1;\n', 'utf8');
  });

  afterEach(async () => {
    await fsp.rm(scratchRoot, { recursive: true, force: true });
  });

  it('throws MANIFEST_INVALID and leaves the previous bundle in place', async () => {
    const loader = buildLoader(scratchRoot);
    const good = await loader.getHarness();
    expect(good.metadata.fileCount).toBe(1);

    await fsp.writeFile(path.join(scratchRoot, 'HARNESS_INDEX.json'), '{not json', 'utf8');

    await expect(loader.reload()).rejects.toBeInstanceOf(HarnessLoadError);
    // The previous cache is preserved — `getHarness()` still returns the
    // good bundle.
    const after = await loader.getHarness();
    expect(after.metadata.fileCount).toBe(1);
    expect(after.text).toContain('export const A = 1;');
  });
});

describe('harnessLoader — token ceiling enforced (PRD §0 D8)', () => {
  it('throws TOKEN_CEILING_EXCEEDED on the oversize fixture', async () => {
    const loader = buildLoader(path.join(FIXTURES, 'harness-fixture-oversize'));
    await expect(loader.getHarness()).rejects.toMatchObject({
      payload: { code: 'TOKEN_CEILING_EXCEEDED' },
    });
  });
});

describe('harnessLoader — setRootPath ROOT_NOT_FOUND', () => {
  it('rejects ROOT_NOT_FOUND, leaving the previous bundle as the cached value', async () => {
    const loader = buildLoader(path.join(FIXTURES, 'harness-fixture-a'));
    const good = await loader.getHarness();

    await expect(
      loader.setRootPath(path.join(FIXTURES, 'this-folder-does-not-exist')),
    ).rejects.toMatchObject({
      payload: { code: 'ROOT_NOT_FOUND' },
    });

    // Previous bundle still cached.
    const after = await loader.getHarness();
    expect(after).toBe(good);
    // Root rolled back.
    expect(loader.getRootPath()).toBe(path.join(FIXTURES, 'harness-fixture-a'));
  });
});
