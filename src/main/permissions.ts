/**
 * @file src/main/permissions.ts
 *
 * Why it exists: PRD §0 D7 places the macOS screen-recording permission flow
 * in Chunk 2 (the flow is user-facing) even though Chunk 3 owns the capture
 * engine. Responsibilities of this module:
 *
 *   1. `getScreenRecordingStatus()` — passive check via Electron's
 *      `systemPreferences.getMediaAccessStatus('screen')`.
 *   2. `requestScreenRecording()` — trigger the macOS native prompt the only
 *      way Electron supports on macOS: attempt a trivial `desktopCapturer`
 *      call and discard the result. `systemPreferences.askForMediaAccess`
 *      does NOT support `'screen'`, so anything that looks like a real
 *      "request" API here is a lie (see PRD §4 note).
 *   3. `openSystemSettings()` — deep-link into the Screen Recording privacy
 *      pane for the denial/recovery path.
 *
 * All three are exported as a single `PermissionsHelper` so tests can swap in
 * fake Electron primitives without this module pulling the real package.
 */

import type { PermissionState } from '../shared/types';
import {
  MACOS_SCREEN_RECORDING_PREF_URL,
  PERMISSION_POLL_INTERVAL_MS,
  PERMISSION_POLL_TIMEOUT_MS,
} from '../shared/constants';

/**
 * Minimal slice of Electron we depend on. Only `systemPreferences` +
 * `desktopCapturer` + `shell.openExternal` are exercised.
 */
export interface ElectronPermissionsDeps {
  systemPreferences: {
    getMediaAccessStatus(
      mediaType: 'screen',
    ): 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown';
  };
  desktopCapturer: {
    getSources(options: {
      types: readonly ('screen' | 'window')[];
      thumbnailSize?: { width: number; height: number };
    }): Promise<unknown>;
  };
  shell: {
    openExternal(url: string): Promise<void>;
  };
  platform: NodeJS.Platform;
}

export interface PermissionsHelper {
  getScreenRecordingStatus(): PermissionState;
  requestScreenRecording(): Promise<PermissionState>;
  openSystemSettings(): Promise<void>;
}

export interface CreatePermissionsHelperOptions {
  /** How long to wait for the OS state to settle after triggering the prompt. */
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
  /** Injected for tests to skip real `setTimeout` delays. */
  sleep?: (ms: number) => Promise<void>;
  /** Optional log hook so callers can observe status transitions. */
  onTransition?: (from: PermissionState, to: PermissionState) => void;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Build a `PermissionsHelper` against any Electron-shaped dependency set.
 * Exported for tests; production callers use `createPermissionsHelper()`.
 */
export function buildPermissionsHelper(
  deps: ElectronPermissionsDeps,
  options: CreatePermissionsHelperOptions = {},
): PermissionsHelper {
  const sleep = options.sleep ?? defaultSleep;
  const timeout = options.pollTimeoutMs ?? PERMISSION_POLL_TIMEOUT_MS;
  const interval = options.pollIntervalMs ?? PERMISSION_POLL_INTERVAL_MS;

  const read = (): PermissionState => {
    if (deps.platform !== 'darwin') {
      // Non-macOS dev machines: treat as granted so the widget doesn't
      // show the permDenied state during Chunk 2 development on Linux.
      // Production target is macOS 14+ per PRD §2.
      return 'granted';
    }
    return deps.systemPreferences.getMediaAccessStatus('screen');
  };

  return {
    getScreenRecordingStatus() {
      return read();
    },

    async requestScreenRecording() {
      const before = read();
      if (before === 'granted' || before === 'restricted') {
        return before;
      }

      // The ONLY way to trigger the macOS native prompt from Electron is to
      // attempt a screen source enumeration. The result is discarded — Chunk 3
      // owns real capture.
      try {
        await deps.desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 1, height: 1 },
        });
      } catch {
        // The call may throw (permission just flipped to denied). Status read
        // below is authoritative; the throw itself is not a signal.
      }

      // Poll for the OS to settle.
      const deadline = Date.now() + timeout;
      let current = read();
      while (current === 'not-determined' && Date.now() < deadline) {
        await sleep(interval);
        current = read();
      }

      if (options.onTransition && current !== before) {
        options.onTransition(before, current);
      }
      return current;
    },

    async openSystemSettings() {
      await deps.shell.openExternal(MACOS_SCREEN_RECORDING_PREF_URL);
    },
  };
}

/**
 * Production factory — lazy-requires Electron so Vitest can import this file
 * without an Electron binary on its classpath.
 */
export function createPermissionsHelper(
  options: CreatePermissionsHelperOptions = {},
): PermissionsHelper {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const electron = require('electron') as typeof import('electron');
  const deps: ElectronPermissionsDeps = {
    systemPreferences: electron.systemPreferences,
    desktopCapturer: electron.desktopCapturer,
    shell: electron.shell,
    platform: process.platform,
  };
  return buildPermissionsHelper(deps, options);
}

/**
 * Translate a `PermissionState` into the `WidgetStatus` that should be shown
 * while that permission is current. Used by the boot sequence in
 * `main/index.ts` to decide the starting widget status.
 */
export function statusForPermission(state: PermissionState): 'ready' | 'permDenied' {
  return state === 'granted' || state === 'restricted' ? 'ready' : 'permDenied';
}
