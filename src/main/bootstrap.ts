/**
 * @file src/main/bootstrap.ts
 *
 * Electron main-process bootstrap sequence. Constructs `AppContext`, wires
 * services, registers IPC, and opens the primary chat window.
 */

import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { ulid } from 'ulid';
import sharp from 'sharp';
import { BrowserWindow, Menu, Tray, app, nativeImage } from 'electron';
import type { AppContext } from './appContext';
import { createAiStore } from './aiStore';
import { createCaptureStore, migrateAutoCaptureKey } from './captureStore';
import { closeChatWindow, createChatLifecycle } from './chatLifecycle';
import { raiseChatWindow } from './chatWindow';
import { createChatOrchestrator } from './chatOrchestrator';
import { createConversationStore } from './conversationStore';
import { createGeminiService } from './geminiService';
import { createKnowledgeStore } from './knowledgeStoreFactory';
import { createKnowledgeStoreState } from './knowledgeStoreState';
import { createAppLogger, registerRendererLogBridge, type AppLogger } from './logger';
import { createPermissionSync, type PermissionSyncHandle } from './permissionSync';
import { createPermissionsHelper } from './permissions';
import { isWindows, platformInfo } from './platform';
import { createScreenshotService } from './screenshotService';
import { openSettingsWindow } from './settingsWindow';
import { createTrayService, type TrayServiceHandle } from './trayService';
import { createUpdaterService, type UpdaterServiceHandle } from './updaterService';
import { createWidgetStateStore } from './widgetState';
import { flashWidgetCapturing } from './widgetFlash';
import { createOptimizerStore } from './optimizerStore';
import { createOptimizerMcpService } from './optimizerMcpService';
import { createOptimizerJobTracker } from './optimizerJobTracker';
import { registerCoreIpc } from './ipc/registerCoreIpc';
import { registerChatAiIpc } from './ipc/registerChatAiIpc';
import { registerOptimizerIpc } from './ipc/registerOptimizerIpc';
import { registerUpdateIpc } from './ipc/registerUpdateIpc';
import { getCurrentDisplays, isRegionStillValid } from './displayUtils';
import {
  defaultSharedConfigDir,
  runProvisioning,
} from './provisioning';
import { CAPTURE_TEMP_SUBDIR, VITE_DEV_SERVER_PORT } from '../shared/constants';
import {
  IPC_CAPTURE_CAPTURED,
  IPC_CAPTURE_LOOP_STATE_CHANGED,
  IPC_WIDGET_STATUS_CHANGED,
} from '../shared/ipcChannels';
import type { WidgetStatus } from '../shared/types';

let trayHandle: TrayServiceHandle | null = null;
let updaterHandle: UpdaterServiceHandle | null = null;

/**
 * Resolve the tray icon path. Tries the packaged `build/icon.ico` relative
 * to the app root first (works for `npm run dev` and a packaged app whose
 * `app.getAppPath()` resolves correctly), then falls back to a path
 * relative to this compiled file (`dist/main/trayService.js` → `../../build`)
 * for alpha builds where `getAppPath()` may point inside an asar archive.
 */
