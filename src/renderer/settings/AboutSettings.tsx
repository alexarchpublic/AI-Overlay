/**
 * @file src/renderer/settings/AboutSettings.tsx
 *
 * Settings → About. Phase 2 ships version display from `app.getVersion()`
 * (package.json is the single source of truth). Phase 3 extends this panel
 * with update channel, check-now, and copy-diagnostics.
 */

import { useEffect, useState, type ReactElement } from 'react';

export default function AboutSettings(): ReactElement {
  const [version, setVersion] = useState<string>('…');

  useEffect(() => {
    let cancelled = false;
    void window.api.app.getVersion().then((v) => {
      if (!cancelled) setVersion(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
      </dl>
    </section>
  );
}
