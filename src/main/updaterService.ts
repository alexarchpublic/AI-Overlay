/**
 * @file src/main/updaterService.ts
 *
 * Why it exists: Chunk 7 Phase 3 — injectable wrapper around electron-updater.
 * No `electron` / `electron-updater` import at module scope so Vitest can drive
 * the state machine with a fake `AppUpdater`. Behavior locked by PRD D7/D9/
 * D10/D11/D18:
 *   - check 10s after start, then every 4h
 *   - Windows: autoDownload + autoInstallOnAppQuit
 *   - macOS: notify-only (no download / no quit-install)
 *   - never set `channel` (D11)
 *   - allowDowngrade = false (D18)
 */

import type { AppLogger } from './logger';
import type { PlatformInfo } from './platform';
import {
  UPDATE_CHANNEL_LABEL,
  buildReleaseNotesUrl,
  type UpdateState,
  type UpdateStateSnapshot,
} from '../shared/updateTypes';

/** Delay before the first update check after `start()` (D9). */
export const UPDATE_INITIAL_DELAY_MS = 10_000;
/** Cadence for subsequent checks while the app is running (D9). */
export const UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000;
/** Max rate for `update.downloadProgress` log lines (PRD §3.8). */
export const UPDATE_PROGRESS_LOG_THROTTLE_MS = 5_000;

/** Minimal UpdateInfo shape we read from electron-updater events. */
export interface UpdateInfoLike {
  version: string;
  releaseDate?: string;
}

