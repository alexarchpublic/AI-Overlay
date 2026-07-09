/**
 * @file src/shared/knowledge/docsIngest.ts
 *
 * Pure docs-corpus ingest helpers (PRD D-P2 / D-P3):
 *   - parse llms.txt page links
 *   - strip GitBook Agent Instructions
 *   - hoist <figure> images / keep figcaptions
 *   - chunk by heading with MAX_CHUNK_TOKENS splits
 *
 * Network I/O lives in `scripts/ingest-docs.mjs`; this module is unit-tested.
 */

import { createHash } from 'node:crypto';
import { DOCS_SITE_ORIGIN, MAX_CHUNK_TOKENS } from '../knowledgeConstants';
import type { DocChunk } from '../knowledgeTypes';
import { estimateTokensFromChars } from '../tokenEstimate';

export interface DocsPageLink {
  title: string;
  /** Absolute page URL (may already end in `.md`). */
  url: string;
  /** Filename stem used for `knowledge/docs-corpus/<slug>.md`. */
  slug: string;
}

export interface ChunkPageOptions {
  pageSlug: string;
  pageTitle: string;
  sourceUrl: string;
  markdown: string;
  maxChunkTokens?: number;
}

const MD_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
const AGENT_INSTRUCTIONS_RE = /^#\s+Agent Instructions\s*$/im;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
const FIGURE_RE =
  /<figure>\s*<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<figcaption>([\s\S]*?)<\/figcaption>\s*<\/figure>/gi;

/** Derive a stable slug from a docs page URL. */
export function slugFromUrl(url: string): string {
  const pathname = new URL(url).pathname;
  const base = pathname.split('/').filter(Boolean).pop() ?? 'page';
  return base.replace(/\.md$/i, '');
}

/**
 * Ensure the fetch URL ends with `.md` (GitBook clean-markdown endpoint).
 * llms.txt already lists `.md` URLs today; this is defensive for drift.
 */
