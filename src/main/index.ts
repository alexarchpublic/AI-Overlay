/**
 * @file src/main/index.ts
 *
 * Why it exists: Electron main-process bootstrap. Chunk 1 opened a standard
 * dev-shell window; Chunk 2 replaced that with the transparent always-on-top
 * overlay; Chunk 3 adds the screenshot engine + region picker. Launch sequence:
 *
 *   1. Init logger (Chunk 1 contract — unchanged)
 *   2. Init widget-state store (electron-store, dynamic import)
 *   3. Init capture-state store + run the one-shot widget→capture migration
 *   4. Init permissions helper
 *   5. Build screenshot service (loop is NOT started here — start happens via
 *      the right-click menu or settings panel)
 *   6. Register IPC (widget + perms + capture + region namespaces)
 *   7. Open the chat window (primary floating surface)
 *   8. If permission state is 'not-determined' on first launch, fire the
 *      OS-native screen-recording prompt
 *   9. If `capture.autoCapture` is true at boot AND permission is granted AND
 *      the saved region is still valid, resume the loop
 *
 * The order matters: IPC handlers capture references to the store, the
 * permissions helper, AND the screenshot service via closure, so all of
 * them must exist before the renderer code runs.
 */

import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { ulid } from 'ulid';
// `sharp` is a CommonJS package; the typed import works under
// `esModuleInterop: true` (locked in tsconfig.json).
import sharp from 'sharp';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import { createAppLogger, registerRendererLogBridge, type AppLogger } from './logger';
import { createWidgetStateStore, type WidgetStateStore } from './widgetState';
import {
  createCaptureStore,
  migrateAutoCaptureKey,
  type CaptureStateStore,
} from './captureStore';
import { createHarnessStore, type HarnessStateStore } from './harnessStore';
import { createKnowledgeStore } from './knowledgeStoreFactory';
import { createKnowledgeStoreState } from './knowledgeStoreState';
import {
  createHarnessLoader,
  createNodeHarnessFs,
  HarnessLoadError,
  type HarnessLoader,
} from './harnessLoader';
import { startHarnessWatcher, type HarnessWatcher } from './harnessWatcher';
import {
  createPermissionsHelper,
  statusForPermission,
  type PermissionsHelper,
} from './permissions';
import { openSettingsWindow } from './settingsWindow';
import { popupWidgetMenu } from './contextMenu';
import { openRegionPicker } from './regionPicker';
import {
  createScreenshotService,
  type ScreenshotService,
} from './screenshotService';
import { createAiStore, maskApiKey, type AiStateStore } from './aiStore';
import { createConversationStore, type ConversationStore } from './conversationStore';
import { createGeminiService, type GeminiService } from './geminiService';
import { createEnumerationMonitor, type EnumerationMonitor } from './enumerationMonitor';
import { createChatOrchestrator, type ChatOrchestrator } from './chatOrchestrator';
import { loadDeepFingerprintManifest } from '../shared/firewall/deepFingerprints';
import { DEFAULT_RETRIEVAL_TOKEN_BUDGET } from '../shared/knowledgeConstants';
import {
  closeChatWindow,
  focusChatWindow,
  isChatWindowOpen,
  openChatWindow,
} from './chatWindow';
import { getCurrentDisplays, isRegionStillValid } from './displayUtils';
import {
  APP_VERSION,
  CAPTURE_TEMP_SUBDIR,
  VITE_DEV_SERVER_PORT,
} from '../shared/constants';
import { HARNESS_DEFAULT_USERDATA_SUBDIR } from '../shared/harnessConstants';
import {
  IPC_AI_CLEAR_API_KEY,
  IPC_AI_GET_API_KEY,
  IPC_AI_GET_MODEL,
  IPC_AI_GET_STATS,
  IPC_AI_LIST_MODELS,
  IPC_AI_SET_API_KEY,
  IPC_AI_SET_MODEL,
  IPC_CAPTURE_CAPTURED,
  IPC_CAPTURE_GET_LOOP_STATE,
  IPC_CAPTURE_GET_RECENT,
  IPC_CAPTURE_GET_THUMBNAIL,
  IPC_CAPTURE_LOOP_STATE_CHANGED,
  IPC_CAPTURE_NOW,
  IPC_CAPTURE_SET_INTERVAL_MS,
  IPC_CAPTURE_START,
  IPC_CAPTURE_STOP,
  IPC_CHAT_CANCEL,
  IPC_CHAT_CLOSE,
  IPC_CHAT_COPY_SUGGESTION,
  IPC_CHAT_ERROR,
  IPC_CHAT_GET_HISTORY,
  IPC_CHAT_GET_KNOWLEDGE_READY,
  IPC_CHAT_HISTORY_CLEARED,
  IPC_CHAT_IS_OPEN,
  IPC_CHAT_OPEN,
  IPC_CHAT_OPEN_SETTINGS,
  IPC_CHAT_SEND,
  IPC_CHAT_STATE_CHANGED,
  IPC_CHAT_TURN_APPENDED,
  IPC_HARNESS_BROWSE_ROOT,
  IPC_HARNESS_GET_BUNDLE_TEXT,
  IPC_HARNESS_GET_METADATA,
  IPC_HARNESS_GET_ROOT_PATH,
  IPC_HARNESS_LOAD_ERROR,
  IPC_HARNESS_RELOAD,
  IPC_HARNESS_RELOADED,
  IPC_HARNESS_SET_ROOT_PATH,
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
} from '../shared/ipcChannels';
import type {
  ApiKeyPresence,
  CaptureLoopState,
  ChatError,
  ChatState,
  ChatTurn,
  GeminiCallStats,
  HarnessLoadErrorPayload,
  HarnessMetadata,
  PermissionState,
  Screenshot,
  SuggestedParameterChange,
  WidgetPosition,
  WidgetStatus,
} from '../shared/types';
import { clipboard } from 'electron';

