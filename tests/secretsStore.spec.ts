/**
 * @file tests/secretsStore.spec.ts
 *
 * Phase 0 task 7 — OS-keychain-backed secret encrypt/decrypt + migration marker.
 */

import { describe, it, expect } from 'vitest';
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
