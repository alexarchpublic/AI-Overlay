/**
 * @file src/shared/knowledgeTypes.ts
 *
 * Secure harness Phase 0 — data model for the two-tier knowledge base (PRD §7).
 * Deep-tier raw IP never appears in these types; only servable abstractions.
 */

/** Servable abstraction kinds (PRD §7). */
export type AbstractionKind = 'contract' | 'param-role' | 'tuning' | 'risk';

/**
 * One retrieval-sized unit in the servable tier. Produced by the offline pipeline;
 * consumed later by KnowledgeStore (Phase 0 task 2).
 */
export interface AbstractionChunk {
  id: string;
  strategyId: string;
  kind: AbstractionKind;
  /** Natural-language abstraction text. */
  text: string;
  version: string;
}

/** Human review record attached to source abstraction files before bundling. */
export interface AbstractionReview {
  reviewer: string;
  reviewedAt: string;
}

/**
 * Authoring-time abstraction document on disk under `knowledge/servable/`.
 * Serialized to `AbstractionChunk` in the bundle (review metadata stripped).
 */
export interface ServableAbstractionSource {
  id: string;
  strategyId: string;
  kind: AbstractionKind;
  version: string;
  text: string;
  review: AbstractionReview;
}

/** Manifest written beside each servable bundle (PRD §5.1 — content-hashed). */
export interface ServableBundleManifest {
  schemaVersion: 1;
  tier: 'servable';
  builtAt: string;
  /** SHA-256 hex over canonical chunk ordering (ids + text + version). */
  contentHash: string;
  chunkCount: number;
  strategyIds: string[];
}

/** On-disk bundle artifact from the offline pipeline. */
export interface ServableKnowledgeBundle {
  manifest: ServableBundleManifest;
  chunks: AbstractionChunk[];
}

/** Scoped retrieval request (PRD §7). */
export interface RetrievalQuery {
  text: string;
  chartContext?: string;
  /** Max chunks to return. Defaults to `DEFAULT_RETRIEVAL_K`. */
  k?: number;
  /** Approximate token ceiling for returned chunk text. */
  tokenBudget?: number;
}

/**
 * The only way runtime components read servable-tier knowledge (PRD §5.2).
 * Backend selection is config-only — call sites depend on this interface.
 */
export interface KnowledgeStore {
  /** Load/decrypt the local index or connect to remote backend. Idempotent. */
  init(): Promise<void>;
  /** Minimum relevant abstraction chunks for the query (servable tier only). */
  retrieve(query: RetrievalQuery): Promise<AbstractionChunk[]>;
  /** Servable-tier content hash for cache invalidation + audit. */
  version(): Promise<string>;
}

/** Metadata stored beside the encrypted index (not secret — hash for invalidation). */
export interface KnowledgeIndexMeta {
  schemaVersion: 1;
  contentHash: string;
  chunkCount: number;
  encryptedAt: string;
}