const isDev = !app.isPackaged;
const DEV_SERVER_URL =
  process.env.VITE_DEV_SERVER_URL ?? `http://localhost:${String(VITE_DEV_SERVER_PORT)}`;

let logger: AppLogger | null = null;
let state: WidgetStateStore | null = null;
let capture: CaptureStateStore | null = null;
let screenshotService: ScreenshotService | null = null;
let harnessLoader: HarnessLoader | null = null;
// `harnessStoreWrapper` lives only inside `app.whenReady` — captured by
// `registerHarnessIpc`'s closure. No module-scoped reference needed because
// shutdown only touches the loader + watcher.
let harnessWatcher: HarnessWatcher | null = null;

// Secure harness Phase 0 — abstraction-only knowledge store (tasks 2–3).
// Live model context uses scoped `knowledgeStore.retrieve()` — not harness bundles.
let knowledgeStore: import('../shared/knowledgeTypes').KnowledgeStore | null = null;

// Chunk 5
let conversationStore: ConversationStore | null = null;
let geminiService: GeminiService | null = null;
/** Per-session tuning/enumeration monitor (Phase 0 task 6). */
let enumerationMonitor: EnumerationMonitor | null = null;
/** AbortController for the in-flight chat send. Replaced on each `send`. */
const chatInflightRef = { current: null as AbortController | null };
/** Wired after Chunk 5 singletons are constructed inside `app.whenReady`. */
let chatOrchestrator: ChatOrchestrator | null = null;
/** Coarse FSM mirror so renderer pulls + IPC pushes stay consistent. */
let chatState: ChatState = 'idle';
/** Polls macOS while screen recording is not granted (stops once granted). */
let permissionPollTimer: NodeJS.Timeout | null = null;
let permissionPollDeps: {
  logger: AppLogger;
  state: WidgetStateStore;
  permissions: PermissionsHelper;
} | null = null;

