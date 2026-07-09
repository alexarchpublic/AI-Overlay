> For the complete documentation index, see [llms.txt](https://docs.archpublic.com/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.archpublic.com/crypto/arbitrage-algorithm-recipes.md).

# Arbitrage Algorithm: Recipes

{% hint style="warning" %}
To explore all Arch Public Recipes, visit <https://recipes.archpublic.com/>.\
\
This page will be depreciated January 1, 2026.

Learn how to use Recipe Lab in under 5 minutes: <https://youtu.be/f_HjWioMlF8>
{% endhint %}

This section provides actionable case studies with *tested parameter sets* that clients can replicate in TradingView. Each example balances cash flow generation and Crypto accumulation based on specific objectives.

{% embed url="<https://youtu.be/ExeyHpHLUgA>" %}

***

<mark style="background-color:orange;">Note: When you find a recipe you want to use, but would like to change the amount of money you are buying and selling without changing it's performance, you will need to take note of the proportion between Entry Trade Size and Exit Trade Size.</mark>&#x20;

<mark style="background-color:orange;">Using STH Recipe No. 1 as an example, the proportion between the Exit and Entry size is 81.25%. This means the Exit Trade is 81.25% smaller than the Entry Trade. If you wanted the Entry trade to be $1,000, you can calculate the Exit: $1,000\*0.8125 = $812.50</mark>

<mark style="background-color:orange;">We have included an Exit to Entry Proportion under each recipe's Parameters section to make this easy.</mark>

***

## Bitcoin Recipes

### Short Time Horizon (STH) Recipes

Short time horizon recipes are backtested over the previous 6 months, optimized for current market conditions. These recipes are tailored to deploy and trade meaningful amounts of capital across shorter time horizons.

#### **\[BTC] STH Recipe No. 1: Daily Arbitrage**

**Goal**: Accumulate a Bitcoin position at a low cost basis while taking advantage of volatility to book cash profits.

**Parameters**:

* **Entry Trade**: Purchase $8,000 when price drops **3%**
* **Exit Trade**: Sell $6,500 when price rises **3.5%**
* **Sell Above Cost Basis:** Checked
* **Exit to Entry Proportion: 81.25%**
* **Time Frame**: Daily
* **Backtesting Period**: January, 2025 - June, 2025

**Results**:

* Initial Capital: $100,000
* Cash Profit: **$2,742**
* Bitcoin Accumulated: $96,170 (0.92 BTC @ $104,000)
* Net Profit: **$20,455** (87% from BTC growth, 13% cash)
* CAGR: **45.29%**

&#x20;

<figure><img src="/files/S860T4ybJNJ0Lg6n8v3t" alt=""><figcaption></figcaption></figure>

<figure><img src="/files/CarfOHb8Lgc59X5YLoyE" alt=""><figcaption></figcaption></figure>

<figure><img src="/files/zHGd2QfIzUC3cNq8eHgJ" alt="" width="375"><figcaption></figcaption></figure>

<figure><img src="/files/lB01p4A0pbjyKXzvbUiZ" alt="" width="375"><figcaption></figcaption></figure>

***

### Long Time Horizon (LTH) Recipes

Long Time Horizon recipes are backtested over many years, optimized to endure multiple market cycles. These recipes are tailored to deploy capital over a long time without adding additional capital. We recognize this isn't completely realistic as the majority of clients add capital throughout a multiple year time horizon. Therefore, the statistics for each recipe represent lower performance than what will realistically occur.&#x20;

Never the less, the recipes below offer substantial returns. Ensure that you are sizing entry and exit trade amounts to fit your account size. \
\
For example, if you deploy LTH Recipe No. 1 with a $100,000 account, you will want to multiple the entry and exit trade size by 2x in order to match the return results.

#### **\[BTC] LTH Recipe No. 1: 6 hour Arbitrage**

**Goal**: Maximize short-term cash profits in volatile intra-day markets while building a core BTC position.

**Parameters**:

* **Entry Trade**: Purchase $580 when price drops **2.5%**
* **Exit Trade**: Sell $260 when price rises **2.1%**
* **Sell Above Cost Basis:** Checked
* **Exit to Entry Proportion: 44.8%**
* **Time Frame**: 6 Hour
* **Backtesting Period**: January, 2019– April, 2025

**Results**:

* Initial Capital: $50,000
* Cash Profit: **$98,913**
* Bitcoin Accumulated: $520,776 (6.53 BTC @ $79,588)
* Net Profit: **$471,568** (79% from BTC growth, 21% cash)
* CAGR: **47.52%**
* **Best For**: Clients comfortable with moderate activity who would like to generate a moderate cash position while growing their BTC core position.

<figure><img src="/files/oHrQCGeJw2SlMiNfh2dn" alt=""><figcaption></figcaption></figure>

<figure><img src="/files/RR7B2R4xarwaXirgtfSM" alt=""><figcaption></figcaption></figure>

<figure><img src="/files/HbFeo6C2sTQxXUab4T9v" alt="" width="375"><figcaption></figcaption></figure>

<figure><img src="/files/UuGXgov5DXAAeIawqTED" alt="" width="375"><figcaption></figcaption></figure>

***

#### &#x20;**\[BTC] LTH Recipe No. 2: Daily Arbitrage**

**Goal**: Maximize short-term cash profits in volatile markets while building a core BTC position.

**Parameters**:

* **Entry Trade**: Purchase $580 when price drops **2.5%**
* **Exit Trade**: Sell $260 when price rises **2.1%**
* **Exit to Entry Proportion: 44.8%**
* **Time Frame**: 1 Day
* **Backtesting Period**: January, 2019– January, 2025

**Results**:

* Cash Profit: **$68,440**
* Bitcoin Accumulated: $246,189 (2.3 BTC @ $107,000)
* Net Profit: **$314,629** (78% from BTC growth, 22% cash)
* Annualized Return: **26.7%**
* **Best For**: Clients comfortable with moderate activity who would like to generate a moderate cash position while growing their BTC core position.

<figure><img src="/files/WKrnK6SyWjydIG3vHBNr" alt=""><figcaption></figcaption></figure>

<figure><img src="/files/gAGQQC89y3suLo4CPEdD" alt=""><figcaption></figcaption></figure>

<figure><img src="/files/VLViJt0Lz2QwgUZVwKdj" alt="" width="375"><figcaption></figcaption></figure>

<figure><img src="/files/fdvd2iBy6gxSg9scHyoE" alt="" width="375"><figcaption></figcaption></figure>

***

#### &#x20;**\[BTC] LTH Recipe No. 3: Cycle Arbitrage**

**Goal**: Maximize BTC & Cash profits over entire market cycles, continuously

**Parameters**:

* **Entry Trade**: Purchase $50,000 when price drops **20%**
* **Exit Trade**: Sell $25,000 when price rises **16%**
* **Exit to Entry Proportion:  50%**
* **Time Frame**: 1 Week
* **Backtesting Period**: January, 2019– January, 2025

**Results**:

* Cash Profit: **$191,840**
* Bitcoin Accumulated: $991,553 (9.8 BTC @ $101,000)
* Net Profit: **$1,183,393** (84% from BTC growth, 16% cash)
* Annualized Return: **53%**
* **Best For**: Clients seeking to deploy large amounts of capital at cycle bottoms and take profits during and near the end of cycle tops.

<figure><img src="/files/5J0WsCmLFg9xc2GIAWiO" alt=""><figcaption></figcaption></figure>

<figure><img src="/files/KjQ21TRY9o8QMEFU0gZ3" alt=""><figcaption></figcaption></figure>

<figure><img src="/files/qw40KMizJGQYBN4wfsTF" alt="" width="375"><figcaption></figcaption></figure>

<figure><img src="/files/lXRehC0efhNfFAaiu7hd" alt="" width="375"><figcaption></figcaption></figure>

***

#### **\[BTC] LTH Recipe No. 4: Bitcoin Yield**

**Goal**: Maximize BTC yield while accumulating BTC

**Parameters**:

* **Entry Trade**: Purchase $1,200 when price drops **2.5%**
* **Exit Trade**: Sell $1,500 when price rises **2.1%**
* **Exit to Entry Proportion:  125%**
* **Time Frame**: 6 Hour
* **Backtesting Period**: October, 2021– April, 2025

**Results**:

* Cash Profit: **$102,454**
* Bitcoin Accumulated: $129,200 (1.36 BTC @ $95,000)
* Net Profit: **$144,372** (29% from BTC growth, 71% cash)
* Annualized Return: **25.77%**
* Realized Cash Yield: **20.32%**
* **Best For**: Clients seeking significant cash yield while accumulating BTC over the long term.

<figure><img src="/files/2ngGBwbSLez5F0Gj33DD" alt=""><figcaption></figcaption></figure>

<figure><img src="/files/1reCy7DtLj7IJfOcwL4N" alt=""><figcaption></figcaption></figure>

<figure><img src="/files/TyYIgm3ssYiumrvq0GXM" alt="" width="375"><figcaption></figcaption></figure>

<figure><img src="/files/wqPhRbBfr2Fs6rAmJGeV" alt="" width="375"><figcaption></figcaption></figure>

***

## Solana Recipes

### Short Time Horizon (STH) Recipes

Short time horizon recipes are backtested over the previous 6 months, optimized for current market conditions. These recipes are tailored to deploy and trade meaningful amounts of capital across shorter time horizons.

#### **\[SOL] STH Recipe No. 1: High Cash Flow**

**Goal**: Maximize short-term cash profits in volatile markets while building a small SOL position.

**Parameters**:

* **Entry Trade**: Purchase $14,000 when price drops &#x36;**%**
* **Exit Trade**: Sell $11,500 when price rises &#x35;**%**
* **Exit to Entry Proportion: 82.14%**
* **Time Frame**: 1 Day
* **Backtesting Period**: January, 2025– June, 2025

**Results**:

* Cash Profit: **$19,115**
* Solana Accumulated: $33,317 (227 SOL @ $146)
* Net Profit: **$23,800** (20% from SOL growth, 80% cash)
* CAGR: **53.35%**

<figure><img src="/files/tAIeYEf1I2tXTGRo8t0Z" alt=""><figcaption></figcaption></figure>

<figure><img src="/files/HJRIJe8HMLCUbRFaJGex" alt=""><figcaption></figcaption></figure>

<figure><img src="/files/ydz6qvpsEmof2Xk4fGDK" alt="" width="375"><figcaption></figcaption></figure>

<figure><img src="/files/vVaCXDisqezlSoPDgHhX" alt="" width="375"><figcaption></figcaption></figure>

***

### Long Time Horizon (LTH) Recipes

Long Time Horizon recipes are backtested over many years, optimized to endure multiple market cycles. These recipes are tailored to deploy capital over a long time without adding additional capital. We recognize this isn't completely realistic as the majority of clients add capital throughout a multiple year time horizon. Therefore, the statistics for each recipe represent lower performance than what will realistically occur.&#x20;

Never the less, the recipes below offer substantial returns. Ensure that you are sizing entry and exit trade amounts to fit your account size. \
\
For example, if you deploy LTH Recipe No. 1 with a $200,000 account, you will want to multiple the entry and exit trade size by 2x in order to match the return results.

#### **\[SOL] LTH Recipe No. 1: High Cash Flow**

**Goal**: Maximize short-term cash profits in volatile markets while building a small SOL position.

**Parameters**:

* **Entry Trade**: Purchase $2900 when price drops **5%**
* **Exit Trade**: Sell $1300 when price rises **4.2%**
* **Exit to Entry Proportion: 44.8%**
* **Time Frame**: 1 Day
* **Backtesting Period**: January, 2023– March, 2025

**Results**:

* Initial Capital: $100,000
* Cash Profit: **$81,366**
* Solana Accumulated: $3,975 (34 SOL @ $117)
* Net Profit: **$85,341** (5% from SOL growth, 95% cash)
* Annualized Return: **31.8%**
* **Best For**: Clients comfortable with moderate activity who would like to generate a large cash position while growing their SOL position incrementally.

<figure><img src="/files/Sg18AjONy0O38nz6O0yr" alt=""><figcaption></figcaption></figure>

<figure><img src="/files/FtUv15O3ajoqn8gkKdkI" alt=""><figcaption></figcaption></figure>

<figure><img src="/files/oqoWq6uB3yj34NmOgnPQ" alt="" width="375"><figcaption></figcaption></figure>

<figure><img src="/files/kWnNYtCs3RduiW2Gp6ho" alt="" width="375"><figcaption></figcaption></figure>

***

## XRP Recipes

### Short Time Horizon (STH) Recipes

Short time horizon recipes are backtested over the previous 6 months, optimized for current market conditions. These recipes are tailored to deploy and trade meaningful amounts of capital across shorter time horizons.

#### **\[ XRP] STH Recipe No. 1: Daily Cash Arbitrage**

**Goal**: Maximize short-term cash profits using XRP volatility.

**Parameters**:

* **Entry Trade**: Purchase $15,000 when price drops **3.7%**
* **Exit Trade**: Sell $16,000 when price rises **1.6%**
* **Sell Above Cost Basis:** Checked
* **Exit to Entry Proportion:  106.6%**
* **Time Frame**: Daily
* **Backtesting Period**: January, 2025– June, 2025

**Results**:

* Initial Capital: $100,000
* Cash Profit: **$26,593**
* XRP Accumulated: $0
* Net Profit: **$26,593** (100% cash)
* CAGR: **60.26%**

<figure><img src="/files/IkOcEyyauuCEBW0WQyVK" alt=""><figcaption></figcaption></figure>

<figure><img src="/files/fGYWWK7ZoQafSaxKQfU3" alt=""><figcaption></figcaption></figure>

<figure><img src="/files/18D5djAYpZP9SrgfcBF7" alt="" width="375"><figcaption></figcaption></figure>

<figure><img src="/files/EsrpeBUpvvJLhfMqij9O" alt="" width="375"><figcaption></figcaption></figure>

#### **\[ XRP] STH Recipe No. 2: 6 Hour Cash Arbitrage**

**Goal**: Maximize short-term cash profits using XRP volatility.

**Parameters**:

* **Entry Trade**: Purchase $5,000 when price drops **2.5%**
* **Exit Trade**: Sell $10,000 when price rises **2.2%**
* **Sell Above Cost Basis:** Checked
* **Exit to Entry Proportion:  200%**
* **Time Frame**: 6 Hour
* **Backtesting Period**: January, 2025– July, 2025

**Results**:

* Initial Capital: $100,000
* Cash Profit: **$17,785**
* XRP Accumulated: $34,474 (14,490 XRP @ $2.37/XRP)
* Net Profit: **$21,378** (83% cash)
* CAGR: **47.34%**

<figure><img src="/files/xdDcVAs4Bq17aNvvnp25" alt=""><figcaption></figcaption></figure>

<figure><img src="/files/EFcujotHLn81ZgkRpxl0" alt=""><figcaption></figcaption></figure>

<figure><img src="/files/zVigwFCmMjHbYo5s42t4" alt="" width="375"><figcaption></figcaption></figure>

<figure><img src="/files/ZDKSNUzZLKbv50Pvep1k" alt="" width="375"><figcaption></figcaption></figure>

***

### Long Time Horizon (LTH) Recipes

Long Time Horizon recipes are backtested over many years, optimized to endure multiple market cycles. These recipes are tailored to deploy capital over a long time without adding additional capital. We recognize this isn't completely realistic as the majority of clients add capital throughout a multiple year time horizon. Therefore, the statistics for each recipe represent lower performance than what will realistically occur.&#x20;

Never the less, the recipes below offer substantial returns. Ensure that you are sizing entry and exit trade amounts to fit your account size. \
\
For example, if you deploy LTH Recipe No. 1 with a $200,000 account, you will want to multiple the entry and exit trade size by 2x in order to match the return results.

#### **\[ XRP] LTH Recipe No. 1: 6 hour Arbitrage**

**Goal**: Maximize short-term cash profits in volatile intra-day markets while building a core XRP position.

**Parameters**:

* **Entry Trade**: Purchase $18,000 when price drops **3.1%**
* **Exit Trade**: Sell $16,000 when price rises **1.6%**
* **Sell Above Cost Basis:** Checked
* **Exit to Entry Proportion:  88.8%**
* **Time Frame**: 6 Hour
* **Backtesting Period**: December, 2024– April, 2025

**Results**:

* Initial Capital: $100,000
* Cash Profit: **$40,369**
* XRP Accumulated: $76,752 (36,196 XRP @ $2.12)
* Net Profit: **$49,027** (18% from XRP growth, 82% cash)
* CAGR: **122%**
* **Best For**: Clients comfortable with moderate activity who would like to generate a substantial cash position while growing their XRP core position.

<figure><img src="/files/mQTMDjyNhnLkLizqcWxv" alt=""><figcaption></figcaption></figure>

<figure><img src="/files/MTQLKHcAaCVA8tzdn8eo" alt=""><figcaption></figcaption></figure>

<figure><img src="/files/Z72XN9c6cF5yIq6mMxHG" alt="" width="375"><figcaption></figcaption></figure>

<figure><img src="/files/TPNK56rMridVBykCWFMF" alt="" width="375"><figcaption></figcaption></figure>

***

#### **\[XRP] LTH Recipe No. 2: 1 hour Cash Yield**

**Goal**: Maximize cash profits while maintaining little to no XRP long term.

**Parameters**:

* **Entry Trade**: Purchase $7,000 when price drops **2.5%**
* **Exit Trade**: Sell $14,583 when price rises 2.&#x31;**%**
* **Sell Above Cost Basis:** Checked
* **Exit to Entry Proportion:  208%**
* **Time Frame**: 1 Hour
* **Backtesting Period**: December, 2024– April, 2025

**Results**:

* Initial Capital: $100,000
* Cash Profit: **$32,272**
* XRP Accumulated: $0
* Net Profit: **$32,272** (100% cash)
* CAGR: **88%**
* **Best For**: Clients that want to take advantage of XRP volatility to generate a cash yield while mitigating long term XRP allocation risk.

<figure><img src="/files/d2wxOKUbd2nvbaOhrfx5" alt=""><figcaption></figcaption></figure>

<figure><img src="/files/yzcxr9hyH0MIPLjHkJxR" alt=""><figcaption></figcaption></figure>

<figure><img src="/files/lGwrMwLIj9SRGmzHnCJC" alt="" width="375"><figcaption></figcaption></figure>

<figure><img src="/files/rYbhIOpWvn3lC4dAgtVQ" alt="" width="375"><figcaption></figcaption></figure>

***

## Ethereum Recipes

### Short Time Horizon (STH) Recipes

Short time horizon recipes are backtested over the previous 6 months, optimized for current market conditions. These recipes are tailored to deploy and trade meaningful amounts of capital across shorter time horizons.

#### **\[ETH] STH Recipe No. 1: Daily Cash Arbitrage**

**Goal**: Generate strong cash returns leveraging Ethereum volatility.

**Parameters**:

* **Entry Trade**: Purchase $12,000 when price drops &#x37;**%**
* **Exit Trade**: Sell $24,000 when price rises &#x36;**%**
* **Sell Above Cost Basis:** Checked
* **Exit to Entry Proportion:  200%**
* **Time Frame**: 1 Day
* **Backtesting Period**: January, 2025– June, 2025

**Results**:

* Initial Capital: $100,000
* Cash Profit: **$21,789**
* ETH Accumulated: 0 ETH&#x20;
* Net Profit: **$21,789** (100% Cash Yield)
* CAGR: 48.3&#x33;**%**

<figure><img src="/files/rgVP3PGd9Lh3YGnNqj1A" alt=""><figcaption></figcaption></figure>

<figure><img src="/files/uX2STRmrbmuX9NfhFGKI" alt=""><figcaption></figcaption></figure>

<figure><img src="/files/JcbGpOJbucvhlNrWmxRy" alt="" width="375"><figcaption></figcaption></figure>

<figure><img src="/files/TBKrnhh2M0XBV5cC6hXa" alt="" width="375"><figcaption></figcaption></figure>

#### **\[ETH] STH Recipe No. 2: Daily Accumulation Arbitrage**

**Goal**: Establish a sizable Ethereum position while minimizing drawdown.

**Parameters**:

* **Entry Trade**: Purchase $12,000 when price drops &#x37;**%**
* **Exit Trade**: Sell $8,000 when price rises &#x36;**%**
* **Sell Above Cost Basis:** Checked
* **Exit to Entry Proportion:  66.6%**
* **Time Frame**: 1 Day
* **Backtesting Period**: January, 2025– June, 2025

**Results**:

* Initial Capital: $100,000
* Cash Profit: -**$656**
* ETH Accumulated: $82,147ETH (32.5 ETH @ $2,500)
* Net Profit: **$22,203** (100% from ETH growth)
* CAGR: 49.&#x32;**%**

<figure><img src="/files/2ALjPfNsiONDYEr1OaNP" alt=""><figcaption></figcaption></figure>

<figure><img src="/files/LfwBLt5WLAGaq9R5WKqA" alt=""><figcaption></figcaption></figure>

<figure><img src="/files/hWhUFr2dUxWgW2SltmJV" alt="" width="375"><figcaption></figcaption></figure>

<figure><img src="/files/lhQ4IgddbpZdFqJQ98h2" alt="" width="375"><figcaption></figcaption></figure>

***

### Long Time Horizon (LTH) Recipes

Long Time Horizon recipes are backtested over many years, optimized to endure multiple market cycles. These recipes are tailored to deploy capital over a long time without adding additional capital. We recognize this isn't completely realistic as the majority of clients add capital throughout a multiple year time horizon. Therefore, the statistics for each recipe represent lower performance than what will realistically occur.&#x20;

Never the less, the recipes below offer substantial returns. Ensure that you are sizing entry and exit trade amounts to fit your account size. \
\
For example, if you deploy LTH Recipe No. 1 with a $200,000 account, you will want to multiple the entry and exit trade size by 2x in order to match the return results.

#### **\[ETH] LTH Recipe No. 1: Daily Arbitrage**

**Goal**: A balanced strategy for cash yield and Ethereum accumulation.

**Parameters**:

* **Entry Trade**: Purchase $8,000 when price drops **4%**
* **Exit Trade**: Sell $12,000 when price rises **3.8%**
* **Sell Above Cost Basis:** Checked
* **Exit to Entry Proportion:  150%**
* **Time Frame**: 1 Day
* **Backtesting Period**: October, 2023– April, 2025

**Results**:

* Initial Capital: $100,000
* Cash Profit: **$29,414**
* ETH Accumulated: 39.9 ETH ($101,230 @ $2,529/ETH)
* Net Profit: **$56,718** (52% Cash Yield, 48% Accumulation)
* CAGR: 29.7&#x38;**%**
* **Best For**: Clients that want generate yield while accumulating Ethereum.

<figure><img src="/files/xkwfwg0Ypq6a8f6MvZ4n" alt=""><figcaption></figcaption></figure>

<figure><img src="/files/TiD9aspCQj5KlC32Ieuj" alt=""><figcaption></figcaption></figure>

<figure><img src="/files/sPuIc32fjaBv3AlufBWr" alt="" width="375"><figcaption></figcaption></figure>

<figure><img src="/files/C4BsiSMWPwvtxSxRPk0y" alt="" width="375"><figcaption></figcaption></figure>

***

## SUI Recipes

### Short Time Horizon (STH) Recipes

Short time horizon recipes are backtested over the previous 6 months, optimized for current market conditions. These recipes are tailored to deploy and trade meaningful amounts of capital across shorter time horizons.

#### **\[SUI] STH Recipe No. 1: Cash Yield**

**Goal**: Generate strong cash returns leveraging SUI volatility.

**Parameters**:

* **Entry Trade**: Purchase $2,900 when price drops 3.&#x38;**%**
* **Exit Trade**: Sell $28,000 when price rises &#x36;**%**
* **Sell Above Cost Basis:** Checked
* **Exit to Entry Proportion:  965%**
* **Time Frame**: 1 Day
* **Backtesting Period**: January, 2025– July, 2025

**Results**:

* Initial Capital: $100,000
* Cash Profit: **$18,683**
* SUI Accumulated: 2,158 SUI ($6,305 @ $2.92/SUI)
* Net Profit: **$19,188** (97% Cash Yield)
* CAGR: 42.0&#x36;**%**

<figure><img src="/files/N8N5DVCDwyJUKIbnyI6S" alt=""><figcaption></figcaption></figure>

<figure><img src="/files/CUhWEwjEJO1Q4rqvwcS1" alt=""><figcaption></figcaption></figure>

<figure><img src="/files/pkxkYrlOxOxrJF3OfE0L" alt="" width="375"><figcaption></figcaption></figure>

<figure><img src="/files/oAcJSx6S8c3noHwJNtB8" alt="" width="375"><figcaption></figcaption></figure>

#### **\[SUI] STH Recipe No. 2: Balanced Accumulation**

**Goal**: Generate a significant SUI position while profiting off of volatility spikes.

**Parameters**:

* **Entry Trade**: Purchase $2,900 when price drops 3.&#x38;**%**
* **Exit Trade**: Sell $3,100 when price rises &#x34;**%**
* **Sell Above Cost Basis:** Checked
* **Exit to Entry Proportion:  106.9%**
* **Time Frame**: 1 Day
* **Backtesting Period**: January, 2025– July, 2025

**Results**:

* Initial Capital: $100,000
* Cash Profit: **$7,568**
* SUI Accumulated: 26,769 SUI ($78,258 @ $2.92/SUI)
* Net Profit: **$18,833** (40% Cash Yield)
* CAGR: 41.1&#x39;**%**

<figure><img src="/files/CgLDjqecmQ93LyM13iND" alt=""><figcaption></figcaption></figure>

<figure><img src="/files/ldCNjhAvNya5o1xtJURI" alt=""><figcaption></figcaption></figure>

<figure><img src="/files/0CbzdcZw6NA1wDLIJIki" alt="" width="375"><figcaption></figcaption></figure>

<figure><img src="/files/YFOBKZFK0oNvNE4W4sZa" alt="" width="375"><figcaption></figcaption></figure>

#### **\[SUI] STH Recipe No. 3: Max Accumulation**

**Goal**: Generate a maximal SUI position at a low cost basis positioned for large, positive price movement.

**Parameters**:

* **Entry Trade**: Purchase $2,900 when price drops 3.&#x38;**%**
* **Exit Trade**: Sell $2,350 when price rises &#x34;**%**
* **Sell Above Cost Basis:** Checked
* **Exit to Entry Proportion:  81%**
* **Time Frame**: 1 Day
* **Backtesting Period**: January, 2025– July, 2025

**Results**:

* Initial Capital: $100,000
* Cash Profit: **$554**
* SUI Accumulated: 33,302 SUI ($97,491 @ $2.92/SUI)
* Net Profit: **$16,328** (3.3% Cash Yield)
* CAGR: 35.3&#x32;**%**

<figure><img src="/files/szGfdIsu3hbtYBO1ueoE" alt=""><figcaption></figcaption></figure>

<figure><img src="/files/dxpnZSjfF6n6nQPNMraB" alt=""><figcaption></figcaption></figure>

<figure><img src="/files/cbbDPT8gkpZ7A5Y34Axg" alt="" width="375"><figcaption></figcaption></figure>

<figure><img src="/files/cMjjHibUXzbiM8fy0Wow" alt="" width="375"><figcaption></figcaption></figure>


---
