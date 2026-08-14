/**
 * @file tests/optimizerJobTracker.spec.ts
 *
 * Coverage for the panel job state machine (PRD_Optimizer_MCP_Integration
 * D-M6 / §3.2): start → poll → done with a TradingView card, engine 404 →
 * terminal `expired`, cancel, the regime follow-up backtest, and the
 * use-in-chat grounding hand-off. Timers are injected and driven by hand.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildTradingviewTable,
  createOptimizerJobTracker,
} from '../src/main/optimizerJobTracker';
import {
  OPTIMIZER_JOB_EXPIRED_MESSAGE,
  type OptimizerJobRequest,
} from '../src/shared/optimizerTypes';
import type { OptimizerToolResult } from '../src/shared/optimizerTypes';
import type { AppLogger } from '../src/main/logger';

function fakeLogger(): AppLogger {
  const make = (): AppLogger => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => make(),
    raw: {} as AppLogger['raw'],
  });
  return make();
}

type ToolScript = (tool: string, args: Record<string, unknown>) => OptimizerToolResult;

function okResult(tool: string, raw: unknown): OptimizerToolResult {
  return {
    ok: true,
    tool,
    raw,
    summary: { tool, label: tool, resultSummary: '', durationMs: 1, ok: true },
  };
}

function build(script: ToolScript): {
  tracker: ReturnType<typeof createOptimizerJobTracker>;
  calls: Array<{ tool: string; args: Record<string, unknown> }>;
  tick: () => Promise<void>;
} {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const pending: Array<() => void> = [];
  const tracker = createOptimizerJobTracker({
    logger: fakeLogger(),
    service: {
      callTool: async (tool, args) => {
        calls.push({ tool, args: args ?? {} });
        return script(tool, args ?? {});
      },
    },
    schedule: (fn) => {
      pending.push(fn);
      return pending.length;
    },
    cancelScheduled: () => undefined,
    nowIso: () => '2026-08-14T00:00:00.000Z',
  });
  const tick = async (): Promise<void> => {
    const fn = pending.shift();
    fn?.();
    // Let the async pollOnce settle.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  };
  return { tracker, calls, tick };
}

const REQUEST: OptimizerJobRequest = {
  kind: 'single',
  ticker: 'NVDA',
  timeframe: '1d',
  objective: 'max_sharpe',
  trials: 50,
};

const DONE_PAYLOAD = {
  status: 'done',
  done: 50,
  total: 50,
  result: {
    best: {
      params: { long_threshold: 431 },
      value: 1.87,
      zero_trades: false,
      backtest: {
        params_used: { iLongThreshold: 431, trade_size_type_perc: true, iLookBackLengthSpeed: 1.55 },
        metrics: { sharpe_ratio: 1.87, total_return_pct: 212.4, total_trades: 38 },
      },
    },
  },
};

describe('optimizerJobTracker', () => {
  it('runs start → poll progress → done with a settings card', async () => {
    let status: Record<string, unknown> = { status: 'queued', done: 0, total: 50, queue_position: 2 };
    const { tracker, tick } = build((tool) => {
      if (tool === 'start_optimization') return okResult(tool, { job_id: 'job-1', total: 50 });
      return okResult(tool, status);
    });
    const snapshots: string[] = [];
    tracker.onSnapshotChanged((s) => snapshots.push(`${s.state}:${s.done}`));

    const first = await tracker.start(REQUEST);
    expect(first?.state).toBe('queued');
    expect(first?.jobId).toBe('job-1');

    status = { status: 'running', done: 12, total: 50, best: 1.4 };
    await tick();
    expect(tracker.getSnapshot()?.state).toBe('running');
    expect(tracker.getSnapshot()?.done).toBe(12);
    expect(tracker.getSnapshot()?.best).toBe(1.4);

    status = DONE_PAYLOAD;
    await tick();
    const done = tracker.getSnapshot();
    expect(done?.state).toBe('done');
    expect(done?.result?.paramsTradingview.iLongThreshold).toBe(431);
    expect(done?.result?.tradingviewTable).toContain('| iLongThreshold | 431 |');
    expect(done?.result?.tradingviewTable).toContain('| trade_size_type_perc | On |');
    expect(done?.result?.metrics.sharpe_ratio).toBe(1.87);
    expect(done?.result?.objectiveValue).toBe(1.87);
    expect(snapshots.at(-1)).toBe('done:12');
  });

  it('maps engine 404 to the terminal expired state', async () => {
    let poll: OptimizerToolResult = okResult('get_optimization_status', {
      status: 'running', done: 1, total: 50,
    });
    const { tracker, tick } = build((tool) => {
      if (tool === 'start_optimization') return okResult(tool, { job_id: 'job-2' });
      return poll;
    });
    await tracker.start(REQUEST);
    poll = { ok: false, kind: 'engine', detail: 'Unknown job — it may have expired.' };
    await tick();
    const snap = tracker.getSnapshot();
    expect(snap?.state).toBe('expired');
    expect(snap?.error).toBe(OPTIMIZER_JOB_EXPIRED_MESSAGE);
  });

  it('keeps polling through transient failures', async () => {
    let poll: OptimizerToolResult = { ok: false, kind: 'timeout', tool: 'get_optimization_status', durationMs: 15000 };
    const { tracker, tick } = build((tool) => {
      if (tool === 'start_optimization') return okResult(tool, { job_id: 'job-3' });
      return poll;
    });
    await tracker.start(REQUEST);
    await tick();
    expect(tracker.getSnapshot()?.state).toBe('queued');
    poll = okResult('get_optimization_status', { status: 'running', done: 5, total: 50 });
    await tick();
    expect(tracker.getSnapshot()?.state).toBe('running');
  });

  it('cancels via cancel_optimization', async () => {
    const { tracker, calls } = build((tool) => {
      if (tool === 'start_optimization') return okResult(tool, { job_id: 'job-4' });
      return okResult(tool, { ok: true, status: 'cancelled' });
    });
    await tracker.start(REQUEST);
    expect(await tracker.cancel()).toBe(true);
    expect(tracker.getSnapshot()?.state).toBe('cancelled');
    expect(calls.some((c) => c.tool === 'cancel_optimization' && c.args.job_id === 'job-4')).toBe(true);
  });

  it('builds the regime card via a follow-up backtest', async () => {
    const { tracker, calls, tick } = build((tool) => {
      if (tool === 'start_regime_optimization') return okResult(tool, { job_id: 'job-5' });
      if (tool === 'backtest') {
        return okResult(tool, {
          params_used: { iLongThreshold: 200, trade_size_type_perc: true },
          metrics: { sharpe_ratio: 2.1, total_trades: 12 },
        });
      }
      return okResult(tool, {
        status: 'done',
        done: 100,
        total: 100,
        result: {
          best_params: { long_threshold: 200 },
          composite: { score: 2.05 },
        },
      });
    });
    await tracker.start({ ...REQUEST, kind: 'regime', regime: 'bull' });
    await tick();
    const snap = tracker.getSnapshot();
    expect(snap?.state).toBe('done');
    expect(snap?.result?.objectiveValue).toBe(2.05);
    expect(snap?.result?.paramsTradingview.iLongThreshold).toBe(200);
    const followUp = calls.find((c) => c.tool === 'backtest');
    expect(followUp?.args.params).toEqual({ long_threshold: 200 });
  });

  it('queues and consumes chat grounding from a completed job', async () => {
    let status: Record<string, unknown> = { status: 'queued', done: 0, total: 50 };
    const { tracker, tick } = build((tool) => {
      if (tool === 'start_optimization') return okResult(tool, { job_id: 'job-6' });
      return okResult(tool, status);
    });
    await tracker.start(REQUEST);
    expect(tracker.queueResultAsGrounding()).toBe(false);
    status = DONE_PAYLOAD;
    await tick();
    expect(tracker.queueResultAsGrounding()).toBe(true);
    const grounding = tracker.consumeGrounding();
    expect(grounding).toContain('NVDA 1d');
    expect(grounding).toContain('iLongThreshold');
    expect(tracker.consumeGrounding()).toBeNull();
  });

  it('refuses to start a second live job', async () => {
    const { tracker, calls } = build((tool) => {
      if (tool === 'start_optimization') return okResult(tool, { job_id: 'job-7' });
      return okResult(tool, { status: 'running', done: 1, total: 50 });
    });
    await tracker.start(REQUEST);
    await tracker.start(REQUEST);
    expect(calls.filter((c) => c.tool === 'start_optimization')).toHaveLength(1);
  });
});

describe('buildTradingviewTable', () => {
  it('renders booleans as On/Off and floats to 2 decimals', () => {
    const table = buildTradingviewTable({
      iLongThreshold: 431,
      iLookBackLengthSpeed: 1.556,
      trade_size_type_shares: false,
    });
    expect(table).toContain('| iLongThreshold | 431 |');
    expect(table).toContain('| iLookBackLengthSpeed | 1.56 |');
    expect(table).toContain('| trade_size_type_shares | Off |');
    expect(table).toContain('| Start/End Date (DATE RANGE) | set to the backtested window |');
  });
});
