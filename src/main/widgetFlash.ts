/**
 * @file src/main/widgetFlash.ts
 *
 * Transient 'capturing' flash broadcast to renderer windows (PRD D11).
 */

import { BrowserWindow } from 'electron';
import type { AppContext } from './appContext';
import { IPC_WIDGET_STATUS_CHANGED } from '../shared/ipcChannels';
import type { WidgetStatus } from '../shared/types';

let flashResetTimer: NodeJS.Timeout | null = null;

export function flashWidgetCapturing(ctx: AppContext): void {
  const store = ctx.widgetState;
  const persisted = store.getStatus();
  if (persisted !== 'ready' && persisted !== 'capturing') return;

  if (flashResetTimer) {
    clearTimeout(flashResetTimer);
    flashResetTimer = null;
  }
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(IPC_WIDGET_STATUS_CHANGED, 'capturing');
  }
  flashResetTimer = setTimeout(() => {
    const after = store.getStatus();
    const next: WidgetStatus = after === 'capturing' ? 'ready' : after;
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send(IPC_WIDGET_STATUS_CHANGED, next);
    }
    flashResetTimer = null;
  }, 600);
}
