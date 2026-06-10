/**
 * @file src/renderer/regionPicker/RegionPicker.tsx
 *
 * Why it exists: PRD §0 D6/D7 — the per-display picker UI. Mounts inside a
 * fullscreen frameless `BrowserWindow` (one per display, spawned by
 * `regionPicker.ts` in main). Responsibilities:
 *
 *   - Capture mouse drag → normalized logical-CSS-pixel rect
 *   - Render the live draw rectangle + a corner dimensions label
 *   - ESC cancels (always sends `region.cancel` over IPC; main tears down
 *     all picker windows)
 *   - Enter confirms the current rect (no-op if no drag has happened yet)
 *   - Mouse-up after a viable drag confirms automatically (no Enter needed)
 *
 * The `displayId` for this window is read from the URL — the main-side
 * controller passes it as a query/hash param when it constructs the URL
 * (`buildPickerUrl` in `regionPicker.ts`).
 */

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import styles from './regionPicker.module.css';
import {
  rectFromDrag,
  isRectViable,
  type PickerRect,
  type Point,
} from './regionGeometry';

interface DragState {
  start: Point;
  current: Point;
  /** True while the mouse button is held; flipped off on mouseup. */
  active: boolean;
}

function readDisplayIdFromLocation(): number | null {
  const fromQuery = new URLSearchParams(window.location.search).get('displayId');
  const fromHash = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('displayId');
  const raw = fromQuery ?? fromHash;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export default function RegionPicker(): ReactElement {
  const displayId = useRef<number | null>(readDisplayIdFromLocation());
  const [drag, setDrag] = useState<DragState | null>(null);
  const [confirmedRect, setConfirmedRect] = useState<PickerRect | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // -------------------------------------------------------------------------
  // Confirm / cancel
  // -------------------------------------------------------------------------
  const sendCancel = useCallback((): void => {
    window.api.region._pickerCancel();
  }, []);

  const sendConfirm = useCallback((rect: PickerRect): void => {
    const id = displayId.current;
    if (id === null) {
      window.api.log.warn('regionPicker.confirmWithoutDisplayId', { rect });
      return;
    }
    window.api.region._pickerConfirm({ displayId: id, rect });
  }, []);

  // -------------------------------------------------------------------------
  // Keyboard: ESC = cancel, Enter = confirm current rect
  // -------------------------------------------------------------------------
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault();
        sendCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (confirmedRect && isRectViable(confirmedRect)) {
          sendConfirm(confirmedRect);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [confirmedRect, sendCancel, sendConfirm]);

  // -------------------------------------------------------------------------
  // Mouse: drag to define the rect
  // -------------------------------------------------------------------------
  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    const point = { x: e.clientX, y: e.clientY };
    setDrag({ start: point, current: point, active: true });
    setConfirmedRect(null);
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>): void => {
      if (!drag?.active) return;
      setDrag({ ...drag, current: { x: e.clientX, y: e.clientY } });
    },
    [drag],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLDivElement>): void => {
      if (!drag?.active) return;
      const final = { x: e.clientX, y: e.clientY };
      const rect = rectFromDrag(drag.start, final, {
        width: window.innerWidth,
        height: window.innerHeight,
      });
      setDrag({ ...drag, current: final, active: false });
      if (isRectViable(rect)) {
        setConfirmedRect(rect);
        // Per PRD §3.3 step 3 — releasing the mouse confirms the rect.
        sendConfirm(rect);
      }
    },
    [drag, sendConfirm],
  );

  // While dragging, compute the visible rect; once dropped, show the
  // confirmed rect (the picker window will tear down moments later, so
  // this is mostly to keep the visual stable across the IPC round-trip).
  const visibleRect: PickerRect | null = drag
    ? rectFromDrag(drag.start, drag.current, {
        width: window.innerWidth,
        height: window.innerHeight,
      })
    : confirmedRect;

  return (
    <div
      ref={containerRef}
      className={styles.scrim}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {visibleRect && visibleRect.w > 0 && visibleRect.h > 0 && (
        <>
          <div
            className={styles.rect}
            style={{
              left: `${String(visibleRect.x)}px`,
              top: `${String(visibleRect.y)}px`,
              width: `${String(visibleRect.w)}px`,
              height: `${String(visibleRect.h)}px`,
            }}
          />
          <div
            className={styles.dimensions}
            style={{
              left: `${String(visibleRect.x)}px`,
              top: `${String(Math.max(0, visibleRect.y - 22))}px`,
            }}
          >
            {Math.round(visibleRect.w)} × {Math.round(visibleRect.h)} px
          </div>
        </>
      )}
      <div className={styles.hintBar}>
        <span>
          <span className={styles.kbd}>Drag</span>to set capture region
        </span>
        <span>
          <span className={styles.kbd}>Enter</span>confirm
        </span>
        <span>
          <span className={styles.kbd}>Esc</span>cancel
        </span>
      </div>
    </div>
  );
}
