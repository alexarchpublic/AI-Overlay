/**
 * @file src/shared/knowledgeConstants.ts
 *
 * Secure harness Phase 0 — config keys, defaults, and path constants (PRD §5.2 D-5).
 */

/** Runtime knowledge backend selection (PRD §5.2 D-5). */
export type KnowledgeBackend = 'local' | 'remote';

export const KNOWLEDGE_STORE_KEY_BACKEND = 'knowledge.backend';

export const DEFAULT_KNOWLEDGE_BACKEND: KnowledgeBackend = 'local';

/** Repo-relative bundle directory produced by `npm run build:knowledge`. */
export const KNOWLEDGE_BUNDLES_DIR = 'knowledge/bundles';

/** Default top-k when `RetrievalQuery.k` is omitted. */
export const DEFAULT_RETRIEVAL_K = 4;

/** Default token budget when `RetrievalQuery.tokenBudget` is omitted. */
export const DEFAULT_RETRIEVAL_TOKEN_BUDGET = 8_000;

/** Servable bundle filename prefix from the offline pipeline. */
export const SERVABLE_BUNDLE_PREFIX = 'servable-';

/** System-prompt section header for scoped abstraction retrieval (Phase 0 task 3). */
export const KNOWLEDGE_CONTEXT_OPENER = '### STRATEGY KNOWLEDGE';

/** Reviewer id written by the Phase 1 automated abstraction pipeline. */
export const AUTOMATED_ABSTRACTION_REVIEWER = 'automated-pipeline';

/** Default offline generation model (override with ABSTRACTION_MODEL). */
export const DEFAULT_ABSTRACTION_GENERATION_MODEL = 'gemini-3.1-flash-lite-preview';
