/**
 * @file src/shared/types.ts
 *
 * Why it exists: Cross-process type module. Chunk 1 declared the narrow IPC
 * log payload. Chunk 2 adds widget state + permission types that span main,
 * preload, and renderer. Later chunks (Screenshot, Harness, Chat) continue to
 * add their own contracts here.
 */

// ---------------------------------------------------------------------------
// Logging (Chunk 1) — unchanged
// ---------------------------------------------------------------------------

/** Level names accepted by the `window.api.log.*` facade and the main logger. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Free-form JSON payload attached to a log record. Must be serializable. */
export type LogContext = Record<string, unknown>;

/**
 * Renderer → main IPC contract for log lines. Preload fan-outs to this exact
 * shape; main `registerRendererLogBridge` consumes it.
 */
export interface RendererLogMessage {
  level: LogLevel;
  event: string;
  context?: LogContext;
}

// ---------------------------------------------------------------------------
// Widget (Chunk 2)
// ---------------------------------------------------------------------------

/**
 * Visual + behavioral state of the overlay widget.
 *
 * - `ready`      — AI green pulse, widget actively listening for interaction
 * - `paused`     — static widget, manually paused by the user
 * - `permDenied` — amber widget, screen-recording permission missing
 * - `capturing`  — Chunk 3 600ms flash on capture (PRD §0 D11). Auto-resets
 *                  back to `'ready'` unless `'paused'` wins the race.
 * - `captureUnhealthy` — Chunk 7 — consecutive captures are landing
 *                  suspiciously small (black/blank frames). Distinct from
 *                  `permDenied` so the user gets a different remediation hint.
 *
 * Do not extend here without updating every consumer of the union
 * (widgetStore, Widget.tsx, contextMenu stubs).
 */
export type WidgetStatus = 'ready' | 'paused' | 'permDenied' | 'capturing' | 'captureUnhealthy';

/** Rectangular bounds used by the widget and by later capture code. */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Last-known widget origin in screen coordinates plus the display identifier
 * that was current when the position was saved. The displayId lets D6's
 * clamp logic decide whether to restore verbatim or re-center.
 */
export interface WidgetPosition {
  x: number;
  y: number;
  /**
   * Electron `Display.id` captured at save time. Used on restore to detect
   * whether the original monitor is still connected. `null` if the position
   * was seeded by the default (no monitor context yet).
   */
  displayId: number | null;
}

/**
 * macOS screen-recording permission states. Mirrors Electron's
 * `systemPreferences.getMediaAccessStatus('screen')` return values 1-for-1.
 */
export type PermissionState = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown';

/**
 * Persisted widget-namespaced state written via `electron-store`. Chunk 3 adds
 * `capture.*`, Chunk 5 adds `ai.*`; this chunk must not write outside
 * `widget.*`.
 */
export interface PersistedWidgetState {
  position: WidgetPosition;
  status: WidgetStatus;
  autoCapture: boolean;
  permissionsPromptSeen: boolean;
}

/**
 * Payload of the left-click IPC event emitted when the user clicks the
 * widget body (not the halo). Chunk 5 will subscribe; Chunk 2 only logs it.
 */
export interface WidgetClickPayload {
  at: { x: number; y: number };
  bounds: Bounds;
  ts: number;
}

// ---------------------------------------------------------------------------
// Capture (Chunk 3)
// ---------------------------------------------------------------------------

/**
 * One on-disk screenshot record. Held by reference in the in-memory ring
 * buffer (PRD §3.5 — capped at N=5) and surfaced over `window.api.capture.*`.
 *
 * `id` is a ULID so consumers can sort the buffer without reading
 * `timestamp`. `filepath` is guaranteed to exist on disk for at least
 * `M=30 minutes` after `timestamp` (PRD §0 D3 / §3.5 pruner contract); after
 * that the eviction sweeper may delete the file out from under the consumer.
 */
export interface Screenshot {
  /** Monotonically sortable ULID. */
  id: string;
  /** Capture *start* time, epoch ms. */
  timestamp: number;
  /** Absolute path inside the app temp/captures directory (PRD §0 D5). */
  filepath: string;
  /** Stable hash of the `CaptureRegion` that produced this frame. */
  regionId: string;
  /** Post-resize pixel width (PRD §0 D4 — longest edge ≤ 1024). */
  width: number;
  /** Post-resize pixel height. */
  height: number;
  /** File size on disk in bytes. */
  bytes: number;
}