void app.whenReady().then(async () => {
  logger = createAppLogger({ baseDir: app.getPath('userData') });
  registerRendererLogBridge(logger);

  logger.info('app.ready', {
    appVersion: APP_VERSION,
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
  });

  state = await createWidgetStateStore();

  // Capture store opens against the same `config` electron-store file as
  // widgetState; both wrappers see each other's writes. Migration runs
  // exactly once across the app's lifetime (sticky flag).
  const { store: rawCaptureStore, wrapper: captureWrapper } = await createCaptureStore();
  capture = captureWrapper;
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
      logger?.info('perms.screen.transition', { from, to });
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
      : path.join(
          app.getAppPath(),
          'node_modules',
          'electron',
          'dist',
          'Electron.app',
        ),
  });
  syncWidgetStatusWithOsPermission(logger, state, permissions, 'boot');
  permissionPollDeps = { logger, state, permissions };
  startPermissionPollIfNeeded(initialPerm);

  // Captures live under app temp + a per-app subdir per PRD D5; resolved here
  // so both the screenshotService and the dev panel use the same path.
  const capturesDir = path.join(app.getPath('temp'), CAPTURE_TEMP_SUBDIR);
  fs.mkdirSync(capturesDir, { recursive: true });

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const electronModule = require('electron') as typeof import('electron');
  screenshotService = createScreenshotService({
    logger,
    store: capture,
    desktopCapturer: {
      // Adapter to satisfy the narrow DesktopCapturerLike — Electron's
      // SourcesOptions wants a mutable `types: ('screen'|'window')[]`, our
      // interface uses `readonly` for safety, so we widen here.
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

  // Wire screenshotService events → widget visual flash + renderer push.
  screenshotService.onCaptured((s) => {
    flashWidgetCapturing();
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send(IPC_CAPTURE_CAPTURED, s);
    }
  });
  screenshotService.onLoopStateChanged((s) => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send(IPC_CAPTURE_LOOP_STATE_CHANGED, s);
    }
    // PRD D12: if the loop transitioned to permission-lost (running flipped
    // false while the OS state is denied), surface that to the widget.
    if (!s.running && permissions.getScreenRecordingStatus() !== 'granted') {
      const log = logger;
      const store = state;
      if (!log || !store) return;
      const next: WidgetStatus = 'permDenied';
      if (store.getStatus() !== next) {
        store.setStatus(next);
        for (const w of BrowserWindow.getAllWindows()) {
          w.webContents.send(IPC_WIDGET_STATUS_CHANGED, next);
        }
      }
    }
  });

  // -------------------------------------------------------------------------
  // Harness loader (Chunk 4)
  //
  // Resolved root precedence (PRD §0 D1):
  //   1. user-set value in electron-store (`harness.rootPath`)
  //   2. `<userData>/arch-public-harness/`
  //   3. dev-only fallback to repo-relative `./arch-public-harness/`
  //
  // The initial load is fired immediately but does NOT block app boot —
  // failures are routed to `onLoadError` and surfaced in the settings panel
  // (PRD §3.1: "Errors during initial load are logged but do not block app boot").
  // -------------------------------------------------------------------------

  const { wrapper: harnessStoreWrapper } = await createHarnessStore();
  const resolvedHarnessRoot = resolveHarnessRoot(harnessStoreWrapper, isDev);

  harnessLoader = createHarnessLoader({
    logger,
    initialRootPath: resolvedHarnessRoot,
    fs: createNodeHarnessFs(),
    onLoaded: (m) => {
      // Persist the small projection — the full bundle never lands on disk.
      harnessStoreWrapper.setLastLoadedAt(m.loadedAt);
      harnessStoreWrapper.setLastLoadDurationMs(m.loadDurationMs);
      harnessStoreWrapper.setLastFileCount(m.fileCount);
      harnessStoreWrapper.setLastApproxTokens(m.approxTokens);
    },
  });

  // Forward loader events to the renderer windows. The metadata payload is
  // explicit — Chunk 5's chat surface reads this to invalidate its system-prompt
  // cache (PRD §8 handoff contract).
  harnessLoader.onReloaded((m: HarnessMetadata) => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send(IPC_HARNESS_RELOADED, m);
    }
  });
  harnessLoader.onLoadError((e: HarnessLoadErrorPayload) => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send(IPC_HARNESS_LOAD_ERROR, e);
    }
  });

  // Fire the initial load. We don't await — Chunk 5 is the only consumer
  // and it goes through `getHarness()` which awaits internally.
  void harnessLoader.getHarness().catch(() => {
    // `onLoadError` already fired and the renderer banner picks it up;
    // swallow here so the unhandled-rejection trap stays clean.
  });

  // Dev-only watcher (PRD §3.6). Production never constructs one.
  if (isDev) {
    harnessWatcher = startHarnessWatcher({
      logger,
      loader: harnessLoader,
      rootPath: resolvedHarnessRoot,
    });
  }

  registerIpc(logger, state, capture, permissions, screenshotService);
  registerHarnessIpc(logger, harnessLoader, harnessStoreWrapper);

  // -------------------------------------------------------------------------
  // Secure harness — KnowledgeStore (Phase 0 tasks 2–3)
  //
  // Loads the servable-tier bundle from `knowledge/bundles/`, encrypts it under
  // userData, and exposes scoped retrieval for geminiService.
  // -------------------------------------------------------------------------
  const { wrapper: knowledgeStoreWrapper } = await createKnowledgeStoreState();
  try {
    knowledgeStore = await createKnowledgeStore({
      backend: knowledgeStoreWrapper.getBackend(),
      logger,
      userDataDir: app.getPath('userData'),
      isDev,
    });
    logger.info('knowledge.ready', { contentHash: await knowledgeStore.version() });
  } catch (err) {
    logger.warn('knowledge.initFailed', {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // -------------------------------------------------------------------------
  // Chunk 5 — AI store, conversation memory, Gemini service, chat IPC
  //
  // The chat window is created lazily on first `widget:click` so the cold
  // launch path stays fast. Model context is scoped via KnowledgeStore (task 3).
  // -------------------------------------------------------------------------
  const { wrapper: aiWrapper } = await createAiStore();
  conversationStore = createConversationStore({ logger });
  enumerationMonitor = createEnumerationMonitor({ logger });
  if (knowledgeStore) {
    const deepFingerprintPath = path.join(app.getAppPath(), 'knowledge', 'deep-fingerprints.json');
    const deepFingerprints = await loadDeepFingerprintManifest(deepFingerprintPath);
    if (deepFingerprints) {
      logger.info('firewall.deepFingerprintsLoaded', {
        spanCount: deepFingerprints.spans.length,
      });
    } else {
      logger.warn('firewall.deepFingerprintsMissing', { path: deepFingerprintPath });
    }
    geminiService = createGeminiService({
      logger,
      knowledgeStore,
      getApiKey: () => aiWrapper.getApiKey(),
      getModel: () => aiWrapper.getModel(),
      recordCall: (rec) => {
        aiWrapper.appendCall({
          ...rec,
          enumerationScore: enumerationMonitor?.getScore(),
        });
      },
      deepFingerprints,
    });
  } else {
    logger.warn('gemini.knowledgeStoreMissing', {
      reason: 'Knowledge store failed to initialize — chat sends will fail',
    });
  }

  if (geminiService && knowledgeStore) {
    chatOrchestrator = createChatOrchestrator({
      logger,
      aiStore: aiWrapper,
      conversationStore,
      geminiService,
      knowledgeStore,
      screenshotService,
      enumerationMonitor,
      chatInflight: chatInflightRef,
      emit: {
        turnAppended: emitTurnAppended,
        stateChanged: setChatState,
        error: emitChatError,
      },
    });
  }

  registerChatAndAiIpc(
    logger,
    aiWrapper,
    conversationStore,
    geminiService,
    screenshotService,
  );

  launchChatWindow();
  conversationStore.startSession();
  setChatState('idle');

  // First-run permission flow — also retry once when still denied but the
  // user has never completed our request flow (common after TCC reset / re-add).
  if (
    !state.getPermissionsPromptSeen() &&
    (initialPerm === 'not-determined' || initialPerm === 'denied')
  ) {
    void runScreenRecordingRequest({
      logger,
      state,
      permissions,
      trigger: 'firstRunAuto',
    }).then((result) => {
      if (result === 'granted' || result === 'restricted') {
        stopPermissionPoll();
      }
    });
  }

  // Resume the loop on launch if the user had it on, permission is granted,
  // and the saved region is still valid (PRD §3.3 step 4 — the loop only
  // starts if it can succeed).
  if (
    capture.getAutoCapture() &&
    (initialPerm === 'granted' || initialPerm === 'restricted') &&
    isRegionStillValid(capture.getRegion(), getCurrentDisplays())
  ) {
    screenshotService.start();
  }

  app.on('activate', () => {
    if (!logger || !state) return;
    syncWidgetStatusWithOsPermission(logger, state, permissions, 'focus');
    const os = permissions.getScreenRecordingStatus();
    if (os === 'granted' || os === 'restricted') {
      stopPermissionPoll();
    }
    if (BrowserWindow.getAllWindows().length === 0) {
      launchChatWindow();
      conversationStore?.startSession();
      setChatState('idle');
    }
  });
});

app.on('window-all-closed', () => {
  logger?.info('app.quit', { reason: 'window-all-closed' });
  app.quit();
});

app.on('before-quit', () => {
  stopPermissionPoll();
  logger?.info('app.beforeQuit');
  // Chunk 5 §8 contract: cancel any in-flight Gemini call BEFORE flushing
  // the harness/loop shutdown so no abandoned `gemini.callCompleted` line
  // races `app.quit`.
  if (chatInflightRef.current) {
    chatInflightRef.current.abort();
    chatInflightRef.current = null;
  }
  geminiService?.cancelAll();
  conversationStore?.endSession('shutdown');
  closeChatWindow('shutdown');
  // Halt the loop and run a final pruner sweep before exit.
  void screenshotService?.shutdown();
  // Stop the harness watcher (no-op in production where it was never started).
  void harnessWatcher?.close();
  void harnessLoader?.shutdown();
});

// ---------------------------------------------------------------------------
// 'capturing' flash helper — broadcasts the transient widget flash.
//
// PRD D11: the widget flips to `'capturing'` for 600ms on each capture. We
// schedule the reset via setTimeout in main rather than in the renderer so
// that 'paused' always wins — if the user pauses *during* the flash, the
// reset to 'ready' is squashed because main checks the persisted status
// before broadcasting.
// ---------------------------------------------------------------------------

let flashResetTimer: NodeJS.Timeout | null = null;

function flashWidgetCapturing(): void {
  const log = logger;
  const store = state;
  if (!log || !store) return;
  // If the widget is currently paused or denied, do not flash to 'capturing'
  // — those states are user-visible and shouldn't be stomped by an
  // auto-capture flash.
  const persisted = store.getStatus();
  if (persisted !== 'ready' && persisted !== 'capturing') return;

  if (flashResetTimer) {
    clearTimeout(flashResetTimer);
    flashResetTimer = null;
  }
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(IPC_WIDGET_STATUS_CHANGED, 'capturing');
  }
  // Note: do NOT persist 'capturing' to electron-store — it's transient.
  // After 600ms broadcast 'ready' (or whatever the persisted status is now,
  // which may have flipped to 'paused' in the meantime).
  flashResetTimer = setTimeout(() => {
    const after = store.getStatus();
    // If the user paused during the flash, after === 'paused' and we honor it.
    const next: WidgetStatus = after === 'capturing' ? 'ready' : after;
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send(IPC_WIDGET_STATUS_CHANGED, next);
    }
    flashResetTimer = null;
  }, 600);
}

