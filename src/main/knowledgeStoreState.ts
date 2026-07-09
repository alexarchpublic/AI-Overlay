/**
 * @file src/main/knowledgeStoreState.ts
 *
 * `knowledge.*` electron-store namespace — backend selection flag (PRD §5.2 D-5).
 */
import type { StoreLike } from './widgetState';
import {
  DEFAULT_KNOWLEDGE_BACKEND,
  KNOWLEDGE_STORE_KEY_BACKEND,
  type KnowledgeBackend,
} from '../shared/knowledgeConstants';
import { importESM } from './importESM';

export interface KnowledgeStateStore {
  getBackend(): KnowledgeBackend;
  setBackend(backend: KnowledgeBackend): void;
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
      },
    },
    clearInvalidConfig: true,
  });
  return { store, wrapper: wrapKnowledgeStore(store) };
}
