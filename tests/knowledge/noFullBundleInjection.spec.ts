/**
 * @file tests/knowledge/noFullBundleInjection.spec.ts
 * Phase 0 task 3 — live model context must not use harness full-bundle injection.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

describe('no full-bundle injection in live serving path', () => {
  it('geminiService does not call harnessLoader.getHarness()', () => {
    const source = readFileSync(
      path.join(process.cwd(), 'src/main/geminiService.ts'),
      'utf8',
    );
    expect(source.includes('getHarness')).toBe(false);
    expect(source.includes('HarnessLoader')).toBe(false);
    expect(source.includes('HARNESS_ENVELOPE_OPENER')).toBe(false);
    expect(source.includes('knowledgeStore')).toBe(true);
    expect(source.includes('knowledgeChunks')).toBe(true);
  });

  it('runChatSend retrieves scoped knowledge instead of harness metadata tokens', () => {
    const source = readFileSync(path.join(process.cwd(), 'src/main/index.ts'), 'utf8');
    const runChatSend = source.slice(source.indexOf('async function runChatSend'));
    expect(runChatSend.includes('store.retrieve(')).toBe(true);
    expect(runChatSend.includes('harnessApproxTokens')).toBe(false);
    expect(runChatSend.includes('knowledgeApproxTokens')).toBe(true);
    expect(runChatSend.includes('loader.getMetadata()')).toBe(false);
  });
});
