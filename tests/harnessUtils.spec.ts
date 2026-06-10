/**
 * @file tests/harnessUtils.spec.ts
 *
 * Why it exists: PRD §5 DoD #19 — `harnessUtils.spec.ts` covers ≥ 6 cases
 * across extension matching, ignore globs, dotfile rules, classification,
 * suspicious-name detection, suspicious-content (high entropy) detection,
 * size cap, manifest parsing + glob, and the priority ordering routine.
 *
 * All functions under test are pure — no fs / Electron / chokidar.
 */

import { describe, it, expect } from 'vitest';
import {
  applyManifestToPath,
  classifyFile,
  comparePosixRelPaths,
  containsHighEntropyLine,
  estimateTokens,
  exceedsMaxFileBytes,
  hasIgnoredSuffix,
  hasSupportedExtension,
  hasSuspiciousFilename,
  isIgnoredDotfile,
  isUnderIgnoredDir,
  matchesGlob,
  orderPaths,
  parseManifest,
  passesDefaultIncludeRules,
  shannonEntropyBitsPerChar,
  toPosixRelPath,
} from '../src/main/harnessUtils';

describe('hasSupportedExtension', () => {
  it('accepts the locked PRD §0 D2 extensions case-insensitively', () => {
    for (const p of [
      'a.ts',
      'a.TSX',
      'b.js',
      'c.mjs',
      'd.cjs',
      'e.py',
      'f.md',
      'g.MDX',
      'h.txt',
    ]) {
      expect(hasSupportedExtension(p)).toBe(true);
    }
  });

  it('rejects unsupported extensions', () => {
    for (const p of ['a.json', 'b.png', 'c.pdf', 'd.csv', 'e.go']) {
      expect(hasSupportedExtension(p)).toBe(false);
    }
  });
});

describe('isUnderIgnoredDir', () => {
  it('flags every D3 directory segment', () => {
    expect(isUnderIgnoredDir('node_modules/foo.ts')).toBe(true);
    expect(isUnderIgnoredDir('a/.git/HEAD')).toBe(true);
    expect(isUnderIgnoredDir('dist/index.js')).toBe(true);
    expect(isUnderIgnoredDir('build/x.ts')).toBe(true);
    expect(isUnderIgnoredDir('.venv/lib/foo.py')).toBe(true);
    expect(isUnderIgnoredDir('a/__pycache__/x.py')).toBe(true);
  });

  it('does not flag harmless paths', () => {
    expect(isUnderIgnoredDir('algorithms/index.ts')).toBe(false);
    expect(isUnderIgnoredDir('docs/whitepaper.md')).toBe(false);
  });
});

describe('isIgnoredDotfile + hasIgnoredSuffix', () => {
  it('treats .env* as dotfiles', () => {
    expect(isIgnoredDotfile('.env')).toBe(true);
    expect(isIgnoredDotfile('.env.local')).toBe(true);
    expect(isIgnoredDotfile('.env.production')).toBe(true);
  });
  it('skips lockfiles + minified bundles', () => {
    expect(hasIgnoredSuffix('package-lock.json')).toBe(false); // wrong ext anyway
    expect(hasIgnoredSuffix('foo.lock')).toBe(true);
    expect(hasIgnoredSuffix('bundle.min.js')).toBe(true);
    expect(hasIgnoredSuffix('app.min.cjs')).toBe(true);
  });
});

describe('passesDefaultIncludeRules — composite', () => {
  it('returns true for typical algorithm + doc paths', () => {
    expect(passesDefaultIncludeRules('algorithms/x.ts')).toBe(true);
    expect(passesDefaultIncludeRules('docs/whitepaper.md')).toBe(true);
    expect(passesDefaultIncludeRules('readme.txt')).toBe(true);
  });
  it('returns false for dotfiles, ignored dirs, lockfiles, unknown ext', () => {
    expect(passesDefaultIncludeRules('.env')).toBe(false);
    expect(passesDefaultIncludeRules('node_modules/x.ts')).toBe(false);
    expect(passesDefaultIncludeRules('a.lock')).toBe(false);
    expect(passesDefaultIncludeRules('a.json')).toBe(false);
    expect(passesDefaultIncludeRules('a.png')).toBe(false);
  });
});

describe('exceedsMaxFileBytes', () => {
  it('respects the 2MB cap', () => {
    expect(exceedsMaxFileBytes(0)).toBe(false);
    expect(exceedsMaxFileBytes(1_000_000)).toBe(false);
    expect(exceedsMaxFileBytes(2 * 1024 * 1024)).toBe(false);
    expect(exceedsMaxFileBytes(2 * 1024 * 1024 + 1)).toBe(true);
  });
});

describe('classifyFile (PRD §0 D15)', () => {
  it('algorithms/* → algorithms regardless of extension', () => {
    expect(classifyFile('algorithms/x.ts')).toBe('algorithms');
    expect(classifyFile('algorithms/notes.md')).toBe('algorithms');
  });
  it('docs/* → docs regardless of extension', () => {
    expect(classifyFile('docs/x.md')).toBe('docs');
    expect(classifyFile('docs/x.ts')).toBe('docs');
  });
  it('root .md/.mdx/.txt → docs', () => {
    expect(classifyFile('readme.md')).toBe('docs');
    expect(classifyFile('overview.mdx')).toBe('docs');
    expect(classifyFile('notes.txt')).toBe('docs');
  });
  it('everything else → other', () => {
    expect(classifyFile('foo.ts')).toBe('other');
    expect(classifyFile('lib/x.py')).toBe('other');
  });
});

