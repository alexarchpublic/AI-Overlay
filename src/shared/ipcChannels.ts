/**
 * @file src/shared/ipcChannels.ts
 *
 * Why it exists: Single source of truth for every IPC channel string used across
 * main / preload / renderer. Chunk 1 kept a handful of `'log:message'` literals
 * inline; Chunk 2 widens the surface so the risk of typos across processes is
 * real. Every new channel lands here first and is referenced by its constant
 * everywhere else.
 *
 * Naming rule: `'{namespace}:{verb}'`. Namespaces so far: `log`, `widget`,
 * `perms`, `capture`, `region`, `chat`, `ai`. Keep verbs imperative
 * (`get`, `set`, `open`, `emit`, `report`).
 */

export const IPC_LOG_MESSAGE = 'log:message';

// ---------------------------------------------------------------------------
// Widget channels (Chunk 2)
// ---------------------------------------------------------------------------

export const IPC_WIDGET_GET_STATUS = 'widget:getStatus';
export const IPC_WIDGET_SET_STATUS = 'widget:setStatus';
export const IPC_WIDGET_REPORT_POSITION = 'widget:reportPosition';
export const IPC_WIDGET_OPEN_CONTEXT_MENU = 'widget:openContextMenu';

/** main → renderer: widget status mutations (e.g., permission flip) */
export const IPC_WIDGET_STATUS_CHANGED = 'widget:statusChanged';

/** main → renderer: context-menu item selection */
export const IPC_WIDGET_MENU_ACTION = 'widget:menuAction';

// ---------------------------------------------------------------------------
// Permissions channels (Chunk 2)
// ---------------------------------------------------------------------------

export const IPC_PERMS_GET_SCREEN = 'perms:getScreenRecordingStatus';
export const IPC_PERMS_REQUEST_SCREEN = 'perms:requestScreenRecording';
export const IPC_PERMS_OPEN_SYSTEM_SETTINGS = 'perms:openSystemSettings';

// ---------------------------------------------------------------------------
// Capture channels (Chunk 3 — PRD §3.2 locked surface)
// ---------------------------------------------------------------------------

export const IPC_CAPTURE_GET_LOOP_STATE = 'capture:getLoopState';
export const IPC_CAPTURE_START = 'capture:start';
export const IPC_CAPTURE_STOP = 'capture:stop';
export const IPC_CAPTURE_NOW = 'capture:captureNow';
export const IPC_CAPTURE_SET_INTERVAL_MS = 'capture:setIntervalMs';
export const IPC_CAPTURE_GET_RECENT = 'capture:getRecent';
/** Renderer pull: JPEG data URL for a ring-buffer screenshot (chat attachment preview). */
export const IPC_CAPTURE_GET_THUMBNAIL = 'capture:getThumbnail';

/** main → renderer push: a new screenshot is on disk + in the ring buffer. */
export const IPC_CAPTURE_CAPTURED = 'capture:captured';
/** main → renderer push: the loop's running/intervalMs/regionValid state changed. */
export const IPC_CAPTURE_LOOP_STATE_CHANGED = 'capture:loopStateChanged';

// ---------------------------------------------------------------------------
// Region channels (Chunk 3 — PRD §3.2 locked surface)
// ---------------------------------------------------------------------------

export const IPC_REGION_GET = 'region:get';
export const IPC_REGION_OPEN_PICKER = 'region:openPicker';
export const IPC_REGION_CLEAR = 'region:clear';

/**
 * main ↔ picker-renderer: the picker window's React tree calls this with the
 * draw rect (or `null` on ESC). The main-side picker controller resolves the
 * outer `openPicker()` promise and tears down the per-display windows. This
 * channel never leaves the picker window — it is NOT exposed on
 * `window.api.region.*` for the overlay or settings windows.
 */
export const IPC_REGION_PICKER_CONFIRM = 'region:pickerConfirm';
export const IPC_REGION_PICKER_CANCEL = 'region:pickerCancel';

// ---------------------------------------------------------------------------
// Chat channels (Chunk 5 — PRD §3.2 locked surface)
// ---------------------------------------------------------------------------

