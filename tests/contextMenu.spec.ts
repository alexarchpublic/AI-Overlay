/**
 * @file tests/contextMenu.spec.ts
 *
 * Why it exists: The right-click menu is the user's primary control surface
 * — Chunks 2 and 3 both depend on its enabled-state logic being correct. The
 * Chunk 2 surface (Capture now / Toggle auto-capture / Open Settings / Quit
 * + conditional "Open System Settings…" recovery) stays asserted, and the
 * Chunk 3 additions (`Set capture region…`; enabled/disabled rules driven
 * by `loopState.regionValid` + `permission`) are added below.
 *
 * `Menu.buildFromTemplate` is an Electron runtime API; we exercise the pure
 * template builder (`buildWidgetMenuTemplate`) which has no Electron
 * dependency, just like `permissions.ts` and `widgetState.ts` patterns.
 */

import { describe, it, expect, vi } from 'vitest';
import { buildWidgetMenuTemplate, type BuildContextMenuDeps } from '../src/main/contextMenu';
import type { CaptureLoopState, PermissionState, WidgetStatus } from '../src/shared/types';

interface MakeDepsOverrides {
  status?: WidgetStatus;
  permission?: PermissionState;
  loopState?: Partial<CaptureLoopState>;
}

function makeDeps(o: MakeDepsOverrides = {}): BuildContextMenuDeps {
  const loopState: CaptureLoopState = {
    running: false,
    intervalMs: 15_000,
    lastCaptureTs: null,
    regionValid: true,
    ...(o.loopState ?? {}),
  };
  return {
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as BuildContextMenuDeps['logger'],
    status: o.status ?? 'ready',
    permission: o.permission ?? 'granted',
    loopState,
    openSettings: vi.fn(),
    openSystemSettings: vi.fn(),
    requestScreenRecording: vi.fn(),
    captureNow: vi.fn(),
    toggleAutoCapture: vi.fn(),
    openRegionPicker: vi.fn(),
  };
}

describe('contextMenu — base items always present', () => {
  it('shows Capture now / Toggle auto-capture / Set capture region… / Open Settings / Quit on ready', () => {
    const template = buildWidgetMenuTemplate(makeDeps({ status: 'ready' }));
    const labels = template.map((t) => t.label).filter(Boolean);
    expect(labels).toContain('Capture now');
    expect(labels).toContain('Toggle auto-capture');
    expect(labels).toContain('Set capture region…');
    expect(labels).toContain('Open Settings…');
    expect(labels).toContain('Quit Arch Public AI Overlay');
  });

  it('shows the same base set on paused', () => {
    const template = buildWidgetMenuTemplate(makeDeps({ status: 'paused' }));
    const labels = template.map((t) => t.label).filter(Boolean);
    expect(labels).toContain('Capture now');
    expect(labels).toContain('Set capture region…');
    expect(labels).toContain('Quit Arch Public AI Overlay');
  });
});

