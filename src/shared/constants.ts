/**
 * @file src/shared/constants.ts
 *
 * Why it exists: Single source of truth for app-wide constants. Per the
 * Context.md §8 "no magic numbers" rule, every timing, size, path, or format
 * string referenced across processes lands here. Later chunks add their own
 * constants (capture interval, Gemini model ID, etc.) — keep the file flat and
 * grouped by concern.
 */

/** User-visible product name. Also used as the `base.app` field in pino logs. */
export const APP_NAME = 'Arch Public AI Overlay';

/**
 * App version lives in `package.json` only (Chunk 7 §3.9 / D11).
 * Main reads it via `app.getVersion()`; the renderer gets it over IPC
 * (`window.api.app.getVersion`). Do not reintroduce a hardcoded `APP_VERSION`.
 */

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

/** Directory name under the user data dir where pino JSONL files land. */
export const LOG_DIR_NAME = 'logs';

/**
 * Daily log filename template. `YYYY`, `MM`, `DD` are replaced at runtime in
 * `logger.formatLogFilename`. JSONL format — one record per line.
 */
export const LOG_FILENAME_FORMAT = 'app-YYYY-MM-DD.jsonl';

/** Placeholder that replaces any field matched by the logger redact paths. */
export const REDACT_PLACEHOLDER = '[REDACTED]';

// ---------------------------------------------------------------------------
// Renderer / dev server
// ---------------------------------------------------------------------------

/** Port the Vite dev server is pinned to (vite.config.ts mirrors this). */
export const VITE_DEV_SERVER_PORT = 5173;

// ---------------------------------------------------------------------------
// Overlay widget (Chunk 2 — PRD §0 D1/D5/D6)
// ---------------------------------------------------------------------------

/** Diameter of the visible circular pill in CSS pixels (PRD D1). */
export const WIDGET_BODY_SIZE = 48;

/** Transparent click-through halo inset around the pill (PRD D5). */
export const WIDGET_HALO_SIZE = 4;

/** Total BrowserWindow size = body + halo on each side. */
export const WIDGET_WINDOW_SIZE = WIDGET_BODY_SIZE + WIDGET_HALO_SIZE * 2;

/** Offset from the primary display's top-right corner used for the default position (PRD D6). */
export const WIDGET_DEFAULT_INSET = 72;

/** "AI Ready" pulse period, milliseconds (PRD D9). */
export const WIDGET_PULSE_DURATION_MS = 2000;

/**
 * Pointer movement below this threshold (px) on the pill body counts as a
 * click; above it we move the BrowserWindow via IPC. The 4px halo still
 * uses native `-webkit-app-region: drag` when the cursor is over it.
 */
export const WIDGET_DRAG_THRESHOLD_PX = 5;

// ---------------------------------------------------------------------------
// Settings window (Chunk 2 — PRD D8)
// ---------------------------------------------------------------------------

export const SETTINGS_WINDOW_WIDTH = 640;
export const SETTINGS_WINDOW_HEIGHT = 480;

// ---------------------------------------------------------------------------
// Permissions (Chunk 2 — PRD §3.3 / §7)
// ---------------------------------------------------------------------------

/** macOS deep-link into System Settings → Privacy & Security → Screen Recording. */
export const MACOS_SCREEN_RECORDING_PREF_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';

/** Max ms to wait for the OS to settle into `granted`/`denied` after triggering the prompt. */
export const PERMISSION_POLL_TIMEOUT_MS = 10_000;

/** Poll interval while waiting for the OS permission state to settle. */
export const PERMISSION_POLL_INTERVAL_MS = 250;

// ---------------------------------------------------------------------------
// Capture engine (Chunk 3 — PRD §0 D1–D5 / D11 / D14 / D15)
// ---------------------------------------------------------------------------

/** Default capture cadence; user-tunable via slider (PRD D1). */
export const CAPTURE_DEFAULT_INTERVAL_MS = 15_000;
/** Slider minimum — PRD D1. Anything tighter risks pile-up. */
export const CAPTURE_INTERVAL_MIN_MS = 5_000;
/** Slider maximum — PRD D1. */
export const CAPTURE_INTERVAL_MAX_MS = 60_000;

/** Hard cap on the in-memory ring buffer (PRD D2). */
export const CAPTURE_RING_BUFFER_SIZE = 5;

/** Disk pruner window — files older than this are deleted (PRD D3). */
export const CAPTURE_DISK_TTL_MS = 30 * 60_000;
/** Disk pruner tick interval (PRD §3.5). */
export const CAPTURE_PRUNE_INTERVAL_MS = 60_000;

/** Image format params (PRD D4). */
export const CAPTURE_JPEG_QUALITY = 85;
/** Resize so the longest edge equals this many pixels (PRD D4). */
export const CAPTURE_MAX_EDGE_PX = 1024;

/** Subdirectory under `app.getPath('temp')` where captures land (PRD D5). */
export const CAPTURE_TEMP_SUBDIR = 'arch-public-ai-overlay/captures';

/** PRD D11 — duration of the `'capturing'` widget flash on each capture. */
export const CAPTURE_FLASH_MS = 600;

/** PRD D15 — minimum gap between *manual* `captureNow()` invocations. */
export const CAPTURE_MANUAL_DEBOUNCE_MS = 500;

/** Chunk 7 — consecutive suspiciously-small captures before flipping to `'captureUnhealthy'`. */
export const CAPTURE_UNHEALTHY_THRESHOLD = 3;
/** Chunk 7 — a capture below this byte count is treated as a black/blank frame. */
export const CAPTURE_UNHEALTHY_MIN_BYTES = 1500;

/** Slider IPC debounce so a drag from 60s → 5s doesn't spam main. */
export const CAPTURE_INTERVAL_SLIDER_DEBOUNCE_MS = 150;

/**
 * Hidden settings-store flag that forces the dev-only Recent Captures panel
 * on in production builds (PRD D13). Read from `capture.dev.showRecentCaptures`.
 */
export const CAPTURE_DEV_SHOW_RECENT_FLAG = 'capture.dev.showRecentCaptures';
