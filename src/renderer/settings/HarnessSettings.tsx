/**
 * @file src/renderer/settings/HarnessSettings.tsx
 *
 * Why it exists: PRD §3.3 step 4 — the settings window's harness pane.
 * Surfaces:
 *
 *   - Resolved root path (read-only)
 *   - File count, approx tokens, last-loaded timestamp, load duration
 *   - Algorithms / docs / other counts
 *   - "Reload now" button → `window.api.harness.reload()`
 *   - "Browse for harness folder…" button → `window.api.harness.browseRoot()`
 *     followed by `setRootPath()` if a folder is chosen
 *   - Yellow banner when `metadata.warnings.length > 0` (empty dir,
 *     suspicious files skipped, etc.)
 *   - Red banner when `onLoadError` fires — sticky until the next successful
 *     reload, with the structured `HarnessLoadErrorPayload.code` shown
 *
 * State syncing strategy mirrors `<CaptureSettings />`: pull a snapshot on
 * mount, then subscribe to `onReloaded` and `onLoadError` for pushes.
 */

import {
  useCallback,
  useEffect,
  useState,
  type ReactElement,
} from 'react';
import type { HarnessLoadErrorPayload, HarnessMetadata } from '../../shared/types';

function formatTimestamp(ts: number | null): string {
  if (ts === null) return 'never';
  const d = new Date(ts);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

function formatTokenCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

/**
 * Best-effort parse of the JSON payload main packs into the rejected-Promise
 * Error message. If the parse fails the renderer still gets a useful (raw)
 * string surface.
 */
function parseErrorPayload(message: string): HarnessLoadErrorPayload | null {
  try {
    const parsed = JSON.parse(message) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'code' in parsed &&
      'message' in parsed &&
      'rootPath' in parsed
    ) {
      return parsed as HarnessLoadErrorPayload;
    }
    return null;
  } catch {
    return null;
  }
}

