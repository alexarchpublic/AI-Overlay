/**
 * @file src/main/index.ts
 *
 * Electron main-process entry. Delegates bootstrap, IPC, and chat orchestration
 * to focused modules; this file owns app lifecycle hooks only.
 */

import { app } from 'electron';
import { bootstrapApp, shutdownApp } from './bootstrap';
import type { AppContext } from './appContext';
import type { PermissionSyncHandle } from './permissionSync';

let ctx: AppContext | null = null;
let permissionSync: PermissionSyncHandle | null = null;

void app.whenReady().then(async () => {
  ctx = await bootstrapApp((_ctx, ps) => {
    permissionSync = ps;
  });
});

app.on('window-all-closed', () => {
  ctx?.logger.info('app.quit', { reason: 'window-all-closed' });
  app.quit();
});

app.on('before-quit', () => {
  if (ctx && permissionSync) {
    shutdownApp(ctx, permissionSync);
  }
});
