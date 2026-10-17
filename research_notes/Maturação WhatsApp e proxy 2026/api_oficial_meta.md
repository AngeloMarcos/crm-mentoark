# API oficial Meta (WhatsApp Business Platform / Cloud API) para CRM brasileiro — 2026

Research date: 2026-10-17. Meta's official BRL rate-card CSV links could not be read through the fetch tool. The Brazil rate figures below come from Brazilian BSP blogs that say they are copying the official BRL card. Four independent sources give the same values, but treat them as secondary until someone checks the Meta CSV in the dashboard.

## 1. Preços no Brasil em 2026 (modelo por mensagem, tarifas, janelas grátis, tiers)

### Takeaway
Since 1 July 2025 Meta charges per delivered template message, not per conversation. In Brazil (BRL card in force since 1 July 2026), marketing costs about R$ 0,3217 per message and utility and authentication cost about R$ 0,035, with volume discounts. **Big change on 1 October 2026:** service messages (free text replies inside the 24h window) and utility templates inside the window are now charged at the utility rate. Each number gets 1,000 free service messages per month, according to BSPs.

### Cited Findings
- **Per-message model since 1 July 2025.** Meta charges only for delivered templates, priced by category (marketing, utility, authentication) and the recipient's country code. The marketing conversation rate became a marketing message rate. — [Meta Pricing docs](https://developers.facebook.com/docs/whatsapp/pricing)
- **Utility and authentication volume tiers since 1 July 2025.** They aggregate across all WABAs in a business portfolio, per market and category pair, and reset monthly. Free messages do not count toward tiers. The `VOLUME_BASED_PRICING_TIER_UPDATE` webhook has existed since 1 October 2025. — [Meta Pricing docs](https://developers.facebook.com/docs/whatsapp/pricing)
- **Free entry point.** A reply within 24h to a user who arrived from a Click-to-WhatsApp ad or a Facebook Page CTA opens a 72h window in which everything is free, templates included. — [Meta Pricing docs](https://developers.facebook.com/docs/whatsapp/pricing)
- **BRL billing (2026).** Since 1 July 2026, partners and direct clients with sold-to country Brazil can create BRL WABAs, invoiced in reais by Facebook Brasil. They must migrate every WABA to BRL by 30 June 2027. From 1 July 2027 Meta stops delivering messages from non-BRL WABAs for these customers. A Currency Migration API has been available since 1 June 2026. — [Meta Pricing docs](https://developers.facebook.com/docs/whatsapp/pricing)
- **Pricing calendar.** Changes happen only on 1 January, 1 April, 1 July and 1 October. Meta gives 1 month of notice for rate changes and 6 months for model changes. Brazil was not among the markets changing on 1 October 2026. — [Meta Pricing docs](https://developers.facebook.com/docs/whatsapp/pricing); [360dialog](https://360dialog.com/blog/whatsapp-service-message-charging-october-2026/)
- **Brazil BRL rate card (in force since 1 July 2026):** — [Wizebot, citing Meta's official BRL card](https://wizebot.com.br/custo-por-mensagens); figures confirmed by [Wizebot blog](https://wizebot.com.br/blog/tabela-precos-whatsapp-business-api-2026) and [ClickMassa](https://clickmassa.com.br/whatsapp-api-em-reais/)
  - Marketing: **R$ 0,3217** per message (about US$ 0,0625), with **no volume discount**
  - Utility: **R$ 0,0350** (about US$ 0,0068)
  - Authentication: **R$ 0,0350** (about US$ 0,0068)
  - Service: free until 30 September 2026
  - Utility tiers per month: 0–250k R$0,0350; 250k–2M R$0,0333 (−5%); 2M–17M R$0,0315; 17M–35M R$0,0298; 35M–70M R$0,0280; 70M+ R$0,0263 (−25%)
  - Authentication tiers: 0–500k R$0,0350; 500k–3M R$0,0333; 3M–5,25M R$0,0315; 5,25M–10M R$0,0298; 10M–20M R$0,0280; 20M+ R$0,0263
- **USD marketing rate for Brazil of US$ 0,0625** appears in several sources. — [MessageCentral](https://www.messagecentral.com/blog/whatsapp-business-api-pricing-brazil); [Yavendio](https://yavendio.com/br/blog/preco-api-whatsapp-brasil). Older or conflicting figures: R$0,39 marketing and R$0,08 utility at [Hyperleap](https://hyperleap.ai/whatsapp-pricing-calculator-brazil), which has internal inconsistencies, and "utility $0.008 / auth $0.0315" in old guides. Treat these as obsolete.
- **Service messages charged from 1 October 2026 (official).** "Effective October 1, 2026, Meta will charge on a per-message basis for service messages." The rate equals the market's utility and authentication rate. There are no volume tiers. The 72h free entry point window stays free. Utility templates inside the 24h window, free since July 2025, are also charged from 1 October 2026. — [Meta: non-template messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages)
- **1,000 free service messages per month per number.** Charging starts at the 1,001st, does not roll over, and counts per number, not per WABA. Brazil's service rate is **US$ 0,0068**. Without a payment method by 30 September 2026, Meta stops delivering service messages. — [360dialog](https://360dialog.com/blog/whatsapp-service-message-charging-october-2026/) (citing a non-public Meta partner communication); also [Zenvia](https://zenvia.com/novas-regras-cobranca-whatsapp-2026/) and Twilio, via [search summary](https://help.twilio.com/articles/53100480177819). **Conflict:** Meta's public page does not mention the 1,000 free messages.
- **Meta Business Agent (Meta's own AI)** is charged per token from 1 August 2026, at US$ 2,00 per 1M tokens (about 4–5 cents per message). — [Meta: non-template messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages)
- **Pricing policy for "AI Providers"** in force since 16 February 2026 and updated 12 May 2026. The terms were not available in the fetched content. — [Meta Pricing docs](https://developers.facebook.com/docs/whatsapp/pricing)
- **Max price for marketing via the MM API (2026).** Businesses using the Marketing Messages API can set a maximum price per marketing delivery, and Meta charges at most that amount. — [Meta Pricing docs](https://developers.facebook.com/docs/whatsapp/pricing)

### Inferences
- For a CRM whose AI agent answers leads, the 1 October 2026 change matters a lot. Every reply after 1,000 per number per month now costs about R$ 0,035 on the official API. The AI-agent cost model for the official API must count the replies, not only the templates.
- In Brazil, marketing costs about 9× utility. Moving reminders and confirmations to correctly categorized utility templates is the biggest saving.
- Click-to-WhatsApp ads plus the 72h window remain the only way to send marketing without per-message cost. That is cheap prospecting, but it requires ad spend.

### Gaps
- I could not open the official BRL CSV directly (no link in the static page). Values should be checked in the Meta dashboard or Billing Hub.
- The exact terms of the AI Providers pricing policy (16 February 2026) are unknown. It may affect the CRM's AI agent.
- The 1,000 free service messages per number are confirmed only by BSPs, not by Meta's public page.

## 2. Messaging limits and tiers (2025–2026)

### Takeaway
Since **7 October 2025** the limit applies to the **business portfolio**, not the number. Every number in the portfolio shares one limit. The steps are 250 → 2K → 10K → 100K → unlimited, measured as unique users contacted outside the 24h window in a rolling 24h period. Moving up to the next tier is evaluated every 6h.

### Cited Findings
- "Messaging limits are calculated and set at the business portfolio level." One number can use up the whole portfolio allowance. New portfolios start at **250**. To reach **2,000**, a portfolio needs one of three things: business verification, verification by the onboarding partner, or 2,000 delivered messages outside the window to unique users in 30 days using high-quality templates. After that, scaling to 10K, 100K and unlimited is automatic when quality is high and at least 50% of the limit was used in the last 7 days. The limit rises "within 6 hours". — [Meta Messaging limits](https://developers.facebook.com/docs/whatsapp/messaging-limits)
- The limit counts **unique users** messaged outside a customer service window, in a rolling 24h period. — [Meta Messaging limits](https://developers.facebook.com/docs/whatsapp/messaging-limits)
- The portfolio-level change dates from **7 October 2025**. Existing portfolios inherited the highest limit among their numbers, and new numbers share the portfolio limit immediately. — [Meta upcoming messaging limits changes](https://developers.facebook.com/documentation/business-messaging/whatsapp/upcoming-messaging-limits-changes/); [Green API](https://green-api.com/en/blog/2025/wa-buisness-change-its-messaging-limits/); [8x8](https://cpaas.8x8.com/en/blog/important-update-whatsapp-messaging-limits-changing-october-7-2025/)
- The first automatic level went from 1K to 2K, tier checks went from every 24h to every 6h, and the "Flagged" status was removed, so a quality drop no longer lowers the limit automatically. — [Green API](https://green-api.com/en/blog/2025/wa-buisness-change-its-messaging-limits/) (secondary)
- API: `messaging_limit_tier` is deprecated in favor of `whatsapp_business_manager_messaging_limit`. In webhooks, `max_daily_conversations_per_business` is used in v24.0+ (the per-phone field was kept for ≤v23 until February 2026). — [Meta Messaging limits](https://developers.facebook.com/docs/whatsapp/messaging-limits)
- When a request is denied, the `account_alerts` webhook explains the next steps. — [Meta Messaging limits](https://developers.facebook.com/docs/whatsapp/messaging-limits)

### Inferences
- The CRM already supports several numbers. Under the official API, adding numbers to the same portfolio does **not** add send capacity, which is the opposite of the Evolution model where each number has its own "quota". Scaling comes from verification and quality, not from more chips.
- Verifying the business (Business Verification) is the shortcut from 250 to 2K on day one.

### Gaps
- Meta's official text does not confirm that losing quality still lowers the tier after the 2025 change. Only a secondary source says "Flagged" was removed.

## 3. Marketing Messages API for WhatsApp (formerly MM Lite)

### Takeaway
This is a separate endpoint (`/marketing_messages`) for marketing templates, with Meta delivery optimization, benchmarks, GIFs, TTL and, since 2026, a per-message max price. It reached GA on **19 November 2025**. The billing model is the same as the Cloud API, and the same numbers and templates can be reused.

### Cited Findings
- The MM API sends marketing through `/marketing_messages` with automatic delivery optimization toward people likely to engage. In a Meta test of about 12M messages in India (January 2025), it got more reads and clicks than standard Cloud API delivery. It adds benchmarks against similar businesses, recommendations, automatic creative optimizations (in testing), GIFs and time-to-live. It uses a schema and billing similar to the Cloud API and reuses numbers and templates. — [Meta MM API docs](https://developers.facebook.com/docs/whatsapp/marketing-messages-api-for-whatsapp)
- General availability on 19 November 2025. Multi-solution conversation support was added on 29 January 2026. — [Meta changelog](https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog) (via search summary)
- A max price per marketing delivery is available in 2026. — [Meta Pricing docs](https://developers.facebook.com/docs/whatsapp/pricing)

### Inferences
- The CRM already has an MM API flag, so for Brazilian marketing it should be the default path. The max price helps cap per-message cost, possibly below R$ 0,32, at the expense of delivery reach.

### Gaps
- I found no official confirmation of Brazil's eligibility for the max price or for the MM API (it seems global, but this was not verified). There is also no confirmation of whether Meta will deprecate marketing sends through `/messages` on the Cloud API.

## 4. Coexistence (WhatsApp Business App + Cloud API on the same number)

### Takeaway
This is available through Embedded Signup from a Tech Provider or Solution Partner, and Brazil appears among supported markets. Up to 180 days of 1:1 history and contacts sync, and messages are mirrored between the app and the API. Groups do not sync. Some app features are disabled, and throughput is capped at 20 mps.

### Cited Findings
- Messages are mirrored between the API and the app. Up to 180 days of 1:1 history sync, contacts sync both ways, and groups are not supported. Media older than 14 days may arrive without a usable asset ID. Disappearing messages, view-once and live location are disabled, and broadcast lists become read-only. The number is capped at 20 mps combined across app and API. It requires app version ≥2.24.17, onboarding through a Tech Provider or Solution Partner, and completing the sync within 24h. — [Instant Reply](https://www.instantreply.co/blog/whatsapp-coexistence-what-actually-syncs-2026) (secondary, citing Meta's docs at developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/)
- Brazil appears on lists of markets with coexistence, but Meta does not publish a fixed list. — [search summary: whautomate](https://whautomate.com/whatsapp-coexistence), [YCloud](https://www.ycloud.com/blog/whatsapp-business-app-coexistence-meta-update)
- **Embedded Signup v2 was deprecated on 15 October 2026.** Integrations must use v4. — [Instant Reply](https://www.instantreply.co/blog/whatsapp-coexistence-what-actually-syncs-2026) (quoting Meta)

### Inferences
- **Action for the CRM:** check whether the embedded signup that is pending uses v4. If it was built on v2, it is already obsolete (the deadline was two days before this research date).
- Coexistence keeps the salesperson's phone app working while the CRM receives events. It is a natural migration path for small customers who already use the WhatsApp Business app.

### Gaps
- Meta's official coexistence page was not read directly. The 20 mps cap, the 24h sync window and Brazil's eligibility come from secondary sources.
- Whether messages typed in the app are billed under coexistence after 1 October 2026 was not confirmed.

## 5. Requirements, opt-in, templates, cold outreach and quality

### Takeaway
The official policy requires the user to have given their number **and** opted in, and forbids "surprising" messages or spam. Outreach to cold leads, such as bought lists or scraping, breaks the policy. Penalties run from send limits up to a permanent ban of the company and its organization.

### Cited Findings
- "You may only contact people on WhatsApp if: (a) they have given you their mobile phone number or username" and they gave permission to receive messages. The business is responsible for the opt-in method, and best practice is a separate opt-in per message category. — [WhatsApp Business Messaging Policy](https://whatsappbusiness.com/pt-br/policy/)
- "não confunda, surpreenda, engane, defraude ou envie spam" ("do not confuse, surprise, deceive, defraud or spam"). Outside the 24h window, only approved templates may be sent. — [Policy](https://whatsappbusiness.com/pt-br/policy/)
- Users can block or report a business. Meta may limit sends based on user feedback, "restringir ou remover seu acesso" ("restrict or remove your access"), and for serious violations "proibir você e sua organização de utilizar qualquer produto e serviço do WhatsApp no futuro" ("ban you and your organization from using any WhatsApp product or service in the future"). — [Policy](https://whatsappbusiness.com/pt-br/policy/)
- The business is responsible for the category assigned to each template and accepts the charge for the category applied at the time of use. — [Meta Pricing docs](https://developers.facebook.com/docs/whatsapp/pricing)
- Customer business verification is needed for higher limits and for Official Business Account status. — [Meta Tech Provider docs](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers) (via search summary)

### Inferences
- The official API **is not a prospecting channel for cold leads**. The compliant way to "prospect" there is Click-to-WhatsApp ads (the user starts the chat, and it is free for 72h) or forms with explicit opt-in. Prospecting cold lists should stay out of the official API, because blocks and reports from those contacts damage the portfolio's quality and the limits of every number in it.
- The policy explicitly allows a lifetime ban of the organization. For a CRM with many customers under one Tech Provider, that risk falls on each customer's portfolio. Each customer's own WABA isolates the damage.

### Gaps
- Official typical times for template approval and display name approval were not found in this session. Meta's docs say templates are reviewed automatically, often within minutes and up to 24h, but this was not verified for 2026.
- The page does not mention purchased lists explicitly. The prohibition comes from the opt-in requirement.

## 6. Usernames and BSUID (business-scoped user IDs)

### Takeaway
In 2026 Meta introduced WhatsApp usernames and the BSUID (`user_id` in webhooks). For users who adopt a username and have no prior history with the business, webhooks may arrive **without `wa_id`/`from` (the phone number)**. A CRM keyed on phone number breaks.

### Cited Findings
- The BSUID is a stable user identifier per business (or portfolio), sent in the `user_id` field of webhooks, and it can be used as a recipient when the phone number is unknown. `user_id` began appearing in webhooks around 31 March to early April 2026. `wa_id`/`from` may be missing for users with a username and no prior interaction. — [Medium: BSUID live](https://medium.com/@matthias_20536/meta-bsuid-is-live-in-whatsapp-cloud-api-what-to-change-in-your-webhooks-and-crm-9b6dc69058dd); [360dialog docs](https://docs.360dialog.com/docs/resources/phone-numbers/usernames-and-bsuid)
- Twilio describes the BSUID field as required starting June 2026. — [Twilio changelog](https://www.twilio.com/en-us/changelog/whatsapp-usernames--new-business-scoped-user-id--bsuid--field-re)
- Rollout timing conflicts. Chatwoot cites test countries in June 2026 and global rollout from August 2026; other sources say it rolls out country by country. Business usernames can be reserved from 29 June 2026, and sending by BSUID has been possible since early July 2026. — [Chatwoot issue #13837](https://github.com/chatwoot/chatwoot/issues/13837); [Instant Reply](https://www.instantreply.co/blog/whatsapp-usernames-business-scoped-user-ids-2026) (secondary)

### Inferences
- The CRM's integration should store `bsuid` in addition to the phone number, use BSUID as an alternative key for deduplicating contacts, and accept webhooks without `from`. This does not affect Evolution/Baileys, which uses JID/LID, but the CRM's `contatos` table needs to hold both keys.

### Gaps
- Meta's official BSUID documentation was not read directly. When Brazil adopts usernames is unknown.

## 7. Practical example: 1,000 marketing messages per month (Brazil)

### Takeaway
On the official API: 1,000 × R$ 0,3217 ≈ **R$ 321,70 per month** (about US$ 62,50) paid to Meta, plus a BSP fee if one is used. Going direct as a Tech Provider adds no fee. With Evolution/Baileys there is no per-message cost, but there is the cost of chips, proxies and infrastructure, plus ban risk.

### Cited Findings
- Marketing rate: R$ 0,3217 per message, with no volume discount. — [Wizebot](https://wizebot.com.br/custo-por-mensagens)
- Replies to those leads: from 1 October 2026, the first 1,000 service messages per number per month are free, then about R$ 0,035 each (US$ 0,0068). — [360dialog](https://360dialog.com/blog/whatsapp-service-message-charging-october-2026/); [Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/non-template-messages)
- Brazilian BSPs typically add 10–35% on top of Meta's rate. — [search summary, secondary sources](https://hyperleap.ai/whatsapp-pricing-calculator-brazil)
- 360dialog charges no markup on Meta's rate and bills only a monthly fee per number (€49 Regular / €99 Premium / €249 High Throughput, per third-party guides). — [360dialog docs](https://docs.360dialog.com/docs/360dialog/prices-plans-and-payment-options); [EzContact](https://ezcontact.ai/en/blog/2026-07-04-360dialog-pricing-2026-real-monthly-costs-api-fees)

### Inferences
- Example scenario: 1,000 marketing messages plus 1,500 replies in the month = R$ 321,70 + 500 × R$ 0,035 (R$ 17,50) ≈ **R$ 339/month** direct to Meta. Through 360dialog, add about €49 (≈R$ 300). Through a BSP with a 20% markup, about R$ 407.
- Equivalent utility messages (reminders) would cost about R$ 35 per 1,000, so the official API is very competitive for utility and reactive service. For mass marketing, the cost per message is significant.
- Compared with Evolution: the per-message cost is zero, but the history of number bans (the cause investigated in the CRM: the same number in 2+ instances) and the maturation and proxy costs need to be priced in. This research did not find public data on the cost of an unofficial setup.

### Gaps
- No reliable published figure exists for the "cost of a ban" or the per-chip cost of the unofficial route. It must be estimated from the CRM's internal data.

## 8. Popular BSPs in Brazil vs direct Cloud API, and Tech Provider requirements

### Takeaway
The CRM already integrates the Cloud API directly. Becoming a Tech Provider requires business verification, App Review with videos, and advanced access to `whatsapp_business_management`, with Embedded Signup v4. BSPs (Zenvia, Blip, Gupshup, Twilio, 360dialog) mostly charge markup or fees. Only 360dialog publishes per-number pricing without markup.

### Cited Findings
- Becoming a Tech Provider: verify the business with Meta, then App Review (icon, privacy policy, category, plus two videos: one sending a message from the app and receiving it in WhatsApp, and one creating a template through the app). The `whatsapp_business_management` permission needs advanced access approved before it appears in Embedded Signup. After the flow, the code is exchanged server-side for the customer's token, then the number is registered and webhooks are subscribed. Sharing a credit line is only for Solution Partners. — [Meta: Become a Tech Provider](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers) (via search summary)
- Embedded Signup v2 was deprecated on 15 October 2026, so v4 must be used. — [Instant Reply](https://www.instantreply.co/blog/whatsapp-coexistence-what-actually-syncs-2026)
- Zenvia: from October 2026, service messages and utility templates inside the window are charged, and the first 1,000 service messages per month are free. — [Zenvia](https://zenvia.com/novas-regras-cobranca-whatsapp-2026/)
- 360dialog: per-number licence fee with Meta's rate passed through without markup. One tracker reports price changes in 2026 (a Marketplace plan at €99, the top tier going from €249 to €500 in September 2026, unconfirmed). — [360dialog docs](https://docs.360dialog.com/docs/360dialog/prices-plans-and-payment-options); [PricingSaaS](https://pricingsaas.com/companies/360dialog/diffs/2026Q2)

### Inferences
- As a Tech Provider, the CRM pays Meta directly (each customer's WABA has its own payment method), with no markup. BSPs only make sense for credit lines or invoicing (Solution Partner) or for enterprise support. Since July 2026, BRL billing through Facebook Brasil removes the old advantage of a local BSP over exchange rates and Brazilian invoices.

### Gaps
- Public 2026 price lists for Blip, Zenvia, Gupshup and Twilio in Brazil were not found. These are generally negotiated.
- Current Tech Provider App Review wait times were not found.
