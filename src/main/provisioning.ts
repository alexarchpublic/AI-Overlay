/**
 * @file src/main/provisioning.ts
 *
 * Chunk 7 Phase 4 — first-launch team-config provisioning (PRD D3/D6).
 * Looks for `team-config.json` beside the executable / in userData / in the
 * shared ArchPublic folder, writes the Gemini key through the existing
 * secretsStore path (DPAPI/Keychain), applies optional defaults, and sets
 * `provisioning.completed`. Never logs the key. Never deletes the config file.
 *
 * Team-config v2 (PRD_Optimizer_MCP_Integration D-M8): an optional
 * `optimizer` block ({ mcpUrl, teamKey }) provisions the hosted-optimizer
 * feature. The parse is now unknown-key-TOLERANT (unknown keys are ignored
 * with a warning, not rejected) so v1 clients' strictness is never repeated:
 * future config additions must not invalidate the whole file. The optimizer
 * block is also re-appliable after first-launch: `provisioning.completed`
 * still gates the one-shot v1 fields, but a re-provisioned config whose
 * optimizer block differs from the stored fingerprint is applied on boot —
 * that is what makes the §3.3 "config-first rollout" and key rotation work
 * on machines that provisioned long ago.
 *
 * Injectable deps — no `electron` import at module scope.
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import type { AppLogger } from './logger';
import type { PlatformInfo } from './platform';
import type { StoreLike } from './widgetState';
import type { AiStateStore } from './aiStore';
import type { CaptureStateStore } from './captureStore';
import type { KnowledgeStateStore } from './knowledgeStoreState';
import type { OptimizerConfigStore } from './optimizerStore';
import { parseActiveAlgorithm } from './knowledgeStoreState';
import { ALGORITHMS } from '../shared/knowledgeConstants';
import type { ActiveAlgorithm } from '../shared/knowledgeTypes';
import type { OptimizerTeamConfig } from '../shared/optimizerTypes';

/** electron-store key — sticky across restarts; delete to re-run provisioning. */
export const PROVISIONING_COMPLETED_KEY = 'provisioning.completed';

/**
 * Fingerprint (sha256, never the raw values) of the last-applied optimizer
 * block. A config file whose block hashes differently is re-applied even
 * after `provisioning.completed` — first provisioning and key rotation are
 * the same code path.
 */
export const PROVISIONING_OPTIMIZER_FINGERPRINT_KEY =
  'provisioning.optimizerFingerprint';

export const TEAM_CONFIG_FILENAME = 'team-config.json';

/** Shared IT drop folder name under ProgramData / Application Support. */
export const ARCHPUBLIC_SHARED_DIR = 'ArchPublic';

const KNOWN_KEYS = new Set([
  'geminiApiKey',
  'defaultAlgorithm',
  'captureIntervalMs',
  'provisionedBy',
  'provisionedAt',
  'optimizer',
]);

const VALID_ALGORITHMS = new Set<string>([...ALGORITHMS, 'all']);

export interface TeamConfig {
  geminiApiKey: string;
  defaultAlgorithm?: ActiveAlgorithm;
  captureIntervalMs?: number;
  provisionedBy?: string;
  provisionedAt?: string;
  /** v2 — absent on v1 configs; absence hides the feature entirely (D-M8). */
  optimizer?: OptimizerTeamConfig;
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
  /** v2 — receives the optimizer block when present (D-M8). */
  optimizerStore: Pick<OptimizerConfigStore, 'setConfig'>;
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
  | { status: 'applied'; source: string; provisionedBy?: string }
  /** Already provisioned, but a new/rotated optimizer block was applied. */
  | { status: 'optimizer-updated'; source: string };

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

/** Validate the v2 `optimizer` block. Unknown fields inside it are ignored. */
function parseOptimizerBlock(
  raw: unknown,
): { ok: true; config: OptimizerTeamConfig } | { ok: false; reason: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: 'optimizer must be a JSON object' };
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.mcpUrl !== 'string' || !/^https?:\/\/\S+$/.test(obj.mcpUrl.trim())) {
    return { ok: false, reason: 'optimizer.mcpUrl must be an http(s) URL' };
  }
  if (typeof obj.teamKey !== 'string' || obj.teamKey.trim().length === 0) {
    return { ok: false, reason: 'optimizer.teamKey must be a non-empty string' };
  }
  return {
    ok: true,
    config: { mcpUrl: obj.mcpUrl.trim(), teamKey: obj.teamKey.trim() },
  };
}

/**
 * Schema validation. Wrong types on known keys reject; unknown keys are
 * tolerated (returned in `unknownKeys` for the caller to log) so future
 * schema additions can never invalidate the whole file on older clients —
 * the v1 strictness bit exactly that way (D-M8).
 */
