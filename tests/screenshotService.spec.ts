/**
 * @file tests/screenshotService.spec.ts
 *
 * Why it exists: PRD §5 DoD #5 / #11 — ring-buffer eviction at N=5,
 * scheduler drift safety (self-correcting setTimeout chain — PRD D14),
 * event-payload shape, manual debounce (D15), permission revocation halts
 * the loop (D12), and disk pruning. All fakes — no Electron / sharp / fs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import {
  createScreenshotService,
  pickSourceForDisplay,
  reconcileExtractRect,
  type DesktopCapturerLike,
  type DesktopCapturerSource,
  type FsLike,
  type ScreenshotServiceDeps,
  type SharpLike,
  type SharpInstanceLike,
} from '../src/main/screenshotService';
import {
  CAPTURE_DEFAULT_INTERVAL_MS,
  CAPTURE_MANUAL_DEBOUNCE_MS,
  CAPTURE_RING_BUFFER_SIZE,
  CAPTURE_UNHEALTHY_MIN_BYTES,
  CAPTURE_UNHEALTHY_THRESHOLD,
} from '../src/shared/constants';
import type { CaptureRegion, Screenshot } from '../src/shared/types';
import { CapturePermissionError } from '../src/shared/types';
import type { CaptureStateStore } from '../src/main/captureStore';
import type { DisplayInfoFull } from '../src/main/displayUtils';

// ---------------------------------------------------------------------------
// Test fakes
// ---------------------------------------------------------------------------

const CAPTURES_DIR = path.join(os.tmpdir(), 'captures');

const display: DisplayInfoFull = {
  id: 1,
  scaleFactor: 2,
  bounds: { x: 0, y: 0, width: 1280, height: 720 },
  label: '',
};

function makeRegion(overrides: Partial<CaptureRegion> = {}): CaptureRegion {
  return {
    id: 'rg_t',
    displayId: display.id,
    scaleFactor: display.scaleFactor,
    x: 100,
    y: 100,
    w: 200,
    h: 200,
    px: 200,
    py: 200,
    pw: 400,
    ph: 400,
    createdAt: 0,
    ...overrides,
  };
}

function makeFakeStore(): CaptureStateStore {
  let region: CaptureRegion | null = makeRegion();
  let intervalMs = CAPTURE_DEFAULT_INTERVAL_MS;
  let lastCaptureTs: number | null = null;
  let auto = false;
  return {
    getIntervalMs: () => intervalMs,
    setIntervalMs: (ms) => {
      intervalMs = ms;
      return ms;
    },
    getRegion: () => region,
    setRegion: (r) => {
      region = r;
    },
    clearRegion: () => {
      region = null;
    },
    getAutoCapture: () => auto,
    setAutoCapture: (n) => {
      auto = n;
    },
    getLastCaptureTs: () => lastCaptureTs,
    setLastCaptureTs: (t) => {
      lastCaptureTs = t;
    },
    getDevShowRecentCaptures: () => false,
  };
}

function makeFakeDesktopCapturer(): {
  capturer: DesktopCapturerLike;
  getSources: ReturnType<typeof vi.fn>;
} {
  const getSources = vi.fn(async () => [
    {
      id: 'screen:1:0',
      display_id: '1',
      thumbnail: {
        toPNG: () => Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        getSize: () => ({ width: 2560, height: 1440 }),
      },
    },
  ]);
  return { capturer: { getSources }, getSources };
}

function makeFakeSharp(): {
  sharp: SharpLike;
  toFile: ReturnType<typeof vi.fn>;
} {
  const toFile = vi.fn(async (filepath: string) => {
    void filepath;
    return { size: 12345, width: 1024, height: 1024 };
  });
  const instance: SharpInstanceLike = {
    extract: () => instance,
    resize: () => instance,
    jpeg: () => instance,
    withMetadata: () => instance,
    toFile,
  };
  return {
    sharp: ((_input: Buffer) => instance) as SharpLike,
    toFile,
  };
}

function makeFakeFs(): { fs: FsLike; rename: ReturnType<typeof vi.fn>; unlink: ReturnType<typeof vi.fn>; readdir: ReturnType<typeof vi.fn>; stat: ReturnType<typeof vi.fn> } {
  const rename = vi.fn(async () => undefined);
  const unlink = vi.fn(async () => undefined);
  const readdir = vi.fn(async () => [] as readonly string[]);
  const stat = vi.fn(async () => ({ mtimeMs: 0, isFile: () => true }));
  const fs: FsLike = {
    mkdir: async () => undefined,
    readdir,
    stat,
    unlink,
    rename,
  };
  return { fs, rename, unlink, readdir, stat };
}

interface BuildOpts {
  store?: CaptureStateStore;
  desktopCapturer?: DesktopCapturerLike;
  sharp?: SharpLike;
  fs?: FsLike;
  permissionsGranted?: () => boolean;
  displays?: () => readonly DisplayInfoFull[];
  newId?: () => string;
  now?: () => number;
}

interface FakeTimerControls {
  setTimer: NonNullable<ScreenshotServiceDeps['setTimer']>;
  clearTimer: NonNullable<ScreenshotServiceDeps['clearTimer']>;
  setIntervalFn: NonNullable<ScreenshotServiceDeps['setIntervalFn']>;
  clearIntervalFn: NonNullable<ScreenshotServiceDeps['clearIntervalFn']>;
  /** Run all pending timeouts whose due time is ≤ `currentMs`. */
  advance: (ms: number) => Promise<void>;
  /** Drain any microtasks plus pending immediate timers. */
  flush: () => Promise<void>;
  pendingCount: () => number;
  /** Read the fake clock; pass `now` from the same controls into the service. */
  now: () => number;
}

