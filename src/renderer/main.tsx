/**
 * @file src/renderer/main.tsx
 *
 * Why it exists: Renderer entry for every BrowserWindow the app opens. The
 * overlay, settings, and (Chunk 3) region-picker windows all share a single
 * Vite bundle; this file picks the right React tree based on the `?view=`
 * query param (dev) or the URL hash `#view=` (prod `loadFile`). Boot sequence:
 *
 *   1. Resolve the view ('settings' | 'regionPicker' | 'chat'; default 'chat')
 *   2. Tag <html> with `view-*` so `index.css` can apply window-specific body rules
 *   3. Mount the matching component
 *   4. Announce `renderer.ready` exactly once (PRD Chunk 1 §3.3 still holds)
 */

import React, { type ReactElement } from 'react';
import ReactDOM from 'react-dom/client';
import SettingsShell from './settings/SettingsShell';
import RegionPicker from './regionPicker/RegionPicker';
import ChatPanel from './chat/ChatPanel';
import './index.css';

type View = 'settings' | 'regionPicker' | 'chat';

function resolveView(): View {
  const fromQuery = new URLSearchParams(window.location.search).get('view');
  const fromHash = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('view');
  const raw = fromQuery ?? fromHash;
  if (raw === 'settings') return 'settings';
  if (raw === 'regionPicker') return 'regionPicker';
  return 'chat';
}

const view = resolveView();
document.documentElement.classList.add(`view-${view}`);

function Root(): ReactElement {
  if (view === 'settings') return <SettingsShell />;
  if (view === 'regionPicker') return <RegionPicker />;
  return <ChatPanel />;
}

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Could not find #root element to mount React app.');
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);

window.api.log.info('renderer.ready', {
  view,
  userAgent: navigator.userAgent,
});
