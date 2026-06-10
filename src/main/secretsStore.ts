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

/** Thrown when production callers attempt to persist without OS keychain. */
export class SecretEncryptionUnavailableError extends Error {
  readonly code = 'SECRET_ENCRYPTION_UNAVAILABLE' as const;

  constructor(message = 'OS keychain encryption unavailable — secret not saved') {
    super(message);
    this.name = 'SecretEncryptionUnavailableError';
  }
}

export interface ResolveSafeStorageOptions {
  /** Explicit storage for tests — never falls back when provided. */
  override?: SafeStorageLike;
  /**
   * When false (production default), unavailable Electron safeStorage yields a
   * fail-closed stub instead of the deterministic test double.
   */
  allowFallback?: boolean;
}

/** Fail-closed stub — reads report unavailable; writes throw. */
export function createUnavailableSafeStorage(): SafeStorageLike {
  const unavailable = (): never => {
    throw new SecretEncryptionUnavailableError();
  };
  return {
    isEncryptionAvailable: () => false,
    encryptString: unavailable,
    decryptString: unavailable,
  };
}

/** Encrypt a UTF-8 secret for at-rest persistence. */
export function encryptSecret(plainText: string, safeStorage: SafeStorageLike): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new SecretEncryptionUnavailableError();
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
    throw new SecretEncryptionUnavailableError(
      'Secret decryption unavailable — safeStorage not ready',
    );
  }
  const payload = Buffer.from(stored.slice(ENCRYPTED_SECRET_PREFIX.length), 'base64');
  return safeStorage.decryptString(payload);
}

/** True when the persisted value is keychain-encrypted (not legacy plaintext). */
export function isEncryptedSecret(stored: string): boolean {
  return stored.startsWith(ENCRYPTED_SECRET_PREFIX);
}

/**
 * Resolve safeStorage for production or tests. Production callers pass
 * `{ allowFallback: false }`; tests inject `createTestSafeStorage()` explicitly.
 */
export function resolveSafeStorage(
  options: ResolveSafeStorageOptions | SafeStorageLike = {},
): SafeStorageLike {
  if ('isEncryptionAvailable' in options && typeof options.isEncryptionAvailable === 'function') {
    return options;
  }

  const opts = options as ResolveSafeStorageOptions;
  if (opts.override) return opts.override;

  const electron = createElectronSafeStorage();
  if (electron) return electron;

  if (opts.allowFallback !== false) {
    return createTestSafeStorage();
  }

  return createUnavailableSafeStorage();
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
    try {
      return decryptSecret(raw, safeStorage);
    } catch (err) {
      if (err instanceof SecretEncryptionUnavailableError) return null;
      throw err;
    }
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
