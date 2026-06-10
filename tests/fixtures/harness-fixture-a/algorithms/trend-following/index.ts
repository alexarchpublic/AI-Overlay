// Trend-following entry point.
export function trendFollowingEntry(price: number, sma: number): boolean {
  return price > sma;
}
