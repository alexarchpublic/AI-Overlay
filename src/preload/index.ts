/**
 * @file src/preload/index.ts
 *
 * Narrow, auditable IPC surface exposed as `window.api`.
 */

import { contextBridge, ipcRenderer } from 'electron';
import type {
  ApiKeyPresence,
  CaptureLoopState,
  CaptureRegion,
  ChatError,
  ChatState,
  ChatTurn,
  GeminiCallStats,
  LogContext,
  LogLevel,
  PermissionState,
  RendererLogMessage,
  Screenshot,
  SuggestedParameterChange,
  WidgetPosition,
  WidgetStatus,
} from '../shared/types';
import type { ActiveAlgorithm, KnowledgeBundleInfo } from '../shared/knowledgeTypes';
import {
  IPC_AI_CLEAR_API_KEY,
  IPC_AI_GET_API_KEY,
  IPC_AI_GET_MODEL,
  IPC_AI_GET_STATS,
  IPC_AI_LIST_MODELS,
  IPC_AI_SET_API_KEY,
  IPC_AI_SET_MODEL,
  IPC_APP_GET_VERSION,
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
  IPC_CHAT_COPY_TALK_TRACK,
  IPC_CHAT_ERROR,
  IPC_CHAT_GET_HISTORY,
  IPC_CHAT_GET_KNOWLEDGE_READY,
  IPC_CHAT_HISTORY_CLEARED,
  IPC_CHAT_TURN_DROPPED,
  IPC_CHAT_IS_OPEN,
  IPC_CHAT_OPEN,
  IPC_CHAT_OPEN_SETTINGS,
  IPC_CHAT_SEND,
  IPC_CHAT_STATE_CHANGED,
  IPC_CHAT_TURN_APPENDED,
  IPC_LOG_MESSAGE,
  IPC_PERMS_GET_SCREEN,
  IPC_PERMS_OPEN_SYSTEM_SETTINGS,
  IPC_PERMS_REQUEST_SCREEN,
  IPC_REGION_CLEAR,
  IPC_REGION_GET,
  IPC_REGION_OPEN_PICKER,
  IPC_REGION_PICKER_CANCEL,
  IPC_REGION_PICKER_CONFIRM,
  IPC_WIDGET_GET_STATUS,
  IPC_WIDGET_OPEN_CONTEXT_MENU,
  IPC_WIDGET_REPORT_POSITION,
  IPC_WIDGET_SET_STATUS,
  IPC_WIDGET_STATUS_CHANGED,
  IPC_KNOWLEDGE_GET_ACTIVE_ALGORITHM,
  IPC_KNOWLEDGE_GET_BUNDLE_INFO,
  IPC_KNOWLEDGE_SET_ACTIVE_ALGORITHM,
  IPC_APP_COPY_DIAGNOSTICS,
  IPC_UPDATE_CHECK,
  IPC_UPDATE_GET_STATE,
  IPC_UPDATE_INSTALL,
  IPC_UPDATE_OPEN_RELEASE_PAGE,
  IPC_UPDATE_STATE_CHANGED,
} from '../shared/ipcChannels';
import type { UpdateStateSnapshot } from '../shared/updateTypes';
import { parsePickerDisplayIdFromArgv } from '../shared/pickerDisplayId';

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

