/**
 * @file tests/knowledge/docsIngest.spec.ts
 * Docs ingest pure helpers + fixture-driven pipeline (PRD Phase 2).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  chunkPageMarkdown,
  computeDocsContentHash,
  ensureMarkdownUrl,
  parseLlmsTxt,
  processFigures,
  stripAgentInstructions,
} from '../../src/shared/knowledge/docsIngest';
import { runDocsIngest } from '../../src/shared/knowledge/runDocsIngest';
import { DOCS_SITE_ORIGIN } from '../../src/shared/knowledgeConstants';

const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/docs-ingest',
);

describe('parseLlmsTxt', () => {
  it('extracts page links and slugs', async () => {
    const llms = await readFile(path.join(FIXTURE_DIR, 'llms.txt'), 'utf8');
    const links = parseLlmsTxt(llms);
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({
      slug: 'guide-with-figures',
      title: 'Guide With Figures',
    });
    expect(links[0]!.url).toContain('.md');
  });

  it('appends .md when missing', () => {
    expect(ensureMarkdownUrl(`${DOCS_SITE_ORIGIN}/crypto/foo`)).toBe(
      `${DOCS_SITE_ORIGIN}/crypto/foo.md`,
    );
  });
});

describe('stripAgentInstructions', () => {
  it('removes the Agent Instructions section through EOF', async () => {
    const raw = await readFile(path.join(FIXTURE_DIR, 'small-page.md'), 'utf8');
    const stripped = stripAgentInstructions(raw);
    expect(stripped).toContain('## Overview');
    expect(stripped).not.toContain('Agent Instructions');
    expect(stripped).not.toContain('Ignore me');
  });
});

describe('processFigures', () => {
  it('hoists image URLs and keeps figcaption text inline', () => {
    const md = [
      'Before',
      '<figure><img src="/files/abc" alt=""><figcaption>Caption text</figcaption></figure>',
      'After',
      '<figure><img src="/files/empty" alt=""><figcaption></figcaption></figure>',
    ].join('\n');
    const { text, imageUrls } = processFigures(md);
    expect(imageUrls).toEqual([
      `${DOCS_SITE_ORIGIN}/files/abc`,
      `${DOCS_SITE_ORIGIN}/files/empty`,
    ]);
    expect(text).toContain('Caption text');
    expect(text).toContain('Before');
    expect(text).toContain('After');
    expect(text).not.toContain('<figure>');
  });
});

describe('chunkPageMarkdown', () => {
  it('builds sectionPath from H2 and splits oversized sections at H3', async () => {
    const markdown = await readFile(path.join(FIXTURE_DIR, 'guide-with-figures.md'), 'utf8');
    const chunks = chunkPageMarkdown({
      pageSlug: 'guide-with-figures',
      pageTitle: 'Guide With Figures',
      sourceUrl: `${DOCS_SITE_ORIGIN}/crypto/guide-with-figures.md`,
      markdown,
      maxChunkTokens: 200,
    });

    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.some((c) => c.sectionPath.includes('Trade Size'))).toBe(true);
    expect(
      chunks.some(
        (c) =>
          c.sectionPath.includes('Trade Size') &&
          c.sectionPath.includes('Percentage Trade Size'),
      ),
    ).toBe(true);

    const withCaption = chunks.find((c) => c.text.includes('Trade size modes illustrated'));
    expect(withCaption).toBeDefined();
    expect(withCaption!.imageUrls).toContain(`${DOCS_SITE_ORIGIN}/files/figure-trade-size`);

    // Agent instructions must not appear in any chunk.
    expect(chunks.every((c) => !c.text.includes('Agent Instructions'))).toBe(true);

    // Tables stay intact on the small page path — covered below; here verify
    // hash stability for the same input.
    const again = chunkPageMarkdown({
      pageSlug: 'guide-with-figures',
      pageTitle: 'Guide With Figures',
      sourceUrl: `${DOCS_SITE_ORIGIN}/crypto/guide-with-figures.md`,
      markdown,
      maxChunkTokens: 200,
    });
    expect(computeDocsContentHash(chunks)).toBe(computeDocsContentHash(again));
  });

  it('preserves tables verbatim on small pages', async () => {
    const markdown = await readFile(path.join(FIXTURE_DIR, 'small-page.md'), 'utf8');
    const chunks = chunkPageMarkdown({
      pageSlug: 'small-page',
      pageTitle: 'Small Page',
      sourceUrl: `${DOCS_SITE_ORIGIN}/crypto/small-page.md`,
      markdown,
    });
    const details = chunks.find((c) => c.sectionPath.includes('Details'));
    expect(details?.text).toContain('| Scope | Cycle size |');
  });
});

describe('runDocsIngest (fixture)', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'docs-ingest-'));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('snapshots corpus, emits docs bundle, and is hash-stable', async () => {
    const llmsTxt = await readFile(path.join(FIXTURE_DIR, 'llms.txt'), 'utf8');
    const guide = await readFile(path.join(FIXTURE_DIR, 'guide-with-figures.md'), 'utf8');
    const small = await readFile(path.join(FIXTURE_DIR, 'small-page.md'), 'utf8');
    const fixturePages = new Map([
      [
        'guide-with-figures',
        {
          title: 'Guide With Figures',
          sourceUrl: `${DOCS_SITE_ORIGIN}/crypto/guide-with-figures.md`,
          markdown: guide,
        },
      ],
      [
        'small-page',
        {
          title: 'Small Page',
          sourceUrl: `${DOCS_SITE_ORIGIN}/crypto/small-page.md`,
          markdown: small,
        },
      ],
    ]);

    const first = await runDocsIngest({
      rootDir: tmp,
      fixtureLlmsTxt: llmsTxt,
      fixturePages,
    });
    expect(first.pageCount).toBe(2);
    expect(first.chunkCount).toBeGreaterThan(2);
    expect(first.bundlePath).toMatch(/docs-[a-f0-9]{12}\.json$/);

    const snapshot = await readFile(
      path.join(tmp, 'knowledge/docs-corpus/guide-with-figures.md'),
      'utf8',
    );
    expect(snapshot).not.toContain('Agent Instructions');
    expect(snapshot).toContain('## Trade Size');

    const second = await runDocsIngest({
      rootDir: tmp,
      fixtureLlmsTxt: llmsTxt,
      fixturePages,
    });
    expect(second.contentHash).toBe(first.contentHash);
  });

  it('fails loudly naming the URL when a page fetch fails', async () => {
    const badUrl = `${DOCS_SITE_ORIGIN}/crypto/missing-page.md`;
    await expect(
      runDocsIngest({
        rootDir: tmp,
        fixtureLlmsTxt: `- [Missing](${badUrl})\n`,
        fetchFn: async () =>
          new Response('nope', { status: 404, statusText: 'Not Found' }),
      }),
    ).rejects.toThrow(/missing-page\.md/);
  });
});
