/**
 * @file src/main/chatLifecycle.ts
 *
 * Chat window open/close and push-event helpers for the Chunk 5 surface.
 */

import { BrowserWindow } from 'electron';
import type { AppContext } from './appContext';
import type { PermissionSyncHandle } from './permissionSync';
import {
  closeChatWindow,
  focusChatWindow,
  isChatWindowOpen,
  openChatWindow,
} from './chatWindow';
import {
  IPC_CHAT_ERROR,
  IPC_CHAT_HISTORY_CLEARED,
  IPC_CHAT_TURN_DROPPED,
  IPC_CHAT_STATE_CHANGED,
  IPC_CHAT_TURN_APPENDED,
} from '../shared/ipcChannels';
import type { ChatError, ChatState, ChatTurn } from '../shared/types';

export interface ChatLifecycle {
  launchChatWindow(): BrowserWindow;
  setChatState(next: ChatState): void;
  emitChatError(err: ChatError): void;
  emitTurnAppended(turn: ChatTurn): void;
  emitTurnDropped(turnId: string): void;
}

export function createChatLifecycle(
  ctx: AppContext,
  permissionSync: PermissionSyncHandle,
): ChatLifecycle {
  function broadcastToAllWindows(channel: string, payload: unknown): void {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send(channel, payload);
    }
  }

  function setChatState(next: ChatState): void {
    if (next === ctx.chatState) return;
    ctx.chatState = next;
    broadcastToAllWindows(IPC_CHAT_STATE_CHANGED, next);
  }

  function emitChatError(err: ChatError): void {
    setChatState('error');
    broadcastToAllWindows(IPC_CHAT_ERROR, err);
    ctx.logger.info('chat.errorShown', { variant: err.variant });
  }

  function emitTurnAppended(turn: ChatTurn): void {
    broadcastToAllWindows(IPC_CHAT_TURN_APPENDED, turn);
  }

  function emitTurnDropped(turnId: string): void {
    broadcastToAllWindows(IPC_CHAT_TURN_DROPPED, turnId);
  }

  function onChatWindowClosed(): void {
    if (ctx.chatInflight.current) {
      ctx.chatInflight.current.abort();
      ctx.chatInflight.current = null;
    }
    ctx.conversationStore.endSession('close');
    broadcastToAllWindows(IPC_CHAT_HISTORY_CLEARED, undefined);
    setChatState('idle');
  }

  function launchChatWindow(): BrowserWindow {
    const win = openChatWindow({
      logger: ctx.logger,
      isDev: ctx.isDev,
      devServerUrl: ctx.devServerUrl,
      state: ctx.widgetState,
      onClosed: onChatWindowClosed,
    });
    win.on('focus', () => {
      permissionSync.syncWidgetStatus('focus');
      const os = ctx.permissions.getScreenRecordingStatus();
      if (os === 'granted' || os === 'restricted') {
        permissionSync.stopPoll();
      }
    });
    if (ctx.isDev) {
      win.webContents.openDevTools({ mode: 'detach' });
    }
    return win;
  }

  return {
    launchChatWindow,
    setChatState,
    emitChatError,
    emitTurnAppended,
    emitTurnDropped,
  };
}

export { focusChatWindow, isChatWindowOpen, closeChatWindow };