// ---------------------------------------------------------------------------
// OS permission ↔ widget status sync
// ---------------------------------------------------------------------------

function broadcastWidgetStatus(status: WidgetStatus): void {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(IPC_WIDGET_STATUS_CHANGED, status);
  }
}

const PERMISSION_POLL_MS = 2_000;

function startPermissionPollIfNeeded(initialPerm: PermissionState): void {
  if (initialPerm === 'granted' || initialPerm === 'restricted') return;
  stopPermissionPoll();
  permissionPollTimer = setInterval(() => {
    const deps = permissionPollDeps;
    if (!deps) return;
    const os = deps.permissions.getScreenRecordingStatus();
    deps.logger.debug('perms.screen.poll', { state: os });
    syncWidgetStatusWithOsPermission(deps.logger, deps.state, deps.permissions, 'focus');
    if (os === 'granted' || os === 'restricted') {
      stopPermissionPoll();
    }
  }, PERMISSION_POLL_MS);
}

function stopPermissionPoll(): void {
  if (permissionPollTimer) {
    clearInterval(permissionPollTimer);
    permissionPollTimer = null;
  }
}

/**
 * Align persisted widget status with `getMediaAccessStatus('screen')`.
 * Called at boot and when the overlay regains focus (e.g. after System
 * Settings). Does not override user `paused` or transient `capturing`.
 */
