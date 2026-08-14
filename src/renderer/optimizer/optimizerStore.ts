/**
 * @file src/renderer/optimizer/optimizerStore.ts
 *
 * Zustand mirror for the optimizer panel (PRD_Optimizer_MCP_Integration
 * D-M6). Main owns the job state machine (`optimizerJobTracker`); this store
 * is a thin render mirror fed by `optimizer:jobStateChanged` pushes and the
 * initial getters — same discipline as `chatStore.ts`. Pure setters only.
 */

import { create } from 'zustand';
import type {
  OptimizerJobSnapshot,
  OptimizerStatus,
  OptimizerToolsInfo,
} from '../../shared/optimizerTypes';

export interface OptimizerUiState {
  status: OptimizerStatus | null;
  toolsInfo: OptimizerToolsInfo | null;
  snapshot: OptimizerJobSnapshot | null;
  /** True while a start request is in flight (before the first snapshot). */
  starting: boolean;
  /** Transient UI acknowledgements. */
  copied: boolean;
  queuedForChat: boolean;

  setStatus: (status: OptimizerStatus | null) => void;
  setToolsInfo: (info: OptimizerToolsInfo | null) => void;
  setSnapshot: (snapshot: OptimizerJobSnapshot | null) => void;
  setStarting: (starting: boolean) => void;
  setCopied: (copied: boolean) => void;
  setQueuedForChat: (queued: boolean) => void;
}

export const useOptimizerStore = create<OptimizerUiState>((set) => ({
  status: null,
  toolsInfo: null,
  snapshot: null,
  starting: false,
  copied: false,
  queuedForChat: false,

  setStatus: (status) => {
    set({ status });
  },
  setToolsInfo: (toolsInfo) => {
    set({ toolsInfo });
  },
  setSnapshot: (snapshot) => {
    // A fresh snapshot invalidates the one-shot acknowledgements.
    set({ snapshot, starting: false, copied: false, queuedForChat: false });
  },
  setStarting: (starting) => {
    set({ starting });
  },
  setCopied: (copied) => {
    set({ copied });
  },
  setQueuedForChat: (queuedForChat) => {
    set({ queuedForChat });
  },
}));
