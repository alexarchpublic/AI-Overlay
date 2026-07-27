/**
 * @file src/main/trayService.ts
 *
 * Why it exists: Chunk 7 Phase 1 — Windows has no menu bar widget/pill, so
 * the app needs a system-tray icon as the entry point back to the chat
 * overlay when it's been dismissed behind other always-on-top windows
 * (screen-share clients in particular). macOS and Linux keep their existing
 * entry points (the chat window itself + Dock), so this service is a no-op
 * everywhere except Windows.
 *
 * Follows the injectable-deps pattern used by `permissions.ts` /
 * `widgetFlash.ts`: no `electron` import at module scope so this file stays
 * importable from Vitest without a real Electron binary. Callers (only
 * `bootstrap.ts` in production) pass in the already-imported `Tray` /
 * `Menu` / `nativeImage` constructors plus a handful of callback deps.
 */

import type { AppLogger } from './logger';

export interface TrayServiceDeps {
  Tray: typeof import('electron').Tray;
  Menu: typeof import('electron').Menu;
  nativeImage: typeof import('electron').nativeImage;
  logger: AppLogger;
  iconPath: string;
  isWindows: boolean;
  onShowOverlay: () => void;
  onToggleAutoCapture: () => void;
  onOpenSettings: () => void;
  onExit: () => void;
}

export interface TrayServiceHandle {
  destroy(): void;
}

/**
 * Build the tray context-menu template. Exported separately so unit tests
 * can assert on labels/click wiring without constructing a real `Menu`.
 */
export function buildTrayMenuTemplate(
  deps: Pick<TrayServiceDeps, 'logger' | 'onShowOverlay' | 'onToggleAutoCapture' | 'onOpenSettings' | 'onExit'>,
): Electron.MenuItemConstructorOptions[] {
  const fire = (action: string, handler: () => void): (() => void) => {
    return () => {
      deps.logger.info('tray.action', { action });
      handler();
    };
  };

  return [
    { label: 'Show Overlay', click: fire('showOverlay', deps.onShowOverlay) },
    { label: 'Toggle auto-capture', click: fire('toggleAutoCapture', deps.onToggleAutoCapture) },
    { label: 'Settings…', click: fire('openSettings', deps.onOpenSettings) },
    { type: 'separator' },
    { label: 'Exit', click: fire('exit', deps.onExit) },
  ];
}

/**
 * Create the Windows system-tray icon. Returns `null` (and does nothing) on
 * every other platform — there is no tray surface to manage there.
 */
export function createTrayService(deps: TrayServiceDeps): TrayServiceHandle | null {
  if (!deps.isWindows) return null;

  const icon = deps.nativeImage.createFromPath(deps.iconPath);
  const tray = new deps.Tray(icon);
  tray.setToolTip('Arch Public AI Overlay');

  const menu = deps.Menu.buildFromTemplate(buildTrayMenuTemplate(deps));
  tray.setContextMenu(menu);

  tray.on('click', () => {
    deps.logger.info('tray.action', { action: 'showOverlay' });
    deps.onShowOverlay();
  });

  deps.logger.info('tray.created', { iconPath: deps.iconPath });

  return {
    destroy(): void {
      tray.destroy();
      deps.logger.info('tray.destroyed');
    },
  };
}
