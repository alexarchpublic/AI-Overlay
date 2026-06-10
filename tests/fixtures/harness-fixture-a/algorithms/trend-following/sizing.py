"""Position sizing for trend-following strategies."""

def size_position(equity: float, risk_pct: float) -> float:
    return equity * risk_pct