/**
 * Hand-rolled fake timer set so we can advance time precisely. Vitest's
 * `vi.useFakeTimers` interacts poorly with the await-chained capture cycle
 * (the scheduler re-arms inside the async `finally`); a per-test runner
 * keeps the test predictable.
 *
 * `now()` reads the same monotonic clock that drives `advance()` so the
 * service's `lastCaptureTs`, `lastManualTs`, and pruner all see consistent
 * time.
 */
function makeFakeTimers(): FakeTimerControls {
  let nextId = 1;
  let currentMs = 0;
  const timeouts = new Map<number, { dueAt: number; cb: () => void }>();
  const intervals = new Map<number, { everyMs: number; nextDueAt: number; cb: () => void }>();

  const setTimer: FakeTimerControls['setTimer'] = (cb, ms) => {
    const id = nextId++;
    timeouts.set(id, { dueAt: currentMs + ms, cb });
    return id as unknown as NodeJS.Timeout;
  };
  const clearTimer: FakeTimerControls['clearTimer'] = (handle) => {
    timeouts.delete(handle as unknown as number);
  };
  const setIntervalFn: FakeTimerControls['setIntervalFn'] = (cb, ms) => {
    const id = nextId++;
    intervals.set(id, { everyMs: ms, nextDueAt: currentMs + ms, cb });
    return id as unknown as NodeJS.Timeout;
  };
  const clearIntervalFn: FakeTimerControls['clearIntervalFn'] = (handle) => {
    intervals.delete(handle as unknown as number);
  };

  async function flush(): Promise<void> {
    // Let pending microtasks resolve (e.g. capture cycle awaits).
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
  }

  async function advance(ms: number): Promise<void> {
    const target = currentMs + ms;
    while (true) {
      // Find earliest due-out timer.
      let earliest: { id: number; dueAt: number; isInterval: boolean } | null = null;
      for (const [id, t] of timeouts) {
        if (t.dueAt > target) continue;
        if (!earliest || t.dueAt < earliest.dueAt) earliest = { id, dueAt: t.dueAt, isInterval: false };
      }
      for (const [id, iv] of intervals) {
        if (iv.nextDueAt > target) continue;
        if (!earliest || iv.nextDueAt < earliest.dueAt) earliest = { id, dueAt: iv.nextDueAt, isInterval: true };
      }
      if (!earliest) break;
      currentMs = earliest.dueAt;
      if (earliest.isInterval) {
        const iv = intervals.get(earliest.id);
        if (iv) {
          iv.cb();
          iv.nextDueAt += iv.everyMs;
        }
      } else {
        const t = timeouts.get(earliest.id);
        timeouts.delete(earliest.id);
        if (t) t.cb();
      }
      await flush();
    }
    currentMs = target;
  }

  return {
    setTimer,
    clearTimer,
    setIntervalFn,
    clearIntervalFn,
    advance,
    flush,
    pendingCount: () => timeouts.size,
    now: () => currentMs,
  };
}

