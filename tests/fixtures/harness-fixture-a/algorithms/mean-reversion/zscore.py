"""Z-score helper for mean-reversion strategies."""

def zscore(x: float, mean: float, sd: float) -> float:
    return (x - mean) / sd if sd != 0 else 0.0
