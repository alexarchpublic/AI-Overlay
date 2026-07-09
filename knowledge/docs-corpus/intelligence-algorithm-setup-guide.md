> For the complete documentation index, see [llms.txt](https://docs.archpublic.com/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.archpublic.com/crypto/intelligence-algorithm-setup-guide.md).

# Intelligence Algorithm Setup Guide

The Intelligence Algorithm is designed to accumulate cryptocurrency at the most opportune prices and excels at building a strong foundation in any cryptocurrency.

Once you've completed the [Bitcoin Algorithm Setup Guide](/crypto/arch-public-algorithm-setup-guide-start-here.md), you can start building an instance of the Intelligence Algorithm by ensuring that only the Intelligence Algorithm is visible. Click the the settings icon to begin changing parameters.

<figure><img src="/files/7tenN31LkHKC8GOjLEf5" alt=""><figcaption></figcaption></figure>

## Funding Options

The Intelligence Algorithm requires cash or stablecoins in your Gemini account. If you need to sell off a cryptocurrency position, you can use the Arbitrage Algorithm to do so.

## Quick Start Using Recipes

Beginning with our pre-built recipes is the fast way to start trading with the Intelligence Algorithm.

{% content-ref url="/pages/lnMVV2GRouGNWUnBAcCW" %}
[Intelligence Algorithm: Recipes](/crypto/intelligence-algorithm-recipes.md)
{% endcontent-ref %}

Once you have copied the recipe settings, you will need to [create an instance](#creating-an-instance) in order to trade live.

## Intelligence Algorithm Settings

Clicking the gear icon next to the Intelligence Algorithm’s name access its settings menu. Here you can make changes to the algorithm and see in real time its effects on your performance.

The Intelligence Algorithm is designed to accumulate cryptocurrency at opportune times, typically when the market is forming troughs and consolidating. By tuning the Intelligence factor, you are able to tune for specific buying behavior that fits the needs of your instance.

<figure><img src="/files/V19l1br56DJiMICbg37s" alt="" width="375"><figcaption></figcaption></figure>

**Intelligence Algorithm Settings**

**Inputs**

Repeat Purchase Method - The buying window allowed for the algorithm to execute orders. Note, this is not the same as changing timeframes.

Every Bar Parameters - Only applies when Repeat Purchase Method is set to “Every Bar”. Generally used when setting timeframe to intraday periods.

Start Time - The start time when the algorithm will be enabled to buy.

End Time - The end time when the algorithm will be enabled to buy.

Daily Parameters - Only applies when Repeat Purchase Method is set to “Daily”.

Time of Day - The time when the algorithm will buy if conditions for order execution are met.

Weekly Parameters - Only applies when Repeat Purchase Method is set to “Weekly”.

Time of Day - The time when the algorithm will buy if conditions for order execution are met.

Day of Week - The day when the algorithm will buy if conditions for order execution are met.

Monthly Parameters - Only applies when Repeat Purchase Method is set to “Monthly”.

Time of Day - The time when the algorithm will buy if conditions for order execution are met.

Day of Month - The day when the algorithm will buy if conditions for order execution are met.

Start Date - The start date of the algorithm’s backtest

End Date - The end date of the algorithm’s backtest. A far future date is recommended.

Number of Bars - The number of bars to load into the chart.

Exit Full Position on Last Historical Bar - If there are any open trades during the backtest, checking this box will close out those trades on the last closed bar which allows you to include open trades in performance calculations.

Activate Intelligence - When checked, the intelligence algorithm is active. The Intelligence factor (0 - 1+) adjusts the sensitivity of the Intelligence Algorithm. Higher numbers increases the frequency of buy orders, lower numbers decrease the frequency of buy orders.

Limit to Available Capital - For backtesting purpose, checking this box will limit the amount of available capital the algorithm can execute buy order from based on the initial capital + realized profits. This feature is useful in helping you determine how much capital you will need in your Gemini account to execute your desired parameters.

<mark style="background-color:orange;">IMPORTANT NOTES - Intelligence Algorithm Setup</mark>

<mark style="background-color:orange;">Exit Full Position on Las Historical Bar - When setting up an instance, DO NOT have this item checked.</mark>

<figure><img src="/files/1rzGF5kwKmsQe0eeKwOc" alt="" width="375"><figcaption></figcaption></figure>

**Properties**

Initial Capital - The dollar value of your starting capital (cash position).

Order Size - The value of each executed buy order.

Pyramiding - Maximum number of successive entries allowed.

Commission - Fees paid for each entry and exit. Fees vary by exchange and are typically based on     &#x20;\
&#x20;                        tiered fee schedules that are subject to change.

All other settings in the Properties are irrelevant to the Intelligence Algorithm.

<mark style="background-color:orange;">IMPORTANT NOTES - Intelligence Algorithm Setup</mark>

<mark style="background-color:orange;">Order Size - Unlike the Arbitrage Algorithm, you will need to set this parameter for the algorithm to buy the desired amount of cryptocurrency.</mark>

## Using Strategy Tester

TradingView’s Strategy Tester is a powerful performance analysis tool that adjusts realtime to changes made to your algorithm’s settings. This allows you to intelligently hone in on your preferred settings.

Upon changing settings for any algorithm, you will see the chart and Strategy Tester immediately update to reflect those changes.

<figure><img src="/files/EHWkPNt6GfbKMGLG3Rmq" alt=""><figcaption></figcaption></figure>

The four main tabs of Strategy Tester are:

* Overview
* Performance Summary
* List of Trades
* Properties

{% embed url="<https://youtu.be/7rZ2DZkelVo?feature=shared>" %}

## Creating an Instance

Once you’ve honed in on settings you like, you will need to direct The Bitcoin Algorithm to execute your trades automatically. To do that, you will create an instance. Instances allow you to stack multiple versions of Arch Public algorithms on your Gemini account, creating a comprehensive, sophisticated, and personalized cryptocurrency strategy designed to meet your goals.

First, go to the Webhooks section through your Arch Public Client Portal. You will find the TradingView Alerts section. For instances to successfully trigger orders on your Gemini account, you must have already completed the steps outlined in [Connecting To Gemini](https://www.notion.so/Connecting-To-Gemini-17cd0b3ffcd1805f9962f7a0848965a7?pvs=21).

<figure><img src="/files/C0Qp08xbTZyk6gAvtVsH" alt="" width="375"><figcaption></figcaption></figure>

On the right hand side of TradingView, click Alerts (clock icon) > Create Alerts.

<figure><img src="/files/fxIkC3UjNmcONKS8tqJc" alt="" width="375"><figcaption></figcaption></figure>

<figure><img src="/files/ac0j09DdVV2RP8EJKbDa" alt="" width="357"><figcaption></figcaption></figure>

To create an instance, first change the Condition to the algorithm you would like to set up for this instance. At the top of the window, check to make sure the timeframe is the correct one you want. If it is not, simply change it on the chart and click on alerts again.

Give the alert any name you wish.

<figure><img src="/files/P1sYfHMkpTRsfvNm1Htc" alt="" width="375"><figcaption></figcaption></figure>

In the TradingView message section, you will need to copy/paste the Webhook message generated in your Arch Public account.

<figure><img src="/files/iI8E2CqX6Wz6XK0bufbo" alt="" width="375"><figcaption></figcaption></figure>

<mark style="background-color:orange;">IMPORTANT NOTE - Instance Expiration</mark>

<mark style="background-color:orange;">The TradingView Essential membership limits the maximum lifespan of an alert to 60 days. This means that your instance will expire after 60 days and you will need to restart it. Upgrading to the TradingView Premium membership enables you to have open-ended alerts which means your instance will function in perpetuity.</mark>

<figure><img src="/files/qnozERrNVoDbDQ1v4ItM" alt="" width="375"><figcaption></figcaption></figure>

Now click the notifications tab. You will need to check Webhook URL and copy/paste the URL found in your Arch Public Account. All other checkboxes are optional.

<figure><img src="/files/QSDtX8LXsiZ0CBqwJIwF" alt="" width="375"><figcaption></figcaption></figure>

<figure><img src="/files/gssRfpWx8BlqQs9lsAoD" alt="" width="375"><figcaption></figcaption></figure>

<mark style="background-color:green;">Click Create and your instance will be live.</mark>

You will see your instance appear in the Alerts section on TradingView.

<figure><img src="/files/lDj73Wpxow5K7u9dblIR" alt="" width="306"><figcaption></figcaption></figure>

## Monitoring Your Algorithms

{% embed url="<https://youtu.be/kE8mz6RSQjY>" %}

## Verifying Successful Order Execution

When an instance executes an order you may receive an alert depend on the notification settings you checked during the instance setup above. To verify that your order successfully executed on your Gemini account, go to Portfolio and scroll down to find Transaction history. A successfully executed order will appear in your Transaction History.

<figure><img src="/files/JlluqeE5RJyriIoMhWEX" alt=""><figcaption></figcaption></figure>

<figure><img src="/files/0br2ZLef4GeuBmJaUgh5" alt=""><figcaption></figcaption></figure>

## Modifying an Instance

If you would like to cease order execution of any instance, simply find the instance in your TradingView Alerts tab and click Pause. You are also able to delete the instance from this section.

<figure><img src="/files/ksClsSivutMfOhgKwpMV" alt="" width="286"><figcaption></figcaption></figure>

Clicking the gear icon of an instance will allow you to edit the webhook and notification parameters of the instance.

<figure><img src="/files/7H78LfN3xXGM5HmnqwbT" alt="" width="375"><figcaption></figcaption></figure>

If you wish to change the trading parameters of the instance, for example, you would like to increase the dollar amount traded, you will need to delete the instance instead. After deletion, make changes to the algorithm’s trading settings and create a new instance.

## Keeping Your Instance Updated

When we release a new version of the algorithms, you will see a purple icon next to the aglorithm's name. Click the icon to update.

<figure><img src="/files/2zE2S75R9AkBw4B6DHj4" alt=""><figcaption></figcaption></figure>

You will need to update any live instances by creating a new instance using the updated algorithm with the same settings from the previous instance.


---
