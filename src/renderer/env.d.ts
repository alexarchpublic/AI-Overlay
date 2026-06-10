/// <reference types="vite/client" />

/**
 * @file src/renderer/env.d.ts
 *
 * Why it exists: Declares the `window.api` surface exposed by the preload
 * contextBridge so the renderer gets type-safe access without reaching into
 * `src/preload/index.ts` (which is compiled into a separate process bundle).
 * Keep this in sync with `src/preload/index.ts`:
 *   - Chunk 2 added `widget` and `perms` namespaces + the D5 `setInteractive` seam
 *   - Chunk 3 added `capture` and `region` namespaces per PRD §3.2
 *   - Chunk 4 added `harness` per PRD §3.2
 *   - Chunk 5 added `chat` and `ai` per PRD §3.2
 */

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
  PermissionState,
  Screenshot,
  SuggestedParameterChange,
  WidgetPosition,
  WidgetStatus,
} from '../shared/types';

declare global {
  interface Window {
    api: {
      log: {
        debug: (event: string, context?: LogContext) => void;
        info: (event: string, context?: LogContext) => void;
        warn: (event: string, context?: LogContext) => void;
        error: (event: string, context?: LogContext) => void;
      };
      widget: {
        getStatus: () => Promise<WidgetStatus>;
        setStatus: (next: WidgetStatus) => Promise<void>;
        reportPosition: (pos: WidgetPosition) => void;
        openContextMenu: (at: { x: number; y: number }) => void;
        emitClick: (payload: { at: { x: number; y: number }; bounds: Bounds; ts: number }) => void;
        setInteractive: (on: boolean) => void;
        moveBy: (delta: { dx: number; dy: number }) => void;
        onStatusChanged: (cb: (status: WidgetStatus) => void) => () => void;
      };
      perms: {
        getScreenRecordingStatus: () => Promise<PermissionState>;
        requestScreenRecording: () => Promise<PermissionState>;
        openSystemSettings: () => void;
      };
      capture: {
        getLoopState: () => Promise<CaptureLoopState>;
        start: () => Promise<void>;
        stop: () => Promise<void>;
        captureNow: () => Promise<Screenshot | null>;
        setIntervalMs: (ms: number) => Promise<number>;
        getRecent: (limit?: number) => Promise<readonly Screenshot[]>;
        getThumbnailDataUrl: (id: string) => Promise<string | null>;
        onCaptured: (cb: (s: Screenshot) => void) => () => void;
        onLoopStateChanged: (cb: (s: CaptureLoopState) => void) => () => void;
      };
      region: {
        getRegion: () => Promise<CaptureRegion | null>;
        openPicker: () => Promise<CaptureRegion | null>;
        clearRegion: () => Promise<void>;
        /** Picker-internal — only callable from the picker window. */
        _pickerConfirm: (payload: {
          displayId: number;
          rect: { x: number; y: number; w: number; h: number };
        }) => void;
        /** Picker-internal — only callable from the picker window. */
        _pickerCancel: () => void;
      };
      harness: {
        getMetadata: () => Promise<HarnessMetadata>;
        getBundleText: () => Promise<string>;
        getRootPath: () => Promise<string>;
        setRootPath: (path: string) => Promise<HarnessMetadata>;
        reload: () => Promise<HarnessMetadata>;
        browseRoot: () => Promise<string | null>;
        onReloaded: (cb: (m: HarnessMetadata) => void) => () => void;
        onLoadError: (cb: (e: HarnessLoadErrorPayload) => void) => () => void;
      };
      chat: {
        open: () => Promise<void>;
        close: () => Promise<void>;
        isOpen: () => Promise<boolean>;
        send: (text: string, screenshotIds?: readonly string[]) => Promise<void>;
        cancelInFlight: () => Promise<void>;
        getHistory: () => Promise<readonly ChatTurn[]>;
        copySuggestion: (payload: SuggestedParameterChange) => Promise<void>;
        openSettings: () => Promise<void>;
        getKnowledgeReady: () => Promise<boolean>;
        onTurnAppended: (cb: (turn: ChatTurn) => void) => () => void;
        onStateChanged: (cb: (s: ChatState) => void) => () => void;
        onError: (cb: (e: ChatError) => void) => () => void;
        onHistoryCleared: (cb: () => void) => () => void;
      };
      ai: {
        getApiKey: () => Promise<ApiKeyPresence>;
        setApiKey: (raw: string) => Promise<void>;
        clearApiKey: () => Promise<void>;
        getModel: () => Promise<string>;
        setModel: (model: string) => Promise<string>;
        listModels: () => Promise<readonly string[]>;
        getStats: () => Promise<GeminiCallStats>;
      };
    };
  }
}

export {};
