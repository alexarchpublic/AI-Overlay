/**
 * @file src/main/contextMenu.ts
 *
 * Why it exists: PRD D12 (Chunk 2) — the widget's right-click menu is
 * Electron's native `Menu.buildFromTemplate`, built in main, popped up on IPC
 * request from the renderer. The renderer never constructs the menu itself
 * (security + native look-and-feel).
 *
 * Chunk 3 wires real handlers and adds *Set capture region…*. Items are
 * enabled based on the live capture/permission state per PRD §3.3:
 *
 *   - *Capture now* and *Toggle auto-capture* are DISABLED when the region
 *     is missing/invalid OR permission is denied — and carry the tooltip
 *     "Set a capture region first" / "Grant screen recording first"
 *   - *Set capture region…* is enabled whenever permission is granted (even
 *     while capturing — re-drawing replaces the region atomically)
 *   - *Toggle auto-capture* is a checkbox reflecting `loopState.running`
 *
 * Post-Chunk-2 fix: the *Open System Settings…* item shows only when the
 * widget is in `permDenied` (recovery path that replaces the removed
 * first-run modal).
 */

import { app, Menu, type BrowserWindow } from 'electron';
import type { AppLogger } from './logger';
import {
  MENU_ACTION_CAPTURE_NOW,
  MENU_ACTION_OPEN_SETTINGS,
  MENU_ACTION_OPEN_SYSTEM_SETTINGS,
  MENU_ACTION_QUIT,
  MENU_ACTION_REQUEST_SCREEN,
  MENU_ACTION_SET_REGION,
  MENU_ACTION_TOGGLE_AUTO_CAPTURE,
  type MenuAction,
} from '../shared/ipcChannels';
import type { CaptureLoopState, PermissionState, WidgetStatus } from '../shared/types';

export interface BuildContextMenuDeps {
  logger: AppLogger;
  /**
   * Current widget status. Used to decide whether the "Open System
   * Settings…" recovery item is shown — only relevant when permission has
   * been denied. Pass a snapshot at popup time; the menu does not subscribe.
   */
  status: WidgetStatus;
  /** Snapshot of the capture loop state. Drives enabled/checked flags. */
  loopState: CaptureLoopState;
  /** OS permission snapshot. Drives enabled/disabled states + tooltips. */
  permission: PermissionState;
  openSettings: () => void;
  /**
   * Deep-link into macOS Screen Recording privacy pane. Required so the
   * user has a recovery path from the `permDenied` state without restarting
   * the app.
   */
  openSystemSettings: () => void;
  /** Re-probe screen capture (may surface the macOS prompt if status is not-determined). */
  requestScreenRecording: () => void;
  /** Trigger a one-shot capture. Hooked to `screenshotService.captureNow()`. */
  captureNow: () => void;
  /** Start or stop the auto-capture loop, per the current toggle state. */
  toggleAutoCapture: () => void;
  /** Open the region picker. Hooked to `regionPicker.openRegionPicker()`. */
  openRegionPicker: () => void;
}

/**
 * Build the widget's right-click menu. Exported so tests can assert on the
 * template shape without popping up a real menu.
 */
export function buildWidgetMenuTemplate(
  deps: BuildContextMenuDeps,
): Electron.MenuItemConstructorOptions[] {
  const fire = (action: MenuAction): (() => void) => {
    return () => {
      deps.logger.info('widget.menuAction', { action });
      switch (action) {
        case MENU_ACTION_OPEN_SETTINGS:
          deps.openSettings();
          return;
        case MENU_ACTION_OPEN_SYSTEM_SETTINGS:
          deps.openSystemSettings();
          return;
        case MENU_ACTION_REQUEST_SCREEN:
          deps.requestScreenRecording();
          return;
        case MENU_ACTION_CAPTURE_NOW:
          deps.captureNow();
          return;
        case MENU_ACTION_TOGGLE_AUTO_CAPTURE:
          deps.toggleAutoCapture();
          return;
        case MENU_ACTION_SET_REGION:
          deps.openRegionPicker();
          return;
        case MENU_ACTION_QUIT:
          app.quit();
          return;
      }
    };
  };

  const permGranted = deps.permission === 'granted' || deps.permission === 'restricted';
  const captureEnabled = permGranted && deps.loopState.regionValid;
  const tooltip = !permGranted
    ? 'Grant screen recording first'
    : !deps.loopState.regionValid
      ? 'Set a capture region first'
      : undefined;

  const tooltipSpread = tooltip !== undefined ? { toolTip: tooltip } : {};
  const setRegionTooltipSpread = !permGranted
    ? { toolTip: 'Grant screen recording first' }
    : {};

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Capture now',
      enabled: captureEnabled,
      ...tooltipSpread,
      click: fire(MENU_ACTION_CAPTURE_NOW),
    },
    {
      label: 'Toggle auto-capture',
      type: 'checkbox',
      checked: deps.loopState.running,
      enabled: captureEnabled,
      ...tooltipSpread,
      click: fire(MENU_ACTION_TOGGLE_AUTO_CAPTURE),
    },
    {
      label: 'Set capture region…',
      enabled: permGranted,
      ...setRegionTooltipSpread,
      click: fire(MENU_ACTION_SET_REGION),
    },
    { type: 'separator' },
    { label: 'Open Settings…', click: fire(MENU_ACTION_OPEN_SETTINGS) },
  ];

  if (!permGranted) {
    template.push(
      { type: 'separator' },
      {
        label: 'Request screen recording access…',
        click: fire(MENU_ACTION_REQUEST_SCREEN),
      },
      {
        label: 'Open System Settings…',
        click: fire(MENU_ACTION_OPEN_SYSTEM_SETTINGS),
      },
    );
  }

  template.push(
    { type: 'separator' },
    { label: 'Quit Arch Public AI Overlay', role: 'quit', click: fire(MENU_ACTION_QUIT) },
  );

  return template;
}

/**
 * Popup the widget context menu at a given cursor position over a given
 * window. `x`/`y` are window-relative pixel coordinates sent by the renderer.
 */
export function popupWidgetMenu(
  window: BrowserWindow,
  at: { x: number; y: number },
  deps: BuildContextMenuDeps,
): void {
  const menu = Menu.buildFromTemplate(buildWidgetMenuTemplate(deps));
  menu.popup({
    window,
    x: Math.round(at.x),
    y: Math.round(at.y),
  });
}
