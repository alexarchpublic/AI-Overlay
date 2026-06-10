// 12-1 momentum signal.
export function momentumScore(returns12m: number, returns1m: number): number {
  return returns12m - returns1m;
}
