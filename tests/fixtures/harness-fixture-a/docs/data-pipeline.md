# Data pipeline

Bars arrive at 1-minute resolution from the broker websocket. The pipeline
normalizes timestamps to UTC, fills gaps with the prior close, and writes
to a column-oriented parquet store.