/**
 * The persisted region the user drew via the picker (PRD §0 D6/D8). Stores
 * BOTH logical CSS-pixel coords (`x/y/w/h`) and resolved physical device-pixel
 * coords (`px/py/pw/ph`), plus `displayId` and `scaleFactor` at draw time.
 *
 * The dual storage is deliberate: logical coords are what the user drew (and
 * what the picker UI re-creates on "Re-draw"); physical coords are what
 * `desktopCapturer.getSources({ thumbnailSize })` and `sharp.extract()` need
 * for a pixel-accurate crop on Retina.
 */
export interface CaptureRegion {
  /** Stable hash of `(displayId + physical rect)`. */
  id: string;
  /** Electron `Display.id` captured at draw time. */
  displayId: number;
  /** `Display.scaleFactor` at draw time (1, 2, 3 in practice on macOS). */
  scaleFactor: number;
  // Logical CSS pixels — the rect the user actually drew.
  x: number;
  y: number;
  w: number;
  h: number;
  // Physical device pixels — what desktopCapturer needs for pixel-accurate crops.
  px: number;
  py: number;
  pw: number;
  ph: number;
  /** Epoch ms when the picker confirmed the rect. */
  createdAt: number;
  /**
   * Chunk 7 — snapshot of the display's label + bounds at draw time. Used by
   * `resolveDisplayForRegion` as a fallback match when `displayId` changes
   * (observed on some Windows multi-monitor reconnect sequences) but the
   * physical monitor is otherwise unchanged.
   */
  displayFingerprint?: DisplayFingerprint;
}

/**
 * Chunk 7 — identifying snapshot of a display at region-draw time, used to
 * re-associate a `CaptureRegion` with its monitor when the OS reassigns
 * `Display.id` (e.g. after a sleep/wake or docking-station replug).
 */
export interface DisplayFingerprint {
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
}

/**
 * Snapshot of the capture loop's runtime state. Mirrored to the renderer via
 * `window.api.capture.getLoopState()` and pushed on every transition via
 * `onLoopStateChanged`.
 */
export interface CaptureLoopState {
  running: boolean;
  /** User-set, clamped to `[CAPTURE_INTERVAL_MIN_MS, CAPTURE_INTERVAL_MAX_MS]`. */
  intervalMs: number;
  /** Epoch ms of the last successful capture, or `null` if never captured. */
  lastCaptureTs: number | null;
  /**
   * `true` iff the persisted `capture.region` exists AND its `displayId` is
   * still present in `screen.getAllDisplays()`. PRD §0 D9.
   */
  regionValid: boolean;
}

/**
 * Sentinel error class so callers (the loop, IPC handlers, and the future
 * Chunk 5 chat surface) can distinguish a permission revocation from any
 * other capture failure without parsing string messages. Per PRD §0 D12 the
 * loop transitions the widget to `'permDenied'` on this error type only.
 */
export class CapturePermissionError extends Error {
  override readonly name = 'CapturePermissionError';

