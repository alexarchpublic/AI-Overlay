/**
 * @file src/main/regionPicker.ts
 *
 * Why it exists: PRD §0 D6 / D16 — the region picker. One transparent,
 * frameless, fullscreen `BrowserWindow` per connected display so the user
 * can draw a rect on whichever monitor TradingView is on. ESC cancels,
 * Enter confirms, mouse drag draws.
 *
 * The picker controller is in main, the draw UX is in
 * `renderer/regionPicker/RegionPicker.tsx`. The two halves communicate over
 * `IPC_REGION_PICKER_CONFIRM` and `IPC_REGION_PICKER_CANCEL` — channels that
 * are NOT exposed on the public `window.api.region.*` surface (those are
 * for callers that *open* the picker, not the picker itself).
 *
 * `openRegionPicker()` returns a promise that resolves with the chosen
 * `CaptureRegion` or `null` on cancel. Internally a single in-flight picker
 * session is tracked so a second call while one is open is a no-op (the
 * second promise resolves with the first's result).
 *
 * Windows note (Chunk 7 / hardware feedback): the chat window's
 * blur→moveTop keep-alive will yank the chat chrome above the picker unless
 * we suppress it for the session and hide the chat while drawing. See
 * `setChatRaiseSuppressed` in `chatWindow.ts`.
 */

import path from 'node:path';
import { BrowserWindow, app, ipcMain, screen, type IpcMainEvent } from 'electron';
import type { AppLogger } from './logger';
import { isWindows } from './platform';
import {
  hideChatWindowTemporarily,
  restoreChatWindowAfterTemporaryHide,
  setChatRaiseSuppressed,
} from './chatWindow';
import type { CaptureRegion } from '../shared/types';
import {
  IPC_REGION_PICKER_CANCEL,
  IPC_REGION_PICKER_CONFIRM,
} from '../shared/ipcChannels';
import { VITE_DEV_SERVER_PORT } from '../shared/constants';
import { buildCaptureRegion, type DisplayInfoFull } from './displayUtils';
import { parsePickerDisplayIdFromArgv } from '../shared/pickerDisplayId';

export interface OpenRegionPickerDeps {
  logger: AppLogger;
  isDev: boolean;
  devServerUrl?: string;
}

interface PickerSession {
  windows: Map<number, BrowserWindow>;
  resolve: (region: CaptureRegion | null) => void;
  cleanup: () => void;
}

let activeSession: PickerSession | null = null;

/**
 * Open the region picker. Resolves with the confirmed `CaptureRegion` (one
 * region only — first window to confirm wins) or `null` if the user pressed
 * ESC on any window. Idempotent: a second call while a picker is already
 * open returns the same pending promise.
 */
export function openRegionPicker(deps: OpenRegionPickerDeps): Promise<CaptureRegion | null> {
  if (activeSession) {
    deps.logger.debug('region.pickerAlreadyOpen');
    return new Promise((resolve) => {
      const prev = activeSession;
      if (!prev) {
        resolve(null);
        return;
      }
      const originalResolve = prev.resolve;
      prev.resolve = (r) => {
        originalResolve(r);
        resolve(r);
      };
    });
  }

  return new Promise<CaptureRegion | null>((resolve) => {
    const displays = screen.getAllDisplays();
    if (displays.length === 0) {
      deps.logger.error('region.pickerNoDisplays');
      resolve(null);
      return;
    }

    // Keep the chat always-on-top keep-alive from covering the picker, and
    // hide the chat frame for the duration of the draw session.
    setChatRaiseSuppressed(true);
    const chatWasHidden = hideChatWindowTemporarily();

    const windows = new Map<number, BrowserWindow>();
    const cleanup = (): void => {
      for (const w of windows.values()) {
        if (!w.isDestroyed()) w.close();
      }
      windows.clear();
      ipcMain.removeListener(IPC_REGION_PICKER_CONFIRM, onConfirm);
      ipcMain.removeListener(IPC_REGION_PICKER_CANCEL, onCancel);
      activeSession = null;
      setChatRaiseSuppressed(false);
      if (chatWasHidden) {
        restoreChatWindowAfterTemporaryHide();
      }
    };

    function onConfirm(_event: IpcMainEvent, payload: unknown): void {
      if (!isConfirmPayload(payload)) {
        deps.logger.warn('region.pickerConfirmInvalid', { payload });
        return;
      }
      const display = screen.getAllDisplays().find((d) => d.id === payload.displayId);
      if (!display) {
        deps.logger.warn('region.pickerConfirmDisplayMissing', { displayId: payload.displayId });
        return;
      }
      const info: DisplayInfoFull = {
        id: display.id,
        scaleFactor: display.scaleFactor,
        bounds: {
          x: display.bounds.x,
          y: display.bounds.y,
          width: display.bounds.width,
          height: display.bounds.height,
        },
        label: display.label,
      };
      const region = buildCaptureRegion(info, payload.rect, Date.now());
      deps.logger.info('region.set', {
        regionId: region.id,
        displayId: region.displayId,
        scaleFactor: region.scaleFactor,
        logical: { x: region.x, y: region.y, w: region.w, h: region.h },
        physical: { px: region.px, py: region.py, pw: region.pw, ph: region.ph },
      });
      cleanup();
      resolve(region);
    }

    function onCancel(): void {
      deps.logger.info('region.cancelled');
      cleanup();
      resolve(null);
    }

    ipcMain.on(IPC_REGION_PICKER_CONFIRM, onConfirm);
    ipcMain.on(IPC_REGION_PICKER_CANCEL, onCancel);

    activeSession = {
      windows,
      resolve,
      cleanup,
    };

    for (const d of displays) {
      const win = createPickerWindow(d, deps);
      windows.set(d.id, win);
    }

    if (isWindows) {
      // Re-assert z-order after the context-menu / chat blur cascade settles.
      const reassertTop = (): void => {
        for (const w of windows.values()) {
          if (w.isDestroyed()) continue;
          w.setAlwaysOnTop(true);
          w.moveTop();
        }
      };
      setTimeout(reassertTop, 50);
      setTimeout(reassertTop, 550);
    }

    deps.logger.info('region.pickerOpened', { displayCount: displays.length });
  });
}

