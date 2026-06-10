/**
 * @file src/renderer/settings/CaptureSettings.tsx
 *
 * Why it exists: PRD §3.3 step 7 — the settings window's capture pane.
 * Surfaces:
 *
 *   - Interval slider (5–60 s) with 150ms IPC debounce so dragging from
 *     60→5 doesn't spam main (PRD §6 mitigation row)
 *   - Current region status: display name + dimensions + age, or "no region
 *     set" with a CTA to draw one
 *   - "Re-draw region" button that calls `window.api.region.openPicker()`
 *   - Live loop state: running/paused indicator + last-capture timestamp
 *
 * State syncing strategy: pulls a snapshot on mount, then subscribes to
 * `onLoopStateChanged` for pushes. The slider value is debounced locally
 * so the user sees instant feedback while only one IPC call lands per
 * `CAPTURE_INTERVAL_SLIDER_DEBOUNCE_MS` window.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement,
} from 'react';
import type { CaptureLoopState, CaptureRegion } from '../../shared/types';
import {
  CAPTURE_DEFAULT_INTERVAL_MS,
  CAPTURE_INTERVAL_MAX_MS,
  CAPTURE_INTERVAL_MIN_MS,
  CAPTURE_INTERVAL_SLIDER_DEBOUNCE_MS,
} from '../../shared/constants';

function formatInterval(ms: number): string {
  return `${(ms / 1000).toFixed(0)}s`;
}

function formatAge(ts: number | null): string {
  if (ts === null) return 'never';
  const ageS = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (ageS < 60) return `${String(ageS)}s ago`;
  if (ageS < 3600) return `${String(Math.round(ageS / 60))}m ago`;
  return `${String(Math.round(ageS / 3600))}h ago`;
}

export default function CaptureSettings(): ReactElement {
  const [loopState, setLoopState] = useState<CaptureLoopState>({
    running: false,
    intervalMs: CAPTURE_DEFAULT_INTERVAL_MS,
    lastCaptureTs: null,
    regionValid: false,
  });
  const [region, setRegion] = useState<CaptureRegion | null>(null);
  const [sliderMs, setSliderMs] = useState<number>(CAPTURE_DEFAULT_INTERVAL_MS);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // -------------------------------------------------------------------------
  // Boot: pull initial snapshot, subscribe to loop-state pushes
  // -------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    async function boot(): Promise<void> {
      try {
        const [ls, r] = await Promise.all([
          window.api.capture.getLoopState(),
          window.api.region.getRegion(),
        ]);
        if (cancelled) return;
        setLoopState(ls);
        setSliderMs(ls.intervalMs);
        setRegion(r);
      } catch (err) {
        window.api.log.error('captureSettings.bootFailed', { message: String(err) });
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const off = window.api.capture.onLoopStateChanged((next) => {
      setLoopState(next);
      setSliderMs(next.intervalMs);
    });
    return off;
  }, []);

  useEffect(() => {
    // Refresh the region whenever the loop state's regionValid flips —
    // covers the "user just confirmed a new region" case without an extra
    // dedicated subscription.
    let cancelled = false;
    void window.api.region.getRegion().then((r) => {
      if (!cancelled) setRegion(r);
    });
    return () => {
      cancelled = true;
    };
  }, [loopState.regionValid]);

  // -------------------------------------------------------------------------
  // Slider with debounced IPC
  // -------------------------------------------------------------------------
  const handleSlider = useCallback((e: ChangeEvent<HTMLInputElement>): void => {
    const next = Number(e.target.value);
    setSliderMs(next);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      void window.api.capture.setIntervalMs(next);
    }, CAPTURE_INTERVAL_SLIDER_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------
  const handleRedraw = useCallback((): void => {
    void window.api.region.openPicker().then((r) => {
      if (r) setRegion(r);
    });
  }, []);

  const handleStartStop = useCallback((): void => {
    if (loopState.running) {
      void window.api.capture.stop();
    } else {
      void window.api.capture.start();
    }
  }, [loopState.running]);

  const handleCaptureNow = useCallback((): void => {
    void window.api.capture.captureNow();
  }, []);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <section className="rounded-md border border-white/10 bg-ap-bg p-5">
      <header className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-ap-fg">Screen Capture</h2>
        <span
          className={
            loopState.running
              ? 'rounded bg-emerald-500/20 px-2 py-0.5 text-[11px] font-medium text-emerald-300'
              : 'rounded bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/70'
          }
        >
          {loopState.running ? 'Running' : 'Paused'}
        </span>
      </header>

      <div className="mb-5">
        <label
          htmlFor="capture-interval"
          className="mb-1 flex items-center justify-between text-xs uppercase tracking-wide text-white/60"
        >
          <span>Capture interval</span>
          <span className="font-mono text-ap-fg">{formatInterval(sliderMs)}</span>
        </label>
        <input
          id="capture-interval"
          type="range"
          min={CAPTURE_INTERVAL_MIN_MS}
          max={CAPTURE_INTERVAL_MAX_MS}
          step={1000}
          value={sliderMs}
          onChange={handleSlider}
          className="w-full"
        />
        <div className="mt-1 flex justify-between text-[10px] text-white/40">
          <span>{formatInterval(CAPTURE_INTERVAL_MIN_MS)}</span>
          <span>{formatInterval(CAPTURE_INTERVAL_MAX_MS)}</span>
        </div>
      </div>

      <div className="mb-5 rounded border border-white/10 bg-black/20 p-3">
        <div className="mb-2 text-xs uppercase tracking-wide text-white/60">
          Capture region
        </div>
        {region ? (
          <div className="font-mono text-xs text-ap-fg">
            <div>
              Display <span className="text-ap-gold">{region.displayId}</span>{' '}
              <span className="text-white/50">
                ({region.scaleFactor}× scale)
              </span>
            </div>
            <div className="text-white/70">
              {region.w} × {region.h} CSS px
              <span className="text-white/40"> · </span>
              {region.pw} × {region.ph} device px
            </div>
          </div>
        ) : (
          <div className="text-xs text-white/60">No region set yet.</div>
        )}
        <button
          type="button"
          onClick={handleRedraw}
          className="mt-3 rounded bg-white/10 px-3 py-1 text-xs text-ap-fg hover:bg-white/15"
        >
          {region ? 'Re-draw region' : 'Set capture region'}
        </button>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleStartStop}
          disabled={!loopState.regionValid}
          className="rounded bg-ap-green/30 px-3 py-1.5 text-xs font-medium text-ap-fg hover:bg-ap-green/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loopState.running ? 'Stop auto-capture' : 'Start auto-capture'}
        </button>
        <button
          type="button"
          onClick={handleCaptureNow}
          disabled={!loopState.regionValid}
          className="rounded bg-white/10 px-3 py-1.5 text-xs text-ap-fg hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Capture now
        </button>
        <span className="ml-auto self-center text-[11px] text-white/50">
          Last capture: {formatAge(loopState.lastCaptureTs)}
        </span>
      </div>
    </section>
  );
}