function resolveTrayIconPath(): string {
  const candidates = [
    path.join(app.getAppPath(), 'build', 'icon.ico'),
    path.join(__dirname, '..', '..', 'build', 'icon.ico'),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? path.join(app.getAppPath(), 'build', 'icon.ico');
}

export function registerProcessTraps(log: AppLogger): void {
  process.on('unhandledRejection', (reason) => {
    log.error('process.unhandledRejection', {
      message: reason instanceof Error ? reason.message : String(reason),
    });
  });
  process.on('uncaughtException', (err) => {
    log.error('process.uncaughtException', {
      message: err.message,
      stack: err.stack,
    });
  });
}

export async function bootstrapApp(
  onReady?: (ctx: AppContext, permissionSync: PermissionSyncHandle) => void,
): Promise<AppContext> {
  const isDev = !app.isPackaged;
  const devServerUrl =
    process.env.VITE_DEV_SERVER_URL ?? `http://localhost:${String(VITE_DEV_SERVER_PORT)}`;

  const logger = createAppLogger({
    baseDir: app.getPath('userData'),
    pretty: !app.isPackaged,
  });
  registerRendererLogBridge(logger);
  registerProcessTraps(logger);

  logger.info('app.ready', {
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
  });

  const widgetState = await createWidgetStateStore();
  const { store: rawCaptureStore, wrapper: capture } = await createCaptureStore();
  const migration = migrateAutoCaptureKey(rawCaptureStore);
  if (migration.migrated) {
    logger.info('migration.captureAutoCapture', {
      from: 'widget.autoCapture',
      to: 'capture.autoCapture',
      value: migration.value,
    });
  } else {
    logger.debug('migration.captureAutoCaptureSkipped', { reason: migration.skipReason });
  }

  const permissions = createPermissionsHelper({
    onTransition: (from, to): void => {
      logger.info('perms.screen.transition', { from, to });
    },
  });

  const initialPerm = permissions.getScreenRecordingStatus();
  logger.info('perms.screen.initial', { state: initialPerm });
  logger.info('perms.screen.diagnostics', {
    execPath: process.execPath,
    appName: app.getName(),
    isPackaged: app.isPackaged,
    devElectronBundleHint: app.isPackaged
      ? undefined
      : path.join(app.getAppPath(), 'node_modules', 'electron', 'dist', 'Electron.app'),
  });

  const chatInflight = { current: null as AbortController | null };
  const conversationStore = createConversationStore({ logger });
  const { wrapper: aiStore } = await createAiStore();
  const optimizerStore = await createOptimizerStore();

  const capturesDir = path.join(app.getPath('temp'), CAPTURE_TEMP_SUBDIR);
  fs.mkdirSync(capturesDir, { recursive: true });

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const electronModule = require('electron') as typeof import('electron');
  const screenshotService = createScreenshotService({
    logger,
    store: capture,
    desktopCapturer: {
      getSources: async (opts) => {
        const sources = await electronModule.desktopCapturer.getSources({
          types: [...opts.types],
          ...(opts.thumbnailSize ? { thumbnailSize: opts.thumbnailSize } : {}),
        });
        return sources.map((s) => ({
          id: s.id,
          display_id: s.display_id,
          thumbnail: {
            toPNG: () => s.thumbnail.toPNG(),
            getSize: () => s.thumbnail.getSize(),
          },
        }));
      },
    },
    sharp,
    fs: {
      mkdir: (dir, opts) => fsp.mkdir(dir, opts),
      readdir: (dir) => fsp.readdir(dir),
      stat: (p) =>
        fsp.stat(p).then((s) => ({
          mtimeMs: s.mtimeMs,
          isFile: () => s.isFile(),
        })),
      unlink: (p) => fsp.unlink(p),
      rename: (from, to) => fsp.rename(from, to),
    },
    permissions: {
      isGranted: () => {
        const s = permissions.getScreenRecordingStatus();
        return s === 'granted' || s === 'restricted';
      },
    },
    getDisplays: getCurrentDisplays,
    capturesDir,
    newId: () => ulid(),
  });

  const { wrapper: knowledgeStoreWrapper } = await createKnowledgeStoreState();

  const ctx: AppContext = {
    logger,
    widgetState,
    capture,
    screenshotService,
    permissions,
    knowledgeStore: null,
    knowledgeStoreState: knowledgeStoreWrapper,
    conversationStore,
    geminiService: null,
    aiStore,
    chatOrchestrator: null,
    chatInflight,
    chatState: 'idle',
    isDev,
    devServerUrl,
    appVersion: app.getVersion(),
    userDataPath: app.getPath('userData'),
    updaterService: null,
    optimizerStore,
    optimizerService: null,
    optimizerJobTracker: null,
  };

  const permissionSync = createPermissionSync(ctx);
  permissionSync.syncWidgetStatus('boot');
  permissionSync.startPollIfNeeded(initialPerm);
  onReady?.(ctx, permissionSync);

  screenshotService.onCaptured((s) => {
    flashWidgetCapturing(ctx);
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send(IPC_CAPTURE_CAPTURED, s);
    }
  });
  screenshotService.onLoopStateChanged((s) => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send(IPC_CAPTURE_LOOP_STATE_CHANGED, s);
    }
    if (!s.running && permissions.getScreenRecordingStatus() !== 'granted') {
      const next: WidgetStatus = 'permDenied';
      if (widgetState.getStatus() !== next) {
        widgetState.setStatus(next);
        for (const w of BrowserWindow.getAllWindows()) {
          w.webContents.send(IPC_WIDGET_STATUS_CHANGED, next);
        }
      }
    }
  });
  screenshotService.onCaptureHealthChanged((healthy) => {
    const current = widgetState.getStatus();
    if (!healthy) {
      if (current !== 'captureUnhealthy' && current !== 'permDenied' && current !== 'paused') {
        widgetState.setStatus('captureUnhealthy');
        for (const w of BrowserWindow.getAllWindows()) {
          w.webContents.send(IPC_WIDGET_STATUS_CHANGED, 'captureUnhealthy');
        }
      }
    } else if (current === 'captureUnhealthy') {
      widgetState.setStatus('ready');
      for (const w of BrowserWindow.getAllWindows()) {
        w.webContents.send(IPC_WIDGET_STATUS_CHANGED, 'ready');
      }
    }
  });

  registerCoreIpc(ctx, permissionSync);

  try {
    ctx.knowledgeStore = await createKnowledgeStore({
      backend: knowledgeStoreWrapper.getBackend(),
      logger,
      isDev,
    });
    logger.info('knowledge.ready', { contentHash: await ctx.knowledgeStore.version() });
  } catch (err) {
    logger.warn('knowledge.initFailed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  if (ctx.knowledgeStore) {
    ctx.geminiService = createGeminiService({
      logger,
      knowledgeStore: ctx.knowledgeStore,
      getApiKey: () => aiStore.getApiKey(),
      getModel: () => aiStore.getModel(),
      recordCall: (rec) => {
        aiStore.appendCall(rec);
      },
    });
  } else {
    logger.warn('gemini.knowledgeStoreMissing', {
      reason: 'Knowledge store failed to initialize — chat sends will fail',
    });
  }

  const chatLifecycle = createChatLifecycle(ctx, permissionSync);

  if (ctx.geminiService && ctx.knowledgeStore) {
    ctx.chatOrchestrator = createChatOrchestrator({
      logger,
      aiStore,
      conversationStore,
      geminiService: ctx.geminiService,
      knowledgeStore: ctx.knowledgeStore,
      screenshotService,
      chatInflight,
      getActiveAlgorithm: () => knowledgeStoreWrapper.getActiveAlgorithm(),
      emit: {
        turnAppended: (turn) => {
          chatLifecycle.emitTurnAppended(turn);
        },
        turnDropped: (turnId) => {
          chatLifecycle.emitTurnDropped(turnId);
        },
        stateChanged: (next) => {
          chatLifecycle.setChatState(next);
        },
        error: (err) => {
          chatLifecycle.emitChatError(err);
        },
      },
    });
  }

  registerChatAiIpc(ctx, chatLifecycle);

  // First-launch team-config provisioning (Chunk 7 D3/D6). Uses the shared
  // electron-store handle so `provisioning.completed` lands in the same
  // config file as capture/ai/knowledge. Never throws — malformed config
  // falls through to the manual Settings → AI key flow.
  runProvisioning({
    store: rawCaptureStore,
    aiStore,
    knowledgeStore: knowledgeStoreWrapper,
    captureStore: capture,
    optimizerStore,
    logger,
    getExecDir: () => path.dirname(process.execPath),
    getUserDataPath: () => app.getPath('userData'),
    getSharedConfigDir: () => defaultSharedConfigDir(platformInfo),
    fs: {
      existsSync: (p) => fs.existsSync(p),
      readFileSync: (p, encoding) => fs.readFileSync(p, encoding),
    },
  });

  // Optimizer MCP integration (PRD_Optimizer_MCP_Integration D-M5/D-M6).
  // Created after provisioning so a just-dropped team-config v2 lights the
  // feature up on this very boot. The service reads config lazily, so an
  // unconfigured install carries inert objects and a hidden feature (D-M8).
  ctx.optimizerService = createOptimizerMcpService({
    logger,
    getConfig: () => optimizerStore.getConfig(),
  });
  ctx.optimizerJobTracker = createOptimizerJobTracker({
    logger,
    service: ctx.optimizerService,
  });
  registerOptimizerIpc(ctx);
  if (optimizerStore.isConfigured()) {
    // D-M6: Gemini function declarations derive from the server's tool list,
    // cached at startup — warm it without blocking boot.
    void ctx.optimizerService.getFunctionDeclarations();
  }

  // electron-updater is a runtime dependency; require here (not at module
  // scope of updaterService) so the service stays Vitest-friendly.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { autoUpdater } = require('electron-updater') as typeof import('electron-updater');
  updaterHandle = createUpdaterService({
    autoUpdater,
    logger,
    platform: platformInfo,
    getVersion: () => app.getVersion(),
    isPackaged: app.isPackaged,
  });
  ctx.updaterService = updaterHandle;
  registerUpdateIpc(ctx);
  updaterHandle.start();

  chatLifecycle.launchChatWindow();
  conversationStore.startSession();
  chatLifecycle.setChatState('idle');

  trayHandle = createTrayService({
    Tray,
    Menu,
    nativeImage,
    logger,
    iconPath: resolveTrayIconPath(),
    isWindows,
    onShowOverlay: () => {
      if (!raiseChatWindow()) {
        chatLifecycle.launchChatWindow();
      }
    },
    onToggleAutoCapture: () => {
      if (screenshotService.getLoopState().running) screenshotService.stop();
      else screenshotService.start();
    },
    onOpenSettings: () => {
      openSettingsWindow({ logger, isDev, devServerUrl });
    },
    onExit: () => {
      app.quit();
    },
  });

  if (
    !widgetState.getPermissionsPromptSeen() &&
    (initialPerm === 'not-determined' || initialPerm === 'denied')
  ) {
    void permissionSync.runScreenRecordingRequest('firstRunAuto').then((result) => {
      if (result === 'granted' || result === 'restricted') {
        permissionSync.stopPoll();
      }
    });
  }

  if (
    capture.getAutoCapture() &&
    (initialPerm === 'granted' || initialPerm === 'restricted') &&
    isRegionStillValid(capture.getRegion(), getCurrentDisplays())
  ) {
    screenshotService.start();
  }

  app.on('activate', () => {
    permissionSync.syncWidgetStatus('focus');
    const os = permissions.getScreenRecordingStatus();
    if (os === 'granted' || os === 'restricted') {
      permissionSync.stopPoll();
    }
    if (BrowserWindow.getAllWindows().length === 0) {
      chatLifecycle.launchChatWindow();
      conversationStore.startSession();
      chatLifecycle.setChatState('idle');
    }
  });

  return ctx;
}

export function shutdownApp(ctx: AppContext, permissionSync: PermissionSyncHandle): void {
  permissionSync.stopPoll();
  ctx.logger.info('app.beforeQuit');
  if (ctx.chatInflight.current) {
    ctx.chatInflight.current.abort();
    ctx.chatInflight.current = null;
  }
  ctx.geminiService?.cancelAll();
  ctx.optimizerJobTracker?.dispose();
  void ctx.optimizerService?.dispose();
  ctx.conversationStore.endSession('shutdown');
  closeChatWindow('shutdown');
  trayHandle?.destroy();
  trayHandle = null;
  updaterHandle?.stop();
  updaterHandle = null;
  ctx.updaterService = null;
  void ctx.screenshotService.shutdown();
}
