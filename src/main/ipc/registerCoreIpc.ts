/**
 * @file src/main/ipc/registerCoreIpc.ts
 *
 * Widget, permissions, capture, and region IPC namespaces.
 */

import fsp from 'node:fs/promises';
import { BrowserWindow, app, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import type { AppContext } from '../appContext';
import type { PermissionSyncHandle } from '../permissionSync';
import { popupWidgetMenu } from '../contextMenu';
import { isMac } from '../platform';
import { openRegionPicker } from '../regionPicker';
import { openSettingsWindow } from '../settingsWindow';
import type { CaptureStateStore } from '../captureStore';
import type { ScreenshotService } from '../screenshotService';
import {
  IPC_APP_GET_VERSION,
  IPC_CAPTURE_GET_LOOP_STATE,
  IPC_CAPTURE_GET_RECENT,
  IPC_CAPTURE_GET_THUMBNAIL,
  IPC_CAPTURE_NOW,
  IPC_CAPTURE_SET_INTERVAL_MS,
  IPC_CAPTURE_START,
  IPC_CAPTURE_STOP,
  IPC_PERMS_GET_SCREEN,
  IPC_PERMS_OPEN_SYSTEM_SETTINGS,
  IPC_PERMS_REQUEST_SCREEN,
  IPC_REGION_CLEAR,
  IPC_REGION_GET,
  IPC_REGION_OPEN_PICKER,
  IPC_WIDGET_GET_STATUS,
  IPC_WIDGET_OPEN_CONTEXT_MENU,
  IPC_WIDGET_REPORT_POSITION,
  IPC_WIDGET_SET_STATUS,
  IPC_WIDGET_STATUS_CHANGED,
} from '../../shared/ipcChannels';
import type {
  CaptureLoopState,
  CaptureRegion,
  Screenshot,
  WidgetStatus,
} from '../../shared/types';
import { isPoint, isWidgetPosition } from './typeGuards';

async function runRegionPicker(
  ctx: AppContext,
  captureStore: CaptureStateStore,
  service: ScreenshotService,
): Promise<CaptureRegion | null> {
  const region = await openRegionPicker({
    logger: ctx.logger,
    isDev: ctx.isDev,
    devServerUrl: ctx.devServerUrl,
  });
  if (region) {
    captureStore.setRegion(region);
    service.refreshRegionValidity();
    return region;
  }
  return null;
}

export function registerCoreIpc(
  ctx: AppContext,
  permissionSync: PermissionSyncHandle,
): void {
  const { logger: log, widgetState: store, capture: captureStore, permissions: perms, screenshotService: service } = ctx;

  ipcMain.handle(IPC_APP_GET_VERSION, (): string => app.getVersion());

  ipcMain.handle(IPC_WIDGET_GET_STATUS, (): WidgetStatus => store.getStatus());

  ipcMain.handle(IPC_WIDGET_SET_STATUS, (_e: IpcMainInvokeEvent, next: unknown): void => {
    if (
      next !== 'ready' &&
      next !== 'paused' &&
      next !== 'permDenied' &&
      next !== 'capturing' &&
      next !== 'captureUnhealthy'
    ) {
      return;
    }
    const prev = store.getStatus();
    if (next !== 'capturing') {
      store.setStatus(next);
    }
    log.info('widget.statusSet', { from: prev, to: next });
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send(IPC_WIDGET_STATUS_CHANGED, next);
    }
  });

  ipcMain.on(IPC_WIDGET_REPORT_POSITION, (_e: IpcMainEvent, pos: unknown): void => {
    if (!isWidgetPosition(pos)) return;
    store.setPosition(pos);
    log.debug('widget.positionReported', { x: pos.x, y: pos.y, displayId: pos.displayId });
  });

  ipcMain.on(IPC_WIDGET_OPEN_CONTEXT_MENU, (event: IpcMainEvent, at: unknown): void => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    const pt = isPoint(at) ? at : { x: 0, y: 0 };
    popupWidgetMenu(win, pt, {
      logger: log,
      status: store.getStatus(),
      loopState: service.getLoopState(),
      permission: perms.getScreenRecordingStatus(),
      openSettings: (): void => {
        openSettingsWindow({ logger: log, isDev: ctx.isDev, devServerUrl: ctx.devServerUrl });
      },
      openSystemSettings: (): void => {
        if (!isMac) {
          log.info('perms.openSystemSettingsSkipped', { trigger: 'menu', reason: 'not-macos' });
          return;
        }
        log.info('perms.openSystemSettings', { trigger: 'menu' });
        void perms.openSystemSettings();
      },
      requestScreenRecording: (): void => {
        void permissionSync.runScreenRecordingRequest('menu');
      },
      captureNow: (): void => {
        void service.captureNow();
      },
      toggleAutoCapture: (): void => {
        if (service.getLoopState().running) service.stop();
        else service.start();
      },
      openRegionPicker: (): void => {
        void runRegionPicker(ctx, captureStore, service);
      },
    });
  });

  ipcMain.handle(IPC_PERMS_GET_SCREEN, () => perms.getScreenRecordingStatus());

  ipcMain.handle(IPC_PERMS_REQUEST_SCREEN, () =>
    permissionSync.runScreenRecordingRequest('rendererInvoke'),
  );

  ipcMain.on(IPC_PERMS_OPEN_SYSTEM_SETTINGS, (): void => {
    if (!isMac) {
      log.info('perms.openSystemSettingsSkipped', {
        trigger: 'rendererInvoke',
        reason: 'not-macos',
      });
      return;
    }
    log.info('perms.openSystemSettings', { trigger: 'rendererInvoke' });
    void perms.openSystemSettings();
  });

  ipcMain.handle(IPC_CAPTURE_GET_LOOP_STATE, (): CaptureLoopState => service.getLoopState());
  ipcMain.handle(IPC_CAPTURE_START, (): void => {
    service.start();
  });
  ipcMain.handle(IPC_CAPTURE_STOP, (): void => {
    service.stop();
  });
  ipcMain.handle(IPC_CAPTURE_NOW, async (): Promise<Screenshot | null> => service.captureNow());
  ipcMain.handle(IPC_CAPTURE_SET_INTERVAL_MS, (_e, ms: unknown): number => {
    if (typeof ms !== 'number') return service.getLoopState().intervalMs;
    return service.setIntervalMs(ms);
  });
  ipcMain.handle(
    IPC_CAPTURE_GET_RECENT,
    (_e, limit: unknown): readonly Screenshot[] => {
      const n = typeof limit === 'number' ? limit : undefined;
      return service.getRecent(n);
    },
  );
  ipcMain.handle(
    IPC_CAPTURE_GET_THUMBNAIL,
    async (_e, id: unknown): Promise<string | null> => {
      if (typeof id !== 'string' || id.length === 0) return null;
      const shot = service.getById(id);
      if (!shot) return null;
      try {
        const buf = await fsp.readFile(shot.filepath);
        return `data:image/jpeg;base64,${buf.toString('base64')}`;
      } catch (err) {
        log.warn('capture.thumbnailReadFailed', {
          id,
          message: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    },
  );

  ipcMain.handle(IPC_REGION_GET, () => captureStore.getRegion());
  ipcMain.handle(IPC_REGION_OPEN_PICKER, async () =>
    runRegionPicker(ctx, captureStore, service),
  );
  ipcMain.handle(IPC_REGION_CLEAR, (): void => {
    captureStore.clearRegion();
    log.info('region.cleared');
    service.refreshRegionValidity();
  });
}
