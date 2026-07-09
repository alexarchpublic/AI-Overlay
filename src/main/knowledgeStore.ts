/**
 * @file src/main/knowledgeStore.ts
 *
 * Phase 0 task 2 — `KnowledgeStore` implementations (PRD §5.2).
 *
 *   - `LocalKnowledgeStore` — servable bundle loaded from the packaged
 *     `knowledge/bundles/` extraResources directory (D-6, audit T3.3).
 *   - `RemoteKnowledgeStore` — interface stub for future server-side retrieval (D-1).
 *
 * Deep-tier paths are never read here — only pre-built servable bundles from
 * `knowledge/bundles/` (offline pipeline output).
 */
import path from 'node:path';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import type { AppLogger } from './logger';
import { retrieveChunks } from '../shared/knowledge/retrieval';
import { SERVABLE_BUNDLE_PREFIX } from '../shared/knowledgeConstants';
import type {
  AbstractionChunk,
  KnowledgeStore,
  RetrievalQuery,
  ServableKnowledgeBundle,
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
  /** Directory containing `servable-*.json` bundle artifacts. */
  bundleDir: string;
  fs?: KnowledgeFsLike;
}

interface LoadedState {
  chunks: AbstractionChunk[];
  contentHash: string;
}

function isServableKnowledgeBundle(value: unknown): value is ServableKnowledgeBundle {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const manifest = record.manifest;
  if (!manifest || typeof manifest !== 'object') return false;
  return (
    (manifest as Record<string, unknown>).tier === 'servable' && Array.isArray(record.chunks)
  );
}

function parseBundle(raw: string, sourcePath: string): ServableKnowledgeBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new KnowledgeStoreError('BUNDLE_INVALID_JSON', `Invalid bundle JSON: ${sourcePath}`);
  }
  if (!isServableKnowledgeBundle(parsed)) {
    throw new KnowledgeStoreError('BUNDLE_INVALID', `Not a servable bundle: ${sourcePath}`);
  }
  return parsed;
}

/** Pick the newest `servable-*.json` full bundle under `bundleDir`. */
export async function resolveServableBundlePath(
  bundleDir: string,
  fs: KnowledgeFsLike,
): Promise<string> {
  if (!(await fs.exists(bundleDir))) {
    throw new KnowledgeStoreError('BUNDLE_DIR_MISSING', `Bundle directory missing: ${bundleDir}`);
  }
  const names = await fs.readdir(bundleDir);
  const candidates = names
    .filter((n) => n.startsWith(SERVABLE_BUNDLE_PREFIX) && n.endsWith('.json'))
    .filter((n) => !n.endsWith('.manifest.json'))
    .sort();
  if (candidates.length === 0) {
    throw new KnowledgeStoreError('BUNDLE_NOT_FOUND', `No servable bundle under ${bundleDir}`);
  }
  const newest = candidates[candidates.length - 1];
  if (!newest) {
    throw new KnowledgeStoreError('BUNDLE_NOT_FOUND', `No servable bundle under ${bundleDir}`);
  }
  return path.join(bundleDir, newest);
}

/**
 * Load the D-3-reviewed servable bundle from disk into memory. The packaged
 * app ships one plaintext representation under `extraResources/knowledge/bundles`
 * (audit T3.3 / security-harness-PRD §12 D-12).
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
    };
  }

  async function doInit(): Promise<void> {
    const bundlePath = await resolveServableBundlePath(deps.bundleDir, fs);
    state = await loadFromPlainBundle(bundlePath);
    deps.logger.info('knowledge.loaded', {
      backend: 'local',
      contentHash: state.contentHash,
      chunkCount: state.chunks.length,
      source: 'servable-bundle',
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

    async retrieve(query: RetrievalQuery): Promise<AbstractionChunk[]> {
      await this.init();
      if (!state) {
        throw new KnowledgeStoreError('NOT_INITIALIZED', 'Knowledge store failed to initialize');
      }
      const chunks = retrieveChunks({ chunks: state.chunks, query });
      deps.logger.debug('knowledge.retrieved', {
        queryLength: query.text.length,
        returned: chunks.length,
        chunkIds: chunks.map((c) => c.id),
      });
      return chunks;
    },

    async version(): Promise<string> {
      await this.init();
      if (!state) {
        throw new KnowledgeStoreError('NOT_INITIALIZED', 'Knowledge store failed to initialize');
      }
      return state.contentHash;
    },
  };
}

/** @deprecated Use `createLocalKnowledgeStore` — encryption cache removed (T3.3). */
export const createLocalEncryptedKnowledgeStore = createLocalKnowledgeStore;

/** @deprecated Renamed to `LocalKnowledgeStoreDeps`. */
export type LocalEncryptedKnowledgeStoreDeps = LocalKnowledgeStoreDeps;

/** Future server-side backend — interface-ready stub (PRD §5.2, §8 item 2). */
export class RemoteKnowledgeStoreNotImplementedError extends Error {
  readonly code = 'REMOTE_KNOWLEDGE_NOT_IMPLEMENTED';

  constructor() {
    super('RemoteKnowledgeStore is not implemented in Phase 0 — set knowledge.backend to "local"');
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
    version(): Promise<never> {
      return Promise.reject(new RemoteKnowledgeStoreNotImplementedError());
    },
  };
}
