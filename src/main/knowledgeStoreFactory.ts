/**
 * @file src/main/knowledgeStoreFactory.ts
 *
 * Config-selected KnowledgeStore factory (PRD §5.2 D-5).
 * Call sites receive a `KnowledgeStore` — never a concrete backend class.
 */
import path from 'node:path';
import type { AppLogger } from './logger';
import {
  createLocalKnowledgeStore,
  createRemoteKnowledgeStoreStub,
  type KnowledgeFsLike,
} from './knowledgeStore';
import {
  DEFAULT_KNOWLEDGE_BACKEND,
  KNOWLEDGE_BUNDLES_DIR,
  type KnowledgeBackend,
} from '../shared/knowledgeConstants';
import type { KnowledgeStore } from '../shared/knowledgeTypes';

export interface CreateKnowledgeStoreOptions {
  backend?: KnowledgeBackend;
  logger: AppLogger;
  /** When true, bundle dir resolves from repo cwd; else from `process.resourcesPath`. */
  isDev: boolean;
  /** Override bundle directory (tests). */
  bundleDir?: string;
  fs?: KnowledgeFsLike;
}

/**
 * Resolve the docs bundle directory for dev vs packaged builds.
 * Packaged apps read from `extraResources/knowledge/bundles` (electron-builder).
 */
export function resolveKnowledgeBundleDir(isDev: boolean, cwd = process.cwd()): string {
  if (isDev) {
    return path.join(cwd, KNOWLEDGE_BUNDLES_DIR);
  }
  return path.join(process.resourcesPath, KNOWLEDGE_BUNDLES_DIR);
}

/**
 * Create and initialize the configured KnowledgeStore backend.
 * Throws when `backend: 'remote'` — stub exists for interface conformance only.
 */
export async function createKnowledgeStore(
  options: CreateKnowledgeStoreOptions,
): Promise<KnowledgeStore> {
  const backend = options.backend ?? DEFAULT_KNOWLEDGE_BACKEND;
  const bundleDir = options.bundleDir ?? resolveKnowledgeBundleDir(options.isDev);

  const store =
    backend === 'remote'
      ? createRemoteKnowledgeStoreStub()
      : createLocalKnowledgeStore({
          logger: options.logger,
          bundleDir,
          fs: options.fs,
        });

  if (backend === 'local') {
    await store.init();
  }

  return store;
}
