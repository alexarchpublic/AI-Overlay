/**
 * @file src/main/permissionSync.ts
 *
 * OS screen-recording permission polling and widget-status sync.
 */

import { BrowserWindow } from 'electron';
import type { AppContext } from './appContext';
import type { AppLogger } from './logger';
import { statusForPermission, type PermissionsHelper } from './permissions';
import type { WidgetStateStore } from './widgetState';
import { IPC_WIDGET_STATUS_CHANGED } from '../shared/ipcChannels';
import type { PermissionState, WidgetStatus } from '../shared/types';

const PERMISSION_POLL_MS = 2_000;

export interface PermissionSyncHandle {
  startPollIfNeeded(initialPerm: PermissionState): void;
  stopPoll(): void;
  syncWidgetStatus(trigger: 'boot' | 'focus'): void;
  runScreenRecordingRequest(trigger: 'firstRunAuto' | 'menu' | 'rendererInvoke'): Promise<PermissionState>;
}

export function createPermissionSync(ctx: AppContext): PermissionSyncHandle {
  let pollTimer: NodeJS.Timeout | null = null;

  function broadcastWidgetStatus(status: WidgetStatus): void {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send(IPC_WIDGET_STATUS_CHANGED, status);
    }
  }

  function stopPoll(): void {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function syncWidgetStatusWithOsPermission(
    log: AppLogger,
    store: WidgetStateStore,
    perms: PermissionsHelper,
    trigger: 'boot' | 'focus',
  ): void {
    const osPerm = perms.getScreenRecordingStatus();
    const mapped = statusForPermission(osPerm);
    const persisted = store.getStatus();

    if (
      mapped === 'permDenied' &&
      persisted !== 'permDenied' &&
      persisted !== 'capturing'
    ) {
      store.setStatus('permDenied');
      log.info('perms.screen.persistedSync', {
        from: persisted,
        to: 'permDenied',
        reason: 'osDenied',
        trigger,
        osState: osPerm,
      });
      broadcastWidgetStatus('permDenied');
      return;
    }

    if (mapped === 'ready' && persisted === 'permDenied') {
      store.setStatus('ready');
      log.info('perms.screen.persistedSync', {
        from: 'permDenied',
        to: 'ready',
        reason: 'osGrantedClearStaleDenial',
        trigger,
        osState: osPerm,
      });
      broadcastWidgetStatus('ready');
      stopPoll();
    }
  }

  function startPollIfNeeded(initialPerm: PermissionState): void {
    if (initialPerm === 'granted' || initialPerm === 'restricted') return;
    stopPoll();
    pollTimer = setInterval(() => {
      const os = ctx.permissions.getScreenRecordingStatus();
      ctx.logger.debug('perms.screen.poll', { state: os });
      syncWidgetStatusWithOsPermission(
        ctx.logger,
        ctx.widgetState,
        ctx.permissions,
        'focus',
      );
      if (os === 'granted' || os === 'restricted') {
        stopPoll();
      }
    }, PERMISSION_POLL_MS);
  }

  async function runScreenRecordingRequest(
    trigger: 'firstRunAuto' | 'menu' | 'rendererInvoke',
  ): Promise<PermissionState> {
    ctx.logger.info('perms.screen.requestStart', { trigger });
    const result = await ctx.permissions.requestScreenRecording();
    ctx.widgetState.setPermissionsPromptSeen(true);
    const nextStatus: WidgetStatus = statusForPermission(result);
    ctx.widgetState.setStatus(nextStatus);
    ctx.logger.info('perms.screen.requestEnd', { result, nextStatus, trigger });
    broadcastWidgetStatus(nextStatus);
    if (result === 'granted' || result === 'restricted') {
      stopPoll();
    } else {
      startPollIfNeeded(result);
    }
    return result;
  }

  return {
    startPollIfNeeded,
    stopPoll,
    syncWidgetStatus: (trigger) => {
      syncWidgetStatusWithOsPermission(
        ctx.logger,
        ctx.widgetState,
        ctx.permissions,
        trigger,
      );
    },
    runScreenRecordingRequest,
  };
}
