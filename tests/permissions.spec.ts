/**
 * @file tests/permissions.spec.ts
 *
 * Why it exists: PRD §5 DoD #9 — permission state transitions exercised with
 * mocked `systemPreferences` + `desktopCapturer`. The real Electron binary
 * isn't available in CI; `buildPermissionsHelper` accepts an injectable
 * dependency set precisely so these transitions can be tested in pure Node.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildPermissionsHelper,
  statusForPermission,
  type ElectronPermissionsDeps,
} from '../src/main/permissions';
import type { PermissionState } from '../src/shared/types';

function fakeDeps(overrides: Partial<ElectronPermissionsDeps> = {}): ElectronPermissionsDeps {
  return {
    platform: 'darwin',
    systemPreferences: {
      getMediaAccessStatus: vi.fn(() => 'not-determined'),
    },
    desktopCapturer: {
      getSources: vi.fn(async () => []),
    },
    shell: {
      openExternal: vi.fn(async () => undefined),
    },
    ...overrides,
  };
}

describe('permissions — statusForPermission mapping', () => {
  const map: Record<PermissionState, 'ready' | 'permDenied'> = {
    granted: 'ready',
    restricted: 'ready',
    denied: 'permDenied',
    'not-determined': 'permDenied',
    unknown: 'permDenied',
  };
  for (const [input, expected] of Object.entries(map)) {
    it(`${input} → ${expected}`, () => {
      expect(statusForPermission(input as PermissionState)).toBe(expected);
    });
  }
});

describe('permissions — getScreenRecordingStatus', () => {
  it('returns Electron\'s current status on macOS', () => {
    const deps = fakeDeps();
    (deps.systemPreferences.getMediaAccessStatus as ReturnType<typeof vi.fn>).mockReturnValue(
      'granted',
    );
    const helper = buildPermissionsHelper(deps);
    expect(helper.getScreenRecordingStatus()).toBe('granted');
  });

  it('returns granted on non-macOS platforms (dev ergonomics — see PRD §2)', () => {
    const deps = fakeDeps({ platform: 'linux' });
    const helper = buildPermissionsHelper(deps);
    expect(helper.getScreenRecordingStatus()).toBe('granted');
    // Should not have called systemPreferences at all
    expect(deps.systemPreferences.getMediaAccessStatus).not.toHaveBeenCalled();
  });
});

describe('permissions — requestScreenRecording', () => {
  it('short-circuits when status is already granted', async () => {
    const deps = fakeDeps();
    (deps.systemPreferences.getMediaAccessStatus as ReturnType<typeof vi.fn>).mockReturnValue(
      'granted',
    );
    const helper = buildPermissionsHelper(deps);
    const result = await helper.requestScreenRecording();
    expect(result).toBe('granted');
    expect(deps.desktopCapturer.getSources).not.toHaveBeenCalled();
  });

  it('triggers desktopCapturer.getSources and resolves to granted after the OS flips', async () => {
    const deps = fakeDeps();
    const getStatus = deps.systemPreferences.getMediaAccessStatus as ReturnType<typeof vi.fn>;
    // First call (pre-check) → not-determined, then after the prompt → granted
    getStatus
      .mockReturnValueOnce('not-determined')
      .mockReturnValueOnce('not-determined')
      .mockReturnValue('granted');

    const helper = buildPermissionsHelper(deps, {
      sleep: async () => undefined,
      pollTimeoutMs: 200,
      pollIntervalMs: 1,
    });

    const result = await helper.requestScreenRecording();
    expect(result).toBe('granted');
    expect(deps.desktopCapturer.getSources).toHaveBeenCalledOnce();
  });

  it('reports denied when the user declines the native prompt', async () => {
    const deps = fakeDeps();
    const getStatus = deps.systemPreferences.getMediaAccessStatus as ReturnType<typeof vi.fn>;
    getStatus.mockReturnValueOnce('not-determined').mockReturnValue('denied');

    const onTransition = vi.fn();
    const helper = buildPermissionsHelper(deps, {
      sleep: async () => undefined,
      onTransition,
    });

    const result = await helper.requestScreenRecording();
    expect(result).toBe('denied');
    expect(onTransition).toHaveBeenCalledWith('not-determined', 'denied');
  });

  it('tolerates desktopCapturer.getSources throwing — status read is authoritative', async () => {
    const deps = fakeDeps();
    const getSources = deps.desktopCapturer.getSources as ReturnType<typeof vi.fn>;
    getSources.mockRejectedValueOnce(new Error('denied by OS'));
    (deps.systemPreferences.getMediaAccessStatus as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce('not-determined')
      .mockReturnValue('denied');

    const helper = buildPermissionsHelper(deps, {
      sleep: async () => undefined,
      pollTimeoutMs: 50,
      pollIntervalMs: 1,
    });

    const result = await helper.requestScreenRecording();
    expect(result).toBe('denied');
  });

  it('bails out of the poll loop when the deadline expires', async () => {
    const deps = fakeDeps();
    // Always not-determined → we want the helper to stop polling after timeout.
    (deps.systemPreferences.getMediaAccessStatus as ReturnType<typeof vi.fn>).mockReturnValue(
      'not-determined',
    );
    const helper = buildPermissionsHelper(deps, {
      sleep: async () => undefined,
      pollTimeoutMs: 5, // effectively immediate
      pollIntervalMs: 1,
    });
    const result = await helper.requestScreenRecording();
    expect(result).toBe('not-determined');
  });
});

describe('permissions — openSystemSettings', () => {
  it('deep-links via shell.openExternal with the macOS pref URL', async () => {
    const deps = fakeDeps();
    const helper = buildPermissionsHelper(deps);
    await helper.openSystemSettings();
    expect(deps.shell.openExternal).toHaveBeenCalledOnce();
    const call = (deps.shell.openExternal as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call?.[0]).toMatch(/^x-apple\.systempreferences:/);
  });
});