describe('contextMenu — System Settings recovery is conditional', () => {
  it('does NOT show "Open System Settings…" when status is ready', () => {
    const template = buildWidgetMenuTemplate(makeDeps({ status: 'ready' }));
    const labels = template.map((t) => t.label);
    expect(labels).not.toContain('Open System Settings…');
  });

  it('does NOT show "Open System Settings…" when status is paused', () => {
    const template = buildWidgetMenuTemplate(makeDeps({ status: 'paused' }));
    const labels = template.map((t) => t.label);
    expect(labels).not.toContain('Open System Settings…');
  });

  it('SHOWS "Open System Settings…" when status is permDenied', () => {
    const template = buildWidgetMenuTemplate(
      makeDeps({ status: 'permDenied', permission: 'denied' }),
    );
    const labels = template.map((t) => t.label);
    expect(labels).toContain('Open System Settings…');
  });

  it('clicking the System Settings item invokes openSystemSettings', () => {
    const deps = makeDeps({ status: 'permDenied', permission: 'denied' });
    const template = buildWidgetMenuTemplate(deps);
    const item = template.find((t) => t.label === 'Open System Settings…');
    expect(item).toBeDefined();
    expect(typeof item?.click).toBe('function');
    (item?.click as () => void)();
    expect(deps.openSystemSettings).toHaveBeenCalledOnce();
    expect(deps.logger.info).toHaveBeenCalledWith(
      'widget.menuAction',
      expect.objectContaining({ action: 'openSystemSettings' }),
    );
  });

  it('clicking Open Settings invokes openSettings (not openSystemSettings)', () => {
    const deps = makeDeps({ status: 'permDenied', permission: 'denied' });
    const template = buildWidgetMenuTemplate(deps);
    const item = template.find((t) => t.label === 'Open Settings…');
    expect(item).toBeDefined();
    (item?.click as () => void)();
    expect(deps.openSettings).toHaveBeenCalledOnce();
    expect(deps.openSystemSettings).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Chunk 3 — capture-related enabled/disabled state
// ---------------------------------------------------------------------------

describe('contextMenu — capture items reflect regionValid + permission', () => {
  it('disables Capture now / Toggle auto-capture when no region is set', () => {
    const template = buildWidgetMenuTemplate(
      makeDeps({ loopState: { regionValid: false } }),
    );
    const captureNow = template.find((t) => t.label === 'Capture now');
    const toggle = template.find((t) => t.label === 'Toggle auto-capture');
    expect(captureNow?.enabled).toBe(false);
    expect(toggle?.enabled).toBe(false);
  });

  it('disables Capture now / Toggle auto-capture when permission is denied', () => {
    const template = buildWidgetMenuTemplate(
      makeDeps({ permission: 'denied', loopState: { regionValid: true } }),
    );
    const captureNow = template.find((t) => t.label === 'Capture now');
    expect(captureNow?.enabled).toBe(false);
  });

  it('enables Capture now / Toggle auto-capture when region is valid + permission granted', () => {
    const template = buildWidgetMenuTemplate(
      makeDeps({ permission: 'granted', loopState: { regionValid: true } }),
    );
    const captureNow = template.find((t) => t.label === 'Capture now');
    const toggle = template.find((t) => t.label === 'Toggle auto-capture');
    expect(captureNow?.enabled).toBe(true);
    expect(toggle?.enabled).toBe(true);
  });

  it('Toggle auto-capture reflects loopState.running via the checked flag', () => {
    const off = buildWidgetMenuTemplate(makeDeps({ loopState: { running: false } }));
    const on = buildWidgetMenuTemplate(makeDeps({ loopState: { running: true } }));
    expect(off.find((t) => t.label === 'Toggle auto-capture')?.checked).toBe(false);
    expect(on.find((t) => t.label === 'Toggle auto-capture')?.checked).toBe(true);
  });

  it('disables Set capture region… when permission is denied', () => {
    const template = buildWidgetMenuTemplate(makeDeps({ permission: 'denied' }));
    const setRegion = template.find((t) => t.label === 'Set capture region…');
    expect(setRegion?.enabled).toBe(false);
  });

  it('enables Set capture region… when permission is granted (even with no region yet)', () => {
    const template = buildWidgetMenuTemplate(
      makeDeps({ permission: 'granted', loopState: { regionValid: false } }),
    );
    const setRegion = template.find((t) => t.label === 'Set capture region…');
    expect(setRegion?.enabled).toBe(true);
  });

  it('clicking Set capture region… invokes openRegionPicker', () => {
    const deps = makeDeps({ permission: 'granted' });
    const template = buildWidgetMenuTemplate(deps);
    const item = template.find((t) => t.label === 'Set capture region…');
    (item?.click as () => void)();
    expect(deps.openRegionPicker).toHaveBeenCalledOnce();
  });

  it('clicking Capture now invokes captureNow', () => {
    const deps = makeDeps({ permission: 'granted' });
    const template = buildWidgetMenuTemplate(deps);
    const item = template.find((t) => t.label === 'Capture now');
    (item?.click as () => void)();
    expect(deps.captureNow).toHaveBeenCalledOnce();
  });

  it('clicking Toggle auto-capture invokes toggleAutoCapture', () => {
    const deps = makeDeps({ permission: 'granted' });
    const template = buildWidgetMenuTemplate(deps);
    const item = template.find((t) => t.label === 'Toggle auto-capture');
    (item?.click as () => void)();
    expect(deps.toggleAutoCapture).toHaveBeenCalledOnce();
  });
});
