/**
 * @file src/renderer/chat/UpdateBanner.tsx
 *
 * Why it exists: Chunk 7 Phase 3 — slim, dismissible strip at the top of the
 * chat panel. Never modal, never focus-stealing (PRD task 3.5 / D7 / D10).
 *   - Windows downloaded: "Update vX ready — installs when you close" + Restart now
 *   - macOS notify-only: "Update vX available — download" → release page
 * Absolute positioning keeps the message list layout stable when shown/hidden.
 */

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { UpdateState, UpdateStateSnapshot } from '../../shared/updateTypes';

const IDLE_LIKE: ReadonlySet<UpdateState> = new Set(['idle', 'checking', 'available', 'downloading']);

function shouldShow(state: UpdateState): boolean {
  return state === 'downloaded' || state === 'notify-only' || state === 'error';
}

export default function UpdateBanner(): ReactElement | null {
  const [snapshot, setSnapshot] = useState<UpdateStateSnapshot | null>(null);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.api.updates.getState().then((s) => {
      if (!cancelled) setSnapshot(s);
    });
    const off = window.api.updates.onStateChanged((s) => {
      setSnapshot(s);
      // A new version clears a prior dismiss.
      setDismissedFor((prev) => {
        if (prev && s.version && prev !== s.version) return null;
        if (prev && s.state === 'idle') return null;
        return prev;
      });
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const handleDismiss = useCallback((): void => {
    if (!snapshot) return;
    setDismissedFor(snapshot.version ?? snapshot.state);
  }, [snapshot]);

  const handleRestart = useCallback((): void => {
    void window.api.updates.install();
  }, []);

  const handleDownload = useCallback((): void => {
    void window.api.updates.openReleasePage();
  }, []);

  if (!snapshot || !shouldShow(snapshot.state)) return null;
  if (dismissedFor !== null) {
    const key = snapshot.version ?? snapshot.state;
    if (dismissedFor === key) return null;
  }

  // Reserve a fixed-height slot so showing/hiding the banner does not shift
  // the message list (PRD: "does not shift the message list layout").
  const barClass =
    'flex shrink-0 items-center gap-2 border-b px-3 py-1.5 text-[11px]';

  if (snapshot.state === 'downloaded' && snapshot.version) {
    return (
      <div
        role="status"
        className={`${barClass} border-ap-green/40 bg-ap-green/15 text-ap-fg`}
        data-testid="update-banner-downloaded"
      >
        <span className="min-w-0 flex-1 truncate">
          Update v{snapshot.version} ready — installs when you close the app
        </span>
        <button
          type="button"
          onClick={handleRestart}
          className="shrink-0 rounded bg-ap-green/30 px-2 py-0.5 font-medium text-ap-fg hover:bg-ap-green/50"
        >
          Restart now
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss update banner"
          className="shrink-0 rounded px-1.5 py-0.5 text-white/60 hover:bg-white/10 hover:text-white"
        >
          ✕
        </button>
      </div>
    );
  }

  if (snapshot.state === 'notify-only' && snapshot.version) {
    return (
      <div
        role="status"
        className={`${barClass} border-ap-gold/40 bg-ap-gold/10 text-ap-fg`}
        data-testid="update-banner-notify"
      >
        <span className="min-w-0 flex-1 truncate">
          Update v{snapshot.version} available — download
        </span>
        <button
          type="button"
          onClick={handleDownload}
          className="shrink-0 rounded bg-ap-gold/25 px-2 py-0.5 font-medium text-ap-fg hover:bg-ap-gold/40"
        >
          Download
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss update banner"
          className="shrink-0 rounded px-1.5 py-0.5 text-white/60 hover:bg-white/10 hover:text-white"
        >
          ✕
        </button>
      </div>
    );
  }

  if (snapshot.state === 'error') {
    return (
      <div
        role="status"
        className={`${barClass} border-amber-400/40 bg-ap-warning/80 text-amber-50`}
        data-testid="update-banner-error"
      >
        <span className="min-w-0 flex-1 truncate">
          Update check failed{snapshot.error ? `: ${snapshot.error}` : ''}
        </span>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss update banner"
          className="shrink-0 rounded px-1.5 py-0.5 text-amber-50/70 hover:bg-white/10 hover:text-amber-50"
        >
          ✕
        </button>
      </div>
    );
  }

  // Exhaustiveness for TypeScript — idle-like states return null above.
  void IDLE_LIKE;
  return null;
}
