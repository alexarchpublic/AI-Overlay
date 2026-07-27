/**
 * @file src/renderer/settings/AboutSettings.tsx
 *
 * Settings → About. Version from `app.getVersion()`, update channel / last
 * check / check-now from the updater service, and Copy diagnostics (D15).
 */

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { UpdateStateSnapshot } from '../../shared/updateTypes';

function formatLastChecked(iso: string | null): string {
  if (!iso) return 'Never';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function AboutSettings(): ReactElement {
  const [version, setVersion] = useState<string>('…');
  const [update, setUpdate] = useState<UpdateStateSnapshot | null>(null);
  const [checking, setChecking] = useState(false);
  const [diagnosticsHint, setDiagnosticsHint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.api.app.getVersion().then((v) => {
      if (!cancelled) setVersion(v);
    });
    void window.api.updates.getState().then((s) => {
      if (!cancelled) setUpdate(s);
    });
    const off = window.api.updates.onStateChanged((s) => {
      setUpdate(s);
      setChecking(s.state === 'checking');
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const handleCheck = useCallback((): void => {
    setChecking(true);
    setDiagnosticsHint(null);
    void window.api.updates.check().then((s) => {
      setUpdate(s);
      setChecking(false);
    });
  }, []);

  const handleCopyDiagnostics = useCallback((): void => {
    void window.api.app.copyDiagnostics().then((text) => {
      setDiagnosticsHint('Copied to clipboard');
      window.api.log.info('diagnostics.copiedRenderer', {
        length: text.length,
      });
      window.setTimeout(() => {
        setDiagnosticsHint(null);
      }, 2500);
    });
  }, []);

  const channel = update?.channel ?? 'default';
  const lastChecked = formatLastChecked(update?.lastCheckedAt ?? null);
  const updateLabel = update?.state ?? 'idle';

  return (
    <section aria-labelledby="about-heading" className="space-y-3">
      <h2 id="about-heading" className="text-sm font-semibold text-white/80">
        About
      </h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-white/50">Version</dt>
        <dd className="font-mono text-ap-fg" data-testid="app-version">
          {version}
        </dd>
        <dt className="text-white/50">Channel</dt>
        <dd className="font-mono text-ap-fg" data-testid="update-channel">
          {channel}
        </dd>
        <dt className="text-white/50">Last check</dt>
        <dd className="text-ap-fg" data-testid="update-last-checked">
          {lastChecked}
        </dd>
        <dt className="text-white/50">Update status</dt>
        <dd className="font-mono text-ap-fg" data-testid="update-status">
          {updateLabel}
          {update?.version ? ` (v${update.version})` : ''}
        </dd>
      </dl>
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={handleCheck}
          disabled={checking}
          className="rounded bg-ap-muted px-3 py-1.5 text-xs text-ap-fg hover:bg-ap-elevated disabled:opacity-50"
          data-testid="update-check-now"
        >
          {checking ? 'Checking…' : 'Check for updates'}
        </button>
        <button
          type="button"
          onClick={handleCopyDiagnostics}
          className="rounded bg-ap-muted px-3 py-1.5 text-xs text-ap-fg hover:bg-ap-elevated"
          data-testid="copy-diagnostics"
        >
          Copy diagnostics
        </button>
      </div>
      {diagnosticsHint && (
        <p className="text-xs text-ap-green" role="status">
          {diagnosticsHint}
        </p>
      )}
      {update?.state === 'error' && update.error && (
        <p className="text-xs text-amber-200/90" role="status">
          {update.error}
        </p>
      )}
    </section>
  );
}
