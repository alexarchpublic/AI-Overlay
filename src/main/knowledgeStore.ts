/**
 * @file src/main/knowledgeStore.ts
 *
 * `KnowledgeStore` implementations for the docs-corpus bundle (PRD D-P11).
 *
 *   - `LocalKnowledgeStore` — `docs-*.json` from packaged `knowledge/bundles/`
 *   - `RemoteKnowledgeStore` — interface stub for future server-side retrieval
 */
import path from 'node:path';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import type { AppLogger } from './logger';
import { retrieveChunks } from '../shared/knowledge/retrieval';
import { DOCS_BUNDLE_PREFIX } from '../shared/knowledgeConstants';
import type {
  DocChunk,
  DocsKnowledgeBundle,
  KnowledgeStore,
  RetrievalQuery,
} from '../shared/knowledgeTypes';

// ---------------------------------------------------------------------------
// Injectable surfaces
// ---------------------------------------------------------------------------

export interface KnowledgeFsLike {
  readFile(filePath: string, encoding?: 'utf8'): Promise<string>;
  readFileBuffer(filePath: string): Promise<Buffer>;
  writeFile(filePath: string, data: string | Buffer): Promise<void>;
  mkdir(dirPath: string): Promise<void>;
  readdir(dirPath: string): Promise<string[]>;
  exists(filePath: string): Promise<boolean>;
}

export function createNodeKnowledgeFs(): KnowledgeFsLike {
  return {
    readFile: (p, enc = 'utf8') => readFile(p, enc),
    readFileBuffer: (p) => readFile(p),
    writeFile: (p, d) => writeFile(p, d),
    mkdir: async (p) => {
      await mkdir(p, { recursive: true });
    },
    readdir: (p) => readdir(p),
    exists: async (p) => {
      try {
        await access(p);
        return true;
      } catch {
        return false;
      }
    },
  };
}

export class KnowledgeStoreError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'KnowledgeStoreError';
    this.code = code;
  }
}

export interface LocalKnowledgeStoreDeps {
  logger: AppLogger;
  /** Directory containing `docs-*.json` bundle artifacts. */
  bundleDir: string;
  fs?: KnowledgeFsLike;
}

interface LoadedState {
  chunks: DocChunk[];
  contentHash: string;
  totalTokenEstimate: number;
  pageCount: number;
  fetchedAt: string;
}

function isDocsKnowledgeBundle(value: unknown): value is DocsKnowledgeBundle {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const manifest = record.manifest;
  if (!manifest || typeof manifest !== 'object') return false;
  return (manifest as Record<string, unknown>).tier === 'docs' && Array.isArray(record.chunks);
}

function parseBundle(raw: string, sourcePath: string): DocsKnowledgeBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new KnowledgeStoreError('BUNDLE_INVALID_JSON', `Invalid bundle JSON: ${sourcePath}`);
  }
  if (!isDocsKnowledgeBundle(parsed)) {
    throw new KnowledgeStoreError('BUNDLE_INVALID', `Not a docs bundle: ${sourcePath}`);
  }
  return parsed;
}

/** Pick the newest `docs-*.json` full bundle under `bundleDir`. */
export async function resolveDocsBundlePath(
  bundleDir: string,
  fs: KnowledgeFsLike,
): Promise<string> {
  if (!(await fs.exists(bundleDir))) {
    throw new KnowledgeStoreError('BUNDLE_DIR_MISSING', `Bundle directory missing: ${bundleDir}`);
  }
  const names = await fs.readdir(bundleDir);
  const candidates = names
    .filter((n) => n.startsWith(DOCS_BUNDLE_PREFIX) && n.endsWith('.json'))
    .sort();
  if (candidates.length === 0) {
    throw new KnowledgeStoreError('BUNDLE_NOT_FOUND', `No docs bundle under ${bundleDir}`);
  }
  const newest = candidates[candidates.length - 1];
  if (!newest) {
    throw new KnowledgeStoreError('BUNDLE_NOT_FOUND', `No docs bundle under ${bundleDir}`);
  }
  return path.join(bundleDir, newest);
}

/** @deprecated Use `resolveDocsBundlePath`. */
export const resolveServableBundlePath = resolveDocsBundlePath;

/**
 * Load the docs-corpus bundle from disk into memory. The packaged app ships
 * one plaintext representation under `extraResources/knowledge/bundles`.
 */