/** Minimal ProgressInfo shape. */
export interface ProgressInfoLike {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

/**
 * Injectable subset of electron-updater's `AppUpdater`. Tests supply a fake;
 * production wires `autoUpdater` from `electron-updater`.
 */
export interface AppUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowDowngrade: boolean;
  /** Getter — leave unset so GitHub provider emits/reads `latest.yml` (D11). */
  readonly channel: string | null;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate?(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  removeListener?(event: string, listener: (...args: unknown[]) => void): unknown;
}

export type UpdaterServiceEvent = 'stateChanged';

export interface UpdaterServiceDeps {
  autoUpdater: AppUpdaterLike;
  logger: AppLogger;
  platform: PlatformInfo;
  /** `app.getVersion()` — injected so tests need no Electron. */
  getVersion: () => string;
  /**
   * When false (dev / unpackaged), `start()` wires listeners but skips the
   * scheduled check loop — unpackaged apps have no `app-update.yml`.
   */
  isPackaged: boolean;
  /** Injectable timers for unit tests. */
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  now?: () => number;
}

export interface UpdaterServiceHandle {
  start(): void;
  checkNow(): Promise<void>;
  getState(): UpdateStateSnapshot;
  installNow(): void;
  on(event: UpdaterServiceEvent, handler: (snapshot: UpdateStateSnapshot) => void): () => void;
  /** Tear down timers + listeners (tests / shutdown). */
  stop(): void;
}

interface MutableSnapshot {
  state: UpdateState;
  version: string | null;
  releaseNotesUrl: string | null;
  percent: number | null;
  error: string | null;
  lastCheckedAt: string | null;
}

function emptyMutable(): MutableSnapshot {
  return {
    state: 'idle',
    version: null,
    releaseNotesUrl: null,
    percent: null,
    error: null,
    lastCheckedAt: null,
  };
}

/**
 * Create the updater service. Call `start()` once after `app.whenReady`.
 */
export function createUpdaterService(deps: UpdaterServiceDeps): UpdaterServiceHandle {
  const setTimeoutFn = deps.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = deps.clearTimeoutFn ?? clearTimeout;
  const setIntervalFn = deps.setIntervalFn ?? setInterval;
  const clearIntervalFn = deps.clearIntervalFn ?? clearInterval;
  const now = deps.now ?? Date.now;

  const snapshot = emptyMutable();
  const listeners = new Set<(s: UpdateStateSnapshot) => void>();

  let started = false;
  let initialTimer: ReturnType<typeof setTimeout> | null = null;
  let intervalTimer: ReturnType<typeof setInterval> | null = null;
  /** `null` means no progress log has been emitted yet — first one is free. */
  let lastProgressLogAt: number | null = null;
  let checking = false;

  const emit = (): void => {
    const next = getState();
    for (const handler of listeners) {
      try {
        handler(next);
      } catch (err) {
        deps.logger.warn('update.listenerError', {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  };

  function getState(): UpdateStateSnapshot {
    return {
      state: snapshot.state,
      version: snapshot.version,
      releaseNotesUrl: snapshot.releaseNotesUrl,
      percent: snapshot.percent,
      error: snapshot.error,
      lastCheckedAt: snapshot.lastCheckedAt,
      currentVersion: deps.getVersion(),
      channel: UPDATE_CHANNEL_LABEL,
    };
  }

  function setState(partial: Partial<MutableSnapshot>): void {
    Object.assign(snapshot, partial);
    emit();
  }

  function markChecked(): void {
    snapshot.lastCheckedAt = new Date(now()).toISOString();
  }

  // ---- electron-updater event handlers ------------------------------------

  const onChecking = (): void => {
    checking = true;
    deps.logger.info('update.checkStarted', {
      currentVersion: deps.getVersion(),
      channel: UPDATE_CHANNEL_LABEL,
    });
    setState({ state: 'checking', error: null });
  };

  const onAvailable = (info: unknown): void => {
    const version =
      info && typeof info === 'object' && 'version' in info && typeof (info as UpdateInfoLike).version === 'string'
        ? (info as UpdateInfoLike).version
        : 'unknown';
    const rawDate =
      info && typeof info === 'object' && 'releaseDate' in info
        ? (info as UpdateInfoLike).releaseDate
        : undefined;
    const releaseDate = typeof rawDate === 'string' && rawDate.length > 0 ? rawDate : undefined;

    deps.logger.info('update.available', {
      version,
      ...(releaseDate ? { releaseDate } : {}),
    });
    markChecked();

    if (deps.platform.isMac || !deps.autoUpdater.autoDownload) {
      // D7 — macOS is notify-only; do not download / install.
      setState({
        state: 'notify-only',
        version,
        releaseNotesUrl: buildReleaseNotesUrl(version),
        percent: null,
        error: null,
      });
      return;
    }

    setState({
      state: 'available',
      version,
      releaseNotesUrl: buildReleaseNotesUrl(version),
      percent: 0,
      error: null,
    });
  };

  const onNotAvailable = (): void => {
    checking = false;
    deps.logger.debug('update.notAvailable', { currentVersion: deps.getVersion() });
    markChecked();
    setState({
      state: 'idle',
      version: null,
      releaseNotesUrl: null,
      percent: null,
      error: null,
    });
  };

  const onProgress = (info: unknown): void => {
    const percent =
      info && typeof info === 'object' && 'percent' in info && typeof (info as ProgressInfoLike).percent === 'number'
        ? (info as ProgressInfoLike).percent
        : 0;
    const rawBps =
      info && typeof info === 'object' && 'bytesPerSecond' in info
        ? (info as ProgressInfoLike).bytesPerSecond
        : undefined;
    const bytesPerSecond = typeof rawBps === 'number' ? rawBps : 0;

    if (snapshot.state !== 'downloading' && snapshot.state !== 'available') {
      setState({ state: 'downloading', percent, error: null });
    } else {
      setState({ state: 'downloading', percent });
    }

    const t = now();
    if (
      lastProgressLogAt === null ||
      t - lastProgressLogAt >= UPDATE_PROGRESS_LOG_THROTTLE_MS
    ) {
      lastProgressLogAt = t;
      deps.logger.debug('update.downloadProgress', {
        percent: Math.round(percent * 10) / 10,
        bytesPerSecond,
      });
    }
  };

  const onDownloaded = (info: unknown): void => {
    checking = false;
    const version =
      info && typeof info === 'object' && 'version' in info && typeof (info as UpdateInfoLike).version === 'string'
        ? (info as UpdateInfoLike).version
        : snapshot.version ?? 'unknown';

    deps.logger.info('update.downloaded', { version });
    deps.logger.info('update.installScheduled', {
      version,
      trigger: 'onQuit',
    });
    setState({
      state: 'downloaded',
      version,
      releaseNotesUrl: buildReleaseNotesUrl(version),
      percent: 100,
      error: null,
    });
  };

  const onError = (err: unknown): void => {
    checking = false;
    const message = err instanceof Error ? err.message : String(err);
    const code =
      err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code) : undefined;
    deps.logger.error('update.error', {
      ...(code ? { code } : {}),
      message,
    });
    markChecked();
    setState({
      state: 'error',
      error: message,
      percent: null,
    });
  };

  function wireUpdater(): void {
    const u = deps.autoUpdater;
    // Configure once — never touch `channel` (D11).
    u.autoDownload = deps.platform.isWindows;
    u.autoInstallOnAppQuit = deps.platform.isWindows;
    u.allowDowngrade = false;

    u.on('checking-for-update', onChecking);
    u.on('update-available', onAvailable);
    u.on('update-not-available', onNotAvailable);
    u.on('download-progress', onProgress);
    u.on('update-downloaded', onDownloaded);
    u.on('error', onError);
  }

  async function runCheck(): Promise<void> {
    if (checking) return;
    try {
      await deps.autoUpdater.checkForUpdates();
    } catch (err) {
      // electron-updater also emits 'error'; this catches promise rejections
      // from network/offline failures that may not emit.
      onError(err);
    }
  }

  return {
    start(): void {
      if (started) return;
      started = true;
      wireUpdater();

      if (!deps.isPackaged) {
        deps.logger.debug('update.startSkipped', { reason: 'not-packaged' });
        return;
      }

      initialTimer = setTimeoutFn(() => {
        initialTimer = null;
        void runCheck();
      }, UPDATE_INITIAL_DELAY_MS);

      intervalTimer = setIntervalFn(() => {
        void runCheck();
      }, UPDATE_INTERVAL_MS);
    },

    async checkNow(): Promise<void> {
      if (!started) {
        wireUpdater();
        started = true;
      }
      await runCheck();
    },

    getState,

    installNow(): void {
      if (snapshot.state !== 'downloaded') {
        deps.logger.warn('update.installNowIgnored', { state: snapshot.state });
        return;
      }
      if (!deps.platform.isWindows) {
        deps.logger.warn('update.installNowIgnored', {
          state: snapshot.state,
          reason: 'notify-only-platform',
        });
        return;
      }
      const version = snapshot.version ?? 'unknown';
      deps.logger.info('update.installScheduled', {
        version,
        trigger: 'manual',
      });
      // quitAndInstall closes windows then installs — intentional user action.
      deps.autoUpdater.quitAndInstall(true, true);
    },

    on(event, handler): () => void {
      void event; // only 'stateChanged' is in the union today
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    },

    stop(): void {
      if (initialTimer !== null) {
        clearTimeoutFn(initialTimer);
        initialTimer = null;
      }
      if (intervalTimer !== null) {
        clearIntervalFn(intervalTimer);
        intervalTimer = null;
      }
      started = false;
      checking = false;
      listeners.clear();
    },
  };
}