function syncWidgetStatusWithOsPermission(
  log: AppLogger,
  store: WidgetStateStore,
  perms: PermissionsHelper,
  trigger: 'boot' | 'focus',
): void {
  const osPerm = perms.getScreenRecordingStatus();
  const mapped = statusForPermission(osPerm);
  const persisted = store.getStatus();

  if (
    mapped === 'permDenied' &&
    persisted !== 'permDenied' &&
    persisted !== 'capturing'
  ) {
    store.setStatus('permDenied');
    log.info('perms.screen.persistedSync', {
      from: persisted,
      to: 'permDenied',
      reason: 'osDenied',
      trigger,
      osState: osPerm,
    });
    broadcastWidgetStatus('permDenied');
    return;
  }

  if (mapped === 'ready' && persisted === 'permDenied') {
    store.setStatus('ready');
    log.info('perms.screen.persistedSync', {
      from: 'permDenied',
      to: 'ready',
      reason: 'osGrantedClearStaleDenial',
      trigger,
      osState: osPerm,
    });
    broadcastWidgetStatus('ready');
    stopPermissionPoll();
  }
}

// ---------------------------------------------------------------------------
// Shared permission-request flow — used by the IPC handler AND the boot path
// ---------------------------------------------------------------------------

interface RunRequestArgs {
  logger: AppLogger;
  state: WidgetStateStore;
  permissions: PermissionsHelper;
  trigger: 'firstRunAuto' | 'menu' | 'rendererInvoke';
}

async function runScreenRecordingRequest(args: RunRequestArgs): Promise<PermissionState> {
  const { logger: log, state: store, permissions, trigger } = args;
  log.info('perms.screen.requestStart', { trigger });
  const result = await permissions.requestScreenRecording();
  store.setPermissionsPromptSeen(true);
  const nextStatus: WidgetStatus = statusForPermission(result);
  store.setStatus(nextStatus);
  log.info('perms.screen.requestEnd', { result, nextStatus, trigger });
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(IPC_WIDGET_STATUS_CHANGED, nextStatus);
  }
  if (result === 'granted' || result === 'restricted') {
    stopPermissionPoll();
  } else {
    startPermissionPollIfNeeded(result);
  }
  return result;
}

// ---------------------------------------------------------------------------
// IPC registration — one place, no string literals
// ---------------------------------------------------------------------------

function registerIpc(
  log: AppLogger,
  store: WidgetStateStore,
  captureStore: CaptureStateStore,
  perms: PermissionsHelper,
  service: ScreenshotService,
): void {
  // -------------------------------------------------------------------------
  // Widget namespace (Chunk 2)
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC_WIDGET_GET_STATUS, (): WidgetStatus => store.getStatus());

  ipcMain.handle(IPC_WIDGET_SET_STATUS, (_e: IpcMainInvokeEvent, next: unknown): void => {
    if (
      next !== 'ready' &&
      next !== 'paused' &&
      next !== 'permDenied' &&
      next !== 'capturing'
    ) {
      return;
    }
    const prev = store.getStatus();
    // 'capturing' is transient — never persist; only broadcast.
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
        openSettingsWindow({ logger: log, isDev, devServerUrl: DEV_SERVER_URL });
      },
      openSystemSettings: (): void => {
        log.info('perms.openSystemSettings', { trigger: 'menu' });
        void perms.openSystemSettings();
      },
      requestScreenRecording: (): void => {
        void runScreenRecordingRequest({
          logger: log,
          state: store,
          permissions: perms,
          trigger: 'menu',
        });
      },
      captureNow: (): void => {
        void service.captureNow();
      },
      toggleAutoCapture: (): void => {
        if (service.getLoopState().running) service.stop();
        else service.start();
      },
      openRegionPicker: (): void => {
        void runRegionPicker(log, captureStore, service);
      },
    });
  });

  // -------------------------------------------------------------------------
  // Permissions namespace (Chunk 2)
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC_PERMS_GET_SCREEN, () => perms.getScreenRecordingStatus());

  ipcMain.handle(IPC_PERMS_REQUEST_SCREEN, () =>
    runScreenRecordingRequest({
      logger: log,
      state: store,
      permissions: perms,
      trigger: 'rendererInvoke',
    }),
  );

  ipcMain.on(IPC_PERMS_OPEN_SYSTEM_SETTINGS, (): void => {
    log.info('perms.openSystemSettings', { trigger: 'rendererInvoke' });
    void perms.openSystemSettings();
  });

  // -------------------------------------------------------------------------
  // Capture namespace (Chunk 3)
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Region namespace (Chunk 3)
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC_REGION_GET, () => captureStore.getRegion());
  ipcMain.handle(IPC_REGION_OPEN_PICKER, async () =>
    runRegionPicker(log, captureStore, service),
  );
  ipcMain.handle(IPC_REGION_CLEAR, (): void => {
    captureStore.clearRegion();
    log.info('region.cleared');
    service.refreshRegionValidity();
  });
}

