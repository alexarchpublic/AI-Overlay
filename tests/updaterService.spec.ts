/**
 * @file tests/updaterService.spec.ts
 *
 * Why it exists: Chunk 7 Phase 3 — drive `createUpdaterService` with a fake
 * `AppUpdater` covering: no update, update found + downloaded, download
 * error, network offline, macOS notify-only, and asserting `channel` is
 * never written.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  UPDATE_INITIAL_DELAY_MS,
  UPDATE_PROGRESS_LOG_THROTTLE_MS,
  createUpdaterService,
  type AppUpdaterLike,
  type UpdaterServiceDeps,
} from '../src/main/updaterService';
import { buildPlatformInfo } from '../src/main/platform';
import { UPDATE_CHANNEL_LABEL } from '../src/shared/updateTypes';
import type { AppLogger } from '../src/main/logger';

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

class FakeUpdater implements AppUpdaterLike {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowDowngrade = true;
  private _channel: string | null = null;
  channelSetCount = 0;
  listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  checkCalls = 0;
  quitCalls: Array<{ silent?: boolean; force?: boolean }> = [];
  checkImpl: (() => Promise<unknown>) | null = null;

  get channel(): string | null {
    return this._channel;
  }

  set channel(value: string | null) {
    this.channelSetCount += 1;
    this._channel = value;
  }

  on(event: string, listener: (...args: unknown[]) => void): this {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
  }

  async checkForUpdates(): Promise<unknown> {
    this.checkCalls += 1;
    if (this.checkImpl) return this.checkImpl();
    return null;
  }

  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
    this.quitCalls.push({ silent: isSilent, force: isForceRunAfter });
  }
}

function buildDeps(
  updater: FakeUpdater,
  overrides: Partial<UpdaterServiceDeps> = {},
): UpdaterServiceDeps {
  return {
    autoUpdater: updater,
    logger: fakeLogger(),
    platform: buildPlatformInfo('win32'),
    getVersion: () => '0.2.0-alpha.1',
    isPackaged: true,
    ...overrides,
  };
}

describe('createUpdaterService — configuration', () => {
  it('sets Windows autoDownload + autoInstallOnAppQuit, never touches channel', () => {
    const updater = new FakeUpdater();
    const service = createUpdaterService(buildDeps(updater));
    service.start();
    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(true);
    expect(updater.allowDowngrade).toBe(false);
    expect(updater.channelSetCount).toBe(0);
    expect(updater.channel).toBeNull();
    expect(service.getState().channel).toBe(UPDATE_CHANNEL_LABEL);
    service.stop();
  });

  it('disables autoDownload / autoInstallOnAppQuit on macOS', () => {
    const updater = new FakeUpdater();
    const service = createUpdaterService(
      buildDeps(updater, { platform: buildPlatformInfo('darwin') }),
    );
    service.start();
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.channelSetCount).toBe(0);
    service.stop();
  });

  it('skips scheduled checks when not packaged', () => {
    const updater = new FakeUpdater();
    const setTimeoutFn = vi.fn();
    const setIntervalFn = vi.fn();
    const service = createUpdaterService(
      buildDeps(updater, {
        isPackaged: false,
        setTimeoutFn: setTimeoutFn as unknown as typeof setTimeout,
        setIntervalFn: setIntervalFn as unknown as typeof setInterval,
      }),
    );
    service.start();
    expect(setTimeoutFn).not.toHaveBeenCalled();
    expect(setIntervalFn).not.toHaveBeenCalled();
    service.stop();
  });

  it('schedules an initial check after UPDATE_INITIAL_DELAY_MS when packaged', () => {
    const updater = new FakeUpdater();
    const setTimeoutFn = vi.fn().mockReturnValue(1);
    const setIntervalFn = vi.fn().mockReturnValue(2);
    const service = createUpdaterService(
      buildDeps(updater, {
        setTimeoutFn: setTimeoutFn as unknown as typeof setTimeout,
        setIntervalFn: setIntervalFn as unknown as typeof setInterval,
        clearTimeoutFn: vi.fn() as unknown as typeof clearTimeout,
        clearIntervalFn: vi.fn() as unknown as typeof clearInterval,
      }),
    );
    service.start();
    expect(setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), UPDATE_INITIAL_DELAY_MS);
    service.stop();
  });
});

describe('createUpdaterService — state paths', () => {
  let updater: FakeUpdater;
  let logger: AppLogger;
  let service: ReturnType<typeof createUpdaterService>;
  let snapshots: ReturnType<typeof service.getState>[];

  beforeEach(() => {
    updater = new FakeUpdater();
    logger = fakeLogger();
    service = createUpdaterService(buildDeps(updater, { logger }));
    snapshots = [];
    service.on('stateChanged', (s) => {
      snapshots.push(s);
    });
    service.start();
  });

  it('no update → idle after update-not-available', async () => {
    updater.checkImpl = async () => {
      updater.emit('checking-for-update');
      updater.emit('update-not-available', { version: '0.2.0-alpha.1' });
      return null;
    };
    await service.checkNow();
    expect(service.getState().state).toBe('idle');
    expect(logger.debug).toHaveBeenCalledWith(
      'update.notAvailable',
      expect.objectContaining({ currentVersion: '0.2.0-alpha.1' }),
    );
    expect(service.getState().lastCheckedAt).toBeTruthy();
  });

  it('update found + downloaded on Windows', async () => {
    updater.checkImpl = async () => {
      updater.emit('checking-for-update');
      updater.emit('update-available', {
        version: '0.2.0-alpha.2',
        releaseDate: '2026-07-27',
      });
      updater.emit('download-progress', { percent: 40, bytesPerSecond: 1000 });
      updater.emit('update-downloaded', { version: '0.2.0-alpha.2' });
      return null;
    };
    await service.checkNow();
    const state = service.getState();
    expect(state.state).toBe('downloaded');
    expect(state.version).toBe('0.2.0-alpha.2');
    expect(state.percent).toBe(100);
    expect(logger.info).toHaveBeenCalledWith(
      'update.available',
      expect.objectContaining({ version: '0.2.0-alpha.2' }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      'update.downloaded',
      expect.objectContaining({ version: '0.2.0-alpha.2' }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      'update.installScheduled',
      expect.objectContaining({ version: '0.2.0-alpha.2', trigger: 'onQuit' }),
    );
    expect(snapshots.some((s) => s.state === 'checking')).toBe(true);
    expect(snapshots.some((s) => s.state === 'downloading')).toBe(true);
  });

  it('download / check error sets error state', async () => {
    updater.checkImpl = async () => {
      updater.emit('checking-for-update');
      updater.emit('error', Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }));
      return null;
    };
    await service.checkNow();
    expect(service.getState().state).toBe('error');
    expect(service.getState().error).toContain('ENOTFOUND');
    expect(logger.error).toHaveBeenCalledWith(
      'update.error',
      expect.objectContaining({ message: expect.stringContaining('ENOTFOUND') }),
    );
  });

  it('network offline (promise rejection) sets error state', async () => {
    updater.checkImpl = async () => {
      updater.emit('checking-for-update');
      throw new Error('net::ERR_INTERNET_DISCONNECTED');
    };
    await service.checkNow();
    expect(service.getState().state).toBe('error');
    expect(service.getState().error).toContain('ERR_INTERNET_DISCONNECTED');
  });

  it('macOS notify-only path — available without download', async () => {
    service.stop();
    updater = new FakeUpdater();
    logger = fakeLogger();
    service = createUpdaterService(
      buildDeps(updater, { logger, platform: buildPlatformInfo('darwin') }),
    );
    service.start();

    updater.checkImpl = async () => {
      updater.emit('checking-for-update');
      updater.emit('update-available', { version: '0.2.0-alpha.2' });
      return null;
    };
    await service.checkNow();
    const state = service.getState();
    expect(state.state).toBe('notify-only');
    expect(state.version).toBe('0.2.0-alpha.2');
    expect(state.releaseNotesUrl).toContain('0.2.0-alpha.2');
    expect(updater.quitCalls).toHaveLength(0);
    // No download-progress / downloaded should have been required.
    expect(logger.info).not.toHaveBeenCalledWith('update.downloaded', expect.anything());
    service.stop();
  });

  it('throttles downloadProgress logs to ≤1 per 5s', async () => {
    let clock = 1_000;
    service.stop();
    updater = new FakeUpdater();
    logger = fakeLogger();
    service = createUpdaterService(
      buildDeps(updater, {
        logger,
        now: () => clock,
      }),
    );
    service.start();

    updater.emit('checking-for-update');
    updater.emit('update-available', { version: '0.2.0-alpha.2' });
    updater.emit('download-progress', { percent: 10, bytesPerSecond: 1 });
    clock += 1_000;
    updater.emit('download-progress', { percent: 20, bytesPerSecond: 1 });
    clock += UPDATE_PROGRESS_LOG_THROTTLE_MS;
    updater.emit('download-progress', { percent: 30, bytesPerSecond: 1 });

    const progressLogs = (logger.debug as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[0] === 'update.downloadProgress',
    );
    expect(progressLogs.length).toBe(2);
    service.stop();
  });

  it('installNow calls quitAndInstall only when downloaded on Windows', async () => {
    updater.checkImpl = async () => {
      updater.emit('checking-for-update');
      updater.emit('update-available', { version: '0.2.0-alpha.2' });
      updater.emit('update-downloaded', { version: '0.2.0-alpha.2' });
      return null;
    };
    await service.checkNow();
    service.installNow();
    expect(updater.quitCalls).toHaveLength(1);
    expect(logger.info).toHaveBeenCalledWith(
      'update.installScheduled',
      expect.objectContaining({ trigger: 'manual' }),
    );
  });

  it('installNow is a no-op when not downloaded', () => {
    service.installNow();
    expect(updater.quitCalls).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith(
      'update.installNowIgnored',
      expect.objectContaining({ state: 'idle' }),
    );
  });
});
