/**
 * @file src/main/ipc/registerChatAiIpc.ts
 *
 * Chat and AI IPC namespaces (Chunk 5).
 */

import { clipboard, ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { AppContext } from '../appContext';
import type { ChatLifecycle } from '../chatLifecycle';
import { closeChatWindow, focusChatWindow, isChatWindowOpen } from '../chatLifecycle';
import { maskApiKey } from '../aiStore';
import { SecretEncryptionUnavailableError } from '../secretsStore';
import { openSettingsWindow } from '../settingsWindow';
import { DEFAULT_RETRIEVAL_TOKEN_BUDGET } from '../../shared/knowledgeConstants';
import {
  IPC_AI_CLEAR_API_KEY,
  IPC_AI_GET_API_KEY,
  IPC_AI_GET_MODEL,
  IPC_AI_GET_STATS,
  IPC_AI_LIST_MODELS,
  IPC_AI_SET_API_KEY,
  IPC_AI_SET_MODEL,
  IPC_CHAT_CANCEL,
  IPC_CHAT_CLOSE,
  IPC_CHAT_COPY_SUGGESTION,
  IPC_CHAT_GET_HISTORY,
  IPC_CHAT_GET_KNOWLEDGE_READY,
  IPC_CHAT_IS_OPEN,
  IPC_CHAT_OPEN,
  IPC_CHAT_OPEN_SETTINGS,
  IPC_CHAT_SEND,
} from '../../shared/ipcChannels';
import type {
  ApiKeyPresence,
  ChatTurn,
  GeminiCallStats,
  SuggestedParameterChange,
} from '../../shared/types';
import { isSuggestedChange } from './typeGuards';

function formatSuggestionForClipboard(s: SuggestedParameterChange): string {
  return `${s.parameter}: ${s.direction} to ${s.suggested_value} # ${s.chart_context} — ${s.rationale}`;
}

export function registerChatAiIpc(ctx: AppContext, chat: ChatLifecycle): void {
  const log = ctx.logger;
  const ai = ctx.aiStore;
  const conv = ctx.conversationStore;
  const gemini = ctx.geminiService;

  ipcMain.handle(IPC_CHAT_OPEN, async (): Promise<void> => {
    if (isChatWindowOpen()) {
      log.debug('chat.openIdempotent');
      focusChatWindow();
      return Promise.resolve();
    }
    chat.launchChatWindow();
    conv.startSession();
    chat.setChatState('idle');
    return Promise.resolve();
  });

  ipcMain.handle(IPC_CHAT_CLOSE, async (): Promise<void> => {
    closeChatWindow('user');
    return Promise.resolve();
  });

  ipcMain.handle(IPC_CHAT_OPEN_SETTINGS, async (): Promise<void> => {
    log.info('chat.openSettings');
    openSettingsWindow({ logger: log, isDev: ctx.isDev, devServerUrl: ctx.devServerUrl });
    return Promise.resolve();
  });

  ipcMain.handle(IPC_CHAT_IS_OPEN, (): boolean => isChatWindowOpen());

  ipcMain.handle(IPC_CHAT_GET_KNOWLEDGE_READY, async (): Promise<boolean> => {
    const store = ctx.knowledgeStore;
    if (!store) return false;
    try {
      const chunks = await store.retrieve({
        text: 'signal',
        k: 1,
        tokenBudget: DEFAULT_RETRIEVAL_TOKEN_BUDGET,
      });
      return chunks.length > 0;
    } catch {
      return false;
    }
  });

  ipcMain.handle(
    IPC_CHAT_SEND,
    async (_e: IpcMainInvokeEvent, text: unknown, screenshotIds: unknown): Promise<void> => {
      if (typeof text !== 'string' || text.trim().length === 0) {
        return Promise.resolve();
      }
      const ids =
        Array.isArray(screenshotIds) &&
        screenshotIds.every((id): id is string => typeof id === 'string')
          ? screenshotIds
          : undefined;
      void ctx.chatOrchestrator?.runChatSend(text, ids);
      return Promise.resolve();
    },
  );

  ipcMain.handle(IPC_CHAT_CANCEL, async (): Promise<void> => {
    if (ctx.chatInflight.current) {
      ctx.chatInflight.current.abort();
      ctx.chatInflight.current = null;
      log.info('chat.cancelled');
    }
    chat.setChatState('idle');
    return Promise.resolve();
  });

  ipcMain.handle(IPC_CHAT_GET_HISTORY, (): readonly ChatTurn[] => conv.getHistory());

  ipcMain.handle(IPC_CHAT_COPY_SUGGESTION, (_e: IpcMainInvokeEvent, payload: unknown): void => {
    if (!isSuggestedChange(payload)) return;
    const text = formatSuggestionForClipboard(payload);
    try {
      clipboard.writeText(text);
      log.info('chat.suggestionCopied', { parameter: payload.parameter });
    } catch (err) {
      log.warn('chat.suggestionCopyFailed', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  ipcMain.handle(IPC_AI_GET_API_KEY, (): ApiKeyPresence => {
    const key = ai.getApiKey();
    return {
      present: key !== null,
      masked: maskApiKey(key),
    };
  });

  ipcMain.handle(IPC_AI_SET_API_KEY, (_e: IpcMainInvokeEvent, raw: unknown): void => {
    if (typeof raw !== 'string') return;
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      ai.clearApiKey();
      log.info('ai.apiKeyUpdated', { cleared: true });
      return;
    }
    try {
      ai.setApiKey(trimmed);
    } catch (err) {
      if (err instanceof SecretEncryptionUnavailableError) {
        log.error('secrets.encryptionUnavailable', {
          operation: 'setApiKey',
          message: err.message,
        });
        return;
      }
      throw err;
    }
    log.info('ai.apiKeyUpdated', { cleared: false, masked: maskApiKey(trimmed) });
  });

  ipcMain.handle(IPC_AI_CLEAR_API_KEY, (): void => {
    ai.clearApiKey();
    log.info('ai.apiKeyUpdated', { cleared: true });
  });

  ipcMain.handle(IPC_AI_GET_MODEL, (): string => ai.getModel());

  ipcMain.handle(IPC_AI_SET_MODEL, (_e: IpcMainInvokeEvent, model: unknown): string => {
    if (typeof model !== 'string') return ai.getModel();
    const prev = ai.getModel();
    const next = ai.setModel(model);
    if (next !== prev) {
      log.info('ai.modelChanged', { from: prev, to: next });
      gemini?.invalidateSystemPromptCache();
    }
    return next;
  });

  ipcMain.handle(
    IPC_AI_LIST_MODELS,
    // eslint-disable-next-line @typescript-eslint/require-await
    async (): Promise<readonly string[]> => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const c = require('../../shared/aiConstants') as { MODEL_ALLOWLIST: readonly string[] };
      return c.MODEL_ALLOWLIST;
    },
  );

  ipcMain.handle(IPC_AI_GET_STATS, (): GeminiCallStats => ai.getStats(Date.now()));
}