interface WidgetApi {
  getStatus(): Promise<WidgetStatus>;
  setStatus(next: WidgetStatus): Promise<void>;
  reportPosition(pos: WidgetPosition): void;
  openContextMenu(at: { x: number; y: number }): void;
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

interface CaptureApi {
  getLoopState(): Promise<CaptureLoopState>;
  start(): Promise<void>;
  stop(): Promise<void>;
  captureNow(): Promise<Screenshot | null>;
  setIntervalMs(ms: number): Promise<number>;
  getRecent(limit?: number): Promise<readonly Screenshot[]>;
  getThumbnailDataUrl(id: string): Promise<string | null>;
  onCaptured(cb: (s: Screenshot) => void): () => void;
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

interface RegionApi {
  getRegion(): Promise<CaptureRegion | null>;
  openPicker(): Promise<CaptureRegion | null>;
  clearRegion(): Promise<void>;
  _pickerConfirm(payload: {
    displayId: number;
    rect: { x: number; y: number; w: number; h: number };
  }): void;
  _pickerCancel(): void;
  /**
   * Picker-internal: display id from `additionalArguments`, used when the
   * URL hash/query does not carry `displayId`.
   */
  _getPickerDisplayId(): number | null;
}

const pickerDisplayIdFromArgv = parsePickerDisplayIdFromArgv(process.argv);

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
  _getPickerDisplayId: () => pickerDisplayIdFromArgv,
};

interface ChatApi {
  open(): Promise<void>;
  close(): Promise<void>;
  isOpen(): Promise<boolean>;
  send(text: string, screenshotIds?: readonly string[]): Promise<void>;
  cancelInFlight(): Promise<void>;
  getHistory(): Promise<readonly ChatTurn[]>;
  copySuggestion(payload: SuggestedParameterChange): Promise<void>;
  copyTalkTrack(text: string): Promise<void>;
  openSettings(): Promise<void>;
  getKnowledgeReady(): Promise<boolean>;
  onTurnAppended(cb: (turn: ChatTurn) => void): () => void;
  onTurnDropped(cb: (turnId: string) => void): () => void;
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
  copyTalkTrack: (text) =>
    ipcRenderer.invoke(IPC_CHAT_COPY_TALK_TRACK, text) as Promise<void>,
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
  onTurnDropped: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, turnId: string): void => {
      cb(turnId);
    };
    ipcRenderer.on(IPC_CHAT_TURN_DROPPED, listener);
    return () => {
      ipcRenderer.removeListener(IPC_CHAT_TURN_DROPPED, listener);
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

interface KnowledgeApi {
  getActiveAlgorithm(): Promise<ActiveAlgorithm>;
  setActiveAlgorithm(algorithm: ActiveAlgorithm): Promise<ActiveAlgorithm>;
  getBundleInfo(): Promise<KnowledgeBundleInfo | null>;
}

const knowledge: KnowledgeApi = {
  getActiveAlgorithm: () =>
    ipcRenderer.invoke(IPC_KNOWLEDGE_GET_ACTIVE_ALGORITHM) as Promise<ActiveAlgorithm>,
  setActiveAlgorithm: (algorithm) =>
    ipcRenderer.invoke(IPC_KNOWLEDGE_SET_ACTIVE_ALGORITHM, algorithm) as Promise<ActiveAlgorithm>,
  getBundleInfo: () =>
    ipcRenderer.invoke(IPC_KNOWLEDGE_GET_BUNDLE_INFO) as Promise<KnowledgeBundleInfo | null>,
};

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

interface AppApi {
  getVersion(): Promise<string>;
  copyDiagnostics(): Promise<string>;
}

const appApi: AppApi = {
  getVersion: () => ipcRenderer.invoke(IPC_APP_GET_VERSION) as Promise<string>,
  copyDiagnostics: () =>
    ipcRenderer.invoke(IPC_APP_COPY_DIAGNOSTICS) as Promise<string>,
};

interface UpdatesApi {
  getState(): Promise<UpdateStateSnapshot>;
  check(): Promise<UpdateStateSnapshot>;
  install(): Promise<void>;
  openReleasePage(): Promise<void>;
  onStateChanged(cb: (snapshot: UpdateStateSnapshot) => void): () => void;
}

const updates: UpdatesApi = {
  getState: () =>
    ipcRenderer.invoke(IPC_UPDATE_GET_STATE) as Promise<UpdateStateSnapshot>,
  check: () => ipcRenderer.invoke(IPC_UPDATE_CHECK) as Promise<UpdateStateSnapshot>,
  install: () => ipcRenderer.invoke(IPC_UPDATE_INSTALL) as Promise<void>,
  openReleasePage: () =>
    ipcRenderer.invoke(IPC_UPDATE_OPEN_RELEASE_PAGE) as Promise<void>,
  onStateChanged: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, snapshot: UpdateStateSnapshot): void => {
      cb(snapshot);
    };
    ipcRenderer.on(IPC_UPDATE_STATE_CHANGED, listener);
    return () => {
      ipcRenderer.removeListener(IPC_UPDATE_STATE_CHANGED, listener);
    };
  },
};

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
  chat,
  knowledge,
  ai,
  app: appApi,
  updates,
} as const;

contextBridge.exposeInMainWorld('api', api);

export type ExposedApi = typeof api;
