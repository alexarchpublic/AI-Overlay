// @vitest-environment jsdom
/**
 * @file tests/updateBanner.smoke.spec.tsx
 *
 * Why it exists: Chunk 7 Phase 3 task 3.5 — UpdateBanner must render correctly
 * for every UpdateState that surfaces UI (downloaded / notify-only / error)
 * and stay hidden for idle-like states without shifting layout when absent.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import UpdateBanner from '../src/renderer/chat/UpdateBanner';
import type { UpdateStateSnapshot } from '../src/shared/updateTypes';

type StateListener = (s: UpdateStateSnapshot) => void;

function baseSnapshot(overrides: Partial<UpdateStateSnapshot> = {}): UpdateStateSnapshot {
  return {
    state: 'idle',
    version: null,
    releaseNotesUrl: null,
    percent: null,
    error: null,
    lastCheckedAt: null,
    currentVersion: '0.2.0-alpha.1',
    channel: 'default',
    ...overrides,
  };
}

describe('<UpdateBanner />', () => {
  let current: UpdateStateSnapshot;
  let listeners: StateListener[];

  beforeEach(() => {
    current = baseSnapshot();
    listeners = [];
    (globalThis as unknown as { window: Window & { api: unknown } }).window =
      Object.assign(globalThis.window, {
        api: {
          updates: {
            getState: async (): Promise<UpdateStateSnapshot> => current,
            check: async (): Promise<UpdateStateSnapshot> => current,
            install: vi.fn(async () => undefined),
            openReleasePage: vi.fn(async () => undefined),
            onStateChanged: (cb: StateListener): (() => void) => {
              listeners.push(cb);
              return () => {
                listeners = listeners.filter((l) => l !== cb);
              };
            },
          },
          log: {
            debug: () => undefined,
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
          },
        },
      });
  });

  afterEach(() => {
    cleanup();
  });

  async function renderBanner(): Promise<void> {
    await act(async () => {
      render(<UpdateBanner />);
    });
  }

  it('hides for idle / checking / available / downloading', async () => {
    for (const state of ['idle', 'checking', 'available', 'downloading'] as const) {
      cleanup();
      current = baseSnapshot({ state, version: state === 'idle' ? null : '0.2.0-alpha.2' });
      await renderBanner();
      expect(screen.queryByRole('status')).toBeNull();
    }
  });

  it('renders downloaded banner with Restart now', async () => {
    current = baseSnapshot({
      state: 'downloaded',
      version: '0.2.0-alpha.2',
      percent: 100,
      releaseNotesUrl: 'https://example.com',
    });
    await renderBanner();
    expect(screen.getByTestId('update-banner-downloaded')).toBeTruthy();
    expect(screen.getByText(/Update v0\.2\.0-alpha\.2 ready/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Restart now/ })).toBeTruthy();
  });

  it('renders notify-only banner with Download', async () => {
    current = baseSnapshot({
      state: 'notify-only',
      version: '0.2.0-alpha.2',
      releaseNotesUrl: 'https://example.com',
    });
    await renderBanner();
    expect(screen.getByTestId('update-banner-notify')).toBeTruthy();
    expect(screen.getByText(/Update v0\.2\.0-alpha\.2 available/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Download/ })).toBeTruthy();
  });

  it('renders error banner', async () => {
    current = baseSnapshot({
      state: 'error',
      error: 'net::ERR_INTERNET_DISCONNECTED',
    });
    await renderBanner();
    expect(screen.getByTestId('update-banner-error')).toBeTruthy();
    expect(screen.getByText(/ERR_INTERNET_DISCONNECTED/)).toBeTruthy();
  });

  it('reacts to onStateChanged push without remount', async () => {
    current = baseSnapshot({ state: 'idle' });
    await renderBanner();
    expect(screen.queryByRole('status')).toBeNull();

    await act(async () => {
      const next = baseSnapshot({
        state: 'downloaded',
        version: '0.2.0-alpha.3',
        percent: 100,
      });
      current = next;
      for (const l of listeners) l(next);
    });
    expect(screen.getByTestId('update-banner-downloaded')).toBeTruthy();
  });
});
