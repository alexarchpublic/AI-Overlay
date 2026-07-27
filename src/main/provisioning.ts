/**
 * @file src/main/provisioning.ts
 *
 * Chunk 7 Phase 4 — first-launch team-config provisioning (PRD D3/D6).
 * Looks for `team-config.json` beside the executable / in userData / in the
 * shared ArchPublic folder, writes the Gemini key through the existing
 * secretsStore path (DPAPI/Keychain), applies optional defaults, and sets
 * `provisioning.completed`. Never logs the key. Never deletes the config file.
 *
 * Injectable deps — no `electron` import at module scope.
 */

import path from 'node:path';
import type { AppLogger } from './logger';
import type { PlatformInfo } from './platform';
import type { StoreLike } from './widgetState';
import type { AiStateStore } from './aiStore';
import type { CaptureStateStore } from './captureStore';
import type { KnowledgeStateStore } from './knowledgeStoreState';
import { parseActiveAlgorithm } from './knowledgeStoreState';
import { ALGORITHMS } from '../shared/knowledgeConstants';
import type { ActiveAlgorithm } from '../shared/knowledgeTypes';

/** electron-store key — sticky across restarts; delete to re-run provisioning. */
export const PROVISIONING_COMPLETED_KEY = 'provisioning.completed';

export const TEAM_CONFIG_FILENAME = 'team-config.json';

/** Shared IT drop folder name under ProgramData / Application Support. */
export const ARCHPUBLIC_SHARED_DIR = 'ArchPublic';

const ALLOWED_KEYS = new Set([
  'geminiApiKey',
  'defaultAlgorithm',
  'captureIntervalMs',
  'provisionedBy',
  'provisionedAt',
]);

const VALID_ALGORITHMS = new Set<string>([...ALGORITHMS, 'all']);

export interface TeamConfig {
  geminiApiKey: string;
  defaultAlgorithm?: ActiveAlgorithm;
  captureIntervalMs?: number;
  provisionedBy?: string;
  provisionedAt?: string;
}

export interface ProvisioningFs {
  existsSync(filePath: string): boolean;
  readFileSync(filePath: string, encoding: 'utf8'): string;
}

export interface ProvisioningDeps {
  store: StoreLike;
  aiStore: Pick<AiStateStore, 'setApiKey'>;
  knowledgeStore: Pick<KnowledgeStateStore, 'setActiveAlgorithm'>;
  captureStore: Pick<CaptureStateStore, 'setIntervalMs'>;
  logger: AppLogger;
  /** Directory containing the running executable (`path.dirname(execPath)`). */
  getExecDir: () => string;
  getUserDataPath: () => string;
  /**
   * Shared machine-wide drop folder:
   *   Windows → `%PROGRAMDATA%\ArchPublic`
   *   macOS   → `/Library/Application Support/ArchPublic`
   */
  getSharedConfigDir: () => string;
  fs: ProvisioningFs;
  pathJoin?: (...parts: string[]) => string;
}

export type ProvisioningResult =
  | { status: 'skipped'; reason: 'already-completed' }
  | { status: 'absent'; searchedPaths: string[] }
  | { status: 'invalid'; source: string; reason: string }
  | { status: 'applied'; source: string; provisionedBy?: string };

/** Build the three search directories in PRD order. */
export function resolveTeamConfigSearchPaths(deps: {
  getExecDir: () => string;
  getUserDataPath: () => string;
  getSharedConfigDir: () => string;
  pathJoin?: (...parts: string[]) => string;
}): string[] {
  const join = deps.pathJoin ?? ((...parts: string[]) => path.join(...parts));
  return [
    join(deps.getExecDir(), TEAM_CONFIG_FILENAME),
    join(deps.getUserDataPath(), TEAM_CONFIG_FILENAME),
    join(deps.getSharedConfigDir(), TEAM_CONFIG_FILENAME),
  ];
}

/**
 * Default shared-config directory for the current platform. Injectable in
 * production via `getSharedConfigDir`; exported for bootstrap wiring.
 */
export function defaultSharedConfigDir(platform: PlatformInfo, env: NodeJS.ProcessEnv = process.env): string {
  const join = platform.isWindows
    ? (...parts: string[]) => path.win32.join(...parts)
    : (...parts: string[]) => path.posix.join(...parts);
  if (platform.isWindows) {
    const programData = env.PROGRAMDATA ?? 'C:\\ProgramData';
    return join(programData, ARCHPUBLIC_SHARED_DIR);
  }
  return join('/Library/Application Support', ARCHPUBLIC_SHARED_DIR);
}

