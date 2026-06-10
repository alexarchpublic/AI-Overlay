// Mean-reversion entry — RSI < 30 buys, RSI > 70 sells.
export function meanReversionEntry(rsi: number): 'buy' | 'sell' | 'hold' {
  if (rsi < 30) return 'buy';
  if (rsi > 70) return 'sell';
  return 'hold';
}