export default function HarnessSettings(): ReactElement {
  const [metadata, setMetadata] = useState<HarnessMetadata | null>(null);
  const [rootPath, setRootPath] = useState<string>('…');
  const [busy, setBusy] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<HarnessLoadErrorPayload | null>(null);

  // -------------------------------------------------------------------------
  // Boot — pull the current metadata + root, subscribe to reload events
  // -------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    async function boot(): Promise<void> {
      try {
        const [m, p] = await Promise.all([
          window.api.harness.getMetadata(),
          window.api.harness.getRootPath(),
        ]);
        if (cancelled) return;
        setMetadata(m);
        setRootPath(p);
        setLoadError(null);
      } catch (err) {
        if (cancelled) return;
        // Initial load may have failed before the renderer mounted; pull the
        // root path anyway so the error banner has somewhere to point.
        const message = err instanceof Error ? err.message : String(err);
        const payload = parseErrorPayload(message);
        setLoadError(
          payload ?? {
            code: 'IO_ERROR',
            message,
            rootPath: '',
          },
        );
        try {
          // setState on an unmounted React 18 component is a silent no-op,
          // so we don't gate the `cancelled` flag again here — the cleanup
          // path is the primary defense.
          const p = await window.api.harness.getRootPath();
          setRootPath(p);
        } catch {
          // ignore — primary `loadError` already shown above.
        }
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const offReload = window.api.harness.onReloaded((m) => {
      setMetadata(m);
      setRootPath(m.rootPath);
      setLoadError(null);
    });
    const offError = window.api.harness.onLoadError((e) => {
      setLoadError(e);
    });
    return () => {
      offReload();
      offError();
    };
  }, []);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------
  const handleReload = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      const m = await window.api.harness.reload();
      setMetadata(m);
      setRootPath(m.rootPath);
      setLoadError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLoadError(
        parseErrorPayload(message) ?? {
          code: 'IO_ERROR',
          message,
          rootPath,
        },
      );
    } finally {
      setBusy(false);
    }
  }, [rootPath]);

  const handleBrowse = useCallback(async (): Promise<void> => {
    const chosen = await window.api.harness.browseRoot();
    if (chosen === null) return;
    setBusy(true);
    try {
      const m = await window.api.harness.setRootPath(chosen);
      setMetadata(m);
      setRootPath(m.rootPath);
      setLoadError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLoadError(
        parseErrorPayload(message) ?? {
          code: 'IO_ERROR',
          message,
          rootPath: chosen,
        },
      );
    } finally {
      setBusy(false);
    }
  }, []);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  const fileCount = metadata?.fileCount ?? 0;
  const approxTokens = metadata?.approxTokens ?? 0;
  const algorithms = metadata?.algorithms.length ?? 0;
  const docs = metadata?.docs.length ?? 0;
  const other = metadata?.other.length ?? 0;
  const warnings = metadata?.warnings ?? [];
  const manifestUsed = metadata?.manifestUsed ?? false;

  return (
    <section className="rounded-md border border-white/10 bg-ap-bg p-5">
      <header className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-ap-fg">Harness</h2>
        {manifestUsed && (
          <span className="rounded bg-ap-gold/20 px-2 py-0.5 text-[11px] font-medium text-ap-gold">
            manifest
          </span>
        )}
      </header>

      <div className="mb-4 rounded border border-white/10 bg-black/20 p-3">
        <div className="mb-1 text-xs uppercase tracking-wide text-white/60">
          Root path
        </div>
        <div className="break-all font-mono text-xs text-ap-fg">{rootPath}</div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 text-xs">
        <div className="rounded border border-white/10 bg-black/20 p-3">
          <div className="text-white/60">Files</div>
          <div className="font-mono text-ap-fg">{fileCount}</div>
          <div className="mt-1 text-[10px] text-white/40">
            {algorithms} algorithms · {docs} docs · {other} other
          </div>
        </div>
        <div className="rounded border border-white/10 bg-black/20 p-3">
          <div className="text-white/60">Approx tokens</div>
          <div className="font-mono text-ap-fg">{formatTokenCount(approxTokens)}</div>
          <div className="mt-1 text-[10px] text-white/40">±15% (char-based)</div>
        </div>
        <div className="rounded border border-white/10 bg-black/20 p-3">
          <div className="text-white/60">Last loaded</div>
          <div className="font-mono text-ap-fg">
            {formatTimestamp(metadata?.loadedAt ?? null)}
          </div>
        </div>
        <div className="rounded border border-white/10 bg-black/20 p-3">
          <div className="text-white/60">Load duration</div>
          <div className="font-mono text-ap-fg">
            {metadata?.loadDurationMs !== undefined
              ? `${String(metadata.loadDurationMs)} ms`
              : '—'}
          </div>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="mb-4 rounded border border-amber-500/40 bg-amber-500/10 p-3">
          <div className="mb-1 text-xs font-medium text-amber-300">
            {warnings.length} warning{warnings.length === 1 ? '' : 's'}
          </div>
          <ul className="ml-4 list-disc space-y-0.5 text-[11px] text-amber-200/80">
            {warnings.map((w, i) => (
              <li key={i} className="break-words">
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      {loadError !== null && (
        <div className="mb-4 rounded border border-red-500/50 bg-red-500/10 p-3">
          <div className="mb-1 text-xs font-medium text-red-300">
            Load failed: {loadError.code}
          </div>
          <p className="break-words text-[11px] text-red-200/80">
            {loadError.message}
          </p>
          {loadError.code === 'ROOT_NOT_FOUND' && (
            <p className="mt-1 text-[11px] text-red-200/70">
              Choose a folder to recover.
            </p>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void handleReload()}
          disabled={busy}
          className="rounded bg-ap-green/30 px-3 py-1.5 text-xs font-medium text-ap-fg hover:bg-ap-green/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Reload now
        </button>
        <button
          type="button"
          onClick={() => void handleBrowse()}
          disabled={busy}
          className="rounded bg-white/10 px-3 py-1.5 text-xs text-ap-fg hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Browse for harness folder…
        </button>
      </div>
    </section>
  );
}
