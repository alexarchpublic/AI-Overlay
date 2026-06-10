/**
 * @file src/renderer/widget/widgetStore.ts
 *
 * Why it exists: Renderer-side source of truth for the widget's UI state.
 * Thin Zustand slice; main is still authoritative for persistence — this
 * store only holds what the React components need for rendering.
 *
 * Chunk 3 additions:
 *   - `'capturing'` enters the WidgetStatus union (handled by the existing
 *     `setStatus` setter, no new method needed)
 *   - `flashCapturing()` helper that locally sets `'capturing'` and resets
 *     to `'ready'` after `CAPTURE_FLASH_MS` UNLESS the user paused mid-flash,
 *     in which case `'paused'` wins (PRD §0 D11)
 *
 * Note (post Chunk 2 first-run fix): the in-app permission modal was removed
 * because the 56×56 overlay window cannot host a 420 px dialog. The OS-native
 * macOS prompt now serves as the first-run modal; the renderer only renders
 * the pill and reflects the resulting `WidgetStatus`. The store accordingly
 * no longer carries any modal-visibility state.
 */

import { create } from 'zustand';
import type { PermissionState, WidgetStatus } from '../../shared/types';
import { CAPTURE_FLASH_MS } from '../../shared/constants';

export interface WidgetUiState {
  status: WidgetStatus;
  /** macOS screen-recording state. Drives the amber/green decision at boot. */
  permission: PermissionState;
  /** Whether the cursor is currently over the clickable pill body. */
  hovered: boolean;

  setStatus: (next: WidgetStatus) => void;
  setPermission: (next: PermissionState) => void;
  setHovered: (hovered: boolean) => void;
  /**
   * Compose a permission outcome into a concrete widget status. Pure
   * transition — exported so tests can assert it without spinning up a
   * React tree.
   */
  applyPermissionOutcome: (next: PermissionState) => void;
  /**
   * Locally flash the widget to `'capturing'` for `CAPTURE_FLASH_MS`, then
   * auto-reset. Called by Widget.tsx when a `capture:captured` push arrives.
   * If the status has changed to `'paused'` or `'permDenied'` by the time
   * the timer fires, the reset is skipped (PRD §0 D11 — paused wins).
   */
  flashCapturing: () => void;
}

/** Pure reducer — exported so tests assert transitions without the hook. */
export function statusFromPermission(p: PermissionState): WidgetStatus {
  return p === 'granted' || p === 'restricted' ? 'ready' : 'permDenied';
}

/**
 * Pure decision: should a `'capturing'` flash auto-reset to the given
 * `current` status? Exported so tests assert the rule without timers.
 *
 * Rule: if the status has been changed by something else mid-flash (paused
 * by user, perm flipped to denied), keep the current status; only revert if
 * we're still in `'capturing'`. The reset target is always `'ready'`.
 */
export function decideFlashReset(current: WidgetStatus): WidgetStatus {
  return current === 'capturing' ? 'ready' : current;
}

export const useWidgetStore = create<WidgetUiState>((set, get) => ({
  status: 'ready',
  permission: 'unknown',
  hovered: false,

  setStatus: (next) => {
    set({ status: next });
  },
  setPermission: (next) => {
    set({ permission: next });
  },
  setHovered: (hovered) => {
    set({ hovered });
  },
  applyPermissionOutcome: (next) => {
    set({ permission: next, status: statusFromPermission(next) });
  },
  flashCapturing: () => {
    // Don't stomp paused/permDenied — those are user-visible commitments.
    const cur = get().status;
    if (cur !== 'ready' && cur !== 'capturing') return;
    set({ status: 'capturing' });
    setTimeout(() => {
      set({ status: decideFlashReset(get().status) });
    }, CAPTURE_FLASH_MS);
  },
}));
