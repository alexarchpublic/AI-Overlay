/**
 * @file src/main/knowledgeStoreState.ts
 *
 * `knowledge.*` electron-store namespace — backend selection and active
 * algorithm picker persistence (PRD D-P10 / §3.7).
 */
import type { StoreLike } from './widgetState';
import {
  ALGORITHMS,
  DEFAULT_ACTIVE_ALGORITHM,
  DEFAULT_KNOWLEDGE_BACKEND,
  KNOWLEDGE_STORE_KEY_ACTIVE_ALGORITHM,
  KNOWLEDGE_STORE_KEY_BACKEND,
  type KnowledgeBackend,
} from '../shared/knowledgeConstants';
import type { ActiveAlgorithm } from '../shared/knowledgeTypes';
import { importESM } from './importESM';

const VALID_ACTIVE_ALGORITHMS: readonly ActiveAlgorithm[] = [...ALGORITHMS, 'all'];

export function parseActiveAlgorithm(raw: unknown): ActiveAlgorithm {
  if (
    typeof raw === 'string' &&
    (VALID_ACTIVE_ALGORITHMS as readonly string[]).includes(raw)
  ) {
    return raw as ActiveAlgorithm;
  }
  return DEFAULT_ACTIVE_ALGORITHM;
}

export interface KnowledgeStateStore {
  getBackend(): KnowledgeBackend;
  setBackend(backend: KnowledgeBackend): void;
  getActiveAlgorithm(): ActiveAlgorithm;
  setActiveAlgorithm(algorithm: ActiveAlgorithm): ActiveAlgorithm;
}

export function wrapKnowledgeStore(store: StoreLike): KnowledgeStateStore {
  return {
    getBackend() {
      const raw = store.get(KNOWLEDGE_STORE_KEY_BACKEND);
      return raw === 'remote' ? 'remote' : DEFAULT_KNOWLEDGE_BACKEND;
    },
    setBackend(backend) {
      store.set(KNOWLEDGE_STORE_KEY_BACKEND, backend);
    },
    getActiveAlgorithm() {
      return parseActiveAlgorithm(store.get(KNOWLEDGE_STORE_KEY_ACTIVE_ALGORITHM));
    },
    setActiveAlgorithm(algorithm) {
      const next = parseActiveAlgorithm(algorithm);
      store.set(KNOWLEDGE_STORE_KEY_ACTIVE_ALGORITHM, next);
      return next;
    },
  };
}

interface ElectronStoreOptions {
  name?: string;
  defaults?: Record<string, unknown>;
  clearInvalidConfig?: boolean;
}

interface ElectronStoreModule {
  default: new (opts: ElectronStoreOptions) => StoreLike;
}

export async function createKnowledgeStoreState(): Promise<{
  store: StoreLike;
  wrapper: KnowledgeStateStore;
}> {
  const mod = await importESM<ElectronStoreModule>('electron-store');
  const store: StoreLike = new mod.default({
    name: 'config',
    defaults: {
      knowledge: {
        backend: DEFAULT_KNOWLEDGE_BACKEND,
        activeAlgorithm: DEFAULT_ACTIVE_ALGORITHM,
      },
    },
    clearInvalidConfig: true,
  });
  return { store, wrapper: wrapKnowledgeStore(store) };
}
