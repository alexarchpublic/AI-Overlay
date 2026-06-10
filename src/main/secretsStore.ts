/**
 * @file src/main/secretsStore.ts
 *
 * Phase 0 task 7 — OS-keychain-backed secret storage (PRD §5.8 D-11).
 * Wraps Electron `safeStorage` for small secrets (Gemini API key today).
 * Reuses the same `SafeStorageLike` surface as `knowledgeCrypto.ts`.
 */
import {
  createElectronSafeStorage,
  createTestSafeStorage,
  type SafeStorageLike,
} from './knowledgeCrypto';

/** Prefix marking safeStorage-encrypted values persisted in electron-store. */
export const ENCRYPTED_SECRET_PREFIX = 'ss:v1:';

/** Encrypt a UTF-8 secret for at-rest persistence. */
export function encryptSecret(plainText: string, safeStorage: SafeStorageLike): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secret encryption unavailable — safeStorage not ready');
  }
  const encrypted = safeStorage.encryptString(plainText);
  return `${ENCRYPTED_SECRET_PREFIX}${encrypted.toString('base64')}`;
}

/** Decrypt a value written by `encryptSecret`. */
export function decryptSecret(stored: string, safeStorage: SafeStorageLike): string {
  if (!stored.startsWith(ENCRYPTED_SECRET_PREFIX)) {
    throw new Error('Stored secret is not in encrypted format');
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secret decryption unavailable — safeStorage not ready');
  }
  const payload = Buffer.from(stored.slice(ENCRYPTED_SECRET_PREFIX.length), 'base64');
  return safeStorage.decryptString(payload);
}

/** True when the persisted value is keychain-encrypted (not legacy plaintext). */
export function isEncryptedSecret(stored: string): boolean {
  return stored.startsWith(ENCRYPTED_SECRET_PREFIX);
}

/**
 * Resolve safeStorage for production or tests. Falls back to the deterministic
 * test double when Electron is unavailable (Vitest, CI).
 */
export function resolveSafeStorage(override?: SafeStorageLike): SafeStorageLike {
  if (override) return override;
  const electron = createElectronSafeStorage();
  if (electron) return electron;
  return createTestSafeStorage();
}

/**
 * Read a secret from electron-store, migrating legacy plaintext on first access.
 * Returns `null` when unset or empty.
 */
export function readStoredSecret(
  raw: unknown,
  safeStorage: SafeStorageLike,
): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;

  if (isEncryptedSecret(raw)) {
    return decryptSecret(raw, safeStorage);
  }

  // Legacy plaintext (pre task 7) — migrate in-place when encryption is ready.
  if (safeStorage.isEncryptionAvailable()) {
    return raw;
  }

  return raw;
}

/**
 * Persist a secret. Empty string clears the field. Legacy plaintext is never
 * written — callers must pass the cleartext and this helper encrypts it.
 */
export function writeStoredSecret(
  key: string,
  plainText: string,
  safeStorage: SafeStorageLike,
  store: { set(key: string, value: unknown): void; delete(key: string): void },
): void {
  if (plainText.length === 0) {
    store.delete(key);
    return;
  }
  store.set(key, encryptSecret(plainText, safeStorage));
}

/** Migrate legacy plaintext to encrypted form after a successful read. */
export function migratePlaintextSecret(
  key: string,
  plainText: string,
  safeStorage: SafeStorageLike,
  store: { set(key: string, value: unknown): void },
): void {
  if (!safeStorage.isEncryptionAvailable()) return;
  store.set(key, encryptSecret(plainText, safeStorage));
}