export function ensureMarkdownUrl(url: string): string {
  const parsed = new URL(url);
  if (!parsed.pathname.toLowerCase().endsWith('.md')) {
    parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}.md`;
  }
  return parsed.toString();
}

/** Parse markdown links from llms.txt into page descriptors. */
export function parseLlmsTxt(llmsTxt: string): DocsPageLink[] {
  const links: DocsPageLink[] = [];
  const seen = new Set<string>();
  for (const match of llmsTxt.matchAll(MD_LINK_RE)) {
    const title = match[1].trim();
    const rawUrl = match[2].trim();
    if (!title || !rawUrl) continue;
    if (!rawUrl.startsWith(DOCS_SITE_ORIGIN)) continue;
    const url = ensureMarkdownUrl(rawUrl);
    const slug = slugFromUrl(url);
    if (seen.has(slug)) continue;
    seen.add(slug);
    links.push({ title, url, slug });
  }
  return links;
}

/** Strip everything from the `# Agent Instructions` heading to EOF. */
export function stripAgentInstructions(markdown: string): string {
  const match = AGENT_INSTRUCTIONS_RE.exec(markdown);
  if (match?.index === undefined) return markdown.trimEnd();
  return markdown.slice(0, match.index).trimEnd();
}

/** Resolve a possibly-relative image src against the docs origin. */
export function resolveDocsImageUrl(src: string, baseOrigin = DOCS_SITE_ORIGIN): string {
  try {
    return new URL(src, baseOrigin).toString();
  } catch {
    return src;
  }
}

export interface FigureProcessResult {
  /** Markdown with figures replaced by figcaption text (when present). */
  text: string;
  imageUrls: string[];
}

/**
 * Keep figcaption text inline; hoist `img src` (absolute) into `imageUrls`.
 * Empty figcaptions leave no inline residue.
 */
export function processFigures(markdown: string, baseOrigin = DOCS_SITE_ORIGIN): FigureProcessResult {
  const imageUrls: string[] = [];
  const text = markdown.replace(FIGURE_RE, (_full, src: string, captionHtml: string) => {
    const absolute = resolveDocsImageUrl(src, baseOrigin);
    imageUrls.push(absolute);
    const caption = captionHtml.replace(/<[^>]+>/g, '').trim();
    return caption.length > 0 ? caption : '';
  });
  return { text, imageUrls };
}

function estimateTextTokens(text: string): number {
  return estimateTokensFromChars(text.length);
}

function slugifyHeading(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function makeChunkId(pageSlug: string, sectionPath: readonly string[], disambiguator: number): string {
  const pathSlug = sectionPath.map(slugifyHeading).filter(Boolean).join('--') || 'body';
  const base = `${pageSlug}--${pathSlug}`;
  return disambiguator === 0 ? base : `${base}--${String(disambiguator)}`;
}

interface RawSection {
  /** Path including page title and H2 (H3+ still inside body until split). */
  sectionPath: string[];
  rawBody: string;
}

/**
 * Split page markdown into H2-primary sections. Preamble (before first H2)
 * becomes its own section under the page title. Nested H3/H4 stay in the
 * body for the oversized splitter.
 */
function splitIntoH2Sections(markdown: string, pageTitle: string): RawSection[] {
  const lines = markdown.split(/\r?\n/);
  const sections: RawSection[] = [];
  let currentH2: string | null = null;
  const buf: string[] = [];
  const preamble: string[] = [];
  let seenH1 = false;

  function flushH2(): void {
    if (currentH2 === null) return;
    sections.push({
      sectionPath: [pageTitle, currentH2],
      rawBody: buf.join('\n').trim(),
    });
    buf.length = 0;
    currentH2 = null;
  }

  for (const line of lines) {
    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = heading[1].length;
      const title = heading[2].trim();
      if (level === 1 && !seenH1 && currentH2 === null && sections.length === 0) {
        seenH1 = true;
        // Page H1 — skip; title comes from options / this heading.
        continue;
      }
      if (level === 2) {
        if (currentH2 === null && preamble.length > 0) {
          const pre = preamble.join('\n').trim();
          if (pre) sections.push({ sectionPath: [pageTitle], rawBody: pre });
          preamble.length = 0;
        }
        flushH2();
        currentH2 = title;
        continue;
      }
    }
    if (currentH2 !== null) {
      buf.push(line);
    } else {
      preamble.push(line);
    }
  }

  if (currentH2 === null && preamble.length > 0) {
    const pre = preamble.join('\n').trim();
    if (pre) sections.push({ sectionPath: [pageTitle], rawBody: pre });
  } else {
    flushH2();
  }

  return sections;
}

/**
 * Split an oversized section at H3 then H4. Never mid-table: if still over
 * budget after H4 splits, emit the piece as-is.
 */
function splitOversized(
  body: string,
  basePath: readonly string[],
  maxTokens: number,
  splitLevel: number,
): { sectionPath: string[]; text: string }[] {
  if (estimateTextTokens(body) <= maxTokens || splitLevel > 4) {
    return [{ sectionPath: [...basePath], text: body }];
  }

  const lines = body.split(/\r?\n/);
  const parts: { title: string | null; body: string }[] = [];
  let currentTitle: string | null = null;
  const buf: string[] = [];
  const lead: string[] = [];
  let foundSplit = false;

  function flushPart(): void {
    const text = buf.join('\n').trim();
    buf.length = 0;
    if (!text && currentTitle === null) return;
    parts.push({ title: currentTitle, body: text });
  }

  for (const line of lines) {
    const heading = HEADING_RE.exec(line);
    const headingMarks = heading?.[1] ?? '';
    if (heading && headingMarks.length === splitLevel) {
      foundSplit = true;
      if (currentTitle === null && lead.length > 0) {
        const leadText = lead.join('\n').trim();
        lead.length = 0;
        if (leadText) parts.push({ title: null, body: leadText });
      } else if (currentTitle !== null || buf.length > 0) {
        flushPart();
      }
      currentTitle = heading[2].trim();
      continue;
    }
    if (currentTitle !== null) {
      buf.push(line);
    } else {
      lead.push(line);
    }
  }

  if (!foundSplit) {
    return splitOversized(body, basePath, maxTokens, splitLevel + 1);
  }

  if (currentTitle !== null || buf.length > 0) flushPart();
  else if (lead.length > 0) {
    const leadText = lead.join('\n').trim();
    if (leadText) parts.push({ title: null, body: leadText });
  }

  const out: { sectionPath: string[]; text: string }[] = [];
  for (const part of parts) {
    const path = part.title ? [...basePath, part.title] : [...basePath];
    out.push(...splitOversized(part.body, path, maxTokens, splitLevel + 1));
  }
  return out.length > 0 ? out : [{ sectionPath: [...basePath], text: body }];
}

/**
 * Chunk a single page's markdown into DocChunks (H2 primary; split oversized
 * at H3/H4). Verbatim — no summarization.
 */
export function chunkPageMarkdown(options: ChunkPageOptions): DocChunk[] {
  const maxTokens = options.maxChunkTokens ?? MAX_CHUNK_TOKENS;
  const stripped = stripAgentInstructions(options.markdown);

  // Prefer explicit H1 from the page body when options.pageTitle is a link label.
  let pageTitle = options.pageTitle;
  for (const line of stripped.split(/\r?\n/)) {
    const h1 = /^#\s+(.+?)\s*$/.exec(line);
    if (h1?.[1]) {
      pageTitle = h1[1].trim();
      break;
    }
  }

  const sections = splitIntoH2Sections(stripped, pageTitle);
  if (sections.length === 0) {
    const { text, imageUrls } = processFigures(stripped);
    const body = text.trim();
    if (!body && imageUrls.length === 0) return [];
    return [
      {
        id: makeChunkId(options.pageSlug, [pageTitle], 0),
        pageSlug: options.pageSlug,
        pageTitle,
        sourceUrl: options.sourceUrl,
        sectionPath: [pageTitle],
        text: body,
        imageUrls,
        tokenEstimate: estimateTextTokens(body),
      },
    ];
  }

  const chunks: DocChunk[] = [];
  const idCounts = new Map<string, number>();

  for (const section of sections) {
    const { text: processed, imageUrls } = processFigures(section.rawBody);
    const cleaned = processed.replace(/\n{3,}/g, '\n\n').trim();
    if (!cleaned && imageUrls.length === 0) continue;

    const pieces = splitOversized(cleaned, section.sectionPath, maxTokens, 3);
    for (const [i, piece] of pieces.entries()) {
      const text = piece.text.trim();
      if (!text && (i > 0 || imageUrls.length === 0)) continue;

      const baseId = makeChunkId(options.pageSlug, piece.sectionPath, 0);
      const prior = idCounts.get(baseId) ?? 0;
      idCounts.set(baseId, prior + 1);

      chunks.push({
        id: makeChunkId(options.pageSlug, piece.sectionPath, prior),
        pageSlug: options.pageSlug,
        pageTitle,
        sourceUrl: options.sourceUrl,
        sectionPath: piece.sectionPath,
        text,
        imageUrls: i === 0 ? imageUrls : [],
        tokenEstimate: estimateTextTokens(text),
      });
    }
  }

  return chunks;
}

/** SHA-256 over canonical chunk ordering (id + text). */
export function computeDocsContentHash(chunks: readonly DocChunk[]): string {
  const ordered = [...chunks].sort((a, b) => a.id.localeCompare(b.id));
  const input = ordered.map((c) => `${c.id}\0${c.text}`).join('\n');
  return createHash('sha256').update(input).digest('hex');
}

/** SHA-256 of a single page's raw snapshot (for manifest per-page hash). */
export function hashPageContent(markdown: string): string {
  return createHash('sha256').update(markdown).digest('hex');
}