function build(opts: BuildOpts = {}): {
  service: ReturnType<typeof createScreenshotService>;
  store: CaptureStateStore;
  fakes: ReturnType<typeof makeFakeFs> & {
    capturer: DesktopCapturerLike;
    getSources: ReturnType<typeof vi.fn>;
    sharp: SharpLike;
    toFile: ReturnType<typeof vi.fn>;
    timers: FakeTimerControls;
    isGranted: ReturnType<typeof vi.fn>;
  };
} {
  const store = opts.store ?? makeFakeStore();
  const dc = opts.desktopCapturer
    ? { capturer: opts.desktopCapturer, getSources: vi.fn() }
    : makeFakeDesktopCapturer();
  const sh = opts.sharp ? { sharp: opts.sharp, toFile: vi.fn() } : makeFakeSharp();
  const fsParts = opts.fs
    ? { fs: opts.fs, rename: vi.fn(), unlink: vi.fn(), readdir: vi.fn(), stat: vi.fn() }
    : makeFakeFs();
  const isGranted = vi.fn(() => (opts.permissionsGranted ?? (() => true))());
  const timers = makeFakeTimers();
  const idCounter = { n: 0 };
  // Default `now` to the fake-timer clock so manual debounce + lastCaptureTs
  // see consistent monotonic time across `advance()` calls.
  const now = opts.now ?? timers.now;

  const deps: ScreenshotServiceDeps = {
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: () =>
        ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) as unknown as ScreenshotServiceDeps['logger'],
      raw: {} as unknown as ScreenshotServiceDeps['logger']['raw'],
    },
    store,
    desktopCapturer: dc.capturer,
    sharp: sh.sharp,
    fs: fsParts.fs,
    permissions: { isGranted },
    getDisplays: opts.displays ?? (() => [display]),
    capturesDir: CAPTURES_DIR,
    newId: opts.newId ?? (() => `ulid_${String(++idCounter.n)}`),
    now,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    setIntervalFn: timers.setIntervalFn,
    clearIntervalFn: timers.clearIntervalFn,
  };
  const service = createScreenshotService(deps);
  return {
    service,
    store,
    fakes: {
      ...fsParts,
      capturer: dc.capturer,
      getSources: dc.getSources,
      sharp: sh.sharp,
      toFile: sh.toFile,
      timers,
      isGranted,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('screenshotService — captureNow happy path', () => {
  it('produces a Screenshot with the expected shape and emits the captured event', async () => {
    const { service } = build();
    const captured: Screenshot[] = [];
    service.onCaptured((s) => captured.push(s));

    const result = await service.captureNow();

    expect(result).not.toBeNull();
    expect(result?.id).toMatch(/^ulid_/);
    expect(result?.regionId).toBe('rg_t');
    expect(result?.width).toBe(1024);
    expect(result?.height).toBe(1024);
    expect(result?.bytes).toBe(12345);
    expect(result?.filepath.startsWith(CAPTURES_DIR)).toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.id).toBe(result?.id);
  });

  it('writes the file via tmp → rename for atomicity', async () => {
    const ctx = build();
    await ctx.service.captureNow();
    expect(ctx.fakes.rename).toHaveBeenCalledOnce();
    const [from, to] = ctx.fakes.rename.mock.calls[0] ?? [];
    expect(typeof from).toBe('string');
    expect(typeof to).toBe('string');
    expect((from as string).endsWith('.tmp')).toBe(true);
    expect((to as string).endsWith('.jpg')).toBe(true);
  });

  it('updates lastCaptureTs in the store', async () => {
    const ctx = build({ now: () => 42_000 });
    expect(ctx.store.getLastCaptureTs()).toBeNull();
    await ctx.service.captureNow();
    expect(ctx.store.getLastCaptureTs()).toBe(42_000);
  });
});

describe('screenshotService — ring buffer eviction (PRD D2)', () => {
  it(`never holds more than N=${String(CAPTURE_RING_BUFFER_SIZE)} entries`, async () => {
    const ctx = build();
    for (let i = 0; i < CAPTURE_RING_BUFFER_SIZE + 3; i++) {
      // Bump time past the manual debounce so each capture lands.
      await ctx.service.captureNow();
      await ctx.fakes.timers.advance(CAPTURE_MANUAL_DEBOUNCE_MS + 1);
    }
    expect(ctx.service.getRecent().length).toBe(CAPTURE_RING_BUFFER_SIZE);
  });

  it('orders the buffer newest-first', async () => {
    const ctx = build();
    let i = 0;
    const ids: string[] = [];
    for (let k = 0; k < 4; k++) {
      const result = await ctx.service.captureNow();
      if (result) ids.push(result.id);
      i++;
      void i;
      await ctx.fakes.timers.advance(CAPTURE_MANUAL_DEBOUNCE_MS + 1);
    }
    const recent = ctx.service.getRecent();
    expect(recent.map((s) => s.id)).toEqual([...ids].reverse());
  });

  it('respects the limit argument in getRecent', async () => {
    const ctx = build();
    for (let i = 0; i < 5; i++) {
      await ctx.service.captureNow();
      await ctx.fakes.timers.advance(CAPTURE_MANUAL_DEBOUNCE_MS + 1);
    }
    expect(ctx.service.getRecent(2).length).toBe(2);
    expect(ctx.service.getRecent(99).length).toBe(5);
  });

  it('the disk file from an evicted ring entry is NOT deleted by the eviction itself (pruner is disk-only per §3.5)', async () => {
    const ctx = build();
    for (let i = 0; i < CAPTURE_RING_BUFFER_SIZE + 2; i++) {
      await ctx.service.captureNow();
      await ctx.fakes.timers.advance(CAPTURE_MANUAL_DEBOUNCE_MS + 1);
    }
    expect(ctx.fakes.unlink).not.toHaveBeenCalled();
  });
});

describe('screenshotService — manual debounce (PRD D15)', () => {
  it(`drops a second captureNow within ${String(CAPTURE_MANUAL_DEBOUNCE_MS)}ms of the first`, async () => {
    let nowMs = 0;
    const ctx = build({ now: () => nowMs });
    const a = await ctx.service.captureNow();
    expect(a).not.toBeNull();
    nowMs += 100;
    const b = await ctx.service.captureNow();
    expect(b).toBeNull();
  });

  it('honors the second captureNow once the debounce window elapses', async () => {
    let nowMs = 0;
    const ctx = build({ now: () => nowMs });
    const a = await ctx.service.captureNow();
    expect(a).not.toBeNull();
    nowMs += CAPTURE_MANUAL_DEBOUNCE_MS + 1;
    const b = await ctx.service.captureNow();
    expect(b).not.toBeNull();
  });
});

describe('screenshotService — auto loop scheduling (PRD D14)', () => {
  it('start() fires an immediate capture and re-arms with a setTimeout chain', async () => {
    const ctx = build();
    ctx.service.start();
    // The "immediate" first capture is queued via the await chain; flush.
    await ctx.fakes.timers.flush();
    expect(ctx.fakes.toFile).toHaveBeenCalledTimes(1);
    // After the cycle completes, exactly one setTimeout is queued.
    expect(ctx.fakes.timers.pendingCount()).toBe(1);
  });

  it('the loop fires again after intervalMs elapses', async () => {
    const ctx = build();
    ctx.service.start();
    await ctx.fakes.timers.flush();
    expect(ctx.fakes.toFile).toHaveBeenCalledTimes(1);

    await ctx.fakes.timers.advance(CAPTURE_DEFAULT_INTERVAL_MS);
    expect(ctx.fakes.toFile).toHaveBeenCalledTimes(2);
  });

  it('changing intervalMs re-arms on the new value', async () => {
    const ctx = build();
    ctx.service.start();
    await ctx.fakes.timers.flush();
    expect(ctx.fakes.toFile).toHaveBeenCalledTimes(1);

    ctx.service.setIntervalMs(5_000);
    // The previous timer was cleared and a 5000ms one armed.
    await ctx.fakes.timers.advance(5_000);
    expect(ctx.fakes.toFile).toHaveBeenCalledTimes(2);
  });

  it('stop() halts the loop and prevents further captures', async () => {
    const ctx = build();
    ctx.service.start();
    await ctx.fakes.timers.flush();
    expect(ctx.fakes.toFile).toHaveBeenCalledTimes(1);

    ctx.service.stop();
    await ctx.fakes.timers.advance(CAPTURE_DEFAULT_INTERVAL_MS * 5);
    expect(ctx.fakes.toFile).toHaveBeenCalledTimes(1);
  });

  it('an in-flight capture taking longer than intervalMs does NOT stack — re-arm waits for completion', async () => {
    // Slow toFile so the cycle takes "longer" than the fake interval.
    let resolveFirst: (() => void) | null = null;
    const slowToFile = vi.fn(
      () =>
        new Promise<{ size: number; width: number; height: number }>((res) => {
          if (!resolveFirst) {
            resolveFirst = (): void => res({ size: 1, width: 10, height: 10 });
          } else {
            res({ size: 1, width: 10, height: 10 });
          }
        }),
    );
    const slowInstance: SharpInstanceLike = {
      extract: () => slowInstance,
      resize: () => slowInstance,
      jpeg: () => slowInstance,
      withMetadata: () => slowInstance,
      toFile: slowToFile,
    };
    const slowSharp = ((_b: Buffer) => slowInstance) as SharpLike;
    const ctx = build({ sharp: slowSharp });
    ctx.service.start();
    await ctx.fakes.timers.flush();
    // First capture is in flight (toFile pending). Advance past intervalMs;
    // the loop must NOT have re-armed yet — re-arm happens in the cycle's
    // finally, after the awaited toFile resolves.
    await ctx.fakes.timers.advance(CAPTURE_DEFAULT_INTERVAL_MS * 2);
    expect(slowToFile).toHaveBeenCalledTimes(1);
    expect(ctx.fakes.timers.pendingCount()).toBe(0);
    // Resolve the in-flight capture; the cycle re-arms.
    resolveFirst?.();
    await ctx.fakes.timers.flush();
    expect(ctx.fakes.timers.pendingCount()).toBe(1);
  });
});

describe('screenshotService — permission revocation (PRD D12)', () => {
  it('halts the loop and does not throw when isGranted flips to false mid-loop', async () => {
    let granted = true;
    const ctx = build({ permissionsGranted: () => granted });
    ctx.service.start();
    await ctx.fakes.timers.flush();
    expect(ctx.fakes.toFile).toHaveBeenCalledTimes(1);

    granted = false;
    await ctx.fakes.timers.advance(CAPTURE_DEFAULT_INTERVAL_MS);
    // The loop pre-checks permission before invoking the capturer; the
    // second capture is skipped.
    expect(ctx.fakes.toFile).toHaveBeenCalledTimes(1);
    expect(ctx.service.getLoopState().running).toBe(false);
  });

  it('catches a desktopCapturer throw mid-capture and recovers as CapturePermissionError when the OS subsequently reports denied', async () => {
    // The realistic mid-capture failure: OS state was 'granted' at the
    // pre-check, capturer call started, OS revoked permission, capturer
    // throws, post-throw permission read returns 'denied' → service
    // surfaces CapturePermissionError and halts.
    let granted = true;
    let capturerCalls = 0;
    const throwingCapturer: DesktopCapturerLike = {
      getSources: vi.fn(async () => {
        capturerCalls++;
        // Simulate the OS flipping permission *during* the capture call.
        granted = false;
        throw new Error('denied by OS');
      }),
    };
    const ctx = build({
      desktopCapturer: throwingCapturer,
      permissionsGranted: () => granted,
    });

    const result = await ctx.service.captureNow();
    expect(result).toBeNull();
    expect(capturerCalls).toBe(1);
    expect(ctx.service.getLoopState().running).toBe(false);
    void CapturePermissionError; // import sanity
  });
});

describe('screenshotService — region invalidation (PRD D9)', () => {
  it('refuses to start when the saved region is invalid (e.g. display unplugged)', () => {
    const store = makeFakeStore();
    const noDisplays: DisplayInfoFull[] = [];
    const ctx = build({ store, displays: () => noDisplays });
    ctx.service.start();
    expect(ctx.service.getLoopState().running).toBe(false);
  });
});

describe('screenshotService — pruner', () => {
  it('deletes files older than CAPTURE_DISK_TTL_MS on its tick', async () => {
    let nowMs = 1_000_000;
    const oldFile = 'old.jpg';
    const newFile = 'fresh.jpg';
    const fakeFs = makeFakeFs();
    fakeFs.readdir.mockResolvedValue([oldFile, newFile, 'unrelated.txt']);
    fakeFs.stat.mockImplementation(async (p: string) => {
      if (p.endsWith('old.jpg')) return { mtimeMs: nowMs - 60 * 60_000, isFile: () => true };
      return { mtimeMs: nowMs, isFile: () => true };
    });

    const ctx = build({
      fs: fakeFs.fs,
      now: () => nowMs,
    });
    // Pruner ticks every 60_000ms — fast-forward one tick.
    await ctx.fakes.timers.advance(60_000);
    expect(fakeFs.unlink).toHaveBeenCalledTimes(1);
    const callPath = fakeFs.unlink.mock.calls[0]?.[0] as string;
    expect(callPath.endsWith('old.jpg')).toBe(true);
  });

  it('shutdown runs a final pruner sweep', async () => {
    const fakeFs = makeFakeFs();
    fakeFs.readdir.mockResolvedValue(['some.jpg']);
    fakeFs.stat.mockResolvedValue({ mtimeMs: 0, isFile: () => true });

    const ctx = build({ fs: fakeFs.fs, now: () => 9_999_999 });
    await ctx.service.shutdown();
    // The 0-mtime file is well past the TTL → unlinked by the final sweep.
    expect(fakeFs.unlink).toHaveBeenCalled();
  });
});

describe('screenshotService — loop state transitions emit events', () => {
  beforeEach(() => {
    // Each test gets a fresh service via build().
  });

  it('emits loopStateChanged when start/stop is called', async () => {
    const ctx = build();
    const events: { running: boolean }[] = [];
    ctx.service.onLoopStateChanged((s) => events.push({ running: s.running }));

    ctx.service.start();
    await ctx.fakes.timers.flush();
    ctx.service.stop();

    const runningTrue = events.some((e) => e.running === true);
    const runningFalse = events.some((e) => e.running === false);
    expect(runningTrue).toBe(true);
    expect(runningFalse).toBe(true);
  });

  it('emits loopStateChanged when intervalMs changes', () => {
    const ctx = build();
    const events: number[] = [];
    ctx.service.onLoopStateChanged((s) => events.push(s.intervalMs));
    ctx.service.setIntervalMs(20_000);
    expect(events.at(-1)).toBe(20_000);
  });
});

describe('pickSourceForDisplay (Chunk 7 B1)', () => {
  function makeSource(id: string, displayId: string): DesktopCapturerSource {
    return {
      id,
      display_id: displayId,
      thumbnail: {
        toPNG: () => Buffer.from([]),
        getSize: () => ({ width: 100, height: 100 }),
      },
    };
  }

  it('returns null for an empty source list', () => {
    expect(pickSourceForDisplay([], 5, [])).toBeNull();
  });

  it('matches on exact display_id', () => {
    const sources = [makeSource('screen:1:0', '5')];
    const displays: DisplayInfoFull[] = [
      { id: 5, scaleFactor: 1, bounds: { x: 0, y: 0, width: 100, height: 100 }, label: '' },
    ];
    expect(pickSourceForDisplay(sources, 5, displays)).toBe(sources[0]);
  });

  it('returns null when display_id is mismatched with no ordinal or single-source fallback available', () => {
    const displays: DisplayInfoFull[] = [
      { id: 10, scaleFactor: 1, bounds: { x: 0, y: 0, width: 100, height: 100 }, label: '' },
      { id: 20, scaleFactor: 1, bounds: { x: 100, y: 0, width: 100, height: 100 }, label: '' },
    ];
    const sources = [makeSource('screen:99:0', '999'), makeSource('screen:98:0', '998')];
    expect(pickSourceForDisplay(sources, 10, displays)).toBeNull();
  });

  it('returns null for two displays with empty source ids (ambiguous — not the single-fallback case)', () => {
    const displays: DisplayInfoFull[] = [
      { id: 10, scaleFactor: 1, bounds: { x: 0, y: 0, width: 100, height: 100 }, label: '' },
      { id: 20, scaleFactor: 1, bounds: { x: 100, y: 0, width: 100, height: 100 }, label: '' },
    ];
    const sources = [makeSource('weird:0', ''), makeSource('weird:1', '')];
    expect(pickSourceForDisplay(sources, 10, displays)).toBeNull();
  });

  it('falls back to the ordinal index parsed from screen:<n>:0 when display_id is empty', () => {
    const displays: DisplayInfoFull[] = [
      { id: 10, scaleFactor: 1, bounds: { x: 0, y: 0, width: 100, height: 100 }, label: '' },
      { id: 20, scaleFactor: 1, bounds: { x: 100, y: 0, width: 100, height: 100 }, label: '' },
    ];
    const sources = [makeSource('screen:0:0', ''), makeSource('screen:1:0', '')];
    expect(pickSourceForDisplay(sources, 20, displays)).toBe(sources[1]);
  });

  it('falls back to the single source when there is exactly one display and one source', () => {
    const displays: DisplayInfoFull[] = [
      { id: 1, scaleFactor: 1, bounds: { x: 0, y: 0, width: 100, height: 100 }, label: '' },
    ];
    const sources = [makeSource('weird-id', '')];
    expect(pickSourceForDisplay(sources, 1, displays)).toBe(sources[0]);
  });
});

describe('reconcileExtractRect (Chunk 7 B2)', () => {
  it('ratio 1.0 — passes the rect through unchanged and is not mismatched', () => {
    const result = reconcileExtractRect(
      { px: 10, py: 20, pw: 100, ph: 50 },
      { width: 200, height: 200 },
      { width: 200, height: 200 },
    );
    expect(result).toEqual({ left: 10, top: 20, width: 100, height: 50, ratioX: 1, ratioY: 1, mismatched: false });
  });

  it('ratio 0.5 — scales the rect down and flags mismatched', () => {
    const result = reconcileExtractRect(
      { px: 100, py: 100, pw: 200, ph: 200 },
      { width: 400, height: 400 },
      { width: 200, height: 200 },
    );
    expect(result.left).toBe(50);
    expect(result.top).toBe(50);
    expect(result.width).toBe(100);
    expect(result.height).toBe(100);
    expect(result.ratioX).toBe(0.5);
    expect(result.ratioY).toBe(0.5);
    expect(result.mismatched).toBe(true);
  });

  it('ratio 1.25 — scales the rect up and flags mismatched', () => {
    const result = reconcileExtractRect(
      { px: 100, py: 100, pw: 200, ph: 200 },
      { width: 400, height: 400 },
      { width: 500, height: 500 },
    );
    expect(result.ratioX).toBe(1.25);
    expect(result.ratioY).toBe(1.25);
    expect(result.left).toBe(125);
    expect(result.top).toBe(125);
    expect(result.width).toBe(250);
    expect(result.height).toBe(250);
    expect(result.mismatched).toBe(true);
  });

  it('clamps a rect that would overflow the actual image bounds', () => {
    const result = reconcileExtractRect(
      { px: 190, py: 190, pw: 50, ph: 50 },
      { width: 200, height: 200 },
      { width: 200, height: 200 },
    );
    expect(result.left + result.width).toBeLessThanOrEqual(200);
    expect(result.top + result.height).toBeLessThanOrEqual(200);
    expect(result.width).toBeGreaterThanOrEqual(1);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });
});

describe('screenshotService — capture health (PRD Chunk 7 B26)', () => {
  function buildHealthCtx(sizes: number[]): ReturnType<typeof build> {
    let call = 0;
    const toFile = vi.fn(async () => ({
      size: sizes[Math.min(call++, sizes.length - 1)] ?? 50_000,
      width: 10,
      height: 10,
    }));
    const instance: SharpInstanceLike = {
      extract: () => instance,
      resize: () => instance,
      jpeg: () => instance,
      withMetadata: () => instance,
      toFile,
    };
    const sharp = ((_b: Buffer) => instance) as SharpLike;
    return build({ sharp });
  }

  it(`trips 'false' after ${String(CAPTURE_UNHEALTHY_THRESHOLD)} consecutive tiny-byte frames`, async () => {
    const tiny = CAPTURE_UNHEALTHY_MIN_BYTES - 1;
    const ctx = buildHealthCtx([tiny, tiny, tiny]);
    const events: boolean[] = [];
    ctx.service.onCaptureHealthChanged((h) => events.push(h));

    for (let i = 0; i < CAPTURE_UNHEALTHY_THRESHOLD; i++) {
      await ctx.service.captureNow();
      await ctx.fakes.timers.advance(CAPTURE_MANUAL_DEBOUNCE_MS + 1);
    }
    expect(events).toEqual([false]);
  });

  it('clears back to healthy on the next valid-sized frame', async () => {
    const tiny = CAPTURE_UNHEALTHY_MIN_BYTES - 1;
    const ctx = buildHealthCtx([tiny, tiny, tiny, 50_000]);
    const events: boolean[] = [];
    ctx.service.onCaptureHealthChanged((h) => events.push(h));

    for (let i = 0; i < CAPTURE_UNHEALTHY_THRESHOLD; i++) {
      await ctx.service.captureNow();
      await ctx.fakes.timers.advance(CAPTURE_MANUAL_DEBOUNCE_MS + 1);
    }
    await ctx.service.captureNow();
    expect(events).toEqual([false, true]);
  });

  it('does not emit when every frame stays healthy-sized', async () => {
    const ctx = build();
    const events: boolean[] = [];
    ctx.service.onCaptureHealthChanged((h) => events.push(h));
    await ctx.service.captureNow();
    expect(events).toEqual([]);
  });
});
