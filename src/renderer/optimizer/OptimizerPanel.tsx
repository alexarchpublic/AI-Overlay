/**
 * @file src/renderer/optimizer/OptimizerPanel.tsx
 *
 * The Optimizer panel (PRD_Optimizer_MCP_Integration D-M6 — the
 * deterministic half of the hybrid UX). Reachable from the settings surface:
 * pick ticker/timeframe/objective/trials (all server-derived via
 * `list_capabilities`, never hard-coded), start a single-window or regime
 * optimization, watch progress, cancel, and on completion copy the
 * TradingView settings card or inject the result into chat as grounding.
 * Hidden-but-hinted when no `optimizer` config is provisioned (D-M8).
 */

import { useEffect, useState, type ReactElement } from 'react';
import { useOptimizerStore } from './optimizerStore';
import type {
  OptimizerJobRequest,
  OptimizerJobSnapshot,
} from '../../shared/optimizerTypes';

const REGIMES = ['bull', 'bear', 'sideways'] as const;
const TRIALS_CHOICES = [50, 100, 150, 300] as const;

function stateBadge(snapshot: OptimizerJobSnapshot): ReactElement {
  const klass =
    snapshot.state === 'done'
      ? 'bg-emerald-500/20 text-emerald-200'
      : snapshot.state === 'error' || snapshot.state === 'expired'
        ? 'bg-red-500/20 text-red-200'
        : snapshot.state === 'cancelled'
          ? 'bg-white/10 text-white/60'
          : 'bg-ap-gold/20 text-ap-gold';
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${klass}`} data-testid="job-state">
      {snapshot.state}
    </span>
  );
}

function ProgressRow(props: { snapshot: OptimizerJobSnapshot }): ReactElement {
  const { snapshot } = props;
  const pct = snapshot.total > 0 ? Math.round((snapshot.done / snapshot.total) * 100) : 0;
  return (
    <div className="mt-3" data-testid="job-progress">
      <div className="flex items-center justify-between text-[11px] text-white/70">
        <span>
          {snapshot.done}/{snapshot.total} trials
          {snapshot.best !== null && (
            <span className="ml-2 font-mono text-ap-fg">best {snapshot.best.toFixed(4)}</span>
          )}
        </span>
        <span>
          {snapshot.state === 'queued' && snapshot.queuePosition !== null
            ? `#${String(snapshot.queuePosition)} in line`
            : `${String(pct)}%`}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded bg-black/30">
        <div
          className="h-full rounded bg-ap-green transition-all"
          style={{ width: `${String(pct)}%` }}
        />
      </div>
    </div>
  );
}

