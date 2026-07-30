/**
 * @file src/shared/pickerDisplayId.ts
 *
 * Pure parser for the `--region-picker-display-id=` switch that main passes
 * via BrowserWindow `webPreferences.additionalArguments`. Preload reads
 * `process.argv` and exposes the value as a fallback when the renderer URL
 * hash/query fails to carry `displayId`.
 */

const ARG_PREFIX = '--region-picker-display-id=';

/**
 * Extract the picker display id from an argv-like list. Returns `null` when
 * the switch is missing or not a finite number.
 */
export function parsePickerDisplayIdFromArgv(argv: readonly string[]): number | null {
  for (const arg of argv) {
    if (!arg.startsWith(ARG_PREFIX)) continue;
    const raw = arg.slice(ARG_PREFIX.length);
    if (raw.length === 0) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
