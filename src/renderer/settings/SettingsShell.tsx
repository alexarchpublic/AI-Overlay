/**
 * @file src/renderer/settings/SettingsShell.tsx
 *
 * Why it exists: The 640×480 Settings window's React root. Chunk 2 shipped
 * a blank shell; Chunk 3 mounted `<CaptureSettings />` + the dev-only
 * `<RecentCapturesPanel />`. Chunk 4 adds `<HarnessSettings />` (always
 * visible) and `<HarnessInspector />` (gated per PRD §0 D17 — dev build OR
 * `harness.showInspector === true`).
 *
 * Layout intentionally stays simple. Chunks 5+ may introduce tabs. Per the
 * Chunk 3 §8 handoff, the shell must remain a passive container so no
 * chunk owns it outright.
 */

import { useEffect, useState, type ReactElement } from 'react';
import CaptureSettings from './CaptureSettings';
import HarnessSettings from './HarnessSettings';
import HarnessInspector from './HarnessInspector';
import RecentCapturesPanel from './RecentCapturesPanel';
import AISettings from './AISettings';

/**
 * Decide whether the dev-only Recent Captures panel should render.
 * Truth table per PRD D13: dev build OR explicit settings flag.
 *
 * The flag check is async (it goes through a future `window.api.capture.*`
 * hidden-flag read — for Chunk 3 we only honor the build-time signal since
 * the flag is meant for internal demos and would need its own IPC channel
 * to surface to the renderer; expose that later if a non-dev demo needs it).
 */
function useDevPanelEnabled(): boolean {
  const [enabled] = useState<boolean>(() => import.meta.env.DEV);
  // Future: pull `capture.dev.showRecentCaptures` via IPC and merge.
  return enabled;
}

/**
 * Decide whether the harness inspector should render. Per PRD §0 D17 the
 * gate is: dev build OR `harness.showInspector === true`. The flag is
 * exposed indirectly — main allows `getBundleText()` only when the gate is
 * open, so a renderer-side hidden read isn't strictly required. We honor
 * the build-time signal here and let main's gate be the final word.
 */
function useHarnessInspectorEnabled(): boolean {
  const [enabled] = useState<boolean>(() => import.meta.env.DEV);
  return enabled;
}

export default function SettingsShell(): ReactElement {
  const showDevPanel = useDevPanelEnabled();
  const showHarnessInspector = useHarnessInspectorEnabled();

  // Log a single mount event so the Chunk 6 observability work has a
  // hook to verify the right panels were rendered for a build.
  useEffect(() => {
    window.api.log.debug('settings.mount', { showDevPanel, showHarnessInspector });
  }, [showDevPanel, showHarnessInspector]);

  return (
    <main className="min-h-screen overflow-y-auto bg-ap-bg px-6 py-6 text-ap-fg">
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-ap-green">Settings</h1>
        <p className="text-xs text-white/50">
          <span className="text-ap-gold">Arch Public AI Overlay</span> — preferences
        </p>
      </header>
      <div className="flex flex-col gap-5">
        {/* PRD §3.1 tab order: Capture → Harness → AI. */}
        <CaptureSettings />
        <HarnessSettings />
        <AISettings />
        {showHarnessInspector && <HarnessInspector />}
        {showDevPanel && <RecentCapturesPanel />}
      </div>
    </main>
  );
}
