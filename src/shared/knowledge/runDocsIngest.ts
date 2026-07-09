/**
 * @file src/shared/knowledge/runDocsIngest.ts
 *
 * End-to-end docs ingest (PRD D-P2 / D-P3). Invoked by `scripts/ingest-docs.mjs`
 * after an esbuild bundle step so the CLI can import TypeScript sources.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DOCS_LLMS_TXT_URL,
  FULL_CORPUS_INJECTION_THRESHOLD,
  KNOWLEDGE_BUNDLES_DIR,
  KNOWLEDGE_DOCS_CORPUS_DIR,
} from '../knowledgeConstants';
import type { DocChunk, DocsBundlePageMeta } from '../knowledgeTypes';
import { writeDocsBundle } from './bundleBuilder';
import {
  chunkPageMarkdown,
  hashPageContent,
  parseLlmsTxt,
  stripAgentInstructions,
  type DocsPageLink,
} from './docsIngest';
import { estimateTokensFromChars } from '../tokenEstimate';

export interface IngestDocsOptions {
  /** Repo root (contains `knowledge/`). */
  rootDir: string;
  /** Override llms.txt URL (tests). */
  llmsTxtUrl?: string;
  /** Injected fetch (tests). */
  fetchFn?: typeof fetch;
  /** Skip network; provide preloaded pages keyed by slug (tests). */
  fixturePages?: ReadonlyMap<string, { title: string; sourceUrl: string; markdown: string }>;
  fixtureLlmsTxt?: string;
}

export interface IngestDocsResult {
  bundlePath: string;
  contentHash: string;
  totalTokenEstimate: number;
  pageCount: number;
  chunkCount: number;
  useFullCorpusInjection: boolean;
  pages: DocsBundlePageMeta[];
}

async function fetchText(url: string, fetchFn: typeof fetch): Promise<string> {
  let response: Response;
  try {
    response = await fetchFn(url);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to fetch ${url}: ${detail}`);
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${String(response.status)}`);
  }
  return response.text();
}

function printSummary(result: IngestDocsResult): void {
  const rows = result.pages.map((p) => ({
    slug: p.slug,
    tokens: p.tokenEstimate,
    hash: p.contentHash.slice(0, 12),
  }));
  console.info('[ingest:docs] pages:');
  console.table(rows);
  console.info(
    `[ingest:docs] totalTokenEstimate=${String(result.totalTokenEstimate)} ` +
      `chunks=${String(result.chunkCount)} ` +
      `contentHash=${result.contentHash.slice(0, 12)}… ` +
      `bundle=${result.bundlePath}`,
  );
  console.info(
    `[ingest:docs] FULL_CORPUS_INJECTION_THRESHOLD=${String(FULL_CORPUS_INJECTION_THRESHOLD)} → ` +
      `useFullCorpusInjection=${String(result.useFullCorpusInjection)}`,
  );
}

/**
 * Fetch llms.txt + every page, snapshot corpus, chunk, emit docs bundle.
 * Any page fetch failure aborts with a non-zero-worthy Error naming the URL.
 */
export async function runDocsIngest(options: IngestDocsOptions): Promise<IngestDocsResult> {
  const fetchFn = options.fetchFn ?? fetch;
  const corpusDir = path.join(options.rootDir, KNOWLEDGE_DOCS_CORPUS_DIR);
  const bundleDir = path.join(options.rootDir, KNOWLEDGE_BUNDLES_DIR);
  await mkdir(corpusDir, { recursive: true });
  await mkdir(bundleDir, { recursive: true });

  let links: DocsPageLink[];
  if (options.fixtureLlmsTxt !== undefined) {
    links = parseLlmsTxt(options.fixtureLlmsTxt);
  } else if (options.fixturePages) {
    links = [...options.fixturePages.entries()].map(([slug, page]) => ({
      slug,
      title: page.title,
      url: page.sourceUrl,
    }));
  } else {
    const llmsUrl = options.llmsTxtUrl ?? DOCS_LLMS_TXT_URL;
    const llmsTxt = await fetchText(llmsUrl, fetchFn);
    links = parseLlmsTxt(llmsTxt);
  }

  if (links.length === 0) {
    throw new Error('llms.txt contained no page links');
  }

  const fetchedAt = new Date().toISOString();
  const allChunks: DocChunk[] = [];
  const pages: DocsBundlePageMeta[] = [];

  for (const link of links) {
    let markdown: string;
    let sourceUrl = link.url;
    let title = link.title;

    const fixture = options.fixturePages?.get(link.slug);
    if (fixture) {
      markdown = fixture.markdown;
      sourceUrl = fixture.sourceUrl;
      title = fixture.title;
    } else {
      markdown = await fetchText(link.url, fetchFn);
    }

    // Snapshot is the page body with Agent Instructions stripped (committed, diffable).
    const snapshot = stripAgentInstructions(markdown);
    const snapshotPath = path.join(corpusDir, `${link.slug}.md`);
    await writeFile(snapshotPath, `${snapshot}\n`, 'utf8');

    const chunks = chunkPageMarkdown({
      pageSlug: link.slug,
      pageTitle: title,
      sourceUrl,
      markdown: snapshot,
    });
    allChunks.push(...chunks);

    const pageTokens = chunks.reduce((n, c) => n + c.tokenEstimate, 0);
    // Prefer chunk sum; fall back to raw snapshot estimate if a page yielded no chunks.
    const tokenEstimate =
      pageTokens > 0 ? pageTokens : estimateTokensFromChars(snapshot.length);

    pages.push({
      slug: link.slug,
      sourceUrl,
      contentHash: hashPageContent(snapshot),
      tokenEstimate,
    });
  }

  const { bundlePath, bundle } = await writeDocsBundle({
    outputDir: bundleDir,
    chunks: allChunks,
    pages,
    fetchedAt,
    pruneOld: true,
  });

  const result: IngestDocsResult = {
    bundlePath,
    contentHash: bundle.manifest.contentHash,
    totalTokenEstimate: bundle.manifest.totalTokenEstimate,
    pageCount: pages.length,
    chunkCount: allChunks.length,
    useFullCorpusInjection:
      bundle.manifest.totalTokenEstimate <= FULL_CORPUS_INJECTION_THRESHOLD,
    pages,
  };

  printSummary(result);
  return result;
}
