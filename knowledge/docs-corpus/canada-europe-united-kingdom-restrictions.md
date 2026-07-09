> For the complete documentation index, see [llms.txt](https://docs.archpublic.com/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.archpublic.com/crypto/canada-europe-united-kingdom-restrictions.md).

# Canada, Europe, United Kingdom Restrictions

The restrictive regulatory environment in Canada, Europe, and the United Kingdom make it difficult for Arch Public clients to use our algorithms through Gemini.

See [Gemini's support page](https://support.gemini.com/hc/en-us/articles/33437494572443-Non-MiCA-Compliant-Stablecoins) for further details.\
\
Clients in these locations may use the built-in webhook functionality on exchanges like Binance in place of Gemini to trade cryptocurrency pairs denominated in USD, GUSD, and USDT.

<mark style="background-color:orange;">Note: we cannot provide support for clients using exchanges other than Gemini as we have no visibility into instance execution.</mark> <br>

In order to use Binance in place of Gemini, you **will not** add your Binance API key in the Arch Public client portal. \
\
Instead, follow the steps below when setting up an instance as outlined in [Arch Public Algorithm Setup Guide (Start Here)](/crypto/arch-public-algorithm-setup-guide-start-here.md).\ <br>

Under the **\[Settings]** tab, name your alert and enter the message from your Binance webhook setup.

<figure><img src="https://public.bnbstatic.com/image/cms/article/body/202409/e9f5bdd7141cdc5ca3af716dbac11231.png" alt=""><figcaption></figcaption></figure>

Please make sure the message matches the one in the Binance webhook.

<figure><img src="https://public.bnbstatic.com/image/cms/article/body/202409/fdf32dec4a85d57489d4417fec55acbf.png" alt="" width="375"><figcaption></figcaption></figure>

<figure><img src="https://public.bnbstatic.com/image/cms/article/body/202409/d34088619589edfaa437ed7ced80fc5d.png" alt="" width="375"><figcaption></figcaption></figure>

Example Message Format: {"symbol":"{{ticker}}","side":"buy","qty":"1","price":"{{close}}","trigger\_time":"{{timenow}}","signal\_id":"175cbc02-79eb-44ef-ac67-d0d818c6f928","UID":"xxxxx"}

Under the **\[Notifications]** tab, paste the Alert webhook URL you got from Binance. Click **\[Save]**.

<figure><img src="https://public.bnbstatic.com/image/cms/article/body/202309/11083a9bc98d0f5fea82d6225d17bc4c.png" alt="" width="375"><figcaption></figcaption></figure>

Click **\[Run Webhook]** to confirm.

<figure><img src="https://public.bnbstatic.com/image/cms/article/body/202409/fdf32dec4a85d57489d4417fec55acbf.png" alt="" width="375"><figcaption></figcaption></figure>

You’ll see all alerts under the **\[Alerts]** panel on the right of the TradingView interface. You can hover over an alert to view its details.

<figure><img src="https://public.bnbstatic.com/image/cms/article/body/202309/5b1d78a8f9b897804484585ed9a123cb.png" alt="" width="563"><figcaption></figcaption></figure>

You may stop, edit, or remove alerts as needed.

<figure><img src="https://public.bnbstatic.com/image/cms/article/body/202309/04bf6ea78dbe5ccd48db938e6e87d2e5.png" alt="" width="375"><figcaption></figcaption></figure>


---
