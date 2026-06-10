/**
 * @file src/main/settingsWindow.ts
 *
 * Why it exists: PRD D8 — Settings is a separate non-modal 640×480
 * BrowserWindow, single-instance (second invocation focuses the existing
 * window rather than duplicating it). Chunk 2 ships only the blank shell so
 * Chunks 5+ have a home for real preferences.
 */

import path from 'node:path';
import { BrowserWindow } from 'electron';
import type { AppLogger } from './logger';
import { buildRendererUrl } from './overlayWindow';
import { SETTINGS_WINDOW_HEIGHT, SETTINGS_WINDOW_WIDTH, APP_NAME } from '../shared/constants';

export interface OpenSettingsWindowDeps {
  logger: AppLogger;
  isDev: boolean;
  devServerUrl?: string;
}

let existing: BrowserWindow | null = null;

/**
 * Open the settings window, or focus it if it's already open. Returns the
 * live `BrowserWindow` for caller-side observation.
 */
export function openSettingsWindow(deps: OpenSettingsWindowDeps): BrowserWindow {
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    deps.logger.debug('settings.focused');
    return existing;
  }

  const preloadPath = path.join(__dirname, '..', 'preload', 'index.js');
  const win = new BrowserWindow({
    width: SETTINGS_WINDOW_WIDTH,
    height: SETTINGS_WINDOW_HEIGHT,
    title: `${APP_NAME} — Settings`,
    show: false,
    backgroundColor: '#0b1220',
    minimizable: true,
    maximizable: false,
    resizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const url = buildRendererUrl({ view: 'settings', isDev: deps.isDev, devServerUrl: deps.devServerUrl });
  if (deps.isDev && url.startsWith('http')) {
    void win.loadURL(url);
  } else {
    const [file, hash] = url.split('#');
    if (!file) throw new Error('settingsWindow: renderer URL missing file component');
    void win.loadFile(file, hash ? { hash } : undefined);
  }

  win.once('ready-to-show', () => {
    win.show();
    deps.logger.info('settings.shown');
  });

  win.on('closed', () => {
    existing = null;
    deps.logger.debug('settings.closed');
  });

  existing = win;
  return win;
}

/**
 * Test/reset hook — drops the module-scoped singleton reference. Not wired
 * from production code, but exported for tests that want a clean slate.
 */
export function __resetSettingsWindowForTests(): void {
  existing = null;
}
