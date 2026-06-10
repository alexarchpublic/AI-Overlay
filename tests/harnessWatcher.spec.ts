/**
 * @file tests/harnessWatcher.spec.ts
 *
 * Why it exists: PRD §5 DoD #19 — `harnessWatcher.spec.ts` covers ≥ 3
 * cases: debounced reload, rapid-fire coalescing into a single reload,
 * and clean teardown via `close()`. Uses a fake chokidar factory so the
 * test never touches the filesystem.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  startHarnessWatcher,
  type ChokidarFactory,
  type WatcherLike,
} from '../src/main/harnessWatcher';
import type { HarnessLoader } from '../src/main/harnessLoader';
import type { AppLogger } from '../src/main/logger';
import type { HarnessBundle, HarnessMetadata } from '../src/shared/types';
import { HARNESS_WATCHER_DEBOUNCE_MS } from '../src/shared/harnessConstants';

interface FakeWatcherHandle {
  watcher: WatcherLike;
  fire: (event: 'add' | 'change' | 'unlink', p: string) => void;
  fireError: (err: Error) => void;
  closed: { v: boolean };
}

function makeFakeWatcher(): FakeWatcherHandle {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  const closed = { v: false };
  const watcher: WatcherLike = {
    on(event, cb) {
      handlers[event] ??= [];
      handlers[event].push(cb);
      return watcher;
    },
    close() {
      closed.v = true;
      return Promise.resolve();
    },
  };
  return {
    watcher,
    fire(event, p) {
      for (const cb of handlers[event] ?? []) cb(p);
    },
    fireError(err) {
      for (const cb of handlers.error ?? []) cb(err);
    },
    closed,
  };
}

function makeFakeLoader(): {
  loader: HarnessLoader;
  reloadCalls: { count: number };
} {
  const reloadCalls = { count: 0 };
  const meta: HarnessMetadata = {
    rootPath: '/tmp/harness',
    fileCount: 1,
    approxTokens: 10,
    algorithms: [],
    docs: ['x.md'],
    other: [],
    files: [],
    loadedAt: 0,
    loadDurationMs: 1,
    warnings: [],
    manifestUsed: false,
  };
  const bundle: HarnessBundle = { text: '### HARNESS BUNDLE\n', metadata: meta };
  const loader: HarnessLoader = {
    getHarness: () => Promise.resolve(bundle),
    getMetadata: () => Promise.resolve(meta),
    reload: () => {
      reloadCalls.count++;
      return Promise.resolve(bundle);
    },
    setRootPath: () => Promise.resolve(bundle),
    getRootPath: () => '/tmp/harness',
    onReloaded: () => () => undefined,
    onLoadError: () => () => undefined,
    shutdown: () => Promise.resolve(),
  };
  return { loader, reloadCalls };
}

function makeFakeLogger(): AppLogger {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child(): AppLogger {
      return this;
    },
    raw: undefined as unknown as AppLogger['raw'],
  };
}

describe('harnessWatcher — debounce + coalescing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('a single change event fires exactly one reload after the debounce window', async () => {
    const { loader, reloadCalls } = makeFakeLoader();
    const handle = makeFakeWatcher();
    const factory: ChokidarFactory = () => handle.watcher;

    const w = startHarnessWatcher({
      logger: makeFakeLogger(),
      loader,
      rootPath: '/tmp/harness',
      chokidarFactory: factory,
    });
    expect(w).not.toBeNull();

    handle.fire('change', '/tmp/harness/a.ts');
    expect(reloadCalls.count).toBe(0);

    vi.advanceTimersByTime(HARNESS_WATCHER_DEBOUNCE_MS);
    // Allow the awaited `reload()` Promise to flush.
    await vi.runAllTimersAsync();
    expect(reloadCalls.count).toBe(1);
  });

  it('rapid-fire edits within the debounce window coalesce to a single reload', async () => {
    const { loader, reloadCalls } = makeFakeLoader();
    const handle = makeFakeWatcher();
    const factory: ChokidarFactory = () => handle.watcher;

    startHarnessWatcher({
      logger: makeFakeLogger(),
      loader,
      rootPath: '/tmp/harness',
      chokidarFactory: factory,
    });

    // Ten events in rapid succession.
    for (let i = 0; i < 10; i++) {
      handle.fire('change', `/tmp/harness/a${String(i)}.ts`);
      vi.advanceTimersByTime(40); // 40ms between events; total 400ms
    }
    // No reload yet — within the debounce window.
    expect(reloadCalls.count).toBe(0);

    vi.advanceTimersByTime(HARNESS_WATCHER_DEBOUNCE_MS);
    await vi.runAllTimersAsync();
    expect(reloadCalls.count).toBe(1);
  });

  it('events on add / unlink also debounce-trigger a reload', async () => {
    const { loader, reloadCalls } = makeFakeLoader();
    const handle = makeFakeWatcher();
    const factory: ChokidarFactory = () => handle.watcher;

    startHarnessWatcher({
      logger: makeFakeLogger(),
      loader,
      rootPath: '/tmp/harness',
      chokidarFactory: factory,
    });

    handle.fire('add', '/tmp/harness/new.ts');
    vi.advanceTimersByTime(HARNESS_WATCHER_DEBOUNCE_MS);
    await vi.runAllTimersAsync();
    expect(reloadCalls.count).toBe(1);

    handle.fire('unlink', '/tmp/harness/new.ts');
    vi.advanceTimersByTime(HARNESS_WATCHER_DEBOUNCE_MS);
    await vi.runAllTimersAsync();
    expect(reloadCalls.count).toBe(2);
  });

  it('close() cancels a pending debounce + tears down the watcher', async () => {
    const { loader, reloadCalls } = makeFakeLoader();
    const handle = makeFakeWatcher();
    const factory: ChokidarFactory = () => handle.watcher;

    const w = startHarnessWatcher({
      logger: makeFakeLogger(),
      loader,
      rootPath: '/tmp/harness',
      chokidarFactory: factory,
    });
    expect(w).not.toBeNull();
    if (!w) return;

    handle.fire('change', '/tmp/harness/a.ts');
    await w.close();
    expect(handle.closed.v).toBe(true);

    // Even after the debounce window the reload must NOT fire post-close.
    vi.advanceTimersByTime(HARNESS_WATCHER_DEBOUNCE_MS * 2);
    await vi.runAllTimersAsync();
    expect(reloadCalls.count).toBe(0);
  });

  it('close() is idempotent', async () => {
    const { loader } = makeFakeLoader();
    const handle = makeFakeWatcher();
    const factory: ChokidarFactory = () => handle.watcher;

    const w = startHarnessWatcher({
      logger: makeFakeLogger(),
      loader,
      rootPath: '/tmp/harness',
      chokidarFactory: factory,
    });
    if (!w) return;
    await w.close();
    await w.close();
    expect(handle.closed.v).toBe(true);
  });
});
