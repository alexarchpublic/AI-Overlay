/**
 * @file src/main/chatWindow.ts
 *
 * Why it exists: PRD §3.5 — frameless 480×640 always-on-top chat window.
 * Replaces the overlay pill as the app's primary floating surface. Opens on
 * launch, restores/clamps its last-known position, and persists on drag-end.
 *
 * Single-instance: a second open call focuses the existing window.
 */

import path from 'node:path';
import { BrowserWindow, screen, type Display } from 'electron';
import type { AppLogger } from './logger';
import { buildRendererUrl } from './overlayWindow';
import {
  clampPosition,
  type ClampContext,
  type DisplayInfo,
  type WidgetStateStore,
} from './widgetState';
import {
  CHAT_ANCHOR_GAP_PX,
  CHAT_WINDOW_HEIGHT,
  CHAT_WINDOW_WIDTH,
} from '../shared/aiConstants';
import { APP_NAME, WIDGET_DEFAULT_INSET } from '../shared/constants';
import type { Bounds } from '../shared/types';

export interface OpenChatWindowDeps {
  logger: AppLogger;
  isDev: boolean;
  devServerUrl?: string;
  /** Restores and persists window position via the shared `widget.position` key. */
  state: WidgetStateStore;
  /** Called when the window emits `closed` so callers can release the singleton. */
  onClosed?: () => void;
}

let existing: BrowserWindow | null = null;

/** Whether a chat window is currently open. Cheap read for IPC handlers. */
export function isChatWindowOpen(): boolean {
  return existing !== null && !existing.isDestroyed();
}

/**
 * Idempotently focus the live window if one exists.
 */
export function focusChatWindow(): boolean {
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return true;
  }
  return false;
}

/** Idempotent close. No-op when no window is open. */
export function closeChatWindow(reason: 'user' | 'toggle' | 'shutdown'): void {
  if (existing && !existing.isDestroyed()) {
    const w = existing;
    existing = null;
    try {
      w.close();
    } catch {
      /* noop */
    }
    return;
  }
  void reason;
}

/**
 * Open the chat window or focus it if already open. Returns the live
 * `BrowserWindow` for caller-side observation.
 */
