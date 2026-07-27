/**
 * @file tests/trayService.spec.ts
 *
 * Why it exists: `trayService.ts` is a Windows-only surface (PRD Chunk 7
 * Phase 1 — no menu-bar widget on Windows, so the tray icon is the entry
 * point back to the chat overlay). No `electron` import at module scope
 * means we can exercise the whole factory with fake `Tray`/`Menu`/
 * `nativeImage` constructors, just like `permissions.spec.ts` fakes
 * `systemPreferences`/`desktopCapturer`.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildTrayMenuTemplate,
  createTrayService,
  type TrayServiceDeps,
} from '../src/main/trayService';

function fakeLogger(): TrayServiceDeps['logger'] {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as TrayServiceDeps['logger'];
}

class FakeTray {
  static instances: FakeTray[] = [];
  destroyed = false;
  toolTip: string | undefined;
  contextMenu: unknown;
  listeners = new Map<string, () => void>();

  constructor(public icon: unknown) {
    FakeTray.instances.push(this);
  }

  setToolTip(tip: string): void {
    this.toolTip = tip;
  }

  setContextMenu(menu: unknown): void {
    this.contextMenu = menu;
  }

  on(event: string, handler: () => void): void {
    this.listeners.set(event, handler);
  }

  destroy(): void {
    this.destroyed = true;
  }
}

const FakeMenu = {
  buildFromTemplate: vi.fn((template: unknown) => ({ template })),
};

const FakeNativeImage = {
  createFromPath: vi.fn((p: string) => ({ path: p })),
};

function fakeDeps(overrides: Partial<TrayServiceDeps> = {}): TrayServiceDeps {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Tray: FakeTray as unknown as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Menu: FakeMenu as unknown as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    nativeImage: FakeNativeImage as unknown as any,
    logger: fakeLogger(),
    iconPath: '/fake/build/icon.ico',
    isWindows: true,
    onShowOverlay: vi.fn(),
    onToggleAutoCapture: vi.fn(),
    onOpenSettings: vi.fn(),
    onExit: vi.fn(),
    ...overrides,
  };
}

describe('createTrayService — platform gating', () => {
  it('returns null on non-Windows platforms and creates no Tray', () => {
    FakeTray.instances = [];
    const deps = fakeDeps({ isWindows: false });
    const handle = createTrayService(deps);
    expect(handle).toBeNull();
    expect(FakeTray.instances).toHaveLength(0);
  });

  it('creates a Tray on Windows', () => {
    FakeTray.instances = [];
    const deps = fakeDeps({ isWindows: true });
    const handle = createTrayService(deps);
    expect(handle).not.toBeNull();
    expect(FakeTray.instances).toHaveLength(1);
    expect(FakeNativeImage.createFromPath).toHaveBeenCalledWith('/fake/build/icon.ico');
  });
});

describe('createTrayService — wiring', () => {
  it('sets a tooltip and a context menu built from buildTrayMenuTemplate', () => {
    FakeTray.instances = [];
    const deps = fakeDeps();
    createTrayService(deps);
    const tray = FakeTray.instances[0]!;
    expect(tray.toolTip).toBe('Arch Public AI Overlay');
    expect(FakeMenu.buildFromTemplate).toHaveBeenCalled();
    expect(tray.contextMenu).toBeDefined();
  });

  it('clicking the tray icon invokes onShowOverlay and logs tray.action', () => {
    FakeTray.instances = [];
    const deps = fakeDeps();
    createTrayService(deps);
    const tray = FakeTray.instances[0]!;
    const clickHandler = tray.listeners.get('click');
    expect(clickHandler).toBeTypeOf('function');
    clickHandler?.();
    expect(deps.onShowOverlay).toHaveBeenCalledOnce();
    expect(deps.logger.info).toHaveBeenCalledWith(
      'tray.action',
      expect.objectContaining({ action: 'showOverlay' }),
    );
  });

  it('destroy() tears down the underlying Tray', () => {
    FakeTray.instances = [];
    const deps = fakeDeps();
    const handle = createTrayService(deps);
    const tray = FakeTray.instances[0]!;
    expect(tray.destroyed).toBe(false);
    handle?.destroy();
    expect(tray.destroyed).toBe(true);
  });
});

describe('buildTrayMenuTemplate', () => {
  it('includes Show Overlay / Toggle auto-capture / Settings / Exit labels', () => {
    const deps = fakeDeps();
    const template = buildTrayMenuTemplate(deps);
    const labels = template.map((t) => t.label);
    expect(labels).toContain('Show Overlay');
    expect(labels).toContain('Toggle auto-capture');
    expect(labels).toContain('Settings…');
    expect(labels).toContain('Exit');
  });

  it('each item click fires the matching callback and logs tray.action', () => {
    const deps = fakeDeps();
    const template = buildTrayMenuTemplate(deps);

    const showOverlay = template.find((t) => t.label === 'Show Overlay');
    (showOverlay?.click as () => void)();
    expect(deps.onShowOverlay).toHaveBeenCalledOnce();

    const toggle = template.find((t) => t.label === 'Toggle auto-capture');
    (toggle?.click as () => void)();
    expect(deps.onToggleAutoCapture).toHaveBeenCalledOnce();

    const settings = template.find((t) => t.label === 'Settings…');
    (settings?.click as () => void)();
    expect(deps.onOpenSettings).toHaveBeenCalledOnce();

    const exit = template.find((t) => t.label === 'Exit');
    (exit?.click as () => void)();
    expect(deps.onExit).toHaveBeenCalledOnce();

    expect(deps.logger.info).toHaveBeenCalledWith(
      'tray.action',
      expect.objectContaining({ action: 'exit' }),
    );
  });
});
