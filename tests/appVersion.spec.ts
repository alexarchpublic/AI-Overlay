/**
 * @file tests/appVersion.spec.ts
 *
 * Chunk 7 Phase 2.5 — package.json is the single source of truth for the app
 * version. Guard against reintroducing a hardcoded `APP_VERSION = 'x.y.z'`.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');

describe('APP_VERSION drift guard (Chunk 7 §3.8 grep contract #2)', () => {
  it('does not assign a semver string literal to APP_VERSION in constants.ts', () => {
    const constantsPath = path.join(ROOT, 'src/shared/constants.ts');
    const source = readFileSync(constantsPath, 'utf8');
    const assignment = /APP_VERSION\s*=\s*['"`]\d+\.\d+\.\d+/;
    expect(source).not.toMatch(assignment);
  });

  it('has no APP_VERSION = \'…\' assignment anywhere under src/', () => {
    // Mirrors: git grep -n "APP_VERSION = '" -- src/  → empty
    let output = '';
    try {
      output = execFileSync(
        'git',
        ['grep', '-n', "APP_VERSION = '", '--', 'src/'],
        { cwd: ROOT, encoding: 'utf8' },
      );
    } catch (err) {
      // git grep exits 1 when there are no matches — that's the pass case.
      const status = (err as { status?: number }).status;
      if (status === 1) {
        output = '';
      } else {
        throw err;
      }
    }
    expect(output.trim()).toBe('');
  });
});