  constructor(message = 'screen-recording permission revoked mid-capture') {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Chat / AI (Chunk 5 — PRD §3.2)
//
// All Chunk 5 contracts that cross process boundaries land here. The shape
// is locked by PRD §3.2 / §3.6 / §3.7 — adding fields to either the chat
// surface or the structured `AnalysisResponse` requires a PRD amendment.
// ---------------------------------------------------------------------------

/**
 * Conversation roles in `conversationStore`. `'system-summary'` is reserved
 * for the one-shot summary turn produced by the D12 truncation path; it is
 * sent to Gemini as an `assistant` turn but tagged separately for the
 * renderer so the UI can label it ("Earlier in this session…").
 */
export type ChatRole = 'user' | 'assistant' | 'system-summary';

/**
 * One row in the chat transcript. User turns carry the raw text the user
 * typed plus the screenshot ids attached at send time. Assistant turns
 * carry the markdown analysis (mirrored from `structured.analysis`) and
 * the parsed `AnalysisResponse` for renderer-side table rendering.
 *
 * `id` is a ULID so consumers can sort the array without parsing
 * `createdAt`. `latencyMs` and `modelUsed` are filled only on assistant
 * turns; `promptTokenEstimate` is filled on user turns for log correlation.
 */
export interface ChatTurn {
  id: string;
  role: ChatRole;
  text: string;
  attachedScreenshotIds: readonly string[];
  structured?: AnalysisResponse;
  createdAt: number;
  latencyMs?: number;
  modelUsed?: string;
  promptTokenEstimate?: number;
  /**
   * Compact labels of optimizer tool calls that grounded this turn, e.g.
   * `backtest: NVDA 1d` (PRD_Optimizer_MCP_Integration D-M6 — the chat
   * attribution chip, so a tester knows an answer is computed, not
   * recalled). Not part of the schema v3 output contract (Non-Goal 3).
   */
  toolAttributions?: readonly string[];
}

/**
 * One row in the structured `suggested_parameter_changes` array (schema v3).
 * `parameter` is the exact TradingView Inputs-tab label. `current_value` comes
 * from the client's screenshot or what the employee stated (null if unknown).
 * `doc_ref` is the documentation section path used for grounding.
 */
export interface SuggestedParameterChange {
  parameter: string;
  current_value: string | null;
  suggested_value: string;
  rationale: string;
  doc_ref: string;
}

/**
 * Locked structured-output schema v3 (PRD D-P6). Adds `talk_track` for
 * client-safe phrasing. Adding a field requires a PRD amendment and updates
 * to `aiSchema.spec.ts`.
 */
export interface AnalysisResponse {
  schema_version: '3';
  analysis: string;
  suggested_parameter_changes: readonly SuggestedParameterChange[];
  talk_track: string;
  confidence_score: number;
  risk_notes: string;
}

/**
 * Coarse FSM exposed to the chat renderer. The store transitions
 * `idle → sending → awaiting → idle` on the happy path; any error returns
 * to `'error'` and stays there until the user dismisses or retries.
 */
export type ChatState = 'idle' | 'sending' | 'awaiting' | 'error';

/**
 * Chat error union (PRD D25 + security-harness Phase 0 task 6). Each variant
 * maps to one `<ChatError>` component path.
 *
 * - `no-api-key`            — `ai.apiKey` is unset; Send is disabled.
 * - `no-harness`            — knowledge store empty; Send is disabled.
 * - `token-ceiling`         — pre-send budget exceeds the hard ceiling (D22).
 * - `transient`             — timeout / 5xx / network; carries a Retry button.
 * - `fatal`                 — 4xx / safety / parse-fail-after-retry; no retry.
 */
export type ChatError =
  | { variant: 'no-api-key' }
  | { variant: 'no-harness' }
  | { variant: 'token-ceiling'; approxTokens: number; ceiling: number }
  | { variant: 'transient'; reason: string; retryable: true }
  | { variant: 'fatal'; reason: string; detail?: Record<string, unknown> };

/**
 * Rolling 7-day stats surfaced in the AI Settings panel. Field set is
 * locked at D28 — Chunk 6 may add fields but must preserve these.
 */
export interface GeminiCallStats {
  windowDays: 7;
  callCount: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  jsonParseFailRate: number;
  lastCallTs: number | null;
}

/**
 * Result of `window.api.ai.getApiKey()`. The raw key NEVER crosses the IPC
 * boundary — only `present` and a four-of-the-last-four-chars `masked`
 * preview do. Settings UI displays the masked form; new values are sent
 * one-way via `setApiKey(raw)`.
 */
export interface ApiKeyPresence {
  present: boolean;
  masked: string;
}

/**
 * One row in the rolling 7-day stats ring persisted under
 * `electron-store` `ai.stats.calls`. Field set is intentionally tiny —
 * Chunk 6 owns the rich-log records that capture full prompt/response
 * detail. Anything we add here must land in the renderer settings panel
 * preview too, so keep additions deliberate.
 */
export interface RecordedCall {
  ts: number;
  latencyMs: number;
  promptTokenEstimate: number;
  jsonOk: boolean;
}
