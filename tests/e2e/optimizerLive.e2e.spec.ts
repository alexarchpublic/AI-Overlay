/**
 * @file tests/e2e/optimizerLive.e2e.spec.ts
 *
 * Live end-to-end gate for PRD_Optimizer_MCP_Integration B3: the REAL
 * service + tracker against the production endpoint — start → poll → done →
 * TradingView card, plus the cancel path. Opt-in only (never runs in CI):
 *
 *   OPTIMIZER_MCP_URL=https://optimize.archpublic.com/mcp \
 *   OPTIMIZER_TEAM_KEY=... npx vitest run tests/e2e/optimizerLive.e2e.spec.ts
 *
 * Uses a small trial count against a cached ticker so the droplet round-trip
 * stays polite (one job-queue slot for well under a minute).
 */

import { describe, it, expect, vi } from 'vitest';
import { createOptimizerMcpService } from '../../src/main/optimizerMcpService';
import { createOptimizerJobTracker } from '../../src/main/optimizerJobTracker';
import type { OptimizerJobSnapshot } from '../../src/shared/optimizerTypes';
import type { AppLogger } from '../../src/main/logger';

const URL_ = process.env.OPTIMIZER_MCP_URL;
const KEY = process.env.OPTIMIZER_TEAM_KEY;
const enabled = typeof URL_ === 'string' && typeof KEY === 'string';

function liveLogger(): AppLogger {
  const make = (): AppLogger => ({
    debug: () => undefined,
    info: (evt, ctx) => {
      // eslint-disable-next-line no-console
      console.log(`[live] ${evt}`, JSON.stringify(ctx ?? {}));
    },
    warn: (evt, ctx) => {
      // eslint-disable-next-line no-console
      console.warn(`[live] ${evt}`, JSON.stringify(ctx ?? {}));
    },
    error: vi.fn(),
    child: () => make(),
    raw: {} as AppLogger['raw'],
  });
  return make();
}

function build(): {
  service: ReturnType<typeof createOptimizerMcpService>;
  tracker: ReturnType<typeof createOptimizerJobTracker>;
} {
  const service = createOptimizerMcpService({
    logger: liveLogger(),
    getConfig: () => ({ mcpUrl: URL_ as string, teamKey: KEY as string }),
  });
  const tracker = createOptimizerJobTracker({
    logger: liveLogger(),
    service,
    pollIntervalMs: 2_000,
  });
  return { service, tracker };
}

function waitForTerminal(
  tracker: ReturnType<typeof createOptimizerJobTracker>,
  timeoutMs: number,
): Promise<OptimizerJobSnapshot> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`job not terminal after ${String(timeoutMs)} ms`));
    }, timeoutMs);
    const off = tracker.onSnapshotChanged((s) => {
      if (['done', 'error', 'cancelled', 'expired'].includes(s.state)) {
        clearTimeout(timer);
        off();
        resolve(s);
      }
    });
  });
}

describe.skipIf(!enabled)('optimizer live e2e (B3 gate)', () => {
  it('start → poll → done → TradingView settings card', async () => {
    const { service, tracker } = build();
    const terminal = waitForTerminal(tracker, 240_000);
    const first = await tracker.start({
      kind: 'single',
      ticker: 'NVDA',
      timeframe: '1d',
      objective: 'max_sharpe',
      trials: 50,
    });
    expect(first).not.toBeNull();
    const done = await terminal;
    expect(done.state).toBe('done');
    expect(done.result).not.toBeNull();
    expect(Object.keys(done.result?.paramsTradingview ?? {}).length).toBeGreaterThan(10);
    // Exact PineScript input labels, from the engine's to_tradingview_dict().
    expect(done.result?.tradingviewTable).toContain('| iLongThreshold | ');
    expect(done.result?.tradingviewTable).toContain('| iLookBackLengthSpeed | ');
    // eslint-disable-next-line no-console
    console.log('[live] card:\n' + (done.result?.tradingviewTable ?? ''));
    // Grounding hand-off works on the real result.
    expect(tracker.queueResultAsGrounding()).toBe(true);
    tracker.dispose();
    await service.dispose();
  }, 300_000);

  it('cancel path', async () => {
    const { service, tracker } = build();
    const terminal = waitForTerminal(tracker, 60_000);
    await tracker.start({
      kind: 'single',
      ticker: 'AAPL',
      timeframe: '1d',
      objective: 'max_sharpe',
      trials: 300,
    });
    // Give the engine a beat, then cancel.
    await new Promise((r) => setTimeout(r, 3_000));
    expect(await tracker.cancel()).toBe(true);
    const done = await terminal;
    expect(done.state).toBe('cancelled');
    tracker.dispose();
    await service.dispose();
  }, 120_000);
});