describe('estimateTokens (PRD §0 D7)', () => {
  it('returns 0 for empty input', () => {
    expect(estimateTokens(0)).toBe(0);
  });
  it('approximates within the documented ratio', () => {
    // PRD locks the ratio at 3.8 chars/token. 380 chars → 100 tokens exactly.
    expect(estimateTokens(380)).toBe(100);
    // 3800 chars → 1000 tokens.
    expect(estimateTokens(3800)).toBe(1000);
  });
  it('rounds up so a single char is never zero tokens', () => {
    expect(estimateTokens(1)).toBe(1);
  });
});

describe('hasSuspiciousFilename (PRD §0 D13)', () => {
  it('flags .env / .pem / .key / secret(s) / credential(s)', () => {
    expect(hasSuspiciousFilename('keys.env')).toBe(true);
    expect(hasSuspiciousFilename('cert.pem')).toBe(true);
    expect(hasSuspiciousFilename('rsa.key')).toBe(true);
    expect(hasSuspiciousFilename('SECRETS.md')).toBe(true);
    expect(hasSuspiciousFilename('credentials.json')).toBe(true);
  });
  it('does not false-positive on innocent filenames', () => {
    expect(hasSuspiciousFilename('algorithms/index.ts')).toBe(false);
    expect(hasSuspiciousFilename('readme.md')).toBe(false);
  });
});

describe('shannonEntropyBitsPerChar + containsHighEntropyLine', () => {
  it('English prose lands below the threshold', () => {
    const prose =
      'The Arch Public algorithm suite combines trend-following, mean-reversion, and breakout signals.';
    expect(containsHighEntropyLine(prose)).toBe(false);
  });
  it('a long base64-ish blob trips the threshold', () => {
    const blob = 'X8aF42BqWmZ9pLkQv6hN3rTuJyEsCxDgVbHcMnPo7KaZWqLpRtEvBn2Y';
    expect(shannonEntropyBitsPerChar(blob)).toBeGreaterThan(4.5);
    expect(containsHighEntropyLine(`KEY="${blob}"`)).toBe(true);
  });
  it('skips lines below the minimum length', () => {
    expect(containsHighEntropyLine('aB3dE')).toBe(false);
  });
});

describe('matchesGlob — minimal glob impl', () => {
  it('* matches within a single segment', () => {
    expect(matchesGlob('algorithms/foo.ts', 'algorithms/*.ts')).toBe(true);
    expect(matchesGlob('algorithms/sub/foo.ts', 'algorithms/*.ts')).toBe(false);
  });
  it('** matches across path segments', () => {
    expect(matchesGlob('algorithms/sub/foo.ts', 'algorithms/**/*.ts')).toBe(true);
    expect(matchesGlob('algorithms/foo.ts', 'algorithms/**/*.ts')).toBe(true);
  });
  it('escapes regex metacharacters', () => {
    expect(matchesGlob('a+b.ts', 'a+b.ts')).toBe(true);
  });
});

describe('parseManifest', () => {
  it('accepts a fully-populated manifest', () => {
    const r = parseManifest('{"include":["a"],"exclude":["b"],"priority":["c"]}');
    expect(r.ok).toBe(true);
    expect(r.manifest).toEqual({ include: ['a'], exclude: ['b'], priority: ['c'] });
  });
  it('rejects non-object root', () => {
    expect(parseManifest('[]').ok).toBe(false);
    expect(parseManifest('"oops"').ok).toBe(false);
  });
  it('rejects non-string-array values', () => {
    expect(parseManifest('{"include":[1]}').ok).toBe(false);
    expect(parseManifest('{"exclude":"single-string"}').ok).toBe(false);
  });
  it('returns parser error on malformed JSON', () => {
    const r = parseManifest('{not json');
    expect(r.ok).toBe(false);
    expect(typeof r.error).toBe('string');
  });
});

describe('applyManifestToPath', () => {
  it('returns "default" when no manifest is provided', () => {
    expect(applyManifestToPath('a.ts', null)).toBe('default');
  });
  it('exclude wins over include', () => {
    expect(
      applyManifestToPath('a.ts', { include: ['*.ts'], exclude: ['a.ts'] }),
    ).toBe('exclude');
  });
  it('include[] set but no match → exclude (whitelist mode)', () => {
    expect(applyManifestToPath('b.ts', { include: ['a.ts'] })).toBe('exclude');
  });
  it('include match returns "include"', () => {
    expect(applyManifestToPath('a.ts', { include: ['a.ts'] })).toBe('include');
  });
});

describe('orderPaths + comparePosixRelPaths', () => {
  it('alphabetical when no priority', () => {
    expect(orderPaths(['c', 'a', 'b'], null)).toEqual(['a', 'b', 'c']);
  });
  it('priority comes first, alphabetical after', () => {
    expect(
      orderPaths(['a', 'b', 'c', 'd'], { priority: ['c', 'a'] }),
    ).toEqual(['c', 'a', 'b', 'd']);
  });
  it('priority entries that do not exist in paths are silently dropped', () => {
    expect(
      orderPaths(['a', 'b'], { priority: ['missing', 'a'] }),
    ).toEqual(['a', 'b']);
  });
  it('comparator is case-sensitive (PRD §0 D4)', () => {
    expect(comparePosixRelPaths('A', 'a')).toBeLessThan(0);
    expect(comparePosixRelPaths('a', 'a')).toBe(0);
  });
});

describe('toPosixRelPath', () => {
  it('produces forward-slash relative paths', () => {
    // Using simple POSIX inputs; the function relies on path.relative + path.sep.
    expect(toPosixRelPath('/root', '/root/algorithms/foo.ts')).toBe(
      'algorithms/foo.ts',
    );
  });
});
