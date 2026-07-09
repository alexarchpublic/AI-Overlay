/**
 * @file src/shared/knowledgeTypes.ts
 *
 * Docs-corpus knowledge model for the internal sales/CS co-pilot (PRD D-P2/D-P11).
 * Chunks are verbatim published documentation — not hand-curated abstractions.
 */

/** Algorithm ids selectable in the chat header (D-P10). `'all'` boosts nothing. */
export type AlgorithmId = 'market-wave' | 'arbitrage' | 'intelligence' | 'apex';

export type ActiveAlgorithm = AlgorithmId | 'all';

/**
 * One retrieval-sized unit from the ingested docs corpus.
 * Produced by `npm run ingest:docs`; consumed by KnowledgeStore.
 */
export interface DocChunk {
  id: string;
  pageSlug: string;
  pageTitle: string;
  sourceUrl: string;
  /** Heading path from page title through H2/H3/H4. */
  sectionPath: string[];
  /** Verbatim markdown body for this section (tables intact; figures processed). */
  text: string;
  /** Absolute image URLs hoisted from `<figure>` blocks. */
  imageUrls: string[];
  tokenEstimate: number;
}

/** One page entry in the docs bundle manifest. */
export interface DocsBundlePageMeta {
  slug: string;
  sourceUrl: string;
  contentHash: string;
  tokenEstimate: number;
}

/** Manifest written into each docs bundle (PRD D-P3). */
export interface DocsBundleManifest {
  schemaVersion: 1;
  tier: 'docs';
  fetchedAt: string;
  /** SHA-256 hex over canonical chunk ordering (ids + text). */
  contentHash: string;
  pages: DocsBundlePageMeta[];
  totalTokenEstimate: number;
  chunkCount: number;
}

/** On-disk bundle artifact from `npm run ingest:docs`. */
export interface DocsKnowledgeBundle {
  manifest: DocsBundleManifest;
  chunks: DocChunk[];
}

/** Scoped retrieval request. */
export interface RetrievalQuery {
  text: string;
  chartContext?: string;
  /** When set, boosts chunks from that algorithm's guide pages (D-P4 / D-P10). */
  activeAlgorithm?: ActiveAlgorithm;
  /** Max chunks to return. Defaults to `DEFAULT_RETRIEVAL_K`. */
  k?: number;
  /** Approximate token ceiling for returned chunk text. */
  tokenBudget?: number;
}

/**
 * The only way runtime components read docs-corpus knowledge (PRD D-P11).
 * Backend selection is config-only — call sites depend on this interface.
 */
export interface KnowledgeStore {
  /** Load the local index or connect to remote backend. Idempotent. */
  init(): Promise<void>;
  /** Minimum relevant doc chunks for the query. */
  retrieve(query: RetrievalQuery): Promise<DocChunk[]>;
  /** Bundle content hash for cache invalidation + audit. */
  version(): Promise<string>;
}

/** Metadata stored beside a local index (hash for invalidation). */
export interface KnowledgeIndexMeta {
  schemaVersion: 1;
  contentHash: string;
  chunkCount: number;
  encryptedAt: string;
}
