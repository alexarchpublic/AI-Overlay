// Trend-following exit rule — fixed-percentage trailing stop.
export function trendFollowingExit(entry: number, current: number, pct: number): boolean {
  return current < entry * (1 - pct);
}
