/**
 * @file src/shared/optimizerTypes.ts
 *
 * Why it exists: single source of truth for the hosted-optimizer MCP
 * integration contracts (PRD_Optimizer_MCP_Integration D-M5/D-M6/D-M7/D-M8).
 * Mirrors the engine's job/tool surface: job states, snapshots, the
 * TradingView settings-card shape, and the tool-result summary types the
 * Gemini loop injects as grounding. Main owns every state machine; the
 * renderer switches on snapshot fields only — same discipline as
 * `updateTypes.ts`. No `any`.
 */

/**
 * Auth header for the hosted endpoint (D-M4). Sent ONLY by
 * `optimizerMcpService.ts` — the §5 grep contract allows the literal in
 * exactly that file and this one.
 */
export const OPTIMIZER_TEAM_KEY_HEADER = 'X-Arch-Team-Key';

/**
 * team-config.json schema v2 optional `optimizer` block (D-M8). Absent block
 * ⇒ the feature is fully hidden and behavior is bit-identical to v1. Field
 * names confirmed at PRD §11 Q4.
 */
export interface OptimizerTeamConfig {
  /** e.g. `https://optimize.archpublic.com/mcp` (streamable HTTP, D-M1). */
  mcpUrl: string;
  /** Shared team key. Stored via DPAPI/Keychain; never crosses IPC or logs. */
  teamKey: string;
}

/** Per-tool call timeout in the Gemini loop and panel plumbing (D-M7). */
export const OPTIMIZER_TOOL_TIMEOUT_MS = 15_000;
/** Max estimated tokens a summarized tool result may inject (D-M7). */
export const OPTIMIZER_TOOL_RESULT_MAX_TOKENS = 2_000;
/** Max tool round-trips per user turn (D-M7 — raise only with operator sign-off). */
export const OPTIMIZER_MAX_TOOL_ROUNDTRIPS = 2;
/**
 * Panel job poll cadence. Deliberately 2 s, not the web UI's 350 ms — that
 * cadence through Caddy from N testers is rude (§3.2 optimizerJobTracker).
 */
export const OPTIMIZER_JOB_POLL_INTERVAL_MS = 2_000;

/**
 * D-M6 hybrid split. Gemini sees only fast read-only tools; long jobs are
 * driven deterministically from the panel. Everything else on the server's
 * 11-tool surface is deliberately absent from BOTH lists (blocking and
 * heavy tools are never named in this repo — §5 grep contract).
 */
export const OPTIMIZER_GEMINI_TOOLS = [
  'list_capabilities',
  'backtest',
  'compare_timeframes',
  'detect_regimes',
] as const;

export const OPTIMIZER_PANEL_TOOLS = [
  'start_optimization',
  'get_optimization_status',
  'cancel_optimization',
  'start_regime_optimization',
] as const;

export type OptimizerGeminiTool = (typeof OPTIMIZER_GEMINI_TOOLS)[number];
export type OptimizerPanelTool = (typeof OPTIMIZER_PANEL_TOOLS)[number];

/** Renderer-visible feature status. The team key never crosses IPC. */
export interface OptimizerStatus {
  /** false ⇒ no `optimizer` config — feature hidden everywhere (D-M8). */
  configured: boolean;
  /** True after the last tool call round-tripped successfully. */
  connected: boolean;
  /** Endpoint URL for the settings display; null when unconfigured. */
  mcpUrl: string | null;
}

/**
 * Engine capability map subset the panel needs (from `list_capabilities` —
 * the ticker/timeframe/objective lists are server-truth, never hard-coded;
 * §6 risk table).
 */
export interface OptimizerCapabilities {
  tickers: readonly string[];
  timeframes: readonly string[];
  objectives: readonly string[];
  /** objective → human description, for the panel's objective picker. */
  objectiveDescriptions: Readonly<Record<string, string>>;
}

/** Result of `optimizer:listTools` — names only; schemas stay in main. */
export interface OptimizerToolsInfo {
  toolNames: readonly string[];
  capabilities: OptimizerCapabilities | null;
}

