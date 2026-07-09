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
import type { WidgetStateStore } from './widgetState';
import type { KnowledgeStore } from '../shared/knowledgeTypes';
import type { ChatState } from '../shared/types';

export interface AppContext {
  logger: AppLogger;
  widgetState: WidgetStateStore;
  capture: CaptureStateStore;
  screenshotService: ScreenshotService;
  permissions: PermissionsHelper;
  knowledgeStore: KnowledgeStore | null;
  conversationStore: ConversationStore;
  geminiService: GeminiService | null;
  aiStore: AiStateStore;
  chatOrchestrator: ChatOrchestrator | null;
  chatInflight: { current: AbortController | null };
  chatState: ChatState;
  isDev: boolean;
  devServerUrl: string;
}
