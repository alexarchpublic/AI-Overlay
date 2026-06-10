/**
 * @file src/preload/index.ts
 *
 * Why it exists: Narrow, auditable IPC surface. Chunk 1 locked
 * `window.api.log.{debug,info,warn,error}`. Chunk 2 added:
 *
 *   window.api.widget.* — overlay widget state + interaction
 *   window.api.perms.*  — macOS screen-recording permission flow
 *
 * Chunk 3 adds, per PRD §3.2:
 *
 *   window.api.capture.* — screenshot loop control + ring-buffer reads
 *   window.api.region.*  — region picker open/get/clear
 *
 * Two `region.*` channels (`_pickerConfirm` / `_pickerCancel`) are present
 * on this surface but underscored to flag them as picker-internal: they are
 * called only by the picker window's React tree, never by the overlay or
 * settings windows. The leading underscore is the convention; main does not
 * differentiate.
 *
 * All channel strings come from `shared/ipcChannels.ts`. No string literals
 * live here.
 */

import { contextBridge, ipcRenderer } from 'electron';
import type {
  ApiKeyPresence,
  Bounds,
  CaptureLoopState,
  CaptureRegion,
  ChatError,
  ChatState,
  ChatTurn,
  GeminiCallStats,
  HarnessLoadErrorPayload,
  HarnessMetadata,
  LogContext,
  LogLevel,
  PermissionState,
  RendererLogMessage,
  Screenshot,
  SuggestedParameterChange,
  WidgetPosition,
  WidgetStatus,
} from '../shared/types';
import {
  IPC_AI_CLEAR_API_KEY,
  IPC_AI_GET_API_KEY,
  IPC_AI_GET_MODEL,
  IPC_AI_GET_STATS,
  IPC_AI_LIST_MODELS,
  IPC_AI_SET_API_KEY,
  IPC_AI_SET_MODEL,
  IPC_CAPTURE_CAPTURED,
  IPC_CAPTURE_GET_LOOP_STATE,
  IPC_CAPTURE_GET_RECENT,
  IPC_CAPTURE_GET_THUMBNAIL,
  IPC_CAPTURE_LOOP_STATE_CHANGED,
  IPC_CAPTURE_NOW,
  IPC_CAPTURE_SET_INTERVAL_MS,
  IPC_CAPTURE_START,
  IPC_CAPTURE_STOP,
  IPC_CHAT_CANCEL,
  IPC_CHAT_CLOSE,
  IPC_CHAT_COPY_SUGGESTION,
  IPC_CHAT_ERROR,
  IPC_CHAT_GET_HISTORY,
  IPC_CHAT_GET_KNOWLEDGE_READY,
  IPC_CHAT_HISTORY_CLEARED,
  IPC_CHAT_IS_OPEN,
  IPC_CHAT_OPEN,
  IPC_CHAT_OPEN_SETTINGS,
  IPC_CHAT_SEND,
  IPC_CHAT_STATE_CHANGED,
  IPC_CHAT_TURN_APPENDED,
  IPC_HARNESS_BROWSE_ROOT,
  IPC_HARNESS_GET_BUNDLE_TEXT,
  IPC_HARNESS_GET_METADATA,
  IPC_HARNESS_GET_ROOT_PATH,
  IPC_HARNESS_LOAD_ERROR,
  IPC_HARNESS_RELOAD,
  IPC_HARNESS_RELOADED,
  IPC_HARNESS_SET_ROOT_PATH,
  IPC_LOG_MESSAGE,
  IPC_PERMS_GET_SCREEN,
  IPC_PERMS_OPEN_SYSTEM_SETTINGS,
  IPC_PERMS_REQUEST_SCREEN,
  IPC_REGION_CLEAR,
  IPC_REGION_GET,
  IPC_REGION_OPEN_PICKER,
  IPC_REGION_PICKER_CANCEL,
  IPC_REGION_PICKER_CONFIRM,
  IPC_WIDGET_EMIT_CLICK,
  IPC_WIDGET_GET_STATUS,
  IPC_WIDGET_OPEN_CONTEXT_MENU,
  IPC_WIDGET_REPORT_POSITION,
  IPC_WIDGET_MOVE_BY,
  IPC_WIDGET_SET_INTERACTIVE,
  IPC_WIDGET_SET_STATUS,
  IPC_WIDGET_STATUS_CHANGED,
} from '../shared/ipcChannels';

