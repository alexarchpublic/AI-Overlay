/**
 * @file src/main/knowledgeCrypto.ts
 *
 * Encrypt/decrypt the servable-tier index at rest (PRD §5.2 D-6, §5.8 D-11).
 * Production uses Electron `safeStorage` (OS keychain on macOS). Tests inject
 * a deterministic fake so Vitest never touches Electron.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Narrow surface matching Electron safeStorage — injectable for tests. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/** Deterministic test double — NOT for production. */
export function createTestSafeStorage(secret = 'phase-0-test-key-32-bytes!!!!'): SafeStorageLike {
  const key = Buffer.from(secret.padEnd(32, '!').slice(0, 32));

  return {
    isEncryptionAvailable: () => true,
    encryptString(plainText: string): Buffer {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGO, key, iv);
      const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return Buffer.concat([iv, tag, encrypted]);
    },
    decryptString(encrypted: Buffer): string {
      const iv = encrypted.subarray(0, IV_BYTES);
      const tag = encrypted.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
      const data = encrypted.subarray(IV_BYTES + TAG_BYTES);
      const decipher = createDecipheriv(ALGO, key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    },
  };
}

/**
 * Wrap plaintext bundle JSON for disk storage. Throws when encryption is
 * unavailable — caller must not persist plaintext servable indexes.
 */
export function encryptKnowledgePayload(plainText: string, safeStorage: SafeStorageLike): Buffer {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Knowledge index encryption unavailable — safeStorage not ready');
  }
  return safeStorage.encryptString(plainText);
}

/** Reverse `encryptKnowledgePayload`. */
export function decryptKnowledgePayload(encrypted: Buffer, safeStorage: SafeStorageLike): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Knowledge index decryption unavailable — safeStorage not ready');
  }
  return safeStorage.decryptString(encrypted);
}

/**
 * Resolve Electron safeStorage when running inside the main process.
 * Returns null in unit tests / non-Electron contexts.
 */
export function createElectronSafeStorage(): SafeStorageLike | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { safeStorage } = require('electron') as {
      safeStorage: SafeStorageLike;
    };
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage;
  } catch {
    return null;
  }
}
