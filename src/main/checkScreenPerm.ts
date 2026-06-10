/**
 * @file src/main/checkScreenPerm.ts
 *
 * Standalone Electron main entry for `npm run check:screen-perm`.
 * Kept separate from index.ts so we do not boot the overlay.
 */

import path from 'node:path';
import { app, desktopCapturer, systemPreferences } from 'electron';

void app.whenReady().then(async () => {
  const status = systemPreferences.getMediaAccessStatus('screen');
  // execPath → …/Electron.app/Contents/MacOS/Electron
  const electronApp = path.resolve(path.dirname(process.execPath), '..', '..');

  console.log(
    JSON.stringify(
      {
        screenRecordingStatus: status,
        execPath: process.execPath,
        electronAppBundle: electronApp,
        systemSettingsHint:
          'System Settings → Privacy & Security → Screen Recording → enable Electron (toggle ON)',
      },
      null,
      2,
    ),
  );

  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1, height: 1 },
    });
    console.log('desktopCapturer.getSources: ok, count=' + String(sources.length));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log('desktopCapturer.getSources: failed —', msg);
  }

  app.quit();
});
