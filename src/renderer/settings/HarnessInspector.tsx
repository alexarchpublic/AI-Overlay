/**
 * @file src/renderer/settings/HarnessInspector.tsx
 *
 * Why it exists: PRD §3.3 step 4 / §0 D17 — the dev-only "what did we
 * actually feed Gemini?" view. Two panes:
 *
 *   - Top: the per-file metadata grid (relPath, classification, bytes,
 *     approx tokens, modifiedAt). Cheap — read from `getMetadata()`.
 *   - Bottom: the full envelope-wrapped bundle text in a `<pre>` block.
 *     Lazily fetched via `getBundleText()` so we don't pay the IPC cost
 *     unless the developer opens the panel.
 *
 * Gating (PRD §0 D17 / §5 DoD #12 / #18): the parent (`SettingsShell.tsx`)
 * only mounts this when allowed. Defense-in-depth still lives in main —
 * `getBundleText()` rejects in production with the inspector flag off.
 */

import {
  useCallback,
  useEffect,
  useState,
  type ReactElement,
} from 'react';
import type { HarnessFileMeta, HarnessMetadata } from '../../shared/types';

function formatBytes(b: number): string {
  if (b < 1024) return `${String(b)} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

export default function HarnessInspector(): ReactElement {
  const [metadata, setMetadata] = useState<HarnessMetadata | null>(null);
  const [bundleText, setBundleText] = useState<string | null>(null);
  const [bundleErr, setBundleErr] = useState<string | null>(null);
  const [showBundle, setShowBundle] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    void window.api.harness
      .getMetadata()
      .then((m) => {
        if (!cancelled) setMetadata(m);
      })
      .catch(() => {
        // The parent panel surfaces load errors; swallow here.
      });
    const off = window.api.harness.onReloaded((m) => {
      setMetadata(m);
      // Invalidate the cached bundle text — next "Show bundle" click
      // re-fetches.
      setBundleText(null);
      setBundleErr(null);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const handleShowBundle = useCallback(async (): Promise<void> => {
    setShowBundle(true);
    if (bundleText !== null) return;
    try {
      const text = await window.api.harness.getBundleText();
      setBundleText(text);
      setBundleErr(null);
    } catch (err) {
      setBundleErr(err instanceof Error ? err.message : String(err));
    }
  }, [bundleText]);

  const files: readonly HarnessFileMeta[] = metadata?.files ?? [];

  return (
    <section className="rounded-md border border-amber-500/30 bg-amber-500/5 p-5">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-amber-300">
          Harness inspector{' '}
          <span className="ml-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">
            dev
          </span>
        </h2>
      </header>

      {files.length === 0 ? (
        <p className="text-xs text-white/50">No files loaded.</p>
      ) : (
        <ul className="mb-4 max-h-48 overflow-y-auto rounded border border-white/5 bg-black/30">
          {files.map((f) => (
            <li
              key={f.relPath}
              className="flex items-center justify-between border-b border-white/5 px-2 py-1 font-mono text-[11px] text-white/80 last:border-b-0"
            >
              <span className="flex flex-1 items-center gap-2 truncate">
                <span
                  className={
                    f.classification === 'algorithms'
                      ? 'rounded bg-ap-green/20 px-1 text-[9px] uppercase text-ap-green'
                      : f.classification === 'docs'
                        ? 'rounded bg-ap-gold/20 px-1 text-[9px] uppercase text-ap-gold'
                        : 'rounded bg-white/10 px-1 text-[9px] uppercase text-white/60'
                  }
                >
                  {f.classification}
                </span>
                <span className="truncate" title={f.relPath}>
                  {f.relPath}
                </span>
              </span>
              <span className="ml-2 shrink-0 text-[10px] text-white/40">
                {formatBytes(f.bytes)} · ~{String(f.approxTokens)} tok
              </span>
            </li>
          ))}
        </ul>
      )}

      {!showBundle ? (
        <button
          type="button"
          onClick={() => void handleShowBundle()}
          className="rounded bg-white/10 px-3 py-1.5 text-xs text-ap-fg hover:bg-white/15"
        >
          Show bundle text
        </button>
      ) : bundleErr !== null ? (
        <div className="rounded border border-red-500/50 bg-red-500/10 p-3 text-[11px] text-red-200">
          {bundleErr}
        </div>
      ) : bundleText === null ? (
        <p className="text-xs text-white/60">Loading bundle…</p>
      ) : (
        <pre className="max-h-72 overflow-auto rounded border border-white/10 bg-black/40 p-2 text-[10px] leading-tight text-white/80">
          {bundleText}
        </pre>
      )}
    </section>
  );
}
