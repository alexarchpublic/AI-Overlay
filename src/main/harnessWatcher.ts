/**
 * @file src/main/harnessWatcher.ts
 *
 * Why it exists: PRD §0 D9 + §3.6 — in dev mode, edits anywhere under the
 * harness root trigger a debounced reload so the bundle stays fresh while
 * the developer iterates on harness content. In production this module is
 * not even constructed (PRD §3.6: "Production builds … never start
 * harnessWatcher").
 *
 * Design points worth re-stating:
 *
 *   - 500ms debounce (`HARNESS_WATCHER_DEBOUNCE_MS`). Rapid-fire saves
 *     coalesce to a single `loader.reload()` (PRD §3.7 + §5 DoD #9).
 *   - `awaitWriteFinish` so editors that rewrite-then-rename a file (vim,
 *     IntelliJ on Save) don't trigger a reload while the file is still
 *     being written.
 *   - `followSymlinks: false` to avoid loop-induced floods (PRD §3.7).
 *   - Polling is opt-in via env (`HARNESS_WATCHER_POLLING=1`) per D18 — the
 *     only deviation here from chokidar's defaults. We log `harness.watcherPolling`
 *     when it's on so operators on network mounts can see why CPU is up.
 *
 * The watcher is NOT responsible for reading files — only for signaling.
 * Every reload routes through `loader.reload()`.
 */

import type { FSWatcher } from 'chokidar';
import type { AppLogger } from './logger';
import type { HarnessLoader } from './harnessLoader';
import {
  HARNESS_IGNORED_DIR_SEGMENTS,
  HARNESS_WATCHER_DEBOUNCE_MS,
  HARNESS_WATCHER_POLLING_ENV,
  HARNESS_WATCHER_POLL_INTERVAL_MS,
  HARNESS_WATCHER_STABILITY_THRESHOLD_MS,
} from '../shared/harnessConstants';

export interface HarnessWatcherDeps {
  logger: AppLogger;
  loader: HarnessLoader;
  /** Resolved absolute root. Caller is responsible for keeping this in sync. */
  rootPath: string;
  /**
   * Optional chokidar factory injection. Production wires real chokidar;
   * tests inject a fake that exposes `.on()` and `.close()` so the debounce
   * + reload coalescing logic can be exercised without filesystem events.
   */
  chokidarFactory?: ChokidarFactory;
  /** `setTimeout` injection for fake-timer tests. */
  setTimer?: (cb: () => void, ms: number) => NodeJS.Timeout | number;
  clearTimer?: (handle: NodeJS.Timeout | number) => void;
}

export type ChokidarFactory = (
  paths: string,
  opts: {
    ignored?: (path: string) => boolean;
    ignoreInitial: boolean;
    persistent: boolean;
    followSymlinks: boolean;
    usePolling?: boolean;
    interval?: number;
    awaitWriteFinish?: { stabilityThreshold: number; pollInterval: number };
  },
) => WatcherLike;

