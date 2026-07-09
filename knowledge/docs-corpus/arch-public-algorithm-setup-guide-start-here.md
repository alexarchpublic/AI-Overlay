> For the complete documentation index, see [llms.txt](https://docs.archpublic.com/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.archpublic.com/crypto/arch-public-algorithm-setup-guide-start-here.md).

# Arch Public Algorithm Setup Guide (Start Here)

## Set up a Supported Exchange Account

Arch Public Algorithms require an exchange account to function. We currently support Gemini, Kraken, Coinbase, and Robinhood (beta).

Once established, you will need to fund your account

## Set up a TradingView Account

1. Set up a [TradingView account](https://www.tradingview.com/). <mark style="background-color:orange;">**You will need an Essential Plan at minimum.**</mark>

## Set up TradingView 2 Factor Authentication&#x20;

Once you have created your account, click the account icon and find Profile Settings

<figure><img src="/files/4SsvZ4zX9A2WB7rm8vUq" alt="" width="188"><figcaption></figcaption></figure>

Click "Set 2-factor authentication". If you have not already subscribed to a paid plan, TradingView will prompt you to do so.

<figure><img src="/files/aU9UKl9ljNTDnDm8SWr7" alt="" width="375"><figcaption></figcaption></figure>

Select your preferred 2 Factor Authentication option using an authentication app or your phone number. In this example, we are using an authentication app.

<figure><img src="/files/rykgD6zQwdwXI6dDt8zB" alt="" width="375"><figcaption></figcaption></figure>

<figure><img src="/files/wSpt7GC9M2Jvo57ubdZd" alt="" width="375"><figcaption></figcaption></figure>

<figure><img src="/files/4nl4pVgU38GQO05peCp8" alt="" width="375"><figcaption></figcaption></figure>

<figure><img src="/files/OtjvGXPsPc9qsozevNoU" alt="" width="375"><figcaption></figcaption></figure>

2 Factor Authentication setup is complete when you see a "Disable" button next to your chosen 2FA method. If you do not see a "Disable" button, click "Enable" again to complete the process.

<figure><img src="/files/Orp9yldXzsO7gZLQqFqg" alt="" width="375"><figcaption></figcaption></figure>

## Access Arch Public Algorithms in TradingView

Log in to your [Arch Public account and go to Client Portal](https://archpublic.com/my-account/)

<figure><img src="/files/7rXOceWBcZ3kSfTQrFPs" alt="" width="563"><figcaption></figcaption></figure>

On the left-hand side, click Webhooks

<figure><img src="/files/Q3Xnq1g9tKhH9kku6j4U" alt="" width="305"><figcaption></figcaption></figure>

1. The Webhooks section is where you will find all critical inputs and outputs required to automate The Bitcoin Algorithm
2. In the User Information section you will need to input your TradingView Username and Opt into automated trades. (Make sure you click “Update” and “Save”).

<mark style="background-color:orange;">**Your TradingView Username IS NOT your email address. Entering your email address will not work.**</mark>

<figure><img src="/files/YCQ3D7Nyh5Bjpy2NL4ut" alt="" width="375"><figcaption></figcaption></figure>

## Connecting To Your Exchange Account

1. In order to connect your Crypto Exchange Account to Arch Public's suite of algorithms, you will need to create an API key in your exchange account and copy/paste the information into the Webhooks section in your Arch Public Client Portal.

### Connect To Kraken

{% hint style="warning" %}
IMPORTANT\
\
Kraken Staking Requirements:

Kraken Auto Earn may remain enabled. However, assets that are manually Flex Staked or Bonded Staked cannot be traded by Arch Public algorithms.

If a cryptocurrency is manually staked (Flex or Bonded), it must be unstaked before the algorithm can execute trades. Failing to do so may result in missed trades. You can stake a portion of a particular cryptocurrency and still trade with the unstaked portion.
{% endhint %}

Log in to your Kraken Account. In the top right-hand corner, click the Account icon and click Settings

<figure><img src="/files/WtkVGyExu44wUUitLFk8" alt="" width="375"><figcaption></figcaption></figure>

Click "Connections & API", then "Create API Key"

<figure><img src="/files/jP3noW7ogT0vLxni72uc" alt=""><figcaption></figcaption></figure>

Give your new API key a name. Make the selections as pictured in the screenshot. Then click "Generate Key"

<figure><img src="/files/PNjeTDLE7yIiuVdiytUr" alt=""><figcaption></figcaption></figure>

You will now see your API Key and API Secret Key. Make sure you copy these somewhere safe. If you lose your API Secret Key, you will simply have to create a new API key to regain functionality. Keep this window open so you can easily copy and paste these keys into your Arch Public Client Portal.

<figure><img src="/files/M8zBmCGUWbFQ097j0Plx" alt="" width="375"><figcaption></figcaption></figure>

Once you have copied your keys to a safe location, check the acknowledgement box above and Close. You will now find the API key you just created in your Kraken account.

Go back to your Arch Public Client Portal’s Webhook section. Copy and paste your API Key Name (also known as Account Alias), API Key, and Secret Key. Click “Add Account”.

<figure><img src="/files/xZaJFvhOvXt26XKgYPdm" alt=""><figcaption></figcaption></figure>

Once completed, you will see your Kraken API key appear in “Your Brokerage Accounts” section. You have now successfully connected Kraken to Arch Public's Crypto Algorithms.

You are now ready to [add your Arch Public Algorithms to TradingView](#adding-arch-public-algorithms-to-tradingview).

***

### Connect To Coinbase

Log in to your Coinbase Account. In the top right-hand corner, click the Account icon and click Settings

<figure><img src="/files/jmV0rkulrUAOGRMZ3u7V" alt="" width="375"><figcaption></figcaption></figure>

On the left-hand side, click "API" settings.

<figure><img src="/files/G3hsW5XTHjX7Okuoqdx0" alt="" width="375"><figcaption></figcaption></figure>

Click "Create API Key"

<figure><img src="/files/K2xHclxiJGfuPNbXJDMc" alt=""><figcaption></figcaption></figure>

Give your API key a nickname and enabling trading by selecting "Trade". Click "Create & download" when finished.

<figure><img src="/files/9yBLWJ7Q3fculIm3tWvD" alt="" width="375"><figcaption></figcaption></figure>

You may have to complete 2-factor authentication to view your API key.

<figure><img src="/files/qk4qKOSccZ9wBXq6Gnll" alt="" width="375"><figcaption></figcaption></figure>

Copy & Paste the ENTIRE API key and private key somewhere safe.&#x20;

<figure><img src="/files/PjHcqrPaG81TostHQGUx" alt="" width="375"><figcaption></figcaption></figure>

Go  to your Arch Public Client Portal’s Webhook section. Copy and paste your API Key Name (also known as Account Alias), API Key, and Secret Key. Click “Add Account”.\
\
Once added, you will see your coinbase key added. Click the "Test Connection" button to ensure your API key has been properly added.

<figure><img src="/files/Xj7sWJAi1D3FaZb9x4m9" alt=""><figcaption></figcaption></figure>

You are now ready to [add your Arch Public Algorithms to TradingView](#adding-arch-public-algorithms-to-tradingview).

***

### Connect To Gemini

1. Log in to your Gemini Account. In the top right-hand corner, click the Account icon and click Settings

<figure><img src="/files/GeIY8wY0ZE8BSGTJJOid" alt=""><figcaption></figcaption></figure>

On the right-hand side, click API

<figure><img src="/files/dtB3ofKheK0DUcYQYYbp" alt="" width="145"><figcaption></figcaption></figure>

Click “Create API Key”

<figure><img src="/files/9uh1NrXITkCbGgqPhTi4" alt="" width="375"><figcaption></figcaption></figure>

Select Primary Scope. Click Next.

<figure><img src="/files/Qj1KSXqsfSIIdAkrmavz" alt="" width="375"><figcaption></figcaption></figure>

Give the API key a name (it can be anything). Select “Trading”. Select "Unrestricted". Click “Create API Key”.

<figure><img src="/files/gVAGAj4P5TEq0dUMm3BL" alt="" width="305"><figcaption></figcaption></figure>

You will now see your API Key and API Secret Key. Make sure you copy these somewhere safe. If you lose your API Secret Key, you will simply have to create a new API key to regain functionality. Keep this window open so you can easily copy and paste these keys into your Arch Public Client Portal.

<figure><img src="/files/IfFTKVlk8C0ew2VFv9F1" alt="" width="188"><figcaption></figcaption></figure>

Once you have copied your keys to a safe location, check the acknowledgement box above and Close. You will now find the API key you just created in your Gemini account.

<figure><img src="/files/Zv3R6QCo72szKb93AXys" alt=""><figcaption></figcaption></figure>

Go back to your Arch Public Client Portal’s Webhook section. Copy and paste your API Key Name (also known as Account Alias), API Key, and Secret Key. Click “Add Account”.

<figure><img src="/files/dp0xxljzxFIJLNs790BF" alt=""><figcaption></figcaption></figure>

Once completed, you will see your Gemini API key appear in “Your Brokerage Accounts” section. You have now successfully connected Gemini to Arch Public's Crypto Algorithms.

You are now ready to [add your Arch Public Algorithms to TradingView](#adding-arch-public-algorithms-to-tradingview).

***

### Connect To Robinhood

{% hint style="info" %}
NOTE: To access available assets through Robinhood on TradingView, you must select BITSTAMP as the exchange. Robinhood recently acquired Bitstamp.
{% endhint %}

To connect to Robinhood, you will need to first generate a private/public key. Go to your Arch Public Client Portal > Webhooks. \
\
In the Add Account section, select Robinhood from the *Broker* dropdown. Enter a Brokerage Alias of your choice, choose between API v1 and API v2, and then click “Generate Private/Public Keys.”

v1 and v2 use different order routing and fee structures.\
For details on the differences between API v1 and v2, please refer to Robinhood’s documentation here: <https://robinhood.com/us/en/support/articles/crypto-api/>\ <br>

<figure><img src="/files/iL8QilNENKWoG5LYY0lc" alt="" width="535"><figcaption></figcaption></figure>

You will see both the Private Key and Public Key appear. Click the “Copy” button to copy the Public Key to your clipboard.

<figure><img src="/files/JP56ieelgRh35XOUnrer" alt="" width="534"><figcaption></figcaption></figure>

In a separate tab or window, log in to your Robinhood Account. In the top right-hand corner, click "Account" > "Crypto".

<figure><img src="/files/5F40DrYBSEvo5CdTvRgx" alt="" width="375"><figcaption></figcaption></figure>

Under API Trading, Select "Add Key".

<figure><img src="/files/6wijbpLRg8b2d25XWz3d" alt="" width="375"><figcaption></figcaption></figure>

Give the key the same name as the “Brokerage Alias” you created in your Arch Public Client Portal.

You must select all five of the lower “Read” permissions (Read crypto accounts, Read crypto holdings, Read crypto orders, Read crypto products, and Read crypto quotes), plus at least one of the top “Place crypto orders” options.

You must select at least one of the following order actions (matching your Arch setup):

* Place crypto orders with fee tiers = v2
* Place crypto orders without fee tiers = v1

The option you select should match the API version chosen in your Arch Public Client Portal. You may select both if desired, but trades will be submitted according to the version established in Arch.

<figure><img src="/files/F6GUtKXoEsHlr5NWPvVW" alt=""><figcaption></figcaption></figure>

Copy/Paste the "Public Key" you generated in the Arch Public Client Portal to the "Public Key" Field in the Add Key form, the Click Save. You may be asked to confirm the activity with your phone.

<figure><img src="/files/YWMLVHF03pneCCLDt5rJ" alt="" width="330"><figcaption></figcaption></figure>

When successful, you will see your API key appear under the "API Trading" Section.

<figure><img src="/files/GT14yKGwS3sIjsOyd8TY" alt=""><figcaption></figcaption></figure>

Click the Robinhood API key that was just generated.

<figure><img src="/files/YgtVG5mnQlFHSx21l3eO" alt=""><figcaption></figcaption></figure>

Click "Copy Key".

<figure><img src="/files/QFju89TZEOJofTl4Ki6B" alt=""><figcaption></figcaption></figure>

Navigate back to your Arch Public Client Portal > "Webhooks" in the separate tab or window.  Paste the Robinhood API key into the "API Key" Field. Click "Add Account".

<figure><img src="/files/sTVt6Op1rBFllOgQxNAk" alt=""><figcaption></figcaption></figure>

Once added, click the "Test Connection" button under "Your Brokerage Accounts" section in the Arch Public Client portal to verify.

***

## Adding Arch Public Algorithms To TradingView

On the TradingView homepage, click the upper left-hand menu and select Supercharts

<figure><img src="/files/HViZuDelaIaND7COISAu" alt="" width="178"><figcaption></figcaption></figure>

Select the correct trading pair in the chart by clicking the symbol selector. For a current list of trading pairs, please reference the [Crypto FAQ](/crypto/crypto-faq.md#what-crypto-pairs-can-i-trade) . The exchange **must** be the same as your exchange (Kraken or Gemini) otherwise the algorithms will not display.

<mark style="background-color:orange;">IMPORTANT NOTE - If your exchange account is funded with a currency other than USD (For example, GBP, USDT, etc.), your chart MUST be set to the correct pair (e.g. BTCGBP, BTCUSDT).</mark>

<figure><img src="/files/hylVMHS7kjc6hLHPQGsS" alt=""><figcaption></figcaption></figure>

<figure><img src="/files/okMjjrIB9Z6BJib88xYU" alt=""><figcaption></figcaption></figure>

<figure><img src="/files/ooDkWJQZow71cbpxzkJU" alt=""><figcaption></figcaption></figure>

<figure><img src="/files/lt5I6ZIV6Xcyn0xdjvRR" alt=""><figcaption></figcaption></figure>

1. Select Indicators > Invite Only.
2. This is where you will add the main Bitcoin Algorithms to your chart. Click the algorithm(s) you would like to add to your chart. You will see them appear on your chart.

<mark style="background-color:orange;">Please allow for up to 24 hours after adding your TradingView username to the Arch Public Client Portal. You will need to refresh TradingView in your browser to see recently added algorithms in the “Invite-only” section.</mark>

<figure><img src="/files/5xQoVRbcLMkZxj6IjQEj" alt="" width="375"><figcaption></figcaption></figure>

You will see the algorithms you’ve selected appear on the chart.

<figure><img src="/files/beTmCoBy0KWdkfQl9l9m" alt=""><figcaption></figcaption></figure>

Display only one algorithm at a time when performing analysis and setting changes. To do so, click the eyeball icon next to the algorithm’s name on the chart. Notice that the visible algorithm has a clear eyeball while the invisible algorithm has a cross through the eyeball.

<figure><img src="/files/3oD3fzGzSkH852YfKbaf" alt=""><figcaption></figcaption></figure>

The main functions you will use are the algorithm settings menu (gear icon), Strategy Tester, and timeframes.

<figure><img src="/files/mwNUjChnNTcV7U0qCZqH" alt=""><figcaption></figcaption></figure>

Timeframes change the period on which the algorithms function, therefore significantly effecting the performance of any given set of algorithm parameters. When setting up an instance, ensure that you are on the timeframe you desire for that instance.

<figure><img src="/files/uPL1CVolx6ELLLarWluY" alt=""><figcaption></figcaption></figure>

## Setup Complete! What Next?

Start with an instance of the Arbitrage Algorithm or Intelligence Algorithm.\
\
The Arbitrage Algorithm is deigned to take advantage of the volatility of cryptocurrency. It can be tuned to generate a cash yield, accumulate cryptocurrency, sell off an existing position, or a blend of all three.&#x20;

[Setup an instance of the Arbitrage Algorithm.](/crypto/arbitrage-algorithm-setup-guide.md)\
\
The Intelligence Algorithm is designed to accumulate cryptocurrency at the most opportune prices and excels at building a strong foundation in any cryptocurrency.

[Setup an instance of the Intelligence Algorithm.](/crypto/intelligence-algorithm-setup-guide.md)

## Navigating TradingView

TradingView is a comprehensive trading platform and we understand it can be daunting at first glance. For questions related to using TradingView, it's best to ask their support AI as you get up and running.

<figure><img src="/files/WefllDYpZRh0N2btoewr" alt="" width="375"><figcaption></figcaption></figure>


---
