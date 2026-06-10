// Donchian-style breakout: long when price > 20-day high.
export function donchianBreakout(price: number, high20: number): boolean {
  return price > high20;
}
