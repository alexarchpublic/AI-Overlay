/**
 * @file src/main/overlayWindow.ts
 *
 * Why it exists: Shared renderer URL builder for every BrowserWindow view.
 * The overlay pill window was removed — the chat window is now the primary
 * floating surface — but this module remains the single place that resolves
 * dev-server vs production `loadFile` URLs.
 */

import path from 'node:path';
import { VITE_DEV_SERVER_PORT } from '../shared/constants';

export interface BuildRendererUrlOptions {
  /** All renderer "views" share one Vite bundle; the view query picks the React tree. */
  view: 'settings' | 'regionPicker' | 'chat';
  isDev: boolean;
  devServerUrl?: string;
}

/**
 * Resolve the renderer URL for a given BrowserWindow view. All windows share
 * one Vite bundle and disambiguate via the `?view=` query param consumed by
 * `renderer/main.tsx`.
 *
 * In dev we load the Vite server URL; in prod we load the bundled file with
 * a matching hash fragment (Vite's default HTML pathing doesn't support query
 * strings on `loadFile`, so we use a URL hash as the transport instead).
 */
export function buildRendererUrl(opts: BuildRendererUrlOptions): string {
  const { view, isDev } = opts;
  if (isDev) {
    const base = opts.devServerUrl ?? `http://localhost:${String(VITE_DEV_SERVER_PORT)}`;
    return `${base}/?view=${view}`;
  }
  const htmlPath = path.join(__dirname, '..', 'renderer', 'index.html');
  return `${htmlPath}#view=${view}`;
}
