/**
 * @file src/renderer/settings/SettingsShell.tsx
 *
 * Why it exists: The 640×480 Settings window's React root. Chunk 3 mounted
 * `<CaptureSettings />` + the dev-only `<RecentCapturesPanel />`. Chunk 5
 * added `<AISettings />`. Layout intentionally stays simple.
 */

import { useEffect, useState, type ReactElement } from 'react';
import CaptureSettings from './CaptureSettings';
import RecentCapturesPanel from './RecentCapturesPanel';
import AISettings from './AISettings';
import KnowledgeSettings from './KnowledgeSettings';

function useDevPanelEnabled(): boolean {
  const [enabled] = useState<boolean>(() => import.meta.env.DEV);
  return enabled;
}

export default function SettingsShell(): ReactElement {
  const showDevPanel = useDevPanelEnabled();

  useEffect(() => {
    window.api.log.debug('settings.mount', { showDevPanel });
  }, [showDevPanel]);

  return (
    <main className="min-h-screen overflow-y-auto bg-ap-bg px-6 py-6 text-ap-fg">
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-ap-green">Settings</h1>
        <p className="text-xs text-white/50">
          <span className="text-ap-gold">Arch Public AI Overlay</span> — preferences
        </p>
      </header>
      <div className="flex flex-col gap-5">
        <CaptureSettings />
        <KnowledgeSettings />
        <AISettings />
        {showDevPanel && <RecentCapturesPanel />}
      </div>
    </main>
  );
}