// ---------------------------------------------------------------------------
// Log (Chunk 1 — unchanged)
// ---------------------------------------------------------------------------

type LogFn = (event: string, context?: LogContext) => void;

interface LogApi {
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
}

const emit =
  (level: LogLevel): LogFn =>
  (event, context) => {
    const message: RendererLogMessage = { level, event, context };
    ipcRenderer.send(IPC_LOG_MESSAGE, message);
  };

// ---------------------------------------------------------------------------
// Widget (Chunk 2)
// ---------------------------------------------------------------------------

interface WidgetApi {
  getStatus(): Promise<WidgetStatus>;
  setStatus(next: WidgetStatus): Promise<void>;
  reportPosition(pos: WidgetPosition): void;
  openContextMenu(at: { x: number; y: number }): void;
  emitClick(payload: { at: { x: number; y: number }; bounds: Bounds; ts: number }): void;
  /**
   * D5 click-through seam. `on = true` makes the window capture mouse events;
   * `on = false` returns it to click-through (with forwarding). Renderer toggles
   * this on `mouseenter`/`mouseleave` of the pill frame.
   */
  setInteractive(on: boolean): void;
  /** Move the overlay BrowserWindow by a screen-space delta (pointer drag). */
  moveBy(delta: { dx: number; dy: number }): void;
  /** Subscribe to status pushes from main. Returns an unsubscribe fn. */
  onStatusChanged(cb: (status: WidgetStatus) => void): () => void;
}

const widget: WidgetApi = {
  getStatus: () => ipcRenderer.invoke(IPC_WIDGET_GET_STATUS) as Promise<WidgetStatus>,
  setStatus: (next) => ipcRenderer.invoke(IPC_WIDGET_SET_STATUS, next) as Promise<void>,
  reportPosition: (pos) => {
    ipcRenderer.send(IPC_WIDGET_REPORT_POSITION, pos);
  },
  openContextMenu: (at) => {
    ipcRenderer.send(IPC_WIDGET_OPEN_CONTEXT_MENU, at);
  },
  emitClick: (payload) => {
    ipcRenderer.send(IPC_WIDGET_EMIT_CLICK, payload);
  },
  setInteractive: (on) => {
    ipcRenderer.send(IPC_WIDGET_SET_INTERACTIVE, on);
  },
  moveBy: (delta) => {
    ipcRenderer.send(IPC_WIDGET_MOVE_BY, delta);
  },
  onStatusChanged: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, status: WidgetStatus): void => {
      cb(status);
    };
    ipcRenderer.on(IPC_WIDGET_STATUS_CHANGED, listener);
    return () => {
      ipcRenderer.removeListener(IPC_WIDGET_STATUS_CHANGED, listener);
    };
  },
};

// ---------------------------------------------------------------------------
// Perms (Chunk 2)
// ---------------------------------------------------------------------------

interface PermsApi {
  getScreenRecordingStatus(): Promise<PermissionState>;
  requestScreenRecording(): Promise<PermissionState>;
  openSystemSettings(): void;
}

const perms: PermsApi = {
  getScreenRecordingStatus: () =>
    ipcRenderer.invoke(IPC_PERMS_GET_SCREEN) as Promise<PermissionState>,
  requestScreenRecording: () =>
    ipcRenderer.invoke(IPC_PERMS_REQUEST_SCREEN) as Promise<PermissionState>,
  openSystemSettings: () => {
    ipcRenderer.send(IPC_PERMS_OPEN_SYSTEM_SETTINGS);
  },
};

