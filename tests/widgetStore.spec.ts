/**
 * @file tests/widgetStore.spec.ts
 *
 * Why it exists: PRD §5 DoD #9 — exercises the pure `statusFromPermission`
 * mapping and the Zustand hook's imperative setters so Chunks 3+ can
 * extend them without silently regressing existing transitions.
 *
 * Chunk 3 additions covered below: `flashCapturing()` semantics + the
 * `decideFlashReset` rule (paused/permDenied wins over the auto-reset).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  decideFlashReset,
  statusFromPermission,
  useWidgetStore,
} from '../src/renderer/widget/widgetStore';
import { CAPTURE_FLASH_MS } from '../src/shared/constants';

describe('widgetStore — statusFromPermission', () => {
  it('maps granted to ready', () => {
    expect(statusFromPermission('granted')).toBe('ready');
  });
  it('maps restricted to ready (managed-device parity with granted)', () => {
    expect(statusFromPermission('restricted')).toBe('ready');
  });
  it('maps denied to permDenied', () => {
    expect(statusFromPermission('denied')).toBe('permDenied');
  });
  it('maps not-determined to permDenied (boot fires the OS prompt)', () => {
    expect(statusFromPermission('not-determined')).toBe('permDenied');
  });
  it('maps unknown to permDenied (safer default)', () => {
    expect(statusFromPermission('unknown')).toBe('permDenied');
  });
});

describe('widgetStore — Zustand setters', () => {
  beforeEach(() => {
    // Reset between tests — the store is a singleton hook.
    useWidgetStore.setState({
      status: 'ready',
      permission: 'unknown',
      hovered: false,
    });
  });

  it('setStatus transitions ready → paused → permDenied', () => {
    useWidgetStore.getState().setStatus('paused');
    expect(useWidgetStore.getState().status).toBe('paused');
    useWidgetStore.getState().setStatus('permDenied');
    expect(useWidgetStore.getState().status).toBe('permDenied');
    useWidgetStore.getState().setStatus('ready');
    expect(useWidgetStore.getState().status).toBe('ready');
  });

  it('applyPermissionOutcome composes permission + status in one call', () => {
    useWidgetStore.getState().applyPermissionOutcome('granted');
    expect(useWidgetStore.getState().permission).toBe('granted');
    expect(useWidgetStore.getState().status).toBe('ready');

    useWidgetStore.getState().applyPermissionOutcome('denied');
    expect(useWidgetStore.getState().permission).toBe('denied');
    expect(useWidgetStore.getState().status).toBe('permDenied');
  });

  it('setHovered is independent of status', () => {
    useWidgetStore.getState().setStatus('permDenied');
    useWidgetStore.getState().setHovered(true);
    expect(useWidgetStore.getState().hovered).toBe(true);
    expect(useWidgetStore.getState().status).toBe('permDenied');
  });

  it('accepts the Chunk 3 capturing transient status', () => {
    useWidgetStore.getState().setStatus('capturing');
    expect(useWidgetStore.getState().status).toBe('capturing');
  });
});

// ---------------------------------------------------------------------------
// Chunk 3 — flashCapturing + decideFlashReset (PRD §0 D11)
// ---------------------------------------------------------------------------

describe('widgetStore — decideFlashReset rule', () => {
  it('reverts capturing → ready', () => {
    expect(decideFlashReset('capturing')).toBe('ready');
  });

  it('keeps paused even though the flash timer fired (paused wins)', () => {
    expect(decideFlashReset('paused')).toBe('paused');
  });

  it('keeps permDenied even though the flash timer fired (denied wins)', () => {
    expect(decideFlashReset('permDenied')).toBe('permDenied');
  });

  it('keeps ready as ready (no-op when already reset)', () => {
    expect(decideFlashReset('ready')).toBe('ready');
  });
});

describe('widgetStore — flashCapturing()', () => {
  beforeEach(() => {
    useWidgetStore.setState({ status: 'ready', permission: 'granted', hovered: false });
    vi.useFakeTimers();
  });

  it('flips to capturing immediately and resets to ready after CAPTURE_FLASH_MS', () => {
    useWidgetStore.getState().flashCapturing();
    expect(useWidgetStore.getState().status).toBe('capturing');
    vi.advanceTimersByTime(CAPTURE_FLASH_MS);
    expect(useWidgetStore.getState().status).toBe('ready');
    vi.useRealTimers();
  });

  it('does not flash when status is paused (paused wins)', () => {
    useWidgetStore.setState({ status: 'paused' });
    useWidgetStore.getState().flashCapturing();
    expect(useWidgetStore.getState().status).toBe('paused');
    vi.advanceTimersByTime(CAPTURE_FLASH_MS);
    expect(useWidgetStore.getState().status).toBe('paused');
    vi.useRealTimers();
  });

  it('does not flash when status is permDenied', () => {
    useWidgetStore.setState({ status: 'permDenied' });
    useWidgetStore.getState().flashCapturing();
    expect(useWidgetStore.getState().status).toBe('permDenied');
    vi.useRealTimers();
  });

  it('honors a mid-flash pause — reset does NOT clobber the user-driven paused', () => {
    useWidgetStore.getState().flashCapturing();
    expect(useWidgetStore.getState().status).toBe('capturing');
    // User pauses during the 600ms window.
    useWidgetStore.setState({ status: 'paused' });
    vi.advanceTimersByTime(CAPTURE_FLASH_MS);
    expect(useWidgetStore.getState().status).toBe('paused');
    vi.useRealTimers();
  });
});
