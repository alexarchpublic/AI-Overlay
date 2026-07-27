/**
 * @file src/main/index.ts
 *
 * Electron main-process entry. Delegates bootstrap, IPC, and chat orchestration
 * to focused modules; this file owns app lifecycle hooks only.
 */

import { app, Menu } from 'electron';
import { bootstrapApp, shutdownApp } from './bootstrap';
import type { AppContext } from './appContext';
import type { PermissionSyncHandle } from './permissionSync';

let ctx: AppContext | null = null;
let permissionSync: PermissionSyncHandle | null = null;

void app.whenReady().then(async () => {
  // No native app menu — the widget's own context menu is the only menu
  // surface (PRD §3.8 B8). On Windows this also removes the default
  // File/Edit/View bar that would otherwise appear on frameless windows.
  Menu.setApplicationMenu(null);
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
