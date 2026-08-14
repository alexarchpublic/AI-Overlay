/**
 * @file tests/provisioning.spec.ts
 *
 * Chunk 7 Phase 4 — unit coverage for team-config lookup, schema validation,
 * secrets-store write path, and redaction of key material.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import pino from 'pino';
import {
  PROVISIONING_COMPLETED_KEY,
  TEAM_CONFIG_FILENAME,
  defaultSharedConfigDir,
  parseTeamConfig,
  resolveTeamConfigSearchPaths,
  runProvisioning,
  type ProvisioningDeps,
  type ProvisioningFs,
} from '../src/main/provisioning';
import { buildPlatformInfo } from '../src/main/platform';
import { wrapAiStore } from '../src/main/aiStore';
import { wrapCaptureStore } from '../src/main/captureStore';
import { wrapKnowledgeStore } from '../src/main/knowledgeStoreState';
import { createTestSafeStorage } from '../src/main/knowledgeCrypto';
import {
  buildLoggerOptions,
  wrapPino,
  type AppLogger,
} from '../src/main/logger';
import { REDACT_PLACEHOLDER } from '../src/shared/constants';
import type { StoreLike } from '../src/main/widgetState';
import { AI_STORE_KEY_API_KEY } from '../src/shared/aiConstants';
import { isEncryptedSecret } from '../src/main/secretsStore';
import { wrapOptimizerStore } from '../src/main/optimizerStore';

function fakeLogger(): AppLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
    raw: {} as AppLogger['raw'],
  };
}

function memoryStore(initial: Record<string, unknown> = {}): StoreLike {
  const data = { ...initial };
  return {
    get(key: string, defaultValue?: unknown) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : defaultValue;
    },
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

function memoryFs(files: Record<string, string>): ProvisioningFs {
  return {
    existsSync(filePath) {
      return Object.prototype.hasOwnProperty.call(files, filePath);
    },
    readFileSync(filePath) {
      if (!Object.prototype.hasOwnProperty.call(files, filePath)) {
        throw new Error(`ENOENT: ${filePath}`);
      }
      return files[filePath]!;
    },
  };
}

function buildDeps(
  overrides: Partial<ProvisioningDeps> & { files?: Record<string, string> } = {},
): {
  deps: ProvisioningDeps;
  store: StoreLike;
  logger: AppLogger;
  aiStore: ReturnType<typeof wrapAiStore>;
  optimizerStore: ReturnType<typeof wrapOptimizerStore>;
} {
  const store = memoryStore();
  const safeStorage = createTestSafeStorage();
  const aiStore = wrapAiStore(store, { safeStorage });
  const captureStore = wrapCaptureStore(store);
  const knowledgeStore = wrapKnowledgeStore(store);
  const logger = fakeLogger();
  const { files, ...rest } = overrides;

  const optimizerStore = wrapOptimizerStore(store, { safeStorage });

  const deps: ProvisioningDeps = {
    store,
    aiStore,
    knowledgeStore,
    captureStore,
    optimizerStore,
    logger,
    getExecDir: () => 'C:\\Apps\\Overlay',
    getUserDataPath: () => 'C:\\Users\\cs\\AppData\\Roaming\\arch-public-ai-overlay',
    getSharedConfigDir: () => 'C:\\ProgramData\\ArchPublic',
    fs: memoryFs(files ?? {}),
    pathJoin: path.win32.join,
    ...rest,
  };

  return { deps, store, logger, aiStore, optimizerStore };
}

describe('parseTeamConfig', () => {
  it('accepts a minimal valid config', () => {
    const result = parseTeamConfig({ geminiApiKey: 'AIzaSy-test-key' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.geminiApiKey).toBe('AIzaSy-test-key');
    }
  });

  it('accepts optional fields', () => {
    const result = parseTeamConfig({
      geminiApiKey: 'key',
      defaultAlgorithm: 'arbitrage',
      captureIntervalMs: 5000,
      provisionedBy: 'it@archpublic.com',
      provisionedAt: '2026-07-27',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.defaultAlgorithm).toBe('arbitrage');
      expect(result.config.captureIntervalMs).toBe(5000);
      expect(result.config.provisionedBy).toBe('it@archpublic.com');
    }
  });

  it('tolerates unknown keys and reports them (v2 forward-compat)', () => {
    // v1 hard-rejected unknown keys, which meant any future config addition
    // invalidated the whole file on older clients. v2 tolerates and surfaces
    // them instead (D-M8).
    const result = parseTeamConfig({ geminiApiKey: 'key', extra: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.unknownKeys).toEqual(['extra']);
  });

  it('parses the v2 optimizer block', () => {
    const result = parseTeamConfig({
      geminiApiKey: 'key',
      optimizer: {
        mcpUrl: 'https://optimize.archpublic.com/mcp',
        teamKey: 'abc123',
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.optimizer).toEqual({
        mcpUrl: 'https://optimize.archpublic.com/mcp',
        teamKey: 'abc123',
      });
    }
  });

  it('rejects a malformed optimizer block', () => {
    expect(parseTeamConfig({ geminiApiKey: 'k', optimizer: { mcpUrl: 'nope' } }).ok).toBe(false);
    expect(
      parseTeamConfig({
        geminiApiKey: 'k',
        optimizer: { mcpUrl: 'https://x.example/mcp', teamKey: '' },
      }).ok,
    ).toBe(false);
    expect(parseTeamConfig({ geminiApiKey: 'k', optimizer: 'yes' }).ok).toBe(false);
  });

  it('rejects empty geminiApiKey', () => {
    const result = parseTeamConfig({ geminiApiKey: '   ' });
    expect(result.ok).toBe(false);
  });

  it('rejects invalid defaultAlgorithm', () => {
    const result = parseTeamConfig({ geminiApiKey: 'key', defaultAlgorithm: 'nope' });
    expect(result.ok).toBe(false);
  });

  it('rejects non-object JSON roots', () => {
    expect(parseTeamConfig([]).ok).toBe(false);
    expect(parseTeamConfig('x').ok).toBe(false);
    expect(parseTeamConfig(null).ok).toBe(false);
  });
});

describe('resolveTeamConfigSearchPaths', () => {
  it('returns execDir, userData, shared in that order', () => {
    const paths = resolveTeamConfigSearchPaths({
      getExecDir: () => '/Apps/Overlay',
      getUserDataPath: () => '/Users/a/Library/Application Support/arch-public-ai-overlay',
      getSharedConfigDir: () => '/Library/Application Support/ArchPublic',
      pathJoin: path.posix.join,
    });
    expect(paths).toEqual([
      `/Apps/Overlay/${TEAM_CONFIG_FILENAME}`,
      `/Users/a/Library/Application Support/arch-public-ai-overlay/${TEAM_CONFIG_FILENAME}`,
      `/Library/Application Support/ArchPublic/${TEAM_CONFIG_FILENAME}`,
    ]);
  });
});

describe('defaultSharedConfigDir', () => {
  it('uses PROGRAMDATA on Windows', () => {
    expect(
      defaultSharedConfigDir(buildPlatformInfo('win32'), { PROGRAMDATA: 'D:\\ProgramData' }),
    ).toBe(path.win32.join('D:\\ProgramData', 'ArchPublic'));
  });

  it('uses /Library/Application Support on macOS', () => {
    expect(defaultSharedConfigDir(buildPlatformInfo('darwin'))).toBe(
      '/Library/Application Support/ArchPublic',
    );
  });
});

describe('runProvisioning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips when provisioning.completed is already true', () => {
    const { deps, store, logger } = buildDeps();
    store.set(PROVISIONING_COMPLETED_KEY, true);
    const result = runProvisioning(deps);
    expect(result.status).toBe('skipped');
    expect(logger.debug).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('logs absent and returns searched paths when no file exists', () => {
    const { deps, logger } = buildDeps({ files: {} });
    const result = runProvisioning(deps);
    expect(result.status).toBe('absent');
    if (result.status === 'absent') {
      expect(result.searchedPaths).toHaveLength(3);
      expect(result.searchedPaths[0]).toContain(TEAM_CONFIG_FILENAME);
    }
    expect(logger.debug).toHaveBeenCalledWith(
      'provisioning.absent',
      expect.objectContaining({ searchedPaths: expect.any(Array) }),
    );
  });

  it('finds team-config in execDir (location 1)', () => {
    const execPath = path.win32.join('C:\\Apps\\Overlay', TEAM_CONFIG_FILENAME);
    const { deps, store, aiStore, logger } = buildDeps({
      files: {
        [execPath]: JSON.stringify({
          geminiApiKey: 'AIzaSy-from-exec',
          provisionedBy: 'ops',
        }),
      },
    });

    const result = runProvisioning(deps);
    expect(result).toEqual({
      status: 'applied',
      source: execPath,
      provisionedBy: 'ops',
    });
    expect(aiStore.getApiKey()).toBe('AIzaSy-from-exec');
    expect(isEncryptedSecret(store.get(AI_STORE_KEY_API_KEY) as string)).toBe(true);
    expect(store.get(PROVISIONING_COMPLETED_KEY)).toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      'provisioning.applied',
      expect.objectContaining({ source: execPath, provisionedBy: 'ops' }),
    );
    const infoArg = (logger.info as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(infoArg).not.toHaveProperty('geminiApiKey');
    expect(infoArg).not.toHaveProperty('apiKey');
  });

  it('falls through to userData when execDir has no file (location 2)', () => {
    const userDataPath = path.win32.join(
      'C:\\Users\\cs\\AppData\\Roaming\\arch-public-ai-overlay',
      TEAM_CONFIG_FILENAME,
    );
    const { deps, aiStore } = buildDeps({
      files: {
        [userDataPath]: JSON.stringify({ geminiApiKey: 'AIzaSy-from-userdata' }),
      },
    });
    const result = runProvisioning(deps);
    expect(result.status).toBe('applied');
    if (result.status === 'applied') expect(result.source).toBe(userDataPath);
    expect(aiStore.getApiKey()).toBe('AIzaSy-from-userdata');
  });

  it('falls through to shared ProgramData folder (location 3)', () => {
    const sharedPath = path.win32.join('C:\\ProgramData\\ArchPublic', TEAM_CONFIG_FILENAME);
    const { deps, aiStore } = buildDeps({
      files: {
        [sharedPath]: JSON.stringify({ geminiApiKey: 'AIzaSy-from-shared' }),
      },
    });
    const result = runProvisioning(deps);
    expect(result.status).toBe('applied');
    if (result.status === 'applied') expect(result.source).toBe(sharedPath);
    expect(aiStore.getApiKey()).toBe('AIzaSy-from-shared');
  });

  it('prefers execDir over later locations', () => {
    const execPath = path.win32.join('C:\\Apps\\Overlay', TEAM_CONFIG_FILENAME);
    const sharedPath = path.win32.join('C:\\ProgramData\\ArchPublic', TEAM_CONFIG_FILENAME);
    const { deps, aiStore } = buildDeps({
      files: {
        [execPath]: JSON.stringify({ geminiApiKey: 'from-exec' }),
        [sharedPath]: JSON.stringify({ geminiApiKey: 'from-shared' }),
      },
    });
    runProvisioning(deps);
    expect(aiStore.getApiKey()).toBe('from-exec');
  });

  it('logs invalid and does not set completed on malformed JSON', () => {
    const execPath = path.win32.join('C:\\Apps\\Overlay', TEAM_CONFIG_FILENAME);
    const { deps, store, logger, aiStore } = buildDeps({
      files: { [execPath]: '{not-json' },
    });
    const result = runProvisioning(deps);
    expect(result.status).toBe('invalid');
    expect(store.get(PROVISIONING_COMPLETED_KEY)).toBeUndefined();
    expect(aiStore.getApiKey()).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      'provisioning.invalid',
      expect.objectContaining({ source: execPath }),
    );
  });

  it('logs invalid and does not crash on schema failure', () => {
    const execPath = path.win32.join('C:\\Apps\\Overlay', TEAM_CONFIG_FILENAME);
    const { deps, store, logger } = buildDeps({
      files: {
        [execPath]: JSON.stringify({ geminiApiKey: '   ' }),
      },
    });
    const result = runProvisioning(deps);
    expect(result.status).toBe('invalid');
    expect(store.get(PROVISIONING_COMPLETED_KEY)).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      'provisioning.invalid',
      expect.objectContaining({ reason: expect.stringContaining('geminiApiKey') }),
    );
  });

  it('applies with a warning when the config carries unknown keys', () => {
    const execPath = path.win32.join('C:\\Apps\\Overlay', TEAM_CONFIG_FILENAME);
    const { deps, store, logger } = buildDeps({
      files: {
        [execPath]: JSON.stringify({ geminiApiKey: 'ok', unexpected: 1 }),
      },
    });
    const result = runProvisioning(deps);
    expect(result.status).toBe('applied');
    expect(store.get(PROVISIONING_COMPLETED_KEY)).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      'provisioning.unknownKeys',
      expect.objectContaining({ unknownKeys: ['unexpected'] }),
    );
  });

  it('provisions the optimizer block into the optimizer store', () => {
    const execPath = path.win32.join('C:\\Apps\\Overlay', TEAM_CONFIG_FILENAME);
    const { deps, store, optimizerStore } = buildDeps({
      files: {
        [execPath]: JSON.stringify({
          geminiApiKey: 'key',
          optimizer: { mcpUrl: 'https://optimize.archpublic.com/mcp', teamKey: 'tk-1' },
        }),
      },
    });
    const result = runProvisioning(deps);
    expect(result.status).toBe('applied');
    expect(optimizerStore.getConfig()).toEqual({
      mcpUrl: 'https://optimize.archpublic.com/mcp',
      teamKey: 'tk-1',
    });
    expect(store.get(PROVISIONING_COMPLETED_KEY)).toBe(true);
  });

  it('re-applies a rotated optimizer block after provisioning completed', () => {
    const execPath = path.win32.join('C:\\Apps\\Overlay', TEAM_CONFIG_FILENAME);
    const v2 = (teamKey: string): string =>
      JSON.stringify({
        geminiApiKey: 'key',
        optimizer: { mcpUrl: 'https://optimize.archpublic.com/mcp', teamKey },
      });
    const files: Record<string, string> = { [execPath]: v2('tk-old') };
    const { deps, optimizerStore } = buildDeps({ files });

    expect(runProvisioning(deps).status).toBe('applied');
    // Same file again: nothing to re-apply.
    expect(runProvisioning(deps).status).toBe('skipped');
    // Rotated key: applied even though provisioning.completed is set.
    files[execPath] = v2('tk-new');
    expect(runProvisioning(deps).status).toBe('optimizer-updated');
    expect(optimizerStore.getConfig()?.teamKey).toBe('tk-new');
  });

  it('lights up the optimizer on an already-provisioned v1 machine', () => {
    // The §3.3 rollout path: a tester provisioned long ago (v1, completed)
    // gets a refreshed v2 config file — the optimizer block must apply.
    const execPath = path.win32.join('C:\\Apps\\Overlay', TEAM_CONFIG_FILENAME);
    const files: Record<string, string> = {
      [execPath]: JSON.stringify({ geminiApiKey: 'key' }),
    };
    const { deps, optimizerStore } = buildDeps({ files });
    expect(runProvisioning(deps).status).toBe('applied');
    expect(optimizerStore.isConfigured()).toBe(false);

    files[execPath] = JSON.stringify({
      geminiApiKey: 'key',
      optimizer: { mcpUrl: 'https://optimize.archpublic.com/mcp', teamKey: 'tk-2' },
    });
    expect(runProvisioning(deps).status).toBe('optimizer-updated');
    expect(optimizerStore.isConfigured()).toBe(true);
  });

  it('never logs the optimizer team key', () => {
    const execPath = path.win32.join('C:\\Apps\\Overlay', TEAM_CONFIG_FILENAME);
    const { deps, logger } = buildDeps({
      files: {
        [execPath]: JSON.stringify({
          geminiApiKey: 'key',
          optimizer: { mcpUrl: 'https://optimize.archpublic.com/mcp', teamKey: 'SECRET-TK' },
        }),
      },
    });
    runProvisioning(deps);
    const allCalls = [
      ...vi.mocked(logger.debug).mock.calls,
      ...vi.mocked(logger.info).mock.calls,
      ...vi.mocked(logger.warn).mock.calls,
      ...vi.mocked(logger.error).mock.calls,
    ];
    expect(JSON.stringify(allCalls)).not.toContain('SECRET-TK');
  });

  it('applies optional defaultAlgorithm and captureIntervalMs', () => {
    const execPath = path.win32.join('C:\\Apps\\Overlay', TEAM_CONFIG_FILENAME);
    const { deps, store } = buildDeps({
      files: {
        [execPath]: JSON.stringify({
          geminiApiKey: 'key',
          defaultAlgorithm: 'apex',
          captureIntervalMs: 8_000,
        }),
      },
    });
    runProvisioning(deps);
    expect(store.get('knowledge.activeAlgorithm')).toBe('apex');
    expect(store.get('capture.intervalMs')).toBe(8_000);
  });

  it('does not delete the team-config file after apply', () => {
    const execPath = path.win32.join('C:\\Apps\\Overlay', TEAM_CONFIG_FILENAME);
    const files: Record<string, string> = {
      [execPath]: JSON.stringify({ geminiApiKey: 'keep-me' }),
    };
    const { deps } = buildDeps({ files });
    runProvisioning(deps);
    expect(files[execPath]).toBeDefined();
  });
});

describe('provisioning redaction', () => {
  it('redacts geminiApiKey so key material never reaches the log stream', () => {
    const chunks: Buffer[] = [];
    const stream = {
      write(chunk: string | Buffer) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        return true;
      },
    };
    const logger = wrapPino(pino(buildLoggerOptions(), stream));
    const secret = 'AIzaSy-MUST-NOT-APPEAR-IN-LOGS-xyz';

    logger.info('provisioning.applied', {
      source: 'C:\\ProgramData\\ArchPublic\\team-config.json',
      provisionedBy: 'ops',
      geminiApiKey: secret,
    });

    const raw = Buffer.concat(chunks).toString('utf8');
    expect(raw).not.toContain(secret);
    expect(raw).toContain(REDACT_PLACEHOLDER);
    expect(raw).toContain('provisioning.applied');
  });
});