export const IPC_CHAT_OPEN = 'chat:open';
export const IPC_CHAT_CLOSE = 'chat:close';
export const IPC_CHAT_IS_OPEN = 'chat:isOpen';
export const IPC_CHAT_SEND = 'chat:send';
export const IPC_CHAT_CANCEL = 'chat:cancel';
export const IPC_CHAT_GET_HISTORY = 'chat:getHistory';
export const IPC_CHAT_COPY_SUGGESTION = 'chat:copySuggestion';
/** Open the settings window from chat error CTAs or in-app shortcuts. */
export const IPC_CHAT_OPEN_SETTINGS = 'chat:openSettings';
/** Whether the docs bundle initialized with at least one chunk. */
export const IPC_CHAT_GET_KNOWLEDGE_READY = 'chat:getKnowledgeReady';
/** Copy a talk-track string to the clipboard. */
export const IPC_CHAT_COPY_TALK_TRACK = 'chat:copyTalkTrack';

/** main → renderer push: a new turn (user or assistant) was appended. */
export const IPC_CHAT_TURN_APPENDED = 'chat:turnAppended';
/** main → renderer push: ChatState transition (idle/sending/awaiting/error). */
export const IPC_CHAT_STATE_CHANGED = 'chat:stateChanged';
/** main → renderer push: a ChatError variant should be displayed. */
export const IPC_CHAT_ERROR = 'chat:error';
/** main → renderer push: conversationStore was cleared (typically on close). */
export const IPC_CHAT_HISTORY_CLEARED = 'chat:historyCleared';
/** main → renderer push: a turn was removed after a failed send (keeps UI in sync). */
export const IPC_CHAT_TURN_DROPPED = 'chat:turnDropped';

// ---------------------------------------------------------------------------
// AI channels (Chunk 5 — PRD §3.2 locked surface)
// ---------------------------------------------------------------------------

export const IPC_AI_GET_API_KEY = 'ai:getApiKey';
export const IPC_AI_SET_API_KEY = 'ai:setApiKey';
export const IPC_AI_CLEAR_API_KEY = 'ai:clearApiKey';
export const IPC_AI_GET_MODEL = 'ai:getModel';
export const IPC_AI_SET_MODEL = 'ai:setModel';
export const IPC_AI_LIST_MODELS = 'ai:listModels';
export const IPC_AI_GET_STATS = 'ai:getStats';

// ---------------------------------------------------------------------------
// Knowledge channels (internal co-pilot pivot — D-P10 / §3.7)
// ---------------------------------------------------------------------------

export const IPC_KNOWLEDGE_GET_ACTIVE_ALGORITHM = 'knowledge:getActiveAlgorithm';
export const IPC_KNOWLEDGE_SET_ACTIVE_ALGORITHM = 'knowledge:setActiveAlgorithm';
export const IPC_KNOWLEDGE_GET_BUNDLE_INFO = 'knowledge:getBundleInfo';

// ---------------------------------------------------------------------------
// Menu action identifiers (strings sent over IPC_WIDGET_MENU_ACTION)
// ---------------------------------------------------------------------------

export const MENU_ACTION_CAPTURE_NOW = 'captureNow';
export const MENU_ACTION_TOGGLE_AUTO_CAPTURE = 'toggleAutoCapture';
export const MENU_ACTION_OPEN_SETTINGS = 'openSettings';
/**
 * Recovery item shown when the widget is in `permDenied`. Deep-links into
 * the macOS Screen Recording privacy pane via `shell.openExternal`. Replaces
 * the in-app "Open System Settings" button that lived inside the (now
 * removed) first-run modal — see CLAUDE_HANDOFF for the post-Chunk-2 fix.
 */
export const MENU_ACTION_OPEN_SYSTEM_SETTINGS = 'openSystemSettings';
/** Re-run desktopCapturer probe + sync widget status (recovery after TCC change). */
export const MENU_ACTION_REQUEST_SCREEN = 'requestScreenRecording';
/** Chunk 3 — opens the region picker (one window per display). */
export const MENU_ACTION_SET_REGION = 'setRegion';
export const MENU_ACTION_QUIT = 'quit';

export type MenuAction =
  | typeof MENU_ACTION_CAPTURE_NOW
  | typeof MENU_ACTION_TOGGLE_AUTO_CAPTURE
  | typeof MENU_ACTION_OPEN_SETTINGS
  | typeof MENU_ACTION_OPEN_SYSTEM_SETTINGS
  | typeof MENU_ACTION_REQUEST_SCREEN
  | typeof MENU_ACTION_SET_REGION
  | typeof MENU_ACTION_QUIT;