/**
 * Open the region picker, persist the result if confirmed, and refresh the
 * service's `regionValid` flag. Pulled out so both the right-click menu and
 * the renderer IPC handler share one path.
 */
async function runRegionPicker(
  log: AppLogger,
  captureStore: CaptureStateStore,
  service: ScreenshotService,
): Promise<ReturnType<CaptureStateStore['getRegion']>> {
  const region = await openRegionPicker({ logger: log, isDev, devServerUrl: DEV_SERVER_URL });
  if (region) {
    captureStore.setRegion(region);
    service.refreshRegionValidity();
    return region;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Harness root resolution + IPC registration (Chunk 4)
// ---------------------------------------------------------------------------

/**
 * Resolve the active harness root path per PRD §0 D1 precedence:
 *
 *   1. user-overridden value persisted in `electron-store` (`harness.rootPath`)
 *   2. `<userData>/arch-public-harness/`
 *   3. dev-only fallback to repo-relative `./arch-public-harness/`
 *
 * The resolver does NOT verify the path exists — that's the loader's job.
 * Returning a missing path yields a `ROOT_NOT_FOUND` error on first load
 * and the settings panel surfaces a "Browse for folder…" CTA.
 */
function resolveHarnessRoot(store: HarnessStateStore, dev: boolean): string {
  const saved = store.getRootPath();
  if (saved !== null) return saved;
  const userData = app.getPath('userData');
  const userDataRoot = path.join(userData, HARNESS_DEFAULT_USERDATA_SUBDIR);
  if (dev && !fs.existsSync(userDataRoot)) {
    // Repo-relative fallback (PRD §0 D1). Production never takes this path
    // because `dev` is `false` in packaged builds (`!app.isPackaged`).
    const repoRel = path.resolve(process.cwd(), HARNESS_DEFAULT_USERDATA_SUBDIR);
    if (fs.existsSync(repoRel)) return repoRel;
  }
  return userDataRoot;
}

/**
 * Wire the `harness.*` IPC channels. Called once after the loader is built.
 * Errors are mapped through `mapHarnessRejection` so the renderer always
 * sees a typed `HarnessLoadErrorPayload` rather than a stringified Error.
 */
function registerHarnessIpc(
  log: AppLogger,
  loader: HarnessLoader,
  store: HarnessStateStore,
): void {
  ipcMain.handle(IPC_HARNESS_GET_METADATA, async (): Promise<HarnessMetadata> => {
    const m = await loader.getMetadata();
    return m;
  });

  // PRD §5 DoD #18 — gated in production with the inspector flag off.
  ipcMain.handle(IPC_HARNESS_GET_BUNDLE_TEXT, async (): Promise<string> => {
    const allowed = isDev || store.getShowInspector();
    if (!allowed) {
      log.warn('harness.bundleTextDenied', { reason: 'inspectorGated' });
      throw new Error('harness inspector is disabled in this build');
    }
    const b = await loader.getHarness();
    return b.text;
  });

  ipcMain.handle(IPC_HARNESS_GET_ROOT_PATH, (): string => loader.getRootPath());

  ipcMain.handle(
    IPC_HARNESS_SET_ROOT_PATH,
    async (_e: IpcMainInvokeEvent, p: unknown): Promise<HarnessMetadata> => {
      if (typeof p !== 'string' || p.length === 0) {
        throw new Error('harness.setRootPath: invalid path');
      }
      try {
        const b = await loader.setRootPath(p);
        // Persist only after a successful reload — a path that resolves to
        // ROOT_NOT_FOUND would otherwise become sticky.
        store.setRootPath(p);
        // Restart the dev watcher against the new root so future edits there
        // trigger reloads.
        if (isDev) {
          await harnessWatcher?.close();
          harnessWatcher = startHarnessWatcher({
            logger: log,
            loader,
            rootPath: b.metadata.rootPath,
          });
        }
        return b.metadata;
      } catch (err) {
        throw rethrowAsHarnessError(err);
      }
    },
  );

  ipcMain.handle(IPC_HARNESS_RELOAD, async (): Promise<HarnessMetadata> => {
    try {
      const b = await loader.reload();
      return b.metadata;
    } catch (err) {
      throw rethrowAsHarnessError(err);
    }
  });

  ipcMain.handle(
    IPC_HARNESS_BROWSE_ROOT,
    async (_e: IpcMainInvokeEvent): Promise<string | null> => {
      // Native folder picker — not modal-tied to a specific window because
      // the request can come from either the settings or overlay window.
      const result = await dialog.showOpenDialog({
        title: 'Choose harness folder',
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: loader.getRootPath(),
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      const chosen = result.filePaths[0];
      log.info('harness.browseRootChosen', { rootPath: chosen });
      return chosen;
    },
  );
}

/**
 * Coerce a thrown value into a serializable string the renderer can show.
 * The raw `HarnessLoadError.payload` is what we want to surface; ipcMain
 * can't serialize Error instances natively, so we re-throw a plain Error
 * carrying the JSON string. The renderer parses it back.
 */
function rethrowAsHarnessError(err: unknown): Error {
  if (err instanceof HarnessLoadError) {
    const e = new Error(JSON.stringify(err.payload));
    e.name = 'HarnessLoadError';
    return e;
  }
  return err instanceof Error ? err : new Error(String(err));
}

// ---------------------------------------------------------------------------
// Narrow runtime type guards for untrusted IPC payloads
// ---------------------------------------------------------------------------

function isPoint(v: unknown): v is { x: number; y: number } {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.x === 'number' && typeof o.y === 'number';
}

function isWidgetPosition(v: unknown): v is WidgetPosition {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.x !== 'number' || typeof o.y !== 'number') return false;
  if (o.displayId !== null && typeof o.displayId !== 'number') return false;
  return true;
}

// ---------------------------------------------------------------------------
// Chat window lifecycle — primary floating surface (replaces overlay pill)
// ---------------------------------------------------------------------------

function onChatWindowClosed(): void {
  if (chatInflightRef.current) {
    chatInflightRef.current.abort();
    chatInflightRef.current = null;
  }
  conversationStore?.endSession('close');
  enumerationMonitor?.reset();
  broadcastToAllWindows(IPC_CHAT_HISTORY_CLEARED, undefined);
  setChatState('idle');
}

function launchChatWindow(): BrowserWindow {
  const log = logger;
  const store = state;
  if (!log || !store) {
    throw new Error('launchChatWindow called before app stores are ready');
  }
  const win = openChatWindow({
    logger: log,
    isDev,
    devServerUrl: DEV_SERVER_URL,
    state: store,
    onClosed: onChatWindowClosed,
  });
  win.on('focus', () => {
    const deps = permissionPollDeps;
    if (!deps) return;
    syncWidgetStatusWithOsPermission(deps.logger, deps.state, deps.permissions, 'focus');
    const os = deps.permissions.getScreenRecordingStatus();
    if (os === 'granted' || os === 'restricted') {
      stopPermissionPoll();
    }
  });
  if (isDev) {
    win.webContents.openDevTools({ mode: 'detach' });
  }
  return win;
}

// ---------------------------------------------------------------------------
// Chunk 5 — chat orchestration + IPC wiring (PRD §3.2 / §3.3)
// ---------------------------------------------------------------------------

/** Single helper so every push goes through the same broadcast contract. */
function broadcastToAllWindows(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(channel, payload);
  }
}

function setChatState(next: ChatState): void {
  if (next === chatState) return;
  chatState = next;
  broadcastToAllWindows(IPC_CHAT_STATE_CHANGED, next);
}

function emitChatError(err: ChatError): void {
  setChatState('error');
  broadcastToAllWindows(IPC_CHAT_ERROR, err);
  logger?.info('chat.errorShown', { variant: err.variant });
}

function emitTurnAppended(turn: ChatTurn): void {
  broadcastToAllWindows(IPC_CHAT_TURN_APPENDED, turn);
}

/**
 * Drive one user turn end-to-end. Implementation lives in
 * `chatOrchestrator.ts` so the path is unit-testable (Milestone 0 T0.3).
 *
 * The caller (`IPC_CHAT_SEND` handler) does NOT await the returned promise —
 * `chat.send` resolves when the request is QUEUED, not when the answer
 * arrives (PRD §3.2).
 */
async function runChatSend(
  text: string,
  requestedScreenshotIds?: readonly string[],
): Promise<void> {
  if (!chatOrchestrator) return;
  return chatOrchestrator.runChatSend(text, requestedScreenshotIds);
}

/** Format a `SuggestedParameterChange` for the clipboard (schema v2). */
function formatSuggestionForClipboard(s: SuggestedParameterChange): string {
  return `${s.parameter}: ${s.direction} to ${s.suggested_value} # ${s.chart_context} — ${s.rationale}`;
}

/**
 * Wire the `chat.*` and `ai.*` IPC handlers. Called once after the
 * conversation/gemini singletons are constructed.
 */
function registerChatAndAiIpc(
  log: AppLogger,
  ai: AiStateStore,
  conv: ConversationStore,
  gemini: GeminiService | null,
  _captureService: ScreenshotService,
): void {
  // -------------------------------------------------------------------------
  // chat.* handlers
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC_CHAT_OPEN, async (): Promise<void> => {
    if (isChatWindowOpen()) {
      log.debug('chat.openIdempotent');
      focusChatWindow();
      return Promise.resolve();
    }
    if (!state) return Promise.resolve();
    launchChatWindow();
    conv.startSession();
    setChatState('idle');
    return Promise.resolve();
  });

  ipcMain.handle(IPC_CHAT_CLOSE, async (): Promise<void> => {
    closeChatWindow('user');
    return Promise.resolve();
  });

  ipcMain.handle(IPC_CHAT_OPEN_SETTINGS, async (): Promise<void> => {
    log.info('chat.openSettings');
    openSettingsWindow({ logger: log, isDev, devServerUrl: DEV_SERVER_URL });
    return Promise.resolve();
  });

  ipcMain.handle(IPC_CHAT_IS_OPEN, (): boolean => isChatWindowOpen());

  ipcMain.handle(IPC_CHAT_GET_KNOWLEDGE_READY, async (): Promise<boolean> => {
    const store = knowledgeStore;
    if (!store) return false;
    try {
      const chunks = await store.retrieve({
        text: 'signal',
        k: 1,
        tokenBudget: DEFAULT_RETRIEVAL_TOKEN_BUDGET,
      });
      return chunks.length > 0;
    } catch {
      return false;
    }
  });

  ipcMain.handle(
    IPC_CHAT_SEND,
    async (_e: IpcMainInvokeEvent, text: unknown, screenshotIds: unknown): Promise<void> => {
      if (typeof text !== 'string' || text.trim().length === 0) {
        return Promise.resolve();
      }
      const ids =
        Array.isArray(screenshotIds) &&
        screenshotIds.every((id): id is string => typeof id === 'string')
          ? screenshotIds
          : undefined;
      // Fire-and-forget — `runChatSend` resolves when the request is queued
      // and surfaces all subsequent state via push events.
      void runChatSend(text, ids);
      return Promise.resolve();
    },
  );

  ipcMain.handle(IPC_CHAT_CANCEL, async (): Promise<void> => {
    if (chatInflightRef.current) {
      chatInflightRef.current.abort();
      chatInflightRef.current = null;
      log.info('chat.cancelled');
    }
    setChatState('idle');
    return Promise.resolve();
  });

  ipcMain.handle(
    IPC_CHAT_GET_HISTORY,
    (): readonly ChatTurn[] => conv.getHistory(),
  );

  ipcMain.handle(
    IPC_CHAT_COPY_SUGGESTION,
    (_e: IpcMainInvokeEvent, payload: unknown): void => {
      if (!isSuggestedChange(payload)) return;
      const text = formatSuggestionForClipboard(payload);
      try {
        clipboard.writeText(text);
        log.info('chat.suggestionCopied', { parameter: payload.parameter });
      } catch (err) {
        log.warn('chat.suggestionCopyFailed', {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  // -------------------------------------------------------------------------
  // ai.* handlers
  // -------------------------------------------------------------------------

  ipcMain.handle(IPC_AI_GET_API_KEY, (): ApiKeyPresence => {
    const key = ai.getApiKey();
    return {
      present: key !== null,
      masked: maskApiKey(key),
    };
  });

  ipcMain.handle(
    IPC_AI_SET_API_KEY,
    (_e: IpcMainInvokeEvent, raw: unknown): void => {
      if (typeof raw !== 'string') return;
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        ai.clearApiKey();
        log.info('ai.apiKeyUpdated', { cleared: true });
        return;
      }
      ai.setApiKey(trimmed);
      // The redaction rule in `logger.ts` masks any `apiKey` field, so
      // including the value here is safe — it never reaches the JSON
      // line. The contract is locked in PRD D28 + Chunk 6 §8.
      log.info('ai.apiKeyUpdated', { apiKey: trimmed, cleared: false });
    },
  );

  ipcMain.handle(IPC_AI_CLEAR_API_KEY, (): void => {
    ai.clearApiKey();
    log.info('ai.apiKeyUpdated', { cleared: true });
  });

  ipcMain.handle(IPC_AI_GET_MODEL, (): string => ai.getModel());

  ipcMain.handle(
    IPC_AI_SET_MODEL,
    (_e: IpcMainInvokeEvent, model: unknown): string => {
      if (typeof model !== 'string') return ai.getModel();
      const prev = ai.getModel();
      const next = ai.setModel(model);
      if (next !== prev) {
        log.info('ai.modelChanged', { from: prev, to: next });
        // Model change should rebuild the prompt cache too — the model
        // doesn't affect the system prompt today, but the contract is
        // "settings change applies on the next turn", so be conservative.
        gemini?.invalidateSystemPromptCache();
      }
      return next;
    },
  );

  ipcMain.handle(
    IPC_AI_LIST_MODELS,
    // eslint-disable-next-line @typescript-eslint/require-await
    async (): Promise<readonly string[]> => {
      // Re-export the constant so the renderer doesn't need to import it.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const c = require('../shared/aiConstants') as { MODEL_ALLOWLIST: readonly string[] };
      return c.MODEL_ALLOWLIST;
    },
  );

  ipcMain.handle(IPC_AI_GET_STATS, (): GeminiCallStats => ai.getStats(Date.now()));
}

function isSuggestedChange(v: unknown): v is SuggestedParameterChange {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.parameter === 'string' &&
    typeof o.rationale === 'string' &&
    typeof o.suggested_value === 'string' &&
    typeof o.chart_context === 'string' &&
    (o.direction === 'increase' || o.direction === 'decrease' || o.direction === 'set')
  );
}
