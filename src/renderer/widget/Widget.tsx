/**
 * @file src/renderer/widget/Widget.tsx
 *
 * Why it exists: The 48×48 circular pill the user sees hovering over
 * TradingView. Chunk 2 scope (PRD §3.3):
 *
 *   - Status-driven visual (pulse on ready, static on paused, amber on permDenied)
 *   - Drag via pointer events on the pill body (IPC `moveBy`) plus native
 *     `-webkit-app-region: drag` on the 4px halo frame
 *   - Left-click emits a `widget:click` IPC event when pointer-up stays
 *     within the drag threshold (opens chat in Chunk 5)
 *   - Right-click asks main to pop up the native context menu
 *   - Click-through halo: window ignores mouse events by default; entering the
 *     frame flips to interactive via `setInteractive(true)` (D5 seam)
 *
 * First-run permission handling: the in-app explainer modal was removed
 * because a 420 px dialog cannot fit inside a 56×56 BrowserWindow. The
 * macOS native screen-recording prompt is now the first-run modal — main
 * fires `requestScreenRecording()` on boot when status is `not-determined`.
 * Recovery from the denied state lives in the right-click menu (`Open
 * System Settings…`).
 */

import { useCallback, useEffect, useRef, type ReactElement } from 'react';
import styles from './widget.module.css';
import { statusFromPermission, useWidgetStore } from './widgetStore';
import {
  createPointerDragState,
  pointerUpIsClick,
  stepPointerDrag,
  type PointerDragState,
} from './widgetPointer';
import type { WidgetStatus } from '../../shared/types';

function ringClassFor(status: WidgetStatus): string {
  switch (status) {
    case 'paused':
      return styles.ringPaused;
    case 'permDenied':
      return styles.ringPermDenied;
    case 'capturing':
      return styles.ringCapturing;
    case 'ready':
    default:
      return styles.ringReady;
  }
}

function classNames(...parts: readonly (string | false)[]): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' ');
}

export default function Widget(): ReactElement {
  const status = useWidgetStore((s) => s.status);
  const setStatus = useWidgetStore((s) => s.setStatus);
  const setPermission = useWidgetStore((s) => s.setPermission);

  const bodyRef = useRef<HTMLDivElement>(null);
  const pointerDragRef = useRef<PointerDragState | null>(null);

  // -------------------------------------------------------------------------
  // Boot: pull persisted status + live permission state from main. The OS
  // prompt (if needed) is fired by main during app boot, so the renderer
  // only mirrors what main reports.
  // -------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function boot(): Promise<void> {
      try {
        const [initStatus, initPerm] = await Promise.all([
          window.api.widget.getStatus(),
          window.api.perms.getScreenRecordingStatus(),
        ]);
        if (cancelled) return;
        setPermission(initPerm);
        // Prefer live OS permission for the ring when store is stale (e.g. user
        // just enabled Screen Recording in System Settings).
        const fromOs = statusFromPermission(initPerm);
        const displayStatus =
          initStatus === 'paused'
            ? 'paused'
            : fromOs === 'permDenied'
              ? 'permDenied'
              : fromOs === 'ready'
                ? 'ready'
                : initStatus;
        setStatus(displayStatus);
        window.api.log.debug('widget.boot', {
          status: displayStatus,
          persistedStatus: initStatus,
          permission: initPerm,
        });
      } catch (err) {
        window.api.log.error('widget.bootFailed', { message: String(err) });
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, [setPermission, setStatus]);

  // Subscribe to main → renderer status pushes (e.g., permission flip after
  // the OS prompt resolves, or the user toggles auto-capture).
  useEffect(() => {
    const off = window.api.widget.onStatusChanged((next) => {
      setStatus(next);
    });
    return off;
  }, [setStatus]);

  // -------------------------------------------------------------------------
  // Interaction handlers
  // -------------------------------------------------------------------------
  const handleFrameEnter = useCallback((): void => {
    window.api.widget.setInteractive(true);
  }, []);

  const handleFrameLeave = useCallback((): void => {
    pointerDragRef.current = null;
    window.api.widget.setInteractive(false);
  }, []);

  const emitClick = useCallback((clientX: number, clientY: number): void => {
    const el = bodyRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    window.api.widget.emitClick({
      at: { x: clientX, y: clientY },
      bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      ts: Date.now(),
    });
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    window.api.widget.setInteractive(true);
    pointerDragRef.current = createPointerDragState(e.screenX, e.screenY);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>): void => {
    const state = pointerDragRef.current;
    if (!state) return;
    const { dx, dy } = stepPointerDrag(state, e.screenX, e.screenY);
    if (dx !== 0 || dy !== 0) {
      window.api.widget.moveBy({ dx, dy });
    }
  }, []);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      if (e.button !== 0) return;
      const state = pointerDragRef.current;
      pointerDragRef.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // capture may already be released
      }
      if (pointerUpIsClick(state)) {
        emitClick(e.clientX, e.clientY);
      }
    },
    [emitClick],
  );

  const handlePointerCancel = useCallback((): void => {
    pointerDragRef.current = null;
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>): void => {
    e.preventDefault();
    window.api.widget.openContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  const ringClass = ringClassFor(status);
  const pulseClass = status === 'ready' ? styles.pulseReady : '';

  return (
    <div
      className={styles.frame}
      onMouseEnter={handleFrameEnter}
      onMouseLeave={handleFrameLeave}
    >
      <div
        ref={bodyRef}
        role="button"
        tabIndex={0}
        className={classNames(styles.body, ringClass, pulseClass)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onContextMenu={handleContextMenu}
      >
        <span className={styles.glyph} aria-hidden>
          AP
        </span>
      </div>
    </div>
  );
}
