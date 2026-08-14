/**
 * @file tests/optimizerStore.spec.ts
 *
 * Coverage for the `optimizer.*` config slice (PRD_Optimizer_MCP_Integration
 * D-M8): encrypted-at-rest team key, feature-hidden semantics when either
 * field is missing, and plaintext migration parity with aiStore.
 */

import { describe, it, expect } from 'vitest';
import {
  OPTIMIZER_STORE_KEY_MCP_URL,
  OPTIMIZER_STORE_KEY_TEAM_KEY,
  wrapOptimizerStore,
} from '../src/main/optimizerStore';
import { createTestSafeStorage } from '../src/main/knowledgeCrypto';
import { isEncryptedSecret } from '../src/main/secretsStore';
import type { StoreLike } from '../src/main/widgetState';

function memoryStore(initial: Record<string, unknown> = {}): StoreLike {
  const data = { ...initial };
  return {
    get: (key: string, defaultValue?: unknown) =>
      Object.prototype.hasOwnProperty.call(data, key) ? data[key] : defaultValue,
    set(key: string, value: unknown) {
      data[key] = value;
    },
    delete(key: string) {
      delete data[key];
    },
    clear() {
      for (const k of Object.keys(data)) delete data[k];
    },
  };
}

function build(initial: Record<string, unknown> = {}): {
  store: StoreLike;
  wrapper: ReturnType<typeof wrapOptimizerStore>;
} {
  const store = memoryStore(initial);
  return { store, wrapper: wrapOptimizerStore(store, { safeStorage: createTestSafeStorage() }) };
}

describe('optimizerStore', () => {
  it('is unconfigured (feature hidden) with no data', () => {
    const { wrapper } = build();
    expect(wrapper.isConfigured()).toBe(false);
    expect(wrapper.getConfig()).toBeNull();
    expect(wrapper.getMcpUrl()).toBeNull();
  });

  it('round-trips a config and encrypts the key at rest', () => {
    const { store, wrapper } = build();
    wrapper.setConfig({ mcpUrl: 'https://optimize.archpublic.com/mcp', teamKey: 'tk' });
    expect(wrapper.isConfigured()).toBe(true);
    expect(wrapper.getConfig()).toEqual({
      mcpUrl: 'https://optimize.archpublic.com/mcp',
      teamKey: 'tk',
    });
    const persisted = store.get(OPTIMIZER_STORE_KEY_TEAM_KEY);
    expect(typeof persisted).toBe('string');
    expect(isEncryptedSecret(persisted as string)).toBe(true);
    expect(persisted).not.toContain('tk');
  });

  it('is unconfigured when either field is missing', () => {
    const { wrapper: urlOnly } = build();
    urlOnly.setConfig({ mcpUrl: 'https://x.example/mcp', teamKey: 'tk' });
    // Simulate a missing key by clearing just the secret.
    const { store, wrapper } = build();
    wrapper.setConfig({ mcpUrl: 'https://x.example/mcp', teamKey: 'tk' });
    store.delete(OPTIMIZER_STORE_KEY_TEAM_KEY);
    expect(wrapper.isConfigured()).toBe(false);
    expect(wrapper.getConfig()).toBeNull();
  });

  it('clearConfig returns to the hidden state', () => {
    const { store, wrapper } = build();
    wrapper.setConfig({ mcpUrl: 'https://x.example/mcp', teamKey: 'tk' });
    wrapper.clearConfig();
    expect(wrapper.isConfigured()).toBe(false);
    expect(store.get(OPTIMIZER_STORE_KEY_MCP_URL)).toBeUndefined();
    expect(store.get(OPTIMIZER_STORE_KEY_TEAM_KEY)).toBeUndefined();
  });

  it('migrates legacy plaintext keys on first read', () => {
    const { store, wrapper } = build({
      [OPTIMIZER_STORE_KEY_MCP_URL]: 'https://x.example/mcp',
      [OPTIMIZER_STORE_KEY_TEAM_KEY]: 'plain-tk',
    });
    expect(wrapper.getConfig()?.teamKey).toBe('plain-tk');
    expect(isEncryptedSecret(store.get(OPTIMIZER_STORE_KEY_TEAM_KEY) as string)).toBe(true);
  });

  it('treats corrupt ciphertext as absent and clears it', () => {
    const { store, wrapper } = build({
      [OPTIMIZER_STORE_KEY_MCP_URL]: 'https://x.example/mcp',
      [OPTIMIZER_STORE_KEY_TEAM_KEY]: 'ss:v1:not-base64-garbage!!!',
    });
    expect(wrapper.getConfig()).toBeNull();
    expect(store.get(OPTIMIZER_STORE_KEY_TEAM_KEY)).toBeUndefined();
  });
});
