// Breakout volatility filter.
export function volatilityFilter(atr: number, threshold: number): boolean {
  return atr > threshold;
}
