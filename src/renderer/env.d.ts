/// <reference types="vite/client" />

/**
 * @file src/renderer/env.d.ts
 *
 * Declares the `window.api` surface exposed by the preload contextBridge.
 * Keep in sync with `src/preload/index.ts`.
 */

import type {
  ApiKeyPresence,
  CaptureLoopState,
  CaptureRegion,
  ChatError,
  ChatState,
  ChatTurn,
  GeminiCallStats,
  LogContext,
  PermissionState,
  Screenshot,
  SuggestedParameterChange,
  WidgetPosition,
  WidgetStatus,
} from '../shared/types';
import type { ActiveAlgorithm, KnowledgeBundleInfo } from '../shared/knowledgeTypes';
import type { UpdateStateSnapshot } from '../shared/updateTypes';

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
        _pickerConfirm: (payload: {
          displayId: number;
          rect: { x: number; y: number; w: number; h: number };
        }) => void;
        _pickerCancel: () => void;
      };
      chat: {
        open: () => Promise<void>;
        close: () => Promise<void>;
        isOpen: () => Promise<boolean>;
        send: (text: string, screenshotIds?: readonly string[]) => Promise<void>;
        cancelInFlight: () => Promise<void>;
        getHistory: () => Promise<readonly ChatTurn[]>;
        copySuggestion: (payload: SuggestedParameterChange) => Promise<void>;
        copyTalkTrack: (text: string) => Promise<void>;
        openSettings: () => Promise<void>;
        getKnowledgeReady: () => Promise<boolean>;
        onTurnAppended: (cb: (turn: ChatTurn) => void) => () => void;
        onTurnDropped: (cb: (turnId: string) => void) => () => void;
        onStateChanged: (cb: (s: ChatState) => void) => () => void;
        onError: (cb: (e: ChatError) => void) => () => void;
        onHistoryCleared: (cb: () => void) => () => void;
      };
      knowledge: {
        getActiveAlgorithm: () => Promise<ActiveAlgorithm>;
        setActiveAlgorithm: (algorithm: ActiveAlgorithm) => Promise<ActiveAlgorithm>;
        getBundleInfo: () => Promise<KnowledgeBundleInfo | null>;
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
      app: {
        getVersion: () => Promise<string>;
        copyDiagnostics: () => Promise<string>;
      };
      updates: {
        getState: () => Promise<UpdateStateSnapshot>;
        check: () => Promise<UpdateStateSnapshot>;
        install: () => Promise<void>;
        openReleasePage: () => Promise<void>;
        onStateChanged: (cb: (snapshot: UpdateStateSnapshot) => void) => () => void;
      };
    };
  }
}

export {};
