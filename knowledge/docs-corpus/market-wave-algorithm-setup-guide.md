> For the complete documentation index, see [llms.txt](https://docs.archpublic.com/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.archpublic.com/crypto/market-wave-algorithm-setup-guide.md).

# Market Wave Algorithm Setup Guide

## About This Guide

This guide explains the Market Wave algorithm inputs/settings with illustrative examples. It is descriptive and does not recommend specific configurations, timeframes, assets, or trade sizes.

## Inputs Tab vs. Properties Tab

Initial capital is entered as "Starting Cash" on the Inputs tab, not in the "Initial capital" field on the Properties tab. The "Initial capital" field on the Properties tab is not needed for live trading — that's handled entirely on the Inputs tab.

The Properties tab can still be used to adjust other settings such as commission, but starting cash does not need to be entered there. The one exception is backtesting: TradingView's Strategy Report pulls from the "Initial capital" field on the Properties tab, so if you plan to use it, that field needs to match the "Starting Cash" figure on the Inputs tab. This has no impact on live trading.

<figure><img src="/files/sV13nCDwpZ5gL7fB5Ub9" alt=""><figcaption></figcaption></figure>

The Inputs tab is where every setting lives. Sections appear top-to-bottom: User Initial Capital, Order Entry & Exit Rules, Trade Size, Market Wave, Static Market Price Filter, Trend Filter, Start/End dates, and Backtesting.

## User Initial Capital

### Starting Cash ($)

The cash balance the strategy starts with.

### Starting Crypto Quantity

The number of crypto units the strategy starts holding. Enter the unit count only. If non-zero, the strategy opens that position via a single seed trade three calendar days before the strategy start date — whether that's the backtest start date or today's date for a live strategy. The seed trade does not fire a webhook alert and will not result in an actual buy; it's simply TradingView's way of accounting for the starting crypto position that you allocate to this particular strategy.

## Order Entry & Exit Rules

### Long Threshold (%)

The minimum red candle size required to trigger a buy.

### Exit Threshold (%)

The minimum green candle size required to trigger a sell.

Large candles are not always tops or bottoms — sometimes they are the initial move of a longer leg. Smaller candles later in a move can also represent valid triggers.

## Trade Size

All trades have a $5 minimum, applied in both Fixed and Percentage modes. Fixed Trade Size is checked by default.

### Fixed Trade Size

When only Fixed Trade Size is checked, the algo uses the dollar amounts in Entry Trade Size ($) and Exit Trade Size ($) for every trade. The percentage values are ignored.

### Percentage Trade Size

When only Percentage Trade Size is checked, entries are sized as a percentage of available cash and exits as a percentage of available crypto — not as a percentage of your buy size, and not as a percentage of your overall portfolio value. Buys are only impacted by your available cash, sells are only impacted by your available crypto, and both are dynamic and fluctuate bar-to-bar depending on the algorithm's calculated holdings. The dollar values are ignored.

Note that "available cash" and "available crypto" here refer to what the algorithm itself is tracking based on the starting inputs and the trades it has executed on the chart — not your actual holdings on the exchange. TradingView cannot see funds added to or removed from your exchange account, so all percentage calculations are contained inside the algorithm.

Because buys are sized off available cash and sells are sized off available crypto, the same percentage settings can produce very different trade sizes depending on how the portfolio is balanced. Here are three examples of starting balances on a $100,000 portfolio with 2% buy/sell sizing (for the sake of simplicity, the values below do not account for fluctuations in asset price):

#### All crypto ($0 cash, $100K crypto)

With 100% allocated to crypto, the same 2% setting produces much larger sells from the start and no buys at all. A sell would fire for $2,000 (2% of $100K crypto), while buys can't fire at all since 2% of $0 cash is $0. After that first sell, the portfolio would be $2K cash / $98K crypto, so a buy could now fire for $40 (2% of $2K) and a sell for $1,960 (2% of $98K). As more sells fire, cash grows and buy sizes grow with it, while sells shrink. Depending on how often buy and sell signals fire (along with other variables), the portfolio may move away from this 100% crypto allocation toward more balance, or with enough sell signals it could swing the other way and end up mostly cash. The disparity between buy and sell sizes closes as the account approaches a more balanced state.

#### All cash ($100K cash, $0 crypto)

With 100% allocated to cash, the same 2% setting produces much larger buys from the start and no sells at all. A buy would fire for $2,000 (2% of $100K cash), while sells can't fire at all since 2% of $0 crypto is $0. After that first buy, the portfolio would be $98K cash / $2K crypto, so a buy could now fire for $1,960 and a sell for $40 (2% of $2K). As more buys fire, crypto grows and sell sizes grow with it, while buys shrink. Depending on how often buy and sell signals fire, the portfolio may move away from this 100% cash allocation toward more balance, or with enough buy signals it could swing the other way and end up mostly crypto. The disparity between buy and sell sizes closes as the account approaches a more balanced state.

#### Balanced ($50K cash, $50K crypto)

With cash and crypto starting at parity, the 2% setting produces equal buy and sell sizes from the start. A buy would fire for $1,000 (2% of $50K cash) and a sell would fire for $1,000 (2% of $50K crypto). From there, depending on how often each signal fires, the portfolio can drift in either direction. Say buys outpace sells and the portfolio shifts to $30K cash / $70K crypto — buys would shrink to $600 and sells would grow to $1,400. The further the portfolio drifts from balanced, the wider the disparity between buy and sell sizes; if signals on the dominant side eventually slow, that disparity itself naturally pulls the account back toward balance.

### Percentage and Fixed Trade Size both checked

When both are checked, the percentage calculation runs first as the default, with the fixed dollar amount acting as a floor (not a cap) — if the percentage calculation comes out smaller than the fixed amount, the fixed amount is used instead.

This setup can be used in multiple ways. You can use all four inputs together with meaningful values for each, or you can configure it as a hybrid where some sides effectively run on fixed sizing and others on percentage sizing.

Using both is useful because it lets you size trades dynamically as a percentage of your holdings while preventing a slew of tiny trades when your available cash or crypto runs low relative to your overall portfolio size.

A few illustrative examples:

#### Percentage with a fixed floor

Imagine a $100,000 account split 50/50 — $50K cash and $50K crypto — with trades set to 2%. Your first buy or sell would be $1,000. Fast forward and say you've deployed all but $5K of cash; now 2% only equates to $100 buys. If you kept deploying without any sells (for the sake of this example), you'd find yourself making much smaller buys than your initial $1K. If you don't want that, you can set a fixed buy as a floor — say $500 — and every buy fires at $500 minimum until the remaining cash is itself $500 or less, at which point the trade adjusts down to clear it out.

#### Static buys, percentage sells

Using the same $100,000 50/50 account, if you set a fixed buy size of $1,000, a fixed sell size of $5 (min), a percentage buy size of 0%, and a percentage sell size of 20%, you'd get static $1,000 buys every time (since 0% always falls below the $1,000 floor) and percentage-based 20% sells every time (since 20% will almost always exceed the $5 (min) floor).

#### Percentage buys, static sells

Flip it. On the same $100,000 50/50 account, if you set a fixed buy of $5 (min), fixed sell of $1,000, percentage buy of 20%, and percentage sell of 0%, you'd get percentage-based 20% buys and static $1,000 sells.

### Auto-Sized Last Trade

In any mode (percentage, fixed, or both), if the trade size would exceed what the algorithm has calculated as available cash (for buys) or available crypto (for sells) based on the initial inputs and chart data/trading activity, the order auto-sizes down to what is available. This overrides any sizing input (% or fixed) when applicable.

It's important to note that all calculations are contained inside the algorithm itself. If you add or remove funds from your exchange, TradingView cannot see that — the algorithm only knows what it has tracked from the starting inputs and the trades it has executed on the chart.

For example, if your fixed buy size is $1,000 but the algorithm has only $500 in available cash, the trade adjusts down and fires for $500. Same logic on the sell side: if your fixed sell size is $1,000 but only $500 worth of crypto remains, the sell fires for $500.

#### Visual: Trade Size Modes

**Fixed Trade Size only -**

<figure><img src="/files/GzFNqJhdC8n6c9RSuHBf" alt=""><figcaption></figcaption></figure>

Only Fixed Trade Size is checked. Both Entry and Exit Trade Size are set to $500. In this XRP example, the first two buys at $500 purchase 362.7 and 368.6 XRP units. On the third buy, there was only enough cash remaining to purchase 268.7 XRP units, so the trade auto-sized down from $500 to whatever the remaining cash allowed. This is why keeping a small amount of extra cash as headroom matters — fees and slippage can eat into the last trade.

**Percentage Trade Size only -**&#x20;

<figure><img src="/files/QIfVtJ0LK2lYfjPhNmOF" alt=""><figcaption></figcaption></figure>

Only Percentage Trade Size is checked. Entries use 5% of available cash; exits use 50% of available crypto. Each sell shown is 50% of the XRP units held at that bar, so the sell amounts get progressively smaller as the position shrinks. Amounts fluctuate bar-to-bar depending on the algo's calculated holdings at that moment.

**Both checked -**

<figure><img src="/files/PzzRCq0pvs51OWDkBWEg" alt=""><figcaption></figcaption></figure>

Both Fixed ($500) and Percentage (5% / 50%) are checked. The first sell is 50% of available crypto, which calculates to more than $500, so the 50% value is used. The next sell is 50% of the remaining crypto, which calculates to less than $500 — the algo falls back to the $500 fixed floor. The last sell auto-sizes down because the remaining crypto is less than $500 worth. The fixed amount acts as a floor for the percentage calculation, not a cap.

### Account Headroom

Keep some headroom in both cash and crypto to account for exchange fees and slippage. There's roughly a 5% server-side buffer on limit orders, so while you don't need to maintain a full 5% cushion at all times, you should always have at least some breathing room on both sides — enough to cover fees, slippage, and the buffer without orders being rejected.

### Exchange fees

Crypto exchanges (not Arch) charge trading fees, and those fees are typically variable based on your trailing 30-day volume — meaning the percentage you pay can shift up or down as your activity changes. TradingView allows you to set a commission percentage on the Properties tab, but it only accepts a fixed value, so it will never match your actual exchange fees verbatim. Treat that input as an approximation, not a precise reflection of cost.

### Slippage

Slippage is the difference between the price you expected on a trade and the price the trade actually fills at. Our system only uses limit orders set in-the-money for instant fill (not market orders), but even with fill-or-kill behavior, slippage can still occur — fast price moves can mean a buy fills slightly higher than the displayed price or a sell fills slightly lower (or vice versa) in the moment between order submission and execution. The actual slippage on any given trade is unpredictable, which is why having a small cash and crypto cushion matters.

### Reconciling with your exchange

Monitor your actual exchange balances against the amounts the algorithm calculates, and adjust as needed. Since TradingView only sees what the algorithm has tracked internally (not your true exchange holdings), small drifts between the two can accumulate over time as fees and slippage chip away at each trade. Periodic reconciliation helps keep the algorithm's view aligned with reality.

## Market Wave

The Market Wave is a tunable wave plotted on the chart with a top edge and a bottom edge. By default, buys are only allowed below the bottom edge; sells are only allowed above the top edge. The space between is the no-action zone.

#### Scope (0.5 = micro, 10 = macro)

Scope controls the behavior of the wave on a single slider, in 0.5 increments from 0.5 (micro) to 10 (macro). The relationship is linear across the range.

Lower Scope = shorter, faster-tracking wave. The wave reacts quickly to price.

Higher Scope = longer, smoother wave. The wave is slower to turn and traces the broader trend.

The names describe the size of the cycles the wave responds to, not the size of the wave itself. A small scope hugs price tightly, so the buy/sell cycles it captures are short — small bounces playing out over a few candles. A large scope smooths past those bounces and only shifts when price makes a sustained directional move, so the cycles it captures are larger — extended accumulation phases and major rallies. The actual duration of those cycles depends on the chart's timeframe; a "macro" cycle on a daily chart might span weeks or months, while the same scope on a 30-minute chart might span only a day or two.

### Scope and timeframe

Scope and timeframe are two independent zoom levels that stack on top of each other. Timeframe controls how granular each candle is (a 4-hour chart shows six times as many candles per day as a daily chart). Scope controls how tightly the wave tracks those candles. Both matter, and they don't combine in a strictly linear way — a longer timeframe with a small scope can still track close to price, just not as closely as a shorter timeframe at the same scope; a larger scope on a shorter timeframe will track more closely than the same scope on a longer one.

#### Visual: Scope on a Daily Chart

**BTCUSD Daily — Scope 0.5**

<figure><img src="/files/3Tk8Aib5pvUN1MtgKo5q" alt=""><figcaption></figcaption></figure>

Scope 0.5 (micro) on the daily chart. The wave tracks price closely and the two oscillate around each other, producing tightly interleaved buy/sell markers throughout most of the chart.

**BTCUSD Daily — Scope 2.5**

<figure><img src="/files/ObBiKCP8ikBUcyboCVLv" alt=""><figcaption></figcaption></figure>

Scope 2.5 on the same daily chart. The wave is longer and smoother, so price spends more continuous time on each side of it. Buys and sells start clustering into runs rather than interleaving tightly.

**BTCUSD Daily — Scope 5**

<figure><img src="/files/aO3pecArxeuzMuT05eJJ" alt=""><figcaption></figcaption></figure>

Scope 5 on the same daily chart. Compared to lower scopes the wave is smoother and price runs above or below it for longer stretches, with buy and sell clusters extending further along the trend. The exact pattern varies by asset.

**BTCUSD Daily — Scope 10**

<figure><img src="/files/wgHNjb0jvw5ydxS3c3RN" alt=""><figcaption></figcaption></figure>

Scope 10 (macro) on the same daily chart. The wave is at its longest and smoothest, behaving like a long-term trend reference. Price oscillates through the wave over weeks or months rather than hours or days, defining clear accumulation and distribution zones — buys cluster through extended downtrends and sells through major rallies.

#### Visual: Scope on a 4-Hour Chart

**BTCUSD 4H — Scope 0.5**

<figure><img src="/files/J9yi5e6z9OSD9OK9z9S2" alt=""><figcaption></figcaption></figure>

Scope 0.5 (micro) on a 4-hour chart. The wave tracks price tightly and reacts quickly to short-term moves, producing dense, tightly interleaved buy/sell markers as price oscillates back and forth across the wave.

**BTCUSD 4H — Scope 2.5**&#x20;

<figure><img src="/files/x552FkWlXiGQFHEX8ln9" alt=""><figcaption></figcaption></figure>

Scope 2.5 on the same 4-hour chart. The wave is longer and smoother than at 0.5, no longer tracking every short-term swing. Buys and sells begin to cluster into runs rather than alternating tightly.

**BTCUSD 4H — Scope 5**&#x20;

<figure><img src="/files/GiPtzIJpRWHzvVS9aBCQ" alt=""><figcaption></figcaption></figure>

Scope 5 on the same 4-hour chart. The wave is smoother and slower to react, so price spends longer stretches on one side before crossing back through. Buy and sell clusters extend further along the trend, though the exact pattern varies by asset.

**BTCUSD 4H — Scope 10**

<figure><img src="/files/h4qXRSqz5y3GkE9pohff" alt=""><figcaption></figcaption></figure>

Scope 10 (macro) on the same 4-hour chart. The wave is at its macro setting, behaving like a long-term trend reference even on the 4-hour timeframe. Price moves through the wave over extended periods — sometimes weeks or months, though the exact duration varies — defining clear accumulation and distribution zones with buys clustering through extended downtrends and sells through major rallies.

### Only Sell Above / Only Buy Below

Both checkboxes are on by default. Together they enforce the no-action zone: sells are restricted to candles closing above the top edge of the wave, buys to candles closing below the bottom edge. Anything happening inside the wave is treated as noise and ignored.

This is the core of the strategy's accumulation philosophy — buy meaningful dips below the wave and sell meaningful rallies above it, rather than trading every small oscillation in between. The no-action zone keeps the strategy from chasing chop.

Turning either off allows trades inside the wave on that side. For example, unchecking "Only Buy Below" lets buys fire on candles inside the wave or even slightly above the bottom edge, which can increase entry frequency but also exposes the strategy to buying at less attractive prices. Turning one off is a deliberate choice for a specific market view, not a default mode of operation.

### Sell Buffer (%) and Buy Buffer (%)

Buffers let users tune the area above the top edge (where sells can fire) and the area below the bottom edge (where buys can fire). Leaving both at 0 uses the wave in its natural state, calculated directly from the chart data. Adjusting them is a way to shape trade behavior around your own outlook and conviction.

Positive values push an edge OUT, away from the wave body. Negative values pull an edge IN, toward the wave body. Sell Buffer controls the top edge; Buy Buffer controls the bottom edge.

Buffers tune one specific component of the strategy — the size of the area outside the wave where candles can close to qualify as trades. Bigger area = more candles can potentially qualify. Smaller area = fewer candles can potentially qualify. Whether trades actually fire still depends on candle thresholds, trade size, and how the market moves.

The wave's natural width depends on the chart's timeframe. Shorter timeframes have smaller candles and a narrower wave; longer timeframes have larger candles and a wider wave. The same buffer percentage therefore has a different absolute effect on different timeframes — narrower waves are more sensitive to buffer adjustments, so smaller values go further on lower timeframes.

#### One edge IN

Setting a negative buffer on one side pulls that edge inward, growing the qualifying area on that side. Sell Buffer -2 with Buy Buffer 0 pulls the top edge in, opening up more area above the wave where green candles can close as potential sell triggers. Buy Buffer -2 with Sell Buffer 0 pulls the bottom edge in, opening up more area below the wave where red candles can close as potential buy triggers.

#### One edge OUT

Setting a positive buffer on one side pushes that edge outward, shrinking the qualifying area on that side. Sell Buffer +2 with Buy Buffer 0 pushes the top edge out, requiring a stronger move above the wave for green candles to close as sell triggers. Buy Buffer +2 with Sell Buffer 0 pushes the bottom edge out, requiring a deeper move below the wave for red candles to close as buy triggers.

#### Both edges OUT (widen)

Setting both buffers to positive values pushes both edges outward. The wave widens and the no-action zone grows, shrinking the qualifying area on both sides. The strategy still operates on the same mean-reversion logic, just with a higher bar — only larger deviations from the wave qualify, so smaller wave-hugging moves are filtered out.

Widening is also useful as a counterweight to smaller candle thresholds. If you've set smaller buy/sell thresholds to catch smaller qualifying moves, a wider no-action zone filters out the ones closest to the wave so the strategy doesn't get overwhelmed by marginal trades.

#### Wave shift (asymmetric)

Setting one buffer positive and the other negative shifts the wave in one direction. Sell Buffer positive with Buy Buffer negative pushes the top edge up and pulls the bottom edge up — shrinking the area above the wave (fewer green candles can close above it as potential sell triggers) and growing the area below (more red candles can close below it as potential buy triggers). Sell Buffer negative with Buy Buffer positive does the opposite — growing the area above (more green candles can close above it as potential sell triggers) and shrinking the area below (fewer red candles can close below it as potential buy triggers).

This combination biases one gate as easier to clear than the other, which can affect how many buys vs. sells fire. The total dollar amount of buying vs. selling is a combination of trade frequency and trade size, so the buffer alone doesn't determine the overall balance — that also depends on candle thresholds, trade size, and how the market moves.

#### Both edges IN (pinch) — caution

Setting both buffers to negative values pulls both edges inward, growing the qualifying area on both sides and filtering less whipsaw. This may produce significantly more trades.

The wave's top and bottom edges are not a fixed distance apart — the gap between them changes with every bar. Because of this, there is no specific negative buffer percentage that is safe across all conditions. On tight scopes or shorter timeframes where the wave is already narrow, negative buffers can pull the edges past each other so the bottom edge ends up above the top edge. When this happens, buys and sells can fire inside the area that would otherwise be the no-action zone. Whether you want that is a deliberate configuration choice — this may be useful when employing the Trend Filters (discussed later).

#### Visual: Buffer Configurations

**Baseline — Buffers 0 / 0**

<figure><img src="/files/Y8Ynel91zW7rat87VZFn" alt=""><figcaption></figcaption></figure>

Scope 2, both buffers at zero. The wave sits in its natural position. This is the reference point for the comparisons below. All subsequent buffer screenshots use the same chart, scope, and thresholds — only the buffer values change.

**Sell Buffer +2, Buy Buffer 0 — Top edge OUT**

<figure><img src="/files/JXkgKgU9iiYLQiYilv6C" alt=""><figcaption></figcaption></figure>

The top edge of the wave is pushed out (up) by 2%. Sells now have to clear a higher bar to qualify, while buy behavior is unchanged.

**Sell Buffer 0, Buy Buffer +2 — Bottom edge OUT**

<figure><img src="/files/CNVTLcOMrPRjnlyFPbOT" alt=""><figcaption></figcaption></figure>

The bottom edge of the wave is pushed out (down) by 2%. Buys now have to clear a lower bar to qualify, while sell behavior is unchanged.

**Sell Buffer +2, Buy Buffer +2 — Both edges OUT (widen)**

<figure><img src="/files/Cr5Yu3hENEoS65tbSnN0" alt=""><figcaption></figcaption></figure>

Both edges are pushed out by 2%. The wave widens and the no-action zone in the middle grows, hiding more of the whipsaw near the wave body. Trades that would have fired close to the wave in the baseline chart are filtered out. This widening can also offset the added trade frequency from running smaller candle thresholds — the thresholds still catch qualifying moves while the wider no-action zone filters out the closest ones.

**Sell Buffer +2, Buy Buffer -2 — Wave shifts UP**

<figure><img src="/files/wNfpaDQugJaFLbuNnrSm" alt=""><figcaption></figcaption></figure>

The top edge is pushed out (up) and the bottom edge is pulled in (up). The entire wave shifts upward relative to price, exposing more area below the wave for buy-qualifying candles and reducing the area above the wave for sell-qualifying candles.

**Sell Buffer -2, Buy Buffer +2 — Wave shifts DOWN**

<figure><img src="/files/qHfH2LwtTb8wQbAcPjaT" alt=""><figcaption></figcaption></figure>

The top edge is pulled in (down) and the bottom edge is pushed out (down). The entire wave shifts downward relative to price, exposing more area above the wave for sell-qualifying candles and reducing the area below the wave for buy-qualifying candles.

**Sell Buffer -5, Buy Buffer -5 — Both edges IN (pinch) — CAUTION**

<figure><img src="/files/s8jdADDaQm3aYkRfWSgR" alt=""><figcaption></figcaption></figure>

Both edges are pulled inward by 5%. On this timeframe the wave is narrow enough that the pull has flipped the bands — the bottom edge (only buy below) is now above the top edge (only sell above). Buys and sells are firing inside what would normally be the no-action zone. Narrower waves (typically on shorter timeframes) flip more easily. Unless this is intentional, the buffers are too aggressive for the current setup.

#### Buffers, Scope, and Timeframe

The effectiveness of buffers depends on how much room the wave gives price to move outside its edges. Buffers shift those edges by a percentage, but whether that shift has a meaningful impact depends on how far price typically moves from the wave to begin with. Both Scope and timeframe contribute.

Shorter timeframes and tighter scopes produce waves that track price closely. The gap between the top and bottom edges stays narrow, and price spends most of its time near the wave. Large positive buffers on these configurations can extend past where price typically reaches and prevent any candles from closing outside the wave. Negative buffers can quickly pull the edges past each other, since there was little room between them to begin with.

Longer timeframes and broader scopes produce wider, slower waves. The edges sit further apart, and price routinely lives above or below the wave for extended periods. Larger buffers can be applied while still leaving exposed area where trades can fire, and negative buffers have more room to work before the edges cross.

The relationship is not strictly linear — Scope and timeframe are independent settings. A longer timeframe with a small scope can still track price closely, and a larger scope on a shorter timeframe can still give the wave more room. The combination matters, not just one or the other.

#### Visual: Buffers vs Scope and Timeframe

**4H, Scope 2, Buffers +10/+10**

<figure><img src="/files/eGX54aFi5lfygYp0saGe" alt=""><figcaption></figcaption></figure>

A 4-hour chart with a small scope and 10% buffers on both sides. The wave tracks price closely at Scope 2, and 10% buffers push both edges so far out that nearly all candles are engulfed inside the wave. Very few or no trades can fire. The combination of tight scope, shorter timeframe, and large buffers has rendered the strategy effectively inoperable.

**4H, Scope 10, Buffers +10/+10**

<figure><img src="/files/jo1ER8LFDcdORWa3EQBE" alt=""><figcaption></figcaption></figure>

Same 4-hour chart, same 10% buffers, but Scope is now 10. The wave is broader and slower to react, but on a 4-hour timeframe it's still narrow in absolute terms. Even at Scope 10, 10% buffers on a 4-hour chart still cover most of the price action. The change in scope shifts the wave's shape compared to Scope 2, but the buffers remain heavily constraining at this timeframe.

**Daily, Scope 0.5, Buffers +10/+10**

<figure><img src="/files/Bui2y3unGXhmnO6Ar8l0" alt=""><figcaption></figcaption></figure>

A daily chart with Scope 0.5 and 10% buffers. Even on a daily timeframe, the tight scope tracks price closely enough that 10% buffers swallow most of the price movement. Scope and timeframe both contribute to how much room the wave gives price to move outside its edges — the relationship is not linear, and a longer timeframe with a small scope can still track price closely.

**Daily, Scope 10, Buffers +10/+10**

<figure><img src="/files/sKveudgEq8dCKFmmXER9" alt=""><figcaption></figcaption></figure>

Same daily chart, same 10% buffers, but Scope is now 10. With a macro scope, the wave is broad and slow, and daily candles travel larger percentages bar-to-bar than 4-hour candles. Even with 10% buffers, daily candles still close outside the wave, leaving exposed area above and below where trades can fire.

## Static Market Price Filter

An optional additional gate, useful for setting a hard price floor or ceiling that trades must respect regardless of what the wave is doing. When enabled, trades must clear both the normal Market Wave conditions and the static price threshold; the static filter disqualifies any trade that doesn't meet its price condition.

### Only Sell Above (static)

When checked, sells only fire above the entered price. Sells below that price are disqualified even if the wave and candle threshold would otherwise allow them.

### Only Buy Below (static)

When checked, buys only fire below the entered price. Buys above that price are disqualified even if the wave and candle threshold would otherwise allow them.

## Trend Filter

The Trend Filter gates entries and exits to candles where a trend shows signs of reversing. It is a reversal-confirmation filter that waits for confirmation of a turn before allowing trades, rather than firing on every candle that meets the basic threshold.

By default (without the Trend Filter), buys trigger on red candles and sells trigger on green candles. Enabling the Trend Filter inverts this — buys now trigger on green candles where a downtrend shows signs of reversing, and sells trigger on red candles where an uptrend shows signs of reversing.

The Trend Filter is an additional gate on top of the wave and threshold checks, not a replacement. The wave's no-action zone still applies, and the candle thresholds still apply — in fact, the candle thresholds are part of how the filter establishes the trend in the first place. Once a trend is established, the filter arms the trigger and waits for signs of reversal before allowing a trade — not necessarily the first candle in the opposite direction, but a stronger indication that the trend is turning.

### Buy on change of trend

When checked, buys are gated to candles where a downtrend shows signs of reversal — the filter waits for price to bottom and recover before allowing a buy. This helps reduce repeated buying into a large, extended leg down — what traders often call catching a falling knife — where each buy adds to a position that keeps moving against it. *Note: with this enabled, buys fire on green candles, not the default red.*

### Sell on change of trend

When checked, sells are gated to candles where an uptrend shows signs of reversal — the filter waits for price to top and roll over before allowing a sell. This helps reduce repeated selling into a large, extended leg up where each sell exits more of the position before the move has run its course. *Note: with this enabled, sells fire on red candles, not the default green.*

### Interaction with Scope and Buffers

When Scope is tight, the wave hugs price closely. The Trend Filter identifies valid reversals, but those reversal candles often close inside the wave body, where the no-action zone disqualifies them. The filter finds the trade; the location check blocks it. The result can be very few trades — or none at all.

There are three ways to give reversal candles room to qualify:

Increase Scope so the wave is slower to react. Price can move further from the wave before it catches up, giving reversal candles more room to close outside the no-action zone. This option preserves both edges and both location gates — nothing about the strategy's structure changes, just where the wave sits relative to price. The trade-off is a wave that's less responsive to short-term moves.

Pinch the wave with negative buffers, pulling the edges inward so more of the candle's close sits outside the no-action zone. If the buffers are aggressive enough to cross the edges past each other (see the Both edges IN caution in the buffer section), the Only Buy Below edge moves above the Only Sell Above edge. Buys still only fire below the Only Buy Below edge and sells still only fire above the Only Sell Above edge — but because those edges have crossed, the two zones now overlap in the middle, creating an area where reversal candles have room to qualify on either side. This can be a softer alternative to fully disabling Only Sell Above or Only Buy Below.

Turn off Only Sell Above or Only Buy Below to remove the location requirement on that side, letting the filter fire regardless of where the candle sits relative to the wave. This gives up the location gate on that side, so trades fire purely on the reversal signal and the candle threshold.

#### Visual: Trend Filter

**Scope 0.5, Trend Filter ON**&#x20;

<figure><img src="/files/dqIf5SPOF3yWNuqOlgw3" alt=""><figcaption></figcaption></figure>

Trend Filter is on and Scope is at 0.5. The wave hugs price so closely that reversal candles often land inside the wave body and are blocked by the no-action zone. Very few trades fire. Tight Scope and Trend Filter on together can produce few or no trades.

**Scope 5, Trend Filter ON**&#x20;

<figure><img src="/files/Z3EKQxGskAcBFlmLadTi" alt=""><figcaption></figcaption></figure>

Scope increased to 5 with Trend Filter still on. The wave is now broad and slow enough that reversal candles have room to deviate from the wave and close outside its edges. The filter's triggers can now fire. Increasing Scope, pinching the buffers, or turning off Only Sell Above / Only Buy Below all give reversal candles room to qualify.

**Scope 5, Trend Filter OFF**&#x20;

<figure><img src="/files/EcdezuPNg2UheBzvdr4T" alt=""><figcaption></figcaption></figure>

Same chart, same Scope 5, but with Trend Filter turned off. Buy markers are much denser than in the previous chart, especially on the large leg down. Without the filter, every threshold-meeting candle in the buy zone fires; with it, only those showing reversal signs do — which reduces repeated buying into extended downtrends. The same effect applies to sells in extended uptrends.

## Start Date / Time and End Date

The dates the strategy starts and stops trading.

For a backtest, these define the backtest window. For a live strategy, Start Date is when the strategy begins running, and End Date is when it stops.

If Starting Crypto Quantity is greater than 0, the seed trade fires three calendar days prior to the Start Date.

## Backtesting

### Exit Full Position on Last Historical Bar

Backtesting only. When checked, closes any open position on the final bar of the backtest. Don't enable for live trading.

### Using the Strategy Report

If you want to use TradingView's built-in Strategy Report when backtesting, the "Initial capital" field on the Properties tab needs to match the "Starting Cash" figure on the Inputs tab. The Strategy Report pulls from the Properties tab, so a mismatch will produce performance numbers that don't reflect the strategy's actual behavior. This has no impact on live trading.

Alternatively, the Object Tree and Data Window provide useful performance data without having to align the two values.

## TradingView Caution Banner

<figure><img src="/files/IkjnBnkMPRS3Ski5GrDZ" alt=""><figcaption></figcaption></figure>

TradingView may display this caution banner when the indicator is loaded, warning about look-ahead bias. This is expected for the Market Wave strategy and is not an issue. The banner can be dismissed.

## Input Reference Guide

| Field                                     | Description                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Starting Cash ($)                         | The cash balance the strategy starts with. Set on the Inputs tab. Do not set initial capital on the Properties tab.                                                                                                                                                                                                                                      |
| Starting Crypto Quantity                  | The number of crypto units the strategy starts with. Enter unit count only — no notional value, no cost basis. If non-zero, the algo seeds that position via a single trade three calendar days before the strategy start date (the backtest start date, or today's date for a live strategy). The seed trade does not fire a webhook alert.             |
| Long Threshold (%)                        | Minimum red candle size required to trigger a buy. Negative values represent the candle size (e.g. -2 means a 2% red candle). Smaller magnitudes trigger more frequently.                                                                                                                                                                                |
| Exit Threshold (%)                        | Minimum green candle size required to trigger a sell. Positive values represent the candle size. Smaller magnitudes trigger more frequently.                                                                                                                                                                                                             |
| Fixed Trade Size                          | Checked by default. When only Fixed is checked, trades use the dollar amounts in Entry/Exit Trade Size ($). $5 minimum per trade.                                                                                                                                                                                                                        |
| Entry Trade Size ($)                      | Dollar amount per buy when Fixed Trade Size is the active calculation.                                                                                                                                                                                                                                                                                   |
| Exit Trade Size ($)                       | Dollar amount per sell when Fixed Trade Size is the active calculation.                                                                                                                                                                                                                                                                                  |
| Percentage Trade Size                     | When only Percentage is checked, entries size as a % of available cash and exits size as a % of available crypto. When both Fixed and Percentage are checked, the percentage calculation is the default; if the percentage result comes out smaller than the fixed dollar amount, the fixed amount is used as a floor. $5 minimum applies in both modes. |
| Entry Trade Size (%)                      | Percentage of available cash used per buy when Percentage Trade Size is the active calculation.                                                                                                                                                                                                                                                          |
| Exit Trade Size (%)                       | Percentage of available crypto used per sell when Percentage Trade Size is the active calculation.                                                                                                                                                                                                                                                       |
| Scope (0.5–micro, 10–macro)               | Controls the length of the Market Wave in 0.5 increments. 0.5 produces a short, fast-tracking wave (micro). 10 produces a long, slow wave (macro). Linear between the ends.                                                                                                                                                                              |
| Only Sell Above                           | When on (default), sells are restricted to candles closing above the top edge of the wave. Disables selling inside the wave.                                                                                                                                                                                                                             |
| Only Buy Below                            | When on (default), buys are restricted to candles closing below the bottom edge of the wave. Disables buying inside the wave.                                                                                                                                                                                                                            |
| Sell Buffer (%)                           | Adjusts the top edge of the wave. Positive values push the top edge OUT (up, away from center), making it harder for sells to qualify. Negative values pull the top edge IN (down, toward center), making it easier for sells to qualify.                                                                                                                |
| Buy Buffer (%)                            | Adjusts the bottom edge of the wave. Positive values push the bottom edge OUT (down, away from center), making it harder for buys to qualify. Negative values pull the bottom edge IN (up, toward center), making it easier for buys to qualify.                                                                                                         |
| Static Filter — Only Sell Above           | Optional manual price floor. When checked, sells only fire above the entered price, regardless of the wave.                                                                                                                                                                                                                                              |
| Static Filter — Only Buy Below            | Optional manual price ceiling. When checked, buys only fire below the entered price, regardless of the wave.                                                                                                                                                                                                                                             |
| Trend Filter — Buy on change of trend     | When checked, buys are gated to candles where a downtrend shows signs of reversal — the filter waits for price to bottom and recover before allowing a buy.                                                                                                                                                                                              |
| Trend Filter — Sell on change of trend    | When checked, sells are gated to candles where an uptrend shows signs of reversal — the filter waits for price to top and roll over before allowing a sell.                                                                                                                                                                                              |
| Start Date / Time                         | The date the strategy starts trading. For a backtest, this is the backtest start. For a live strategy, this is when the strategy begins operating. The seed trade (if Starting Crypto Quantity > 0) fires three calendar days prior.                                                                                                                     |
| End Date                                  | The date the strategy stops trading. For a backtest, this is the backtest end. For a live strategy, this can be set to when the strategy should stop operating.                                                                                                                                                                                          |
| Exit Full Position on Last Historical Bar | Backtesting only. When checked, closes any open position on the final bar of the backtest. Has no effect on a live strategy.                                                                                                                                                                                                                             |

## Disclaimer

This document describes the behavior of the Market Wave strategy and the function of its inputs. It does not constitute financial, investment, or trading advice. No outcome is guaranteed. All trading involves risk.


---