/**
 * Build one transparent fullscreen frameless picker window for a single
 * display. Per PRD D6 the window is `'screen-saver'` level so it stays
 * above TradingView; click-through is OFF (the user must be able to draw),
 * so we rely on transparency for the "dim everything but my draw" effect.
 */
function createPickerWindow(
  display: Electron.Display,
  deps: OpenRegionPickerDeps,
): BrowserWindow {
  const preloadPath = path.join(__dirname, '..', 'preload', 'index.js');
  const win = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    focusable: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    show: false,
    ...(isWindows ? {} : { enableLargerThanScreen: true }),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Pass the displayId through so the renderer knows which window it is
      // when it calls `pickerConfirm`. additionalArguments are exposed on
      // `process.argv` inside the preload sandbox (and as a fallback when
      // the URL hash/query fails to round-trip on packaged Windows).
      additionalArguments: [`--region-picker-display-id=${String(display.id)}`],
    },
  });

  if (isWindows) {
    win.setAlwaysOnTop(true);
  } else {
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  const url = buildPickerUrl({
    displayId: display.id,
    isDev: deps.isDev,
    devServerUrl: deps.devServerUrl,
  });

  if (deps.isDev && url.startsWith('http')) {
    void win.loadURL(url);
  } else {
    const [file, hash] = url.split('#');
    if (!file) throw new Error('regionPicker: renderer URL missing file component');
    void win.loadFile(file, hash ? { hash } : undefined);
  }

  win.once('ready-to-show', () => {
    win.setBounds(display.bounds); // re-assert
    win.show();
    if (isWindows) {
      app.focus({ steal: true });
      win.setAlwaysOnTop(true);
      win.moveTop();
    }
    win.focus();
  });

  return win;
}

/**
 * Build the URL the picker window loads. Shares the renderer bundle with
 * the overlay + settings windows; disambiguates with `?view=regionPicker`
 * (dev) or `#view=regionPicker` (prod loadFile), plus `displayId=` so the
 * renderer can echo it back on confirm.
 */
function buildPickerUrl(opts: {
  displayId: number;
  isDev: boolean;
  devServerUrl?: string;
}): string {
  if (opts.isDev) {
    const base = opts.devServerUrl ?? `http://localhost:${String(VITE_DEV_SERVER_PORT)}`;
    return `${base}/?view=regionPicker&displayId=${String(opts.displayId)}`;
  }
  const htmlPath = path.join(__dirname, '..', 'renderer', 'index.html');
  return `${htmlPath}#view=regionPicker&displayId=${String(opts.displayId)}`;
}

interface ConfirmPayload {
  displayId: number;
  rect: { x: number; y: number; w: number; h: number };
}

function isConfirmPayload(value: unknown): value is ConfirmPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.displayId !== 'number') return false;
  const r = v.rect;
  if (typeof r !== 'object' || r === null) return false;
  const rr = r as Record<string, unknown>;
  return (
    typeof rr.x === 'number' &&
    typeof rr.y === 'number' &&
    typeof rr.w === 'number' &&
    typeof rr.h === 'number' &&
    rr.w > 0 &&
    rr.h > 0
  );
}

/**
 * Test/reset hook — drops the module-scoped picker session reference.
 * Production never calls this; tests use it between specs.
 */
export function __resetRegionPickerForTests(): void {
  if (activeSession) {
    activeSession.cleanup();
  }
  activeSession = null;
}

// Re-export for callers/tests that want the argv parser without importing
// the dedicated module.
export { parsePickerDisplayIdFromArgv };