// ---------------------------------------------------------------------------
// Capture (Chunk 3 — PRD §3.2 locked surface)
// ---------------------------------------------------------------------------

interface CaptureApi {
  getLoopState(): Promise<CaptureLoopState>;
  start(): Promise<void>;
  stop(): Promise<void>;
  captureNow(): Promise<Screenshot | null>;
  setIntervalMs(ms: number): Promise<number>;
  getRecent(limit?: number): Promise<readonly Screenshot[]>;
  /** JPEG data URL for a ring-buffer screenshot (chat attachment preview). */
  getThumbnailDataUrl(id: string): Promise<string | null>;
  /** Subscribe to per-capture pushes. Returns unsubscribe fn. */
  onCaptured(cb: (s: Screenshot) => void): () => void;
  /** Subscribe to loop-state transitions. Returns unsubscribe fn. */
  onLoopStateChanged(cb: (s: CaptureLoopState) => void): () => void;
}

const capture: CaptureApi = {
  getLoopState: () =>
    ipcRenderer.invoke(IPC_CAPTURE_GET_LOOP_STATE) as Promise<CaptureLoopState>,
  start: () => ipcRenderer.invoke(IPC_CAPTURE_START) as Promise<void>,
  stop: () => ipcRenderer.invoke(IPC_CAPTURE_STOP) as Promise<void>,
  captureNow: () =>
    ipcRenderer.invoke(IPC_CAPTURE_NOW) as Promise<Screenshot | null>,
  setIntervalMs: (ms) =>
    ipcRenderer.invoke(IPC_CAPTURE_SET_INTERVAL_MS, ms) as Promise<number>,
  getRecent: (limit) =>
    ipcRenderer.invoke(IPC_CAPTURE_GET_RECENT, limit) as Promise<readonly Screenshot[]>,
  getThumbnailDataUrl: (id) =>
    ipcRenderer.invoke(IPC_CAPTURE_GET_THUMBNAIL, id) as Promise<string | null>,
  onCaptured: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, s: Screenshot): void => {
      cb(s);
    };
    ipcRenderer.on(IPC_CAPTURE_CAPTURED, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CAPTURE_CAPTURED, listener);
    };
  },
  onLoopStateChanged: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, s: CaptureLoopState): void => {
      cb(s);
    };
    ipcRenderer.on(IPC_CAPTURE_LOOP_STATE_CHANGED, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CAPTURE_LOOP_STATE_CHANGED, listener);
    };
  },
};

// ---------------------------------------------------------------------------
// Region (Chunk 3 — PRD §3.2 locked surface + picker-internal channels)
// ---------------------------------------------------------------------------

interface RegionApi {
  getRegion(): Promise<CaptureRegion | null>;
  openPicker(): Promise<CaptureRegion | null>;
  clearRegion(): Promise<void>;
  /** Picker-internal: confirm the drawn rect. NOT for overlay/settings use. */
  _pickerConfirm(payload: {
    displayId: number;
    rect: { x: number; y: number; w: number; h: number };
  }): void;
  /** Picker-internal: ESC pressed. NOT for overlay/settings use. */
  _pickerCancel(): void;
}

const region: RegionApi = {
  getRegion: () => ipcRenderer.invoke(IPC_REGION_GET) as Promise<CaptureRegion | null>,
  openPicker: () =>
    ipcRenderer.invoke(IPC_REGION_OPEN_PICKER) as Promise<CaptureRegion | null>,
  clearRegion: () => ipcRenderer.invoke(IPC_REGION_CLEAR) as Promise<void>,
  _pickerConfirm: (payload) => {
    ipcRenderer.send(IPC_REGION_PICKER_CONFIRM, payload);
  },
  _pickerCancel: () => {
    ipcRenderer.send(IPC_REGION_PICKER_CANCEL);
  },
};