/**
 * Strict schema validation. Rejects unknown keys, wrong types, and empty keys.
 * Returns a typed config or a human-readable reason string.
 */
export function parseTeamConfig(raw: unknown): { ok: true; config: TeamConfig } | { ok: false; reason: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: 'root must be a JSON object' };
  }

  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_KEYS.has(key)) {
      return { ok: false, reason: `unknown key: ${key}` };
    }
  }

  if (typeof obj.geminiApiKey !== 'string' || obj.geminiApiKey.trim().length === 0) {
    return { ok: false, reason: 'geminiApiKey must be a non-empty string' };
  }

  if (obj.defaultAlgorithm !== undefined) {
    if (typeof obj.defaultAlgorithm !== 'string' || !VALID_ALGORITHMS.has(obj.defaultAlgorithm)) {
      return {
        ok: false,
        reason: 'defaultAlgorithm must be market-wave|arbitrage|intelligence|apex|all',
      };
    }
  }

  if (obj.captureIntervalMs !== undefined) {
    if (typeof obj.captureIntervalMs !== 'number' || !Number.isFinite(obj.captureIntervalMs)) {
      return { ok: false, reason: 'captureIntervalMs must be a finite number' };
    }
  }

  if (obj.provisionedBy !== undefined && typeof obj.provisionedBy !== 'string') {
    return { ok: false, reason: 'provisionedBy must be a string' };
  }

  if (obj.provisionedAt !== undefined && typeof obj.provisionedAt !== 'string') {
    return { ok: false, reason: 'provisionedAt must be a string' };
  }

  const config: TeamConfig = {
    geminiApiKey: obj.geminiApiKey.trim(),
  };
  if (typeof obj.defaultAlgorithm === 'string') {
    config.defaultAlgorithm = parseActiveAlgorithm(obj.defaultAlgorithm);
  }
  if (typeof obj.captureIntervalMs === 'number') {
    config.captureIntervalMs = obj.captureIntervalMs;
  }
  if (typeof obj.provisionedBy === 'string') {
    config.provisionedBy = obj.provisionedBy;
  }
  if (typeof obj.provisionedAt === 'string') {
    config.provisionedAt = obj.provisionedAt;
  }

  return { ok: true, config };
}

/**
 * First-launch provisioning. Safe to call on every boot — no-ops once
 * `provisioning.completed` is set. Never throws; malformed input falls through
 * to the manual Settings → AI key flow.
 */
export function runProvisioning(deps: ProvisioningDeps): ProvisioningResult {
  if (deps.store.get(PROVISIONING_COMPLETED_KEY) === true) {
    return { status: 'skipped', reason: 'already-completed' };
  }

  const searchedPaths = resolveTeamConfigSearchPaths(deps);
  let foundPath: string | null = null;
  for (const candidate of searchedPaths) {
    if (deps.fs.existsSync(candidate)) {
      foundPath = candidate;
      break;
    }
  }

  if (!foundPath) {
    deps.logger.debug('provisioning.absent', { searchedPaths });
    return { status: 'absent', searchedPaths };
  }

  let parsedJson: unknown;
  try {
    const text = deps.fs.readFileSync(foundPath, 'utf8');
    parsedJson = JSON.parse(text) as unknown;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    deps.logger.warn('provisioning.invalid', { source: foundPath, reason: `json: ${reason}` });
    return { status: 'invalid', source: foundPath, reason: `json: ${reason}` };
  }

  const validated = parseTeamConfig(parsedJson);
  if (!validated.ok) {
    deps.logger.warn('provisioning.invalid', { source: foundPath, reason: validated.reason });
    return { status: 'invalid', source: foundPath, reason: validated.reason };
  }

  const { config } = validated;

  try {
    deps.aiStore.setApiKey(config.geminiApiKey);
    if (config.defaultAlgorithm !== undefined) {
      deps.knowledgeStore.setActiveAlgorithm(config.defaultAlgorithm);
    }
    if (config.captureIntervalMs !== undefined) {
      deps.captureStore.setIntervalMs(config.captureIntervalMs);
    }
    deps.store.set(PROVISIONING_COMPLETED_KEY, true);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    deps.logger.warn('provisioning.invalid', {
      source: foundPath,
      reason: `apply failed: ${reason}`,
    });
    return { status: 'invalid', source: foundPath, reason: `apply failed: ${reason}` };
  }

  // Never include geminiApiKey — REDACT_PATHS covers it, but don't emit it.
  deps.logger.info('provisioning.applied', {
    source: foundPath,
    provisionedBy: config.provisionedBy,
  });

  return {
    status: 'applied',
    source: foundPath,
    provisionedBy: config.provisionedBy,
  };
}
