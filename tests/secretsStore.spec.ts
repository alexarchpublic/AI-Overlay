/**
 * @file tests/secretsStore.spec.ts
 *
 * Phase 0 task 7 — OS-keychain-backed secret encrypt/decrypt + migration marker.
 */

import { describe, it, expect, vi } from 'vitest';
import { createTestSafeStorage } from '../src/main/knowledgeCrypto';
import {
  ENCRYPTED_SECRET_PREFIX,
  SecretEncryptionUnavailableError,
  createUnavailableSafeStorage,
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
  migratePlaintextSecret,
  readStoredSecret,
  resolveSafeStorage,
  writeStoredSecret,
} from '../src/main/secretsStore';

describe('secretsStore', () => {
  const safeStorage = createTestSafeStorage();

  it('round-trips a secret through encrypt/decrypt', () => {
    const stored = encryptSecret('AIzaSyTestKey123', safeStorage);
    expect(stored.startsWith(ENCRYPTED_SECRET_PREFIX)).toBe(true);
    expect(isEncryptedSecret(stored)).toBe(true);
    expect(decryptSecret(stored, safeStorage)).toBe('AIzaSyTestKey123');
  });

  it('readStoredSecret returns null for empty values', () => {
    expect(readStoredSecret('', safeStorage)).toBeNull();
    expect(readStoredSecret(undefined, safeStorage)).toBeNull();
  });

  it('readStoredSecret decrypts encrypted values', () => {
    const enc = encryptSecret('secret-value', safeStorage);
    expect(readStoredSecret(enc, safeStorage)).toBe('secret-value');
  });

  it('readStoredSecret returns legacy plaintext without decrypting', () => {
    expect(readStoredSecret('legacy-plain-key', safeStorage)).toBe('legacy-plain-key');
    expect(isEncryptedSecret('legacy-plain-key')).toBe(false);
  });

  it('writeStoredSecret persists encrypted values and clears on empty', () => {
    const store = {
      data: {} as Record<string, unknown>,
      set(key: string, value: unknown) {
        this.data[key] = value;
      },
      delete(key: string) {
        delete this.data[key];
      },
    };

    writeStoredSecret('ai.apiKey', 'AIzaXYZ', safeStorage, store);
    const stored = store.data['ai.apiKey'];
    expect(typeof stored).toBe('string');
    expect(isEncryptedSecret(stored as string)).toBe(true);
    expect(readStoredSecret(stored, safeStorage)).toBe('AIzaXYZ');

    writeStoredSecret('ai.apiKey', '', safeStorage, store);
    expect(store.data['ai.apiKey']).toBeUndefined();
  });

  it('resolveSafeStorage fails closed in production mode', () => {
    const storage = resolveSafeStorage({ allowFallback: false });
    expect(storage.isEncryptionAvailable()).toBe(false);
    expect(() => encryptSecret('key', storage)).toThrow(SecretEncryptionUnavailableError);
  });

  it('resolveSafeStorage invokes onFailClosed when the fail-closed stub is selected', () => {
    const onFailClosed = vi.fn();
    const storage = resolveSafeStorage({ allowFallback: false, onFailClosed });
    expect(storage.isEncryptionAvailable()).toBe(false);
    expect(onFailClosed).toHaveBeenCalledOnce();
  });

  it('resolveSafeStorage allows explicit test double injection', () => {
    const storage = resolveSafeStorage(createTestSafeStorage('explicit-test-key-32-bytes!'));
    expect(encryptSecret('key', storage)).toContain(ENCRYPTED_SECRET_PREFIX);
  });

  it('writeStoredSecret refuses to persist when encryption is unavailable', () => {
    const store = {
      data: {} as Record<string, unknown>,
      set(key: string, value: unknown) {
        this.data[key] = value;
      },
      delete(key: string) {
        delete this.data[key];
      },
    };
    const unavailable = createUnavailableSafeStorage();
    expect(() => writeStoredSecret('ai.apiKey', 'AIzaXYZ', unavailable, store)).toThrow(
      SecretEncryptionUnavailableError,
    );
    expect(store.data['ai.apiKey']).toBeUndefined();
  });

  it('readStoredSecret on corrupt ciphertext returns null, calls clearCorrupt, and logs one warning without throwing (Chunk 7 B22/B23)', () => {
    const warn = vi.fn();
    const clearCorrupt = vi.fn();
    const corrupt = `${ENCRYPTED_SECRET_PREFIX}not-valid-base64-ciphertext`;

    let result: string | null = 'sentinel';
    expect(() => {
      result = readStoredSecret(corrupt, safeStorage, {
        keyName: 'ai.apiKey',
        platform: 'darwin',
        logger: { warn },
        clearCorrupt,
      });
    }).not.toThrow();

    expect(result).toBeNull();
    expect(clearCorrupt).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith('secrets.decryptFailed', {
      keyName: 'ai.apiKey',
      platform: 'darwin',
    });
    // Never logs the ciphertext itself.
    const [, ctx] = warn.mock.calls[0] ?? [];
    expect(JSON.stringify(ctx)).not.toContain('not-valid-base64-ciphertext');
  });

  it('readStoredSecret returns null (not throw) when safeStorage is unavailable at decrypt time', () => {
    const enc = encryptSecret('secret-value', safeStorage);
    const unavailable = createUnavailableSafeStorage();
    const clearCorrupt = vi.fn();
    expect(readStoredSecret(enc, unavailable, { clearCorrupt })).toBeNull();
    expect(clearCorrupt).toHaveBeenCalledOnce();
  });

  it('migratePlaintextSecret rewrites legacy plaintext as encrypted', () => {
    const store = {
      data: { 'ai.apiKey': 'legacy-plain-key' } as Record<string, unknown>,
      set(key: string, value: unknown) {
        this.data[key] = value;
      },
    };

    migratePlaintextSecret('ai.apiKey', 'legacy-plain-key', safeStorage, store);
    const stored = store.data['ai.apiKey'];
    expect(isEncryptedSecret(stored as string)).toBe(true);
    expect(readStoredSecret(stored, safeStorage)).toBe('legacy-plain-key');
  });
});
