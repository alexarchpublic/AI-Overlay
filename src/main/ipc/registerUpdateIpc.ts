/**
 * @file src/main/ipc/registerUpdateIpc.ts
 *
 * Update + diagnostics IPC namespace (Chunk 7 Phase 3). Follows the
 * namespace-registrar convention of `registerCoreIpc` / `registerChatAiIpc`.
 */

import path from 'node:path';
import { BrowserWindow, clipboard, ipcMain, shell } from 'electron';
import type { AppContext } from '../appContext';
import { platformInfo } from '../platform';
import { LOG_DIR_NAME } from '../../shared/constants';
import {
  IPC_APP_COPY_DIAGNOSTICS,
  IPC_UPDATE_CHECK,
  IPC_UPDATE_GET_STATE,
  IPC_UPDATE_INSTALL,
  IPC_UPDATE_OPEN_RELEASE_PAGE,
  IPC_UPDATE_STATE_CHANGED,
} from '../../shared/ipcChannels';
import type { UpdateStateSnapshot } from '../../shared/updateTypes';

export function registerUpdateIpc(ctx: AppContext): void {
  const log = ctx.logger;
  const updater = ctx.updaterService;

  ipcMain.handle(IPC_UPDATE_GET_STATE, (): UpdateStateSnapshot => {
    if (!updater) {
      return {
        state: 'idle',
        version: null,
        releaseNotesUrl: null,
        percent: null,
        error: null,
        lastCheckedAt: null,
        currentVersion: ctx.appVersion,
        channel: 'default',
      };
    }
    return updater.getState();
  });

  ipcMain.handle(IPC_UPDATE_CHECK, async (): Promise<UpdateStateSnapshot> => {
    if (!updater) {
      log.warn('update.checkSkipped', { reason: 'no-updater' });
      return {
        state: 'idle',
        version: null,
        releaseNotesUrl: null,
        percent: null,
        error: null,
        lastCheckedAt: null,
        currentVersion: ctx.appVersion,
        channel: 'default',
      };
    }
    await updater.checkNow();
    return updater.getState();
  });

  ipcMain.handle(IPC_UPDATE_INSTALL, (): void => {
    if (!updater) return;
    updater.installNow();
  });

  ipcMain.handle(IPC_UPDATE_OPEN_RELEASE_PAGE, async (): Promise<void> => {
    const url = updater?.getState().releaseNotesUrl;
    if (!url) {
      log.warn('update.openReleasePageSkipped', { reason: 'no-url' });
      return;
    }
    log.info('update.openReleasePage', { url });
    await shell.openExternal(url);
  });

  ipcMain.handle(IPC_APP_COPY_DIAGNOSTICS, (): string => {
    const logsDir = path.join(ctx.userDataPath, LOG_DIR_NAME);
    const state = updater?.getState();
    const lines = [
      `Arch Public AI Overlay diagnostics`,
      `version: ${ctx.appVersion}`,
      `platform: ${platformInfo.platform}`,
      `channel: ${state?.channel ?? 'default'}`,
      `updateState: ${state?.state ?? 'idle'}`,
      `logs: ${logsDir}`,
    ];
    const text = lines.join('\n');
    clipboard.writeText(text);
    log.info('diagnostics.copied', {
      version: ctx.appVersion,
      platform: platformInfo.platform,
      logsDir,
    });
    return text;
  });

  if (updater) {
    updater.on('stateChanged', (snapshot) => {
      for (const w of BrowserWindow.getAllWindows()) {
        w.webContents.send(IPC_UPDATE_STATE_CHANGED, snapshot);
      }
    });
  }
}
