# Pine Script® reference (algorithm source)

Arch Public algorithm source under `algorithm source code/` is **TradingView Pine Script®**
saved as plain `.txt` files. When reading or explaining that code, treat it as Pine Script —
not TypeScript, Python, or JavaScript — and use the official language semantics below.

## Official documentation

| Resource | URL |
|----------|-----|
| **Pine Script docs (start here)** | https://www.tradingview.com/pine-script-docs/ |
| **Language reference manual (v6)** | https://www.tradingview.com/pine-script-reference/v6/ |
| **Migration guide (v5 → v6)** | https://www.tradingview.com/pine-script-docs/migration-guides/to-pine-version-6/ |

Check the `//@version=N` annotation at the top of each source file and interpret builtins,
types, and syntax for that version (Arch strategies currently use **v6**).

## How to read Arch algorithm `.txt` files

1. **`strategy(...)` declaration** — entry/exit model, pyramiding, order sizing, and
   `calc_on_every_tick` / `process_orders_on_close` behavior.
2. **`input.*()` blocks** — user-facing parameters; map these to suggestion rows when the
   user asks to tune settings.
3. **Series vs simple types** — most price/volume values are *series* (bar-by-bar history);
   `ta.*` and `math.*` builtins operate on series unless documented otherwise.
4. **`strategy.entry` / `strategy.exit` / `strategy.close`** — actual trade logic; ground
   “current signal” answers in these calls and their conditions.
5. **`plot` / `plotshape` / `bgcolor`** — visual overlays only; do not confuse with orders.
6. **`request.security()` and `request.*()`** — multi-timeframe or external symbol data;
   note the requested timeframe/symbol when explaining cross-TF behavior.

When terminology or builtin behavior is unclear, defer to the v6 language reference above
rather than inferring from other languages.