// ---------------------------------------------------------------------------
// Harness (Chunk 4 — PRD §3.2 locked surface)
// ---------------------------------------------------------------------------

interface HarnessApi {
  /** Cheap — never returns the full bundle text. */
  getMetadata(): Promise<HarnessMetadata>;
  /**
   * Dev/inspector only. Resolves with the full envelope-wrapped bundle
   * text. In production with the inspector flag off, main rejects with a
   * typed error (PRD §5 DoD #18).
   */
  getBundleText(): Promise<string>;
  getRootPath(): Promise<string>;
  setRootPath(path: string): Promise<HarnessMetadata>;
  reload(): Promise<HarnessMetadata>;
  /** Open the native folder picker. Returns the chosen path or `null`. */
  browseRoot(): Promise<string | null>;
  /** Subscribe to successful (re)loads. Returns unsubscribe fn. */
  onReloaded(cb: (m: HarnessMetadata) => void): () => void;
  /** Subscribe to load errors. Returns unsubscribe fn. */
  onLoadError(cb: (e: HarnessLoadErrorPayload) => void): () => void;
}

const harness: HarnessApi = {
  getMetadata: () =>
    ipcRenderer.invoke(IPC_HARNESS_GET_METADATA) as Promise<HarnessMetadata>,
  getBundleText: () =>
    ipcRenderer.invoke(IPC_HARNESS_GET_BUNDLE_TEXT) as Promise<string>,
  getRootPath: () =>
    ipcRenderer.invoke(IPC_HARNESS_GET_ROOT_PATH) as Promise<string>,
  setRootPath: (p) =>
    ipcRenderer.invoke(IPC_HARNESS_SET_ROOT_PATH, p) as Promise<HarnessMetadata>,
  reload: () =>
    ipcRenderer.invoke(IPC_HARNESS_RELOAD) as Promise<HarnessMetadata>,
  browseRoot: () =>
    ipcRenderer.invoke(IPC_HARNESS_BROWSE_ROOT) as Promise<string | null>,
  onReloaded: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, m: HarnessMetadata): void => {
      cb(m);
    };
    ipcRenderer.on(IPC_HARNESS_RELOADED, listener);
    return () => {
      ipcRenderer.removeListener(IPC_HARNESS_RELOADED, listener);
    };
  },
  onLoadError: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, p: HarnessLoadErrorPayload): void => {
      cb(p);
    };
    ipcRenderer.on(IPC_HARNESS_LOAD_ERROR, listener);
    return () => {
      ipcRenderer.removeListener(IPC_HARNESS_LOAD_ERROR, listener);
    };
  },
};

// ---------------------------------------------------------------------------
// Chat (Chunk 5 — PRD §3.2 locked surface)
// ---------------------------------------------------------------------------

interface ChatApi {
  open(): Promise<void>;
  close(): Promise<void>;
  isOpen(): Promise<boolean>;
  send(text: string, screenshotIds?: readonly string[]): Promise<void>;
  cancelInFlight(): Promise<void>;
  getHistory(): Promise<readonly ChatTurn[]>;
  copySuggestion(payload: SuggestedParameterChange): Promise<void>;
  openSettings(): Promise<void>;
  getKnowledgeReady(): Promise<boolean>;
  onTurnAppended(cb: (turn: ChatTurn) => void): () => void;
  onStateChanged(cb: (s: ChatState) => void): () => void;
  onError(cb: (e: ChatError) => void): () => void;
  onHistoryCleared(cb: () => void): () => void;
}

