/**
 * @file src/main/platform.ts
 *
 * Single source of truth for OS branching (Chunk 7 Phase 0 task 0.7).
 * All subsequent platform checks go through this module — never inline
 * `process.platform` comparisons elsewhere in `src/` (see PRD §3.8 grep
 * contracts). Mirrors the injectable-deps pattern used by `permissions.ts`.
 */

export interface PlatformInfo {
  readonly isWindows: boolean;
  readonly isMac: boolean;
  readonly isLinux: boolean;
  readonly platform: NodeJS.Platform;
}

/**
 * Derive a frozen PlatformInfo from a platform string. Exported for tests
 * so callers can inject `'win32'` / `'darwin'` / `'linux'` without stubbing
 * `process`.
 */
export function buildPlatformInfo(
  platform: NodeJS.Platform = process.platform,
): PlatformInfo {
  return Object.freeze({
    isWindows: platform === 'win32',
    isMac: platform === 'darwin',
    isLinux: platform === 'linux',
    platform,
  });
}

/** Process-platform snapshot — evaluated once at module load. */
export const platformInfo: PlatformInfo = buildPlatformInfo();

export const isWindows: boolean = platformInfo.isWindows;
export const isMac: boolean = platformInfo.isMac;
export const isLinux: boolean = platformInfo.isLinux;
