/**
 * @file src/renderer/chat/chatStore.ts
 *
 * Why it exists: Renderer-side source of truth for the chat UI. Main is
 * authoritative for conversation memory + the FSM transitions; this store
 * is a thin Zustand mirror so React renders without round-tripping every
 * read through IPC.
 *
 * Pure setters only. The component layer subscribes to push events from
 * main (`onTurnAppended`, `onStateChanged`, `onError`, `onHistoryCleared`)
 * and feeds them in here.
 */

import { create } from 'zustand';
import type {
  ChatError,
  ChatState,
  ChatTurn,
  GeminiCallStats,
  Screenshot,
} from '../../shared/types';

export interface ChatUiState {
  /** Newest-at-end. Mirrors `conversationStore.getHistory()`. */
  turns: ChatTurn[];
  state: ChatState;
  error: ChatError | null;
  /** Whether the chat window is open per main-side `isOpen()`. */
  isOpen: boolean;
  /** Cached stats projection — null while loading. */
  stats: GeminiCallStats | null;
  /** Active model name — pulled at boot so the header renders without a flash. */
  model: string;
  /** Current input draft. Lives in the store so quick-prompts can prefill it. */
  draft: string;
  /** Screenshots queued for the next outgoing message (oldest-first). */
  pendingScreenshots: readonly Screenshot[];

  setTurns: (turns: ChatTurn[]) => void;
  appendTurn: (turn: ChatTurn) => void;
  setState: (s: ChatState) => void;
  setError: (e: ChatError | null) => void;
  clear: () => void;
  setIsOpen: (open: boolean) => void;
  setStats: (s: GeminiCallStats | null) => void;
  setModel: (model: string) => void;
  setDraft: (draft: string) => void;
  addPendingScreenshot: (screenshot: Screenshot) => void;
  removePendingScreenshot: (id: string) => void;
  clearPendingScreenshots: () => void;
}

export const useChatStore = create<ChatUiState>((set) => ({
  turns: [],
  state: 'idle',
  error: null,
  isOpen: false,
  stats: null,
  model: '',
  draft: '',
  pendingScreenshots: [],

  setTurns: (turns) => {
    set({ turns });
  },
  appendTurn: (turn) => {
    set((s) => ({ turns: [...s.turns, turn] }));
  },
  setState: (s) => {
    // Clear stale errors on any non-error transition.
    set((prev) => ({ state: s, error: s === 'error' ? prev.error : null }));
  },
  setError: (e) => {
    set({ error: e, state: e ? 'error' : 'idle' });
  },
  clear: () => {
    set({ turns: [], state: 'idle', error: null, draft: '', pendingScreenshots: [] });
  },
  setIsOpen: (open) => {
    set({ isOpen: open });
  },
  setStats: (stats) => {
    set({ stats });
  },
  setModel: (model) => {
    set({ model });
  },
  setDraft: (draft) => {
    set({ draft });
  },
  addPendingScreenshot: (screenshot) => {
    set((s) => ({
      pendingScreenshots: [...s.pendingScreenshots, screenshot],
    }));
  },
  removePendingScreenshot: (id) => {
    set((s) => ({
      pendingScreenshots: s.pendingScreenshots.filter((shot) => shot.id !== id),
    }));
  },
  clearPendingScreenshots: () => {
    set({ pendingScreenshots: [] });
  },
}));