function ResultCard(props: { snapshot: OptimizerJobSnapshot }): ReactElement | null {
  const card = props.snapshot.result;
  const copied = useOptimizerStore((s) => s.copied);
  const queuedForChat = useOptimizerStore((s) => s.queuedForChat);
  const setCopied = useOptimizerStore((s) => s.setCopied);
  const setQueuedForChat = useOptimizerStore((s) => s.setQueuedForChat);
  if (!card) return null;

  const headline = Object.entries(card.metrics)
    .filter(([k]) => ['total_return_pct', 'sharpe_ratio', 'max_drawdown_pct', 'win_rate', 'total_trades'].includes(k))
    .slice(0, 5);

  return (
    <div className="mt-3 rounded border border-white/10 bg-black/20 p-3" data-testid="result-card">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-white/60">
          TradingView settings — {card.ticker} {card.timeframe}
        </span>
        {card.objectiveValue !== null && (
          <span className="font-mono text-[11px] text-ap-green">
            {card.objective} = {card.objectiveValue.toFixed(4)}
          </span>
        )}
      </div>
      {card.zeroTrades && (
        <p className="mb-2 rounded bg-amber-500/20 px-2 py-1 text-[11px] text-amber-200">
          Best parameter set produced zero trades — treat with suspicion.
        </p>
      )}
      <div className="max-h-40 overflow-y-auto rounded bg-black/30 p-2">
        <table className="w-full text-[11px]">
          <tbody>
            {Object.entries(card.paramsTradingview).map(([label, value]) => (
              <tr key={label} className="border-b border-white/5 last:border-0">
                <td className="py-0.5 pr-2 text-white/70">{label}</td>
                <td className="py-0.5 text-right font-mono text-ap-fg">
                  {typeof value === 'boolean' ? (value ? 'On' : 'Off') : String(value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {headline.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-white/60">
          {headline.map(([k, v]) => (
            <span key={k} className="rounded bg-white/5 px-1.5 py-0.5">
              {k}: <span className="font-mono text-ap-fg">{typeof v === 'number' ? v.toFixed(2) : String(v)}</span>
            </span>
          ))}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="rounded bg-ap-green-action px-3 py-1 text-[11px] font-medium text-white hover:brightness-110"
          onClick={() => {
            void window.api.optimizer.copySettingsCard().then((ok) => {
              setCopied(ok);
            });
          }}
        >
          {copied ? 'Copied ✓' : 'Copy settings card'}
        </button>
        <button
          type="button"
          className="rounded border border-white/20 bg-ap-muted px-3 py-1 text-[11px] text-ap-fg hover:border-ap-gold/60"
          onClick={() => {
            void window.api.optimizer.useInChat().then((ok) => {
              setQueuedForChat(ok);
            });
          }}
        >
          {queuedForChat ? 'Queued for next chat turn ✓' : 'Use in chat'}
        </button>
      </div>
    </div>
  );
}

export default function OptimizerPanel(): ReactElement {
  const status = useOptimizerStore((s) => s.status);
  const toolsInfo = useOptimizerStore((s) => s.toolsInfo);
  const snapshot = useOptimizerStore((s) => s.snapshot);
  const starting = useOptimizerStore((s) => s.starting);
  const setStatus = useOptimizerStore((s) => s.setStatus);
  const setToolsInfo = useOptimizerStore((s) => s.setToolsInfo);
  const setSnapshot = useOptimizerStore((s) => s.setSnapshot);
  const setStarting = useOptimizerStore((s) => s.setStarting);

  const [ticker, setTicker] = useState('');
  const [timeframe, setTimeframe] = useState('1d');
  const [objective, setObjective] = useState('max_sharpe');
  const [trials, setTrials] = useState<number>(150);
  const [mode, setMode] = useState<'single' | 'regime'>('single');
  const [regime, setRegime] = useState<(typeof REGIMES)[number]>('bull');

  useEffect(() => {
    let cancelled = false;
    void window.api.optimizer.getStatus().then((s) => {
      if (!cancelled) setStatus(s);
      if (s.configured) {
        void window.api.optimizer.listTools().then((info) => {
          if (!cancelled) setToolsInfo(info);
        });
        void window.api.optimizer.getJobState().then((snap) => {
          if (!cancelled && snap) setSnapshot(snap);
        });
      }
    });
    const off = window.api.optimizer.onJobStateChanged((snap) => {
      setSnapshot(snap);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [setSnapshot, setStatus, setToolsInfo]);

  const caps = toolsInfo?.capabilities ?? null;
  const jobLive =
    snapshot !== null && !['done', 'error', 'cancelled', 'expired'].includes(snapshot.state);
  const effectiveTicker = ticker !== '' ? ticker : (caps?.tickers[0] ?? '');
  const startDisabled = !caps || jobLive || starting || effectiveTicker === '';

  const start = (): void => {
    if (startDisabled) return;
    const request: OptimizerJobRequest = {
      kind: mode,
      ticker: effectiveTicker,
      timeframe,
      objective,
      trials,
      ...(mode === 'regime' ? { regime } : {}),
    };
    setStarting(true);
    window.api.log.info('optimizer.panel.start', {
      ticker: request.ticker, timeframe, objective, trials, kind: mode,
    });
    void window.api.optimizer.startOptimization(request).then((snap) => {
      if (snap) setSnapshot(snap);
      else setStarting(false);
    });
  };

  if (!status) return <section data-testid="optimizer-panel-loading" />;

  if (!status.configured) {
    // D-M8: absent config ⇒ hidden feature. A short provisioning hint is the
    // only trace, so a tester whose update landed before their config sees
    // essentially the app they had yesterday.
    return (
      <section className="rounded-md border border-white/10 bg-ap-bg p-5" data-testid="optimizer-panel">
        <header className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ap-fg">Optimizer</h2>
          <span className="rounded bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/70">
            not provisioned
          </span>
        </header>
        <p className="text-xs text-white/50">
          Backtesting and optimization light up when your team config includes
          optimizer access. Ask your administrator for an updated
          team-config.json.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-md border border-white/10 bg-ap-bg p-5" data-testid="optimizer-panel">
      <header className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-ap-fg">Optimizer</h2>
        <span
          className={`rounded px-2 py-0.5 text-[11px] font-medium ${
            status.connected ? 'bg-emerald-500/20 text-emerald-200' : 'bg-white/10 text-white/70'
          }`}
        >
          {status.connected ? 'connected' : 'ready'}
        </span>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-white/60">
          Ticker
          <select
            className="rounded border border-white/15 bg-ap-muted px-1.5 py-1 font-mono text-[12px] normal-case text-ap-fg"
            value={effectiveTicker}
            disabled={!caps || jobLive}
            onChange={(e) => {
              setTicker(e.target.value);
            }}
          >
            {(caps?.tickers ?? []).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-white/60">
          Timeframe
          <select
            className="rounded border border-white/15 bg-ap-muted px-1.5 py-1 font-mono text-[12px] normal-case text-ap-fg"
            value={timeframe}
            disabled={!caps || jobLive}
            onChange={(e) => {
              setTimeframe(e.target.value);
            }}
          >
            {(caps?.timeframes ?? []).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-white/60">
          Objective
          <select
            className="rounded border border-white/15 bg-ap-muted px-1.5 py-1 font-mono text-[12px] normal-case text-ap-fg"
            value={objective}
            disabled={!caps || jobLive}
            onChange={(e) => {
              setObjective(e.target.value);
            }}
            title={caps?.objectiveDescriptions[objective] ?? ''}
          >
            {(caps?.objectives ?? []).map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-white/60">
          Trials
          <select
            className="rounded border border-white/15 bg-ap-muted px-1.5 py-1 font-mono text-[12px] normal-case text-ap-fg"
            value={trials}
            disabled={jobLive}
            onChange={(e) => {
              setTrials(Number(e.target.value));
            }}
          >
            {TRIALS_CHOICES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-[11px] text-white/70">
          <input
            type="radio"
            checked={mode === 'single'}
            disabled={jobLive}
            onChange={() => {
              setMode('single');
            }}
          />
          Single window
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-white/70">
          <input
            type="radio"
            checked={mode === 'regime'}
            disabled={jobLive}
            onChange={() => {
              setMode('regime');
            }}
          />
          Regime
        </label>
        {mode === 'regime' && (
          <select
            className="rounded border border-white/15 bg-ap-muted px-1.5 py-0.5 font-mono text-[11px] text-ap-fg"
            value={regime}
            disabled={jobLive}
            onChange={(e) => {
              setRegime(e.target.value as (typeof REGIMES)[number]);
            }}
          >
            {REGIMES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        )}
        <div className="ml-auto flex gap-2">
          {jobLive ? (
            <button
              type="button"
              className="rounded border border-white/20 bg-ap-muted px-3 py-1 text-[11px] text-ap-fg hover:border-red-400/60"
              onClick={() => {
                void window.api.optimizer.cancelJob();
              }}
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              className="rounded bg-ap-green-action px-3 py-1 text-[11px] font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={startDisabled}
              onClick={start}
            >
              {starting ? 'Starting…' : 'Start optimization'}
            </button>
          )}
        </div>
      </div>

      {snapshot && (
        <div className="mt-3 rounded border border-white/10 bg-black/20 p-3">
          <div className="flex items-center justify-between text-[11px] text-white/70">
            <span className="font-mono">
              {snapshot.request.ticker} {snapshot.request.timeframe} · {snapshot.request.objective}
              {snapshot.kind === 'regime' && ` · ${snapshot.request.regime ?? ''}`}
            </span>
            {stateBadge(snapshot)}
          </div>
          {(snapshot.state === 'queued' || snapshot.state === 'running') && (
            <ProgressRow snapshot={snapshot} />
          )}
          {(snapshot.state === 'error' || snapshot.state === 'expired') && snapshot.error && (
            <p className="mt-2 text-[11px] text-red-300" data-testid="job-error">{snapshot.error}</p>
          )}
          {snapshot.state === 'done' && <ResultCard snapshot={snapshot} />}
        </div>
      )}
    </section>
  );
}