export function openChatWindow(deps: OpenChatWindowDeps): BrowserWindow {
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    deps.logger.debug('chat.focused');
    return existing;
  }

  const ctx = buildChatClampContext();
  const clamp = clampPosition(deps.state.getPosition(), ctx);
  if (clamp.clamped) {
    const from = deps.state.getPosition();
    deps.logger.info('chat.positionClamped', {
      reason: clamp.reason,
      from: from ? { x: from.x, y: from.y, displayId: from.displayId } : null,
      to: {
        x: clamp.position.x,
        y: clamp.position.y,
        displayId: clamp.position.displayId,
      },
    });
    deps.state.setPosition(clamp.position);
  }

  const preloadPath = path.join(__dirname, '..', 'preload', 'index.js');
  const { x, y } = clamp.position;

  const win = new BrowserWindow({
    width: CHAT_WINDOW_WIDTH,
    height: CHAT_WINDOW_HEIGHT,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    roundedCorners: false,
    backgroundColor: '#00000000',
    title: `${APP_NAME} — Chat`,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const url = buildRendererUrl({
    view: 'chat',
    isDev: deps.isDev,
    ...(deps.devServerUrl !== undefined ? { devServerUrl: deps.devServerUrl } : {}),
  });
  if (deps.isDev && url.startsWith('http')) {
    void win.loadURL(url);
  } else {
    const [file, hash] = url.split('#');
    if (!file) throw new Error('chatWindow: renderer URL missing file component');
    void win.loadFile(file, hash ? { hash } : undefined);
  }

  win.once('ready-to-show', () => {
    win.show();
    deps.logger.info('chat.opened', { x, y });
  });

  win.on('moved', () => {
    const [mx, my] = win.getPosition();
    if (typeof mx !== 'number' || typeof my !== 'number') return;
    const displayId = screen.getDisplayNearestPoint({ x: mx, y: my }).id;
    deps.state.setPosition({ x: mx, y: my, displayId });
    deps.logger.debug('chat.positionPersisted', { x: mx, y: my, displayId });
  });

  win.on('closed', () => {
    if (existing === win) existing = null;
    deps.logger.info('chat.closed');
    deps.onClosed?.();
  });

  existing = win;
  return win;
}

/**
 * Test/reset hook — drops the module-scoped singleton reference. Not
 * wired from production code, but exported for tests that want a clean slate.
 */
export function __resetChatWindowForTests(): void {
  existing = null;
}

function buildChatClampContext(): ClampContext {
  const displays: DisplayInfo[] = screen.getAllDisplays().map((d) => ({
    id: d.id,
    workArea: d.workArea,
  }));
  return {
    windowWidth: CHAT_WINDOW_WIDTH,
    windowHeight: CHAT_WINDOW_HEIGHT,
    defaultInset: WIDGET_DEFAULT_INSET,
    displays,
    primaryId: screen.getPrimaryDisplay().id,
  };
}

// ---------------------------------------------------------------------------
// Anchor math — retained for unit tests; no longer used at open time.
// ---------------------------------------------------------------------------

interface ChatAnchor {
  x: number;
  y: number;
  anchorEdge: 'left' | 'right' | 'top' | 'bottom' | 'center';
}

/**
 * Decide the chat window's top-left position relative to a widget bounds
 * rect. Exported for tests only — production restores saved position instead.
 */
export function computeAnchor(
  anchorBounds?: Bounds,
  displayList?: Display[],
): ChatAnchor {
  const displays = displayList ?? screen.getAllDisplays();
  const primary = displayList?.[0] ?? screen.getPrimaryDisplay();

  if (!anchorBounds) {
    const wa = primary.workArea;
    return {
      x: Math.round(wa.x + (wa.width - CHAT_WINDOW_WIDTH) / 2),
      y: Math.round(wa.y + (wa.height - CHAT_WINDOW_HEIGHT) / 2),
      anchorEdge: 'center',
    };
  }

  const cx = anchorBounds.x + anchorBounds.width / 2;
  const cy = anchorBounds.y + anchorBounds.height / 2;
  const display =
    displays.find((d) => containsPoint(d.workArea, { x: cx, y: cy })) ?? primary;
  const wa = display.workArea;

  const distLeft = cx - wa.x;
  const distRight = wa.x + wa.width - cx;
  const distTop = cy - wa.y;
  const distBottom = wa.y + wa.height - cy;
  const min = Math.min(distLeft, distRight, distTop, distBottom);

  let x: number;
  let y: number;
  let anchorEdge: ChatAnchor['anchorEdge'];

  if (min === distLeft) {
    x = anchorBounds.x + anchorBounds.width + CHAT_ANCHOR_GAP_PX;
    y = anchorBounds.y;
    anchorEdge = 'left';
  } else if (min === distRight) {
    x = anchorBounds.x - CHAT_WINDOW_WIDTH - CHAT_ANCHOR_GAP_PX;
    y = anchorBounds.y;
    anchorEdge = 'right';
  } else if (min === distTop) {
    x = anchorBounds.x;
    y = anchorBounds.y + anchorBounds.height + CHAT_ANCHOR_GAP_PX;
    anchorEdge = 'top';
  } else {
    x = anchorBounds.x;
    y = anchorBounds.y - CHAT_WINDOW_HEIGHT - CHAT_ANCHOR_GAP_PX;
    anchorEdge = 'bottom';
  }

  if (x + CHAT_WINDOW_WIDTH > wa.x + wa.width) x = wa.x + wa.width - CHAT_WINDOW_WIDTH;
  if (x < wa.x) x = wa.x;
  if (y + CHAT_WINDOW_HEIGHT > wa.y + wa.height) y = wa.y + wa.height - CHAT_WINDOW_HEIGHT;
  if (y < wa.y) y = wa.y;

  return { x: Math.round(x), y: Math.round(y), anchorEdge };
}

function containsPoint(rect: Bounds, p: { x: number; y: number }): boolean {
  return (
    p.x >= rect.x &&
    p.y >= rect.y &&
    p.x < rect.x + rect.width &&
    p.y < rect.y + rect.height
  );
}