export type OptimizerJobKind = 'single' | 'regime';

/**
 * Engine job states (`queued|running|done|error|cancelled`) plus the
 * client-only terminal `expired`: the engine answered 404 for a job it no
 * longer knows, which happens when the droplet restarts mid-job (Non-Goal 5).
 */
export type OptimizerJobState =
  | 'queued'
  | 'running'
  | 'done'
  | 'error'
  | 'cancelled'
  | 'expired';

/** Terminal states — the tracker stops polling on any of these. */
export const OPTIMIZER_TERMINAL_STATES: readonly OptimizerJobState[] = [
  'done',
  'error',
  'cancelled',
  'expired',
];

/** What the panel submits over `optimizer:startOptimization`. */
export interface OptimizerJobRequest {
  kind: OptimizerJobKind;
  ticker: string;
  timeframe: string;
  objective: string;
  trials: number;
  /** Regime jobs only: `bull` | `bear` | `sideways` (server-validated). */
  regime?: string;
}

/**
 * The TradingView settings card rendered when a job completes. Field names
 * in `paramsTradingview` are exact PineScript input labels — the engine's
 * `to_tradingview_dict()` output, built for copy-paste into TV (§1).
 */
export interface OptimizerResultCard {
  ticker: string;
  timeframe: string;
  objective: string;
  /** Best objective value (e.g. Sharpe); null when the engine omits it. */
  objectiveValue: number | null;
  /** Markdown `| Parameter | Value |` table, clipboard-ready. */
  tradingviewTable: string;
  paramsTradingview: Readonly<Record<string, string | number | boolean>>;
  /** Headline metrics of the best run's full backtest. */
  metrics: Readonly<Record<string, number | string | null>>;
  /** Engine flag: the best parameter set produced zero trades. */
  zeroTrades: boolean;
}

/**
 * Snapshot pushed over `optimizer:jobStateChanged` and returned by
 * `optimizer:getJobState`. All payload fields nullable so the renderer never
 * discriminates further than `state` (updateTypes.ts precedent).
 */
export interface OptimizerJobSnapshot {
  jobId: string;
  kind: OptimizerJobKind;
  state: OptimizerJobState;
  request: OptimizerJobRequest;
  done: number;
  total: number;
  /** Best objective value so far, when the engine reports one. */
  best: number | null;
  queuePosition: number | null;
  /** Readable engine `detail` for `error`, or the expiry copy for `expired`. */
  error: string | null;
  result: OptimizerResultCard | null;
  /** ISO timestamp when the job was accepted. */
  startedAt: string;
}

/** Copy shown for the `expired` state (§3.2 — job lost to a redeploy). */
export const OPTIMIZER_JOB_EXPIRED_MESSAGE =
  'Unknown job — the server may have restarted. Start a new run.';

/**
 * D-M7: one summarized tool call. `resultSummary` is post-truncation
 * (≤ OPTIMIZER_TOOL_RESULT_MAX_TOKENS estimated) and is what the Gemini loop
 * appends to context; the chat chip renders `label`.
 */
export interface OptimizerToolCallSummary {
  tool: string;
  /** Compact human label for the attribution chip, e.g. `backtest: NVDA 1d`. */
  label: string;
  /** Summarized/truncated result text injected as grounding. */
  resultSummary: string;
  durationMs: number;
  ok: boolean;
}

/** Typed failure surface for optimizer tool calls (mirrors GeminiSendError). */
export type OptimizerToolError =
  | { ok: false; kind: 'not-configured' }
  | { ok: false; kind: 'unauthorized' }
  | { ok: false; kind: 'timeout'; tool: string; durationMs: number }
  | { ok: false; kind: 'connect-failed'; reason: string }
  | { ok: false; kind: 'engine'; detail: string }
  | { ok: false; kind: 'aborted' };

export type OptimizerToolResult =
  | { ok: true; tool: string; raw: unknown; summary: OptimizerToolCallSummary }
  | OptimizerToolError;