const chat: ChatApi = {
  open: () => ipcRenderer.invoke(IPC_CHAT_OPEN) as Promise<void>,
  close: () => ipcRenderer.invoke(IPC_CHAT_CLOSE) as Promise<void>,
  isOpen: () => ipcRenderer.invoke(IPC_CHAT_IS_OPEN) as Promise<boolean>,
  send: (text, screenshotIds) =>
    ipcRenderer.invoke(IPC_CHAT_SEND, text, screenshotIds) as Promise<void>,
  cancelInFlight: () => ipcRenderer.invoke(IPC_CHAT_CANCEL) as Promise<void>,
  getHistory: () =>
    ipcRenderer.invoke(IPC_CHAT_GET_HISTORY) as Promise<readonly ChatTurn[]>,
  copySuggestion: (payload) =>
    ipcRenderer.invoke(IPC_CHAT_COPY_SUGGESTION, payload) as Promise<void>,
  openSettings: () => ipcRenderer.invoke(IPC_CHAT_OPEN_SETTINGS) as Promise<void>,
  getKnowledgeReady: () =>
    ipcRenderer.invoke(IPC_CHAT_GET_KNOWLEDGE_READY) as Promise<boolean>,
  onTurnAppended: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, t: ChatTurn): void => {
      cb(t);
    };
    ipcRenderer.on(IPC_CHAT_TURN_APPENDED, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHAT_TURN_APPENDED, listener);
    };
  },
  onStateChanged: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, s: ChatState): void => {
      cb(s);
    };
    ipcRenderer.on(IPC_CHAT_STATE_CHANGED, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHAT_STATE_CHANGED, listener);
    };
  },
  onError: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, err: ChatError): void => {
      cb(err);
    };
    ipcRenderer.on(IPC_CHAT_ERROR, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHAT_ERROR, listener);
    };
  },
  onHistoryCleared: (cb) => {
    const listener = (): void => {
      cb();
    };
    ipcRenderer.on(IPC_CHAT_HISTORY_CLEARED, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHAT_HISTORY_CLEARED, listener);
    };
  },
};

// ---------------------------------------------------------------------------
// AI (Chunk 5 — PRD §3.2 locked surface)
//
// Note: `getApiKey()` returns ONLY `{ present, masked }` — the raw key is
// MAIN-only. Settings UI must render the masked form and post NEW values
// one-way via `setApiKey`. PRD §5 DoD #24 enforces this with a renderer grep.
// ---------------------------------------------------------------------------

interface AiApi {
  getApiKey(): Promise<ApiKeyPresence>;
  setApiKey(raw: string): Promise<void>;
  clearApiKey(): Promise<void>;
  getModel(): Promise<string>;
  setModel(model: string): Promise<string>;
  listModels(): Promise<readonly string[]>;
  getStats(): Promise<GeminiCallStats>;
}

const ai: AiApi = {
  getApiKey: () =>
    ipcRenderer.invoke(IPC_AI_GET_API_KEY) as Promise<ApiKeyPresence>,
  setApiKey: (raw) => ipcRenderer.invoke(IPC_AI_SET_API_KEY, raw) as Promise<void>,
  clearApiKey: () => ipcRenderer.invoke(IPC_AI_CLEAR_API_KEY) as Promise<void>,
  getModel: () => ipcRenderer.invoke(IPC_AI_GET_MODEL) as Promise<string>,
  setModel: (model) =>
    ipcRenderer.invoke(IPC_AI_SET_MODEL, model) as Promise<string>,
  listModels: () =>
    ipcRenderer.invoke(IPC_AI_LIST_MODELS) as Promise<readonly string[]>,
  getStats: () =>
    ipcRenderer.invoke(IPC_AI_GET_STATS) as Promise<GeminiCallStats>,
};

// ---------------------------------------------------------------------------
// Expose — single `window.api` object, no other globals
// ---------------------------------------------------------------------------

const api = {
  log: {
    debug: emit('debug'),
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
  } satisfies LogApi,
  widget,
  perms,
  capture,
  region,
  harness,
  chat,
  ai,
} as const;

contextBridge.exposeInMainWorld('api', api);

export type ExposedApi = typeof api;
