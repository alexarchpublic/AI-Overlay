/**
 * @file src/main/appContext.ts
 *
 * Consolidated runtime dependencies for main-process modules. Created once
 * inside `app.whenReady` and passed to IPC registrars and lifecycle helpers.
 */

import type { ChatOrchestrator } from './chatOrchestrator';
import type { AiStateStore } from './aiStore';
import type { CaptureStateStore } from './captureStore';
import type { ConversationStore } from './conversationStore';
import type { GeminiService } from './geminiService';
import type { AppLogger } from './logger';
import type { PermissionsHelper } from './permissions';
import type { ScreenshotService } from './screenshotService';
import type { UpdaterServiceHandle } from './updaterService';
import type { WidgetStateStore } from './widgetState';
import type { KnowledgeStore } from '../shared/knowledgeTypes';
import type { KnowledgeStateStore } from './knowledgeStoreState';
import type { ChatState } from '../shared/types';

export interface AppContext {
  logger: AppLogger;
  widgetState: WidgetStateStore;
  capture: CaptureStateStore;
  screenshotService: ScreenshotService;
  permissions: PermissionsHelper;
  knowledgeStore: KnowledgeStore | null;
  knowledgeStoreState: KnowledgeStateStore;
  conversationStore: ConversationStore;
  geminiService: GeminiService | null;
  aiStore: AiStateStore;
  chatOrchestrator: ChatOrchestrator | null;
  chatInflight: { current: AbortController | null };
  chatState: ChatState;
  isDev: boolean;
  devServerUrl: string;
  /** `app.getVersion()` — package.json is the single source of truth. */
  appVersion: string;
  /** `app.getPath('userData')` — for diagnostics / log path. */
  userDataPath: string;
  /** Chunk 7 Phase 3 — null only before the updater is wired. */
  updaterService: UpdaterServiceHandle | null;
}
