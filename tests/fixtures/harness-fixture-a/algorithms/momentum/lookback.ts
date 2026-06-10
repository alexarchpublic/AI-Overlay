// Lookback window helpers.
export const LOOKBACK_DAYS = 252;
export function trailing(values: readonly number[], n: number): readonly number[] {
  return values.slice(-n);
}