/** Slice of `chokidar.FSWatcher` we depend on. */
export interface WatcherLike {
  on(event: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir' | 'error', cb: (...args: unknown[]) => void): WatcherLike;
  close(): Promise<void>;
}

export interface HarnessWatcher {
  /** Stop the watcher and clear any pending debounce. Idempotent. */
  close(): Promise<void>;
}

/**
 * Start the watcher. Returns `null` if `chokidarFactory` resolution failed
 * (e.g., chokidar wasn't installed) — the loader keeps working without
 * hot-reload, the user just has to click "Reload now".
 */
export function startHarnessWatcher(deps: HarnessWatcherDeps): HarnessWatcher | null {
  const setTimer = deps.setTimer ?? setTimeout;
  const clearTimer = deps.clearTimer ?? clearTimeout;

  const factory = deps.chokidarFactory ?? defaultChokidarFactory();
  if (!factory) {
    deps.logger.warn('harness.watcherUnavailable', {
      reason: 'chokidar not resolvable',
      rootPath: deps.rootPath,
    });
    return null;
  }

  const usePolling = process.env[HARNESS_WATCHER_POLLING_ENV] === '1';
  if (usePolling) {
    deps.logger.warn('harness.watcherPolling', {
      rootPath: deps.rootPath,
      reason: 'env opt-in',
    });
  }

  const watcher = factory(deps.rootPath, {
    ignored: (p: string): boolean => isWatcherIgnored(p),
    ignoreInitial: true,
    persistent: true,
    followSymlinks: false,
    ...(usePolling ? { usePolling: true, interval: HARNESS_WATCHER_POLL_INTERVAL_MS } : {}),
    awaitWriteFinish: {
      stabilityThreshold: HARNESS_WATCHER_STABILITY_THRESHOLD_MS,
      pollInterval: HARNESS_WATCHER_POLL_INTERVAL_MS,
    },
  });

  let debounceHandle: ReturnType<typeof setTimer> | null = null;
  let closed = false;

  function trigger(reason: string, sample?: string): void {
    if (closed) return;
    if (debounceHandle !== null) {
      clearTimer(debounceHandle);
      debounceHandle = null;
    }
    debounceHandle = setTimer(() => {
      debounceHandle = null;
      deps.logger.debug('harness.watcherFired', {
        reason,
        ...(sample !== undefined ? { sample } : {}),
      });
      void deps.loader
        .reload()
        .then((b) => {
          deps.logger.info('harness.reloaded', {
            rootPath: b.metadata.rootPath,
            fileCount: b.metadata.fileCount,
            approxTokens: b.metadata.approxTokens,
            loadDurationMs: b.metadata.loadDurationMs,
            trigger: 'watcher',
          });
        })
        .catch(() => {
          // `loader.reload()` already routed the error to `onLoadError`;
          // swallow the throw here so the unhandled-rejection trap stays clean.
        });
    }, HARNESS_WATCHER_DEBOUNCE_MS);
  }

  watcher
    .on('add', (p: unknown) => {
      trigger('add', typeof p === 'string' ? p : undefined);
    })
    .on('change', (p: unknown) => {
      trigger('change', typeof p === 'string' ? p : undefined);
    })
    .on('unlink', (p: unknown) => {
      trigger('unlink', typeof p === 'string' ? p : undefined);
    })
    .on('error', (err: unknown) => {
      deps.logger.warn('harness.watcherError', {
        message: err instanceof Error ? err.message : String(err),
      });
    });

  return {
    async close() {
      if (closed) return;
      closed = true;
      if (debounceHandle !== null) {
        clearTimer(debounceHandle);
        debounceHandle = null;
      }
      try {
        await watcher.close();
      } catch (err) {
        deps.logger.warn('harness.watcherCloseFailed', {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Path-based ignore rule for chokidar. Directory-name matching only (the
 * loader's `harnessUtils.isUnderIgnoredDir` is path-shaped); we don't need
 * extension-level filtering at the watcher tier because changes to ignored
 * extensions still trip a reload, and the loader will skip them.
 */
function isWatcherIgnored(p: string): boolean {
  const segs = p.split(/[/\\]/);
  for (const seg of segs) {
    if (HARNESS_IGNORED_DIR_SEGMENTS.includes(seg)) return true;
  }
  return false;
}

/**
 * Resolve the real chokidar factory, returning `null` if the package is
 * not loadable. Wrapped this way so the watcher module is importable from
 * Vitest without chokidar installed.
 */
function defaultChokidarFactory(): ChokidarFactory | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const chokidar = require('chokidar') as {
      watch: (paths: string, opts: unknown) => FSWatcher;
    };
    return (paths, opts) => {
      // chokidar's FSWatcher is structurally compatible with WatcherLike
      // (both expose `on(event, cb)` returning `this` and `close(): Promise<void>`).
      // We cast through `unknown` to satisfy the structural-mismatch lint
      // when the FSWatcher type is unknown to the lint pass.
      const w: unknown = chokidar.watch(paths, opts);
      return w as WatcherLike;
    };
  } catch {
    return null;
  }
}
