/**
 * @file src/main/optimizerJobTracker.ts
 *
 * Panel-side start/poll/cancel state machine for long optimizer jobs
 * (PRD_Optimizer_MCP_Integration D-M6 — the deterministic half of the hybrid
 * UX; long jobs never enter the Gemini loop). Polls job status every 2 s
 * while a job is live (deliberately not the web UI's 350 ms — that cadence
 * through Caddy from N testers is rude), pushes `optimizer:jobStateChanged`
 * snapshots, and maps an engine 404 to the client-terminal `expired` state:
 * the droplet's in-memory job table forgets jobs on redeploy and the overlay
 * must say so instead of spinning (Non-Goal 5).
 *
 * Injectable deps — no `electron` import at module scope.
 */

import type { AppLogger } from './logger';
import type { OptimizerMcpService } from './optimizerMcpService';
import {
  OPTIMIZER_JOB_EXPIRED_MESSAGE,
  OPTIMIZER_JOB_POLL_INTERVAL_MS,
  OPTIMIZER_TERMINAL_STATES,
  type OptimizerJobKind,
  type OptimizerJobRequest,
  type OptimizerJobSnapshot,
  type OptimizerJobState,
  type OptimizerResultCard,
} from '../shared/optimizerTypes';

export interface OptimizerJobTrackerDeps {
  logger: AppLogger;
  service: Pick<OptimizerMcpService, 'callTool'>;
  pollIntervalMs?: number;
  /** Injectable timers/clock so tests drive the poll loop synchronously. */
  schedule?: (fn: () => void, ms: number) => unknown;
  cancelScheduled?: (handle: unknown) => void;
  nowIso?: () => string;
}

export interface OptimizerJobTracker {
  /** Start a job; resolves with the first snapshot or null on failure. */
  start(request: OptimizerJobRequest): Promise<OptimizerJobSnapshot | null>;
  /** Cancel the active job. True if a cancel was submitted. */
  cancel(): Promise<boolean>;
  getSnapshot(): OptimizerJobSnapshot | null;
  /** Subscribe to snapshot changes; returns unsubscribe. */
  onSnapshotChanged(cb: (snapshot: OptimizerJobSnapshot) => void): () => void;
  /**
   * Panel "use in chat": queue the completed job's summary as grounding for
   * the next turn. True when a completed result was available.
   */
  queueResultAsGrounding(): boolean;
  /** One-shot read of queued grounding (consumed by the chat orchestrator). */
  consumeGrounding(): string | null;
  dispose(): void;
}

/** True when the engine no longer knows the job id (droplet restarted). */
function isUnknownJobDetail(detail: string): boolean {
  return /unknown job|404/i.test(detail);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
}

function numberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Render the clipboard markdown table from the TV-keyed params dict — the
 * same `| Parameter | Value |` presentation the engine's own formatter uses,
 * with exact PineScript input names as labels (§1: `to_tradingview_dict()`
 * and schema v3's `suggested_parameter_changes[]` were built for each other).
 */
export function buildTradingviewTable(
  params: Readonly<Record<string, string | number | boolean>>,
): string {
  const lines = ['| Parameter | Value |', '|-----------|-------|'];
  for (const [label, value] of Object.entries(params)) {
    let rendered: string;
    if (typeof value === 'boolean') rendered = value ? 'On' : 'Off';
    else if (typeof value === 'number' && !Number.isInteger(value)) rendered = value.toFixed(2);
    else rendered = String(value);
    lines.push(`| ${label} | ${rendered} |`);
  }
  lines.push('| Start/End Date (DATE RANGE) | set to the backtested window |');
  return lines.join('\n');
}

/** Pull TV params + metrics out of a full-backtest payload. */
function cardFromBacktest(
  request: OptimizerJobRequest,
  backtest: Record<string, unknown>,
  objectiveValue: number | null,
  zeroTrades: boolean,
): OptimizerResultCard | null {
  // params_tradingview carries the exact PineScript input labels (engine
  // to_tradingview_dict); params_used is the engine-keyed fallback for an
  // engine that predates the field.
  const paramsUsed =
    asRecord(backtest.params_tradingview) ?? asRecord(backtest.params_used);
  if (!paramsUsed) return null;
  const paramsTradingview: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(paramsUsed)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      paramsTradingview[k] = v;
    }
  }
  const metricsRaw = asRecord(backtest.metrics) ?? {};
  const metrics: Record<string, number | string | null> = {};
  for (const [k, v] of Object.entries(metricsRaw)) {
    if (typeof v === 'number' || typeof v === 'string' || v === null) metrics[k] = v;
  }
  return {
    ticker: request.ticker,
    timeframe: request.timeframe,
    objective: request.objective,
    objectiveValue,
    tradingviewTable: buildTradingviewTable(paramsTradingview),
    paramsTradingview,
    metrics,
    zeroTrades,
  };
}

