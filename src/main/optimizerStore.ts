/**
 * @file src/main/optimizerStore.ts
 *
 * Owns the `optimizer.*` namespace inside the shared `config` electron-store
 * file (PRD_Optimizer_MCP_Integration D-M8). Mirrors the `aiStore.ts`
 * pattern: pure `wrapOptimizerStore` for tests plus a `createOptimizerStore`
 * factory for production. The team key is encrypted at rest through the same
 * DPAPI/Keychain `secretsStore` path as the Gemini key (D-M4/D-M8) and is
 * main-process-only — the IPC surface exposes `configured`/`mcpUrl`, never
 * the key.
 */

import type { StoreLike } from './widgetState';
import type { SafeStorageLike } from './knowledgeCrypto';
import type { OptimizerTeamConfig } from '../shared/optimizerTypes';
import {
  isEncryptedSecret,
  migratePlaintextSecret,
  readStoredSecret,
  resolveSafeStorage,
  writeStoredSecret,
} from './secretsStore';
import { platformInfo } from './platform';
import { importESM } from './importESM';

export const OPTIMIZER_STORE_KEY_MCP_URL = 'optimizer.mcpUrl';
export const OPTIMIZER_STORE_KEY_TEAM_KEY = 'optimizer.teamKey';

export interface OptimizerConfigStore {
  /**
   * Full config, or `null` when either field is missing — which is the
   * feature-hidden state (D-M8). **Main-process only**: the returned
   * `teamKey` must never cross IPC or reach a log line (§5 grep contract).
   */
  getConfig(): OptimizerTeamConfig | null;
  /** True without decrypting — cheap feature-flag check for IPC status. */
  isConfigured(): boolean;
  /** Endpoint URL alone (safe for the renderer status payload). */
  getMcpUrl(): string | null;
  /** Persist both fields; the key goes through safeStorage. */
  setConfig(config: OptimizerTeamConfig): void;
  /** Drop both fields — returns the app to the feature-hidden state. */
  clearConfig(): void;
}

export interface WrapOptimizerStoreOptions {
  safeStorage?: SafeStorageLike;
}

/**
 * Wrap an arbitrary `StoreLike` for the `optimizer.*` namespace. Public for
 * dependency injection in tests; production calls `createOptimizerStore()`.
 */
export function wrapOptimizerStore(
  store: StoreLike,
  options: WrapOptimizerStoreOptions = {},
): OptimizerConfigStore {
  const safeStorage =
    options.safeStorage ?? resolveSafeStorage({ allowFallback: false });

  function readTeamKey(): string | null {
    const raw = store.get(OPTIMIZER_STORE_KEY_TEAM_KEY);
    const plain = readStoredSecret(raw, safeStorage, {
      keyName: OPTIMIZER_STORE_KEY_TEAM_KEY,
      platform: platformInfo.platform,
      clearCorrupt: () => {
        store.delete(OPTIMIZER_STORE_KEY_TEAM_KEY);
      },
    });
    if (plain === null) return null;
    if (typeof raw === 'string' && !isEncryptedSecret(raw)) {
      migratePlaintextSecret(OPTIMIZER_STORE_KEY_TEAM_KEY, plain, safeStorage, store);
    }
    return plain;
  }

  return {
    getConfig() {
      const mcpUrl = this.getMcpUrl();
      if (mcpUrl === null) return null;
      const teamKey = readTeamKey();
      if (teamKey === null) return null;
      return { mcpUrl, teamKey };
    },
    isConfigured() {
      const url = store.get(OPTIMIZER_STORE_KEY_MCP_URL);
      const key = store.get(OPTIMIZER_STORE_KEY_TEAM_KEY);
      return (
        typeof url === 'string' && url.length > 0 &&
        typeof key === 'string' && key.length > 0
      );
    },
    getMcpUrl() {
      const raw = store.get(OPTIMIZER_STORE_KEY_MCP_URL);
      if (typeof raw !== 'string' || raw.trim().length === 0) return null;
      return raw.trim();
    },
    setConfig(config) {
      store.set(OPTIMIZER_STORE_KEY_MCP_URL, config.mcpUrl.trim());
      writeStoredSecret(
        OPTIMIZER_STORE_KEY_TEAM_KEY, config.teamKey, safeStorage, store);
    },
    clearConfig() {
      store.delete(OPTIMIZER_STORE_KEY_MCP_URL);
      store.delete(OPTIMIZER_STORE_KEY_TEAM_KEY);
    },
  };
}

// ---------------------------------------------------------------------------
// Production factory — same dynamic-import dance as aiStore.ts
// ---------------------------------------------------------------------------

interface ElectronStoreOptions {
  name?: string;
  clearInvalidConfig?: boolean;
}

interface ElectronStoreModule {
  default: new (opts: ElectronStoreOptions) => StoreLike;
}

export interface CreateOptimizerStoreOptions {
  safeStorage?: SafeStorageLike;
}

/** Open the `optimizer.*` slice of the shared `config` electron-store file. */
export async function createOptimizerStore(
  options: CreateOptimizerStoreOptions = {},
): Promise<OptimizerConfigStore> {
  const mod = await importESM<ElectronStoreModule>('electron-store');
  const store: StoreLike = new mod.default({
    name: 'config',
    clearInvalidConfig: true,
  });
  return wrapOptimizerStore(store, { safeStorage: options.safeStorage });
}