export function createLocalKnowledgeStore(deps: LocalKnowledgeStoreDeps): KnowledgeStore {
  const fs = deps.fs ?? createNodeKnowledgeFs();

  let state: LoadedState | null = null;
  let initPromise: Promise<void> | null = null;

  async function loadFromPlainBundle(bundlePath: string): Promise<LoadedState> {
    const raw = await fs.readFile(bundlePath, 'utf8');
    const bundle = parseBundle(raw, bundlePath);
    return {
      chunks: bundle.chunks,
      contentHash: bundle.manifest.contentHash,
      totalTokenEstimate: bundle.manifest.totalTokenEstimate,
      pageCount: bundle.manifest.pages.length,
      fetchedAt: bundle.manifest.fetchedAt,
    };
  }

  async function doInit(): Promise<void> {
    const bundlePath = await resolveDocsBundlePath(deps.bundleDir, fs);
    state = await loadFromPlainBundle(bundlePath);
    deps.logger.info('knowledge.loaded', {
      backend: 'local',
      contentHash: state.contentHash,
      chunkCount: state.chunks.length,
      pageCount: state.pageCount,
      totalTokenEstimate: state.totalTokenEstimate,
      fetchedAt: state.fetchedAt,
      source: 'docs-bundle',
      bundlePath,
    });
  }

  return {
    init(): Promise<void> {
      if (state) return Promise.resolve();
      initPromise ??= doInit().catch((err: unknown) => {
        initPromise = null;
        throw err;
      });
      return initPromise;
    },

    async retrieve(query: RetrievalQuery): Promise<DocChunk[]> {
      await this.init();
      if (!state) {
        throw new KnowledgeStoreError('NOT_INITIALIZED', 'Knowledge store failed to initialize');
      }
      const chunks = retrieveChunks({ chunks: state.chunks, query });
      deps.logger.debug('knowledge.retrieved', {
        queryLength: query.text.length,
        returned: chunks.length,
        chunkIds: chunks.map((c) => c.id),
        activeAlgorithm: query.activeAlgorithm,
      });
      return chunks;
    },

    async getAllChunks(): Promise<readonly DocChunk[]> {
      await this.init();
      if (!state) {
        throw new KnowledgeStoreError('NOT_INITIALIZED', 'Knowledge store failed to initialize');
      }
      return state.chunks;
    },

    async version(): Promise<string> {
      await this.init();
      if (!state) {
        throw new KnowledgeStoreError('NOT_INITIALIZED', 'Knowledge store failed to initialize');
      }
      return state.contentHash;
    },

    async getBundleInfo(): Promise<{
      contentHash: string;
      fetchedAt: string;
      pageCount: number;
      totalTokenEstimate: number;
    }> {
      await this.init();
      if (!state) {
        throw new KnowledgeStoreError('NOT_INITIALIZED', 'Knowledge store failed to initialize');
      }
      return {
        contentHash: state.contentHash,
        fetchedAt: state.fetchedAt,
        pageCount: state.pageCount,
        totalTokenEstimate: state.totalTokenEstimate,
      };
    },
  };
}

/** @deprecated Use `createLocalKnowledgeStore`. */
export const createLocalEncryptedKnowledgeStore = createLocalKnowledgeStore;

/** @deprecated Renamed to `LocalKnowledgeStoreDeps`. */
export type LocalEncryptedKnowledgeStoreDeps = LocalKnowledgeStoreDeps;

/** Future server-side backend — interface-ready stub. */
export class RemoteKnowledgeStoreNotImplementedError extends Error {
  readonly code = 'REMOTE_KNOWLEDGE_NOT_IMPLEMENTED';

  constructor() {
    super('RemoteKnowledgeStore is not implemented — set knowledge.backend to "local"');
    this.name = 'RemoteKnowledgeStoreNotImplementedError';
  }
}

export function createRemoteKnowledgeStoreStub(): KnowledgeStore {
  return {
    init(): Promise<void> {
      return Promise.reject(new RemoteKnowledgeStoreNotImplementedError());
    },
    retrieve(): Promise<never> {
      return Promise.reject(new RemoteKnowledgeStoreNotImplementedError());
    },
    getAllChunks(): Promise<never> {
      return Promise.reject(new RemoteKnowledgeStoreNotImplementedError());
    },
    version(): Promise<never> {
      return Promise.reject(new RemoteKnowledgeStoreNotImplementedError());
    },
    getBundleInfo(): Promise<never> {
      return Promise.reject(new RemoteKnowledgeStoreNotImplementedError());
    },
  };
}