const START_TOOL: Record<OptimizerJobKind, string> = {
  single: 'start_optimization',
  regime: 'start_regime_optimization',
};

export function createOptimizerJobTracker(deps: OptimizerJobTrackerDeps): OptimizerJobTracker {
  const log = deps.logger;
  const pollIntervalMs = deps.pollIntervalMs ?? OPTIMIZER_JOB_POLL_INTERVAL_MS;
  const schedule = deps.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const cancelScheduled =
    deps.cancelScheduled ??
    ((h: unknown) => {
      clearTimeout(h as NodeJS.Timeout);
    });
  const nowIso = deps.nowIso ?? (() => new Date().toISOString());

  let snapshot: OptimizerJobSnapshot | null = null;
  let pollHandle: unknown = null;
  let polling = false;
  let disposed = false;
  let pendingGrounding: string | null = null;
  const listeners = new Set<(s: OptimizerJobSnapshot) => void>();

  function emit(next: OptimizerJobSnapshot): void {
    snapshot = next;
    for (const cb of listeners) cb(next);
  }

  function stopPolling(): void {
    if (pollHandle !== null) {
      cancelScheduled(pollHandle);
      pollHandle = null;
    }
    polling = false;
  }

  function scheduleNextPoll(): void {
    if (disposed || !polling) return;
    pollHandle = schedule(() => {
      void pollOnce();
    }, pollIntervalMs);
  }

  function finish(state: OptimizerJobState, error: string | null, result: OptimizerResultCard | null): void {
    if (!snapshot) return;
    stopPolling();
    emit({ ...snapshot, state, error, result, queuePosition: null });
    const evt = state === 'done' ? 'optimizer.job.done'
      : state === 'expired' ? 'optimizer.job.expired'
      : state === 'cancelled' ? 'optimizer.job.cancelled'
      : 'optimizer.job.error';
    log.info(evt, {
      jobId: snapshot.jobId,
      kind: snapshot.kind,
      ticker: snapshot.request.ticker,
      timeframe: snapshot.request.timeframe,
    });
  }

  async function buildCard(payload: Record<string, unknown>): Promise<OptimizerResultCard | null> {
    if (!snapshot) return null;
    const request = snapshot.request;
    const result = asRecord(payload.result);
    if (!result) return null;

    // Both job kinds report the winning params ENGINE-keyed (verified live:
    // the optimize result's embedded backtest uses engine field names). Only
    // /api/backtest emits `to_tradingview_dict()` labels, so the card is
    // always built from one fast follow-up backtest with the best params —
    // reusing the engine's own conversion, never reimplementing it (§3.5).
    let engineParams: Record<string, unknown> | null = null;
    let objectiveValue: number | null = null;
    let knownZeroTrades = false;
    if (request.kind === 'single') {
      const best = asRecord(result.best);
      engineParams = best ? asRecord(best.params) : null;
      objectiveValue = best ? numberOrNull(best.value) : null;
      knownZeroTrades = best?.zero_trades === true;
    } else {
      engineParams = asRecord(result.best_params);
      const composite = asRecord(result.composite);
      objectiveValue = composite ? numberOrNull(composite.score) : null;
    }
    if (!engineParams) return null;

    const followUp = await deps.service.callTool('backtest', {
      ticker: request.ticker,
      timeframe: request.timeframe,
      params: engineParams,
    });
    if (!followUp.ok) {
      log.warn('optimizer.job.cardBacktestFailed', {
        jobId: snapshot.jobId,
        kind: followUp.kind,
      });
      return null;
    }
    const backtest = asRecord(followUp.raw);
    if (!backtest) return null;
    const metrics = asRecord(backtest.metrics);
    const totalTrades = metrics ? numberOrNull(metrics.total_trades) : null;
    return cardFromBacktest(
      request,
      backtest,
      objectiveValue,
      knownZeroTrades || totalTrades === 0,
    );
  }

  async function pollOnce(): Promise<void> {
    if (disposed || !snapshot || !polling) return;
    const jobId = snapshot.jobId;
    const result = await deps.service.callTool('get_optimization_status', { job_id: jobId });

    // A new job may have started — or cancel/dispose stopped polling —
    // while the poll round-trip was in flight (reads via a function call so
    // the linter doesn't narrow the mutable closure state across the await).
    const stillCurrent = (): boolean => polling && snapshot?.jobId === jobId;
    if (!stillCurrent()) return;

    if (!result.ok) {
      if (result.kind === 'engine' && isUnknownJobDetail(result.detail)) {
        finish('expired', OPTIMIZER_JOB_EXPIRED_MESSAGE, null);
        return;
      }
      // Transient failure (timeout / reconnect) — keep polling; the job is
      // still running server-side.
      log.warn('optimizer.job.pollFailed', { jobId, kind: result.kind });
      scheduleNextPoll();
      return;
    }

    const payload = asRecord(result.raw) ?? {};
    const status = typeof payload.status === 'string' ? payload.status : 'running';
    log.debug('optimizer.job.poll', { jobId, status, done: payload.done, total: payload.total });

    if (status === 'done') {
      const card = await buildCard(payload);
      finish('done', null, card);
      return;
    }
    if (status === 'error') {
      const detail = typeof payload.error === 'string' ? payload.error : 'optimization failed';
      finish('error', detail, null);
      return;
    }
    if (status === 'cancelled') {
      finish('cancelled', null, null);
      return;
    }

    emit({
      ...snapshot,
      state: status === 'queued' ? 'queued' : 'running',
      done: numberOrNull(payload.done) ?? snapshot.done,
      total: numberOrNull(payload.total) ?? snapshot.total,
      best: numberOrNull(payload.best) ?? snapshot.best,
      queuePosition: numberOrNull(payload.queue_position),
    });
    scheduleNextPoll();
  }

  return {
    async start(request) {
      if (snapshot && !OPTIMIZER_TERMINAL_STATES.includes(snapshot.state)) {
        // One job at a time — the panel disables Start while one is live.
        return snapshot;
      }
      const args: Record<string, unknown> = {
        ticker: request.ticker,
        timeframe: request.timeframe,
        objective: request.objective,
      };
      if (request.kind === 'regime') {
        args.regime = request.regime;
        args.n_trials = request.trials;
      } else {
        args.trials = request.trials;
      }
      const result = await deps.service.callTool(START_TOOL[request.kind], args);
      if (!result.ok) {
        log.warn('optimizer.job.startFailed', { kind: result.kind });
        return null;
      }
      const payload = asRecord(result.raw) ?? {};
      const jobId = typeof payload.job_id === 'string' ? payload.job_id : null;
      if (!jobId) {
        log.warn('optimizer.job.startFailed', { kind: 'engine', reason: 'no job_id' });
        return null;
      }
      log.info('optimizer.job.start', {
        jobId,
        kind: request.kind,
        ticker: request.ticker,
        timeframe: request.timeframe,
        objective: request.objective,
        trials: request.trials,
      });
      emit({
        jobId,
        kind: request.kind,
        state: 'queued',
        request,
        done: 0,
        total: numberOrNull(payload.total) ?? request.trials,
        best: null,
        queuePosition: numberOrNull(payload.queue_position),
        error: null,
        result: null,
        startedAt: nowIso(),
      });
      polling = true;
      scheduleNextPoll();
      return snapshot;
    },

    async cancel() {
      if (!snapshot || OPTIMIZER_TERMINAL_STATES.includes(snapshot.state)) return false;
      const result = await deps.service.callTool('cancel_optimization', {
        job_id: snapshot.jobId,
      });
      if (!result.ok) {
        log.warn('optimizer.job.cancelFailed', { jobId: snapshot.jobId, kind: result.kind });
        return false;
      }
      finish('cancelled', null, null);
      return true;
    },

    getSnapshot() {
      return snapshot;
    },

    onSnapshotChanged(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },

    queueResultAsGrounding() {
      const card = snapshot?.result;
      if (!snapshot || !card) return false;
      const metricsLine = Object.entries(card.metrics)
        .filter(([, v]) => v !== null)
        .slice(0, 8)
        .map(([k, v]) => `${k}=${typeof v === 'number' ? v.toFixed(3) : String(v)}`)
        .join(', ');
      pendingGrounding = [
        `Completed optimizer run (${snapshot.kind === 'regime' ? `regime: ${snapshot.request.regime ?? ''}` : 'single window'})`,
        `${card.ticker} ${card.timeframe}, objective ${card.objective}` +
          (card.objectiveValue !== null ? ` = ${card.objectiveValue.toFixed(4)}` : ''),
        `Metrics: ${metricsLine}`,
        `Optimized TradingView settings:`,
        card.tradingviewTable,
        card.zeroTrades ? 'WARNING: best parameter set produced zero trades.' : '',
      ].filter((l) => l.length > 0).join('\n');
      return true;
    },

    consumeGrounding() {
      const g = pendingGrounding;
      pendingGrounding = null;
      return g;
    },

    dispose() {
      disposed = true;
      stopPolling();
      listeners.clear();
    },
  };
}
