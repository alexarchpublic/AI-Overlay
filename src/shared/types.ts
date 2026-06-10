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
 *
 * Do not extend here without updating every consumer of the union
 * (widgetStore, Widget.tsx, contextMenu stubs).
 */
export type WidgetStatus = 'ready' | 'paused' | 'permDenied' | 'capturing';

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
// Harness loader (Chunk 4 — PRD §3.2)
// ---------------------------------------------------------------------------

/**
 * Per-file metadata gathered during a load. Exposed to the renderer through
 * `HarnessMetadata.files` so the inspector can render a per-file view without
 * pulling the full bundle text.
 */
export interface HarnessFileMeta {
  /** POSIX-normalized path relative to the harness root. */
  relPath: string;
  /** UTF-8 byte count of the file's contents (post-read). */
  bytes: number;
  /** Character-based estimate per PRD §0 D7 — not Gemini-exact. */
  approxTokens: number;
  /** Per PRD §0 D15. */
  classification: 'algorithms' | 'docs' | 'other';
  /** `fs.Stats.mtimeMs` at load time. */
  modifiedAt: number;
}

/**
 * Lightweight projection of a `HarnessBundle` — never carries the full
 * concatenated text. The IPC surface uses this for `getMetadata()`, the
 * `harness:reloaded` push event, and the settings panel display.
 */
export interface HarnessMetadata {
  /** Resolved absolute path to the harness root. */
  rootPath: string;
  fileCount: number;
  /** Sum across files; ±15% tolerance band (PRD §0 D7). */
  approxTokens: number;
  /** Relative paths classified as algorithms (PRD §0 D15). */
  algorithms: readonly string[];
  /** Relative paths classified as docs (PRD §0 D15). */
  docs: readonly string[];
  /** Relative paths classified as other (PRD §0 D15). */
  other: readonly string[];
  /** Full per-file metadata, ordered per PRD §0 D4. */
  files: readonly HarnessFileMeta[];
  /** Epoch ms when the load completed. */
  loadedAt: number;
  /** Wall-clock duration of the load. */
  loadDurationMs: number;
  /**
   * Non-fatal advisories — empty harness, suspicious-file skips, oversize
   * file skips, manifest-missing-file warnings, etc. Settings surfaces these
   * as a yellow banner.
   */
  warnings: readonly string[];
  /** True iff `arch-public-harness/HARNESS_INDEX.json` was applied. */
  manifestUsed: boolean;
}

/**
 * The full harness bundle — text envelope + structured metadata. Only Chunk
 * 5's `geminiService.buildSystemPrompt()` (and the dev-only inspector) read
 * `text`. All other consumers go through `HarnessMetadata`.
 */
export interface HarnessBundle {
  /** D5/D6 envelope-wrapped concatenated text, ready to feed Gemini. */
  text: string;
  metadata: HarnessMetadata;
}

/**
 * Stable error code surface for load failures. The renderer (and Chunk 5
 * chat) discriminate on `code` to choose between the right banner copy and
 * the right recovery CTA.
 */
export type HarnessLoadErrorCode =
  | 'ROOT_NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'TOKEN_CEILING_EXCEEDED'
  | 'MANIFEST_INVALID'
  | 'IO_ERROR';

export interface HarnessLoadErrorPayload {
  code: HarnessLoadErrorCode;
  message: string;
  rootPath: string;
  /**
   * Optional structured detail. For `TOKEN_CEILING_EXCEEDED` this carries
   * `{ approxTokens, ceiling }`. For `MANIFEST_INVALID` it carries
   * `{ parserError }`. Everything is JSON-serializable.
   */
  detail?: Record<string, unknown>;
}

/**
 * Optional curation manifest (PRD §0 D14). Lives at
 * `arch-public-harness/HARNESS_INDEX.json`. All three arrays are optional;
 * an empty manifest is treated as "absent".
 *
 * - `include` — if set, ONLY these files (POSIX-relative globs) are loaded
 *   regardless of the default extension filter
 * - `exclude` — additional ignore patterns layered on top of D3 defaults
 * - `priority` — explicit ordering; files in `priority` come first (in the
 *   listed order), then everything else falls back to D4 alphabetical
 */
export interface HarnessManifest {
  include?: readonly string[];
  exclude?: readonly string[];
  priority?: readonly string[];
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
}

/** Direction for a forward-looking parameter suggestion (schema v2). */
export type SuggestionDirection = 'increase' | 'decrease' | 'set';

/**
 * One row in the structured `suggested_parameter_changes` array (schema v2).
 * `suggested_value` is a forward recommendation to TRY — never a readout of
 * a proprietary default. `chart_context` grounds the suggestion in what the
 * user sees on their chart or last tried.
 */
export interface SuggestedParameterChange {
  parameter: string;
  direction: SuggestionDirection;
  suggested_value: string;
  chart_context: string;
  rationale: string;
}

/**
 * Locked structured-output schema v2 (security-harness PRD §5.4). No file/path
 * fields; no proprietary `current` value. Adding a field requires a PRD
 * amendment and updates to `aiSchema.spec.ts`.
 */
export interface AnalysisResponse {
  schema_version: '2';
  analysis: string;
  suggested_parameter_changes: readonly SuggestedParameterChange[];
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
 * - `enumeration-throttled` — per-session probe/rate limit (PRD §6 D-13).
 */
export type ChatError =
  | { variant: 'no-api-key' }
  | { variant: 'no-harness' }
  | { variant: 'token-ceiling'; approxTokens: number; ceiling: number }
  | { variant: 'transient'; reason: string; retryable: true }
  | { variant: 'fatal'; reason: string; detail?: Record<string, unknown> }
  | { variant: 'enumeration-throttled'; cooldownMs: number; score: number };

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
export type FirewallAction = 'allow' | 'block' | 'rewrite';

export interface RecordedCall {
  ts: number;
  latencyMs: number;
  promptTokenEstimate: number;
  jsonOk: boolean;
  /** Deterministic gate outcome when set (PRD §7 — Phase 0 task 5). */
  firewallAction?: FirewallAction;
  /** Session enumeration score at call time (PRD §7 — Phase 0 task 6). */
  enumerationScore?: number;
}
