/**
 * @file src/renderer/settings/RecentCapturesPanel.tsx
 *
 * Why it exists: PRD §3.3 step 7 + D13 — dev-only thumbnail grid showing
 * the last `N=5` captures with their IDs, timestamps, and dimensions. Helps
 * verify the pipeline visually without inspecting `logs/app-*.jsonl`.
 *
 * Gating (PRD D13): the panel renders only when
 *   `import.meta.env.DEV === true` OR `capture.dev.showRecentCaptures` is true.
 * The store flag is opaque to this component; the gating decision is taken
 * by the parent (`SettingsShell.tsx`) which only mounts this when allowed.
 */

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { Screenshot } from '../../shared/types';

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function formatBytes(b: number): string {
  if (b < 1024) return `${String(b)} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

export default function RecentCapturesPanel(): ReactElement {
  const [items, setItems] = useState<readonly Screenshot[]>([]);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const list = await window.api.capture.getRecent();
      setItems(list);
    } catch (err) {
      window.api.log.warn('recentCaptures.refreshFailed', { message: String(err) });
    }
  }, []);

  // Boot + subscribe to per-capture pushes so the panel updates live.
  useEffect(() => {
    void refresh();
    const off = window.api.capture.onCaptured(() => {
      void refresh();
    });
    return off;
  }, [refresh]);

  return (
    <section className="rounded-md border border-amber-500/30 bg-amber-500/5 p-5">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-amber-300">
          Recent captures{' '}
          <span className="ml-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">
            dev
          </span>
        </h2>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded bg-white/10 px-2 py-0.5 text-[11px] text-ap-fg hover:bg-white/15"
        >
          Refresh
        </button>
      </header>
      {items.length === 0 ? (
        <p className="text-xs text-white/50">No captures yet.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-2">
          {items.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between rounded border border-white/5 bg-black/30 p-2 font-mono text-[11px] text-white/80"
            >
              <div className="flex flex-col">
                <span className="text-amber-200">{s.id}</span>
                <span className="text-white/50">
                  {formatTime(s.timestamp)} · {s.width}×{s.height} · {formatBytes(s.bytes)}
                </span>
              </div>
              <span className="ml-2 truncate text-[10px] text-white/40" title={s.filepath}>
                …/{s.filepath.split('/').slice(-2).join('/')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
