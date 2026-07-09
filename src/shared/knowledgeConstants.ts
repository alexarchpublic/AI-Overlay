/**
 * @file src/shared/knowledgeConstants.ts
 *
 * Knowledge-store config keys, retrieval budgets, and algorithm page maps
 * for the internal sales/CS co-pilot (PRD D-P3 / D-P4 / D-P10 / D-P11).
 */

import type { AlgorithmId } from './knowledgeTypes';

/** Runtime knowledge backend selection (factory seam retained). */
export type KnowledgeBackend = 'local' | 'remote';

export const KNOWLEDGE_STORE_KEY_BACKEND = 'knowledge.backend';

export const DEFAULT_KNOWLEDGE_BACKEND: KnowledgeBackend = 'local';

/** Repo-relative bundle directory produced by `npm run ingest:docs`. */
export const KNOWLEDGE_BUNDLES_DIR = 'knowledge/bundles';

/** Repo-relative raw markdown snapshots from ingest. */
export const KNOWLEDGE_DOCS_CORPUS_DIR = 'knowledge/docs-corpus';

/** Default top-k when `RetrievalQuery.k` is omitted (raised for docs corpus). */
export const DEFAULT_RETRIEVAL_K = 12;

/** Default token budget when `RetrievalQuery.tokenBudget` is omitted. */
export const DEFAULT_RETRIEVAL_TOKEN_BUDGET = 12_000;

/** Soft ceiling for a single chunk before splitting at deeper headings. */
export const MAX_CHUNK_TOKENS = 1_200;

/** Budget reserved for the active algorithm's full guide injection (D-P4). */
export const ACTIVE_DOC_TOKEN_BUDGET = 15_000;

/**
 * When total corpus tokens ≤ this threshold, inject the full corpus and
 * skip retrieval (D-P4). Measured after `npm run ingest:docs`.
 */
export const FULL_CORPUS_INJECTION_THRESHOLD = 50_000;

/**
 * Set by Phase 2 after the first real ingest. When true, prompt composition
 * (Phase 3) injects the full corpus instead of scoped retrieval.
 */
export const USE_FULL_CORPUS_INJECTION = true;

/** Docs bundle filename prefix from the ingest pipeline. */
export const DOCS_BUNDLE_PREFIX = 'docs-';

/** Canonical docs site origin (llms.txt + page fetches). */
export const DOCS_SITE_ORIGIN = 'https://docs.archpublic.com';

/** llms.txt index URL. */
export const DOCS_LLMS_TXT_URL = `${DOCS_SITE_ORIGIN}/llms.txt`;

/** System-prompt section header for retrieved / injected docs. */
export const KNOWLEDGE_CONTEXT_OPENER = '### PRODUCT DOCUMENTATION';

/** Score boost applied to chunks belonging to the active algorithm. */
export const ACTIVE_ALGORITHM_SCORE_BOOST = 2.5;

/** Algorithms exposed by the picker (D-P10). */
export const ALGORITHMS: readonly AlgorithmId[] = [
  'market-wave',
  'arbitrage',
  'intelligence',
  'apex',
] as const;

/**
 * Page slugs (filename without `.md`) owned by each algorithm.
 * Used for full-guide injection (D-P4) and retrieval boosting (D-P10).
 */
export const ALGORITHM_PAGE_SLUGS: Readonly<Record<AlgorithmId, readonly string[]>> = {
  'market-wave': ['market-wave-algorithm-setup-guide'],
  arbitrage: ['arbitrage-algorithm-setup-guide', 'arbitrage-algorithm-recipes'],
  intelligence: ['intelligence-algorithm-setup-guide', 'intelligence-algorithm-recipes'],
  apex: ['apex-algorithm-recipes'],
};