export function parseTeamConfig(raw: unknown):
  | { ok: true; config: TeamConfig; unknownKeys: string[] }
  | { ok: false; reason: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: 'root must be a JSON object' };
  }

  const obj = raw as Record<string, unknown>;
  const unknownKeys = Object.keys(obj).filter((key) => !KNOWN_KEYS.has(key));

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
  if (obj.optimizer !== undefined) {
    const parsed = parseOptimizerBlock(obj.optimizer);
    if (!parsed.ok) return { ok: false, reason: parsed.reason };
    config.optimizer = parsed.config;
  }

  return { ok: true, config, unknownKeys };
}

/**
 * Content fingerprint of an optimizer block. Stored instead of the raw
 * values so rotation detection never persists (or logs) the key itself.
 */
export function optimizerConfigFingerprint(config: OptimizerTeamConfig): string {
  return createHash('sha256')
    .update(`${config.mcpUrl}\n${config.teamKey}`)
    .digest('hex');
}

/**
 * Provisioning. Safe to call on every boot. The v1 fields remain one-shot
 * behind `provisioning.completed`; the v2 optimizer block re-applies whenever
 * its fingerprint changes (initial rollout and key rotation both look like
 * "the file changed"). Never throws; malformed input falls through to the
 * manual Settings → AI key flow.
 */
export function runProvisioning(deps: ProvisioningDeps): ProvisioningResult {
  const completed = deps.store.get(PROVISIONING_COMPLETED_KEY) === true;

  const searchedPaths = resolveTeamConfigSearchPaths(deps);
  let foundPath: string | null = null;
  for (const candidate of searchedPaths) {
    if (deps.fs.existsSync(candidate)) {
      foundPath = candidate;
      break;
    }
  }

  if (!foundPath) {
    if (completed) return { status: 'skipped', reason: 'already-completed' };
    deps.logger.debug('provisioning.absent', { searchedPaths });
    return { status: 'absent', searchedPaths };
  }

  let parsedJson: unknown;
  try {
    const text = deps.fs.readFileSync(foundPath, 'utf8');
    parsedJson = JSON.parse(text) as unknown;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    // After first-launch success a corrupt file is a curiosity, not an error.
    if (completed) {
      deps.logger.debug('provisioning.invalid', { source: foundPath, reason: `json: ${reason}` });
      return { status: 'skipped', reason: 'already-completed' };
    }
    deps.logger.warn('provisioning.invalid', { source: foundPath, reason: `json: ${reason}` });
    return { status: 'invalid', source: foundPath, reason: `json: ${reason}` };
  }

  const validated = parseTeamConfig(parsedJson);
  if (!validated.ok) {
    if (completed) {
      deps.logger.debug('provisioning.invalid', { source: foundPath, reason: validated.reason });
      return { status: 'skipped', reason: 'already-completed' };
    }
    deps.logger.warn('provisioning.invalid', { source: foundPath, reason: validated.reason });
    return { status: 'invalid', source: foundPath, reason: validated.reason };
  }

  const { config, unknownKeys } = validated;
  if (unknownKeys.length > 0) {
    deps.logger.warn('provisioning.unknownKeys', { source: foundPath, unknownKeys });
  }

  const applyOptimizerBlock = (): boolean => {
    if (config.optimizer === undefined) return false;
    const fingerprint = optimizerConfigFingerprint(config.optimizer);
    if (deps.store.get(PROVISIONING_OPTIMIZER_FINGERPRINT_KEY) === fingerprint) {
      return false;
    }
    deps.optimizerStore.setConfig(config.optimizer);
    deps.store.set(PROVISIONING_OPTIMIZER_FINGERPRINT_KEY, fingerprint);
    // Never include teamKey — only the endpoint, which is not a secret.
    deps.logger.info('provisioning.optimizerApplied', {
      source: foundPath,
      mcpUrl: config.optimizer.mcpUrl,
    });
    return true;
  };

  if (completed) {
    try {
      if (applyOptimizerBlock()) {
        return { status: 'optimizer-updated', source: foundPath };
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      deps.logger.warn('provisioning.invalid', {
        source: foundPath,
        reason: `optimizer apply failed: ${reason}`,
      });
    }
    return { status: 'skipped', reason: 'already-completed' };
  }

  try {
    deps.aiStore.setApiKey(config.geminiApiKey);
    if (config.defaultAlgorithm !== undefined) {
      deps.knowledgeStore.setActiveAlgorithm(config.defaultAlgorithm);
    }
    if (config.captureIntervalMs !== undefined) {
      deps.captureStore.setIntervalMs(config.captureIntervalMs);
    }
    applyOptimizerBlock();
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
