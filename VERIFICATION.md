# Verification log (2026-10-20)

**Method.** Research agents read official documentation and produced the guides. I then re-fetched the source pages behind a sample of the highest-stakes claims and compared them with what each guide says. I also tested the code. I did not register any provider app or attempt any approval, so nothing here is hands-on tested against a provider.

## 1. Claims checked against the source page: confirmed

| Guide | Claim | Source |
|---|---|---|
| Slack | New non-Marketplace commercial apps (created on/after 2025-05-29) and new installs of older unlisted apps: 1 request/min and `limit` max 15 on `conversations.history`/`.replies`; Marketplace, existing installs and internal customer-built apps exempt | docs.slack.dev changelog 2025-05-29 |
| Google | Testing status: 100 test users, authorizations expire after 7 days (except openid/email/profile only) | support.google.com/cloud/answer/15549945 |
| Google | Restricted-scope verification "can potentially take several weeks"; CASA needed when restricted data is stored/transmitted via servers; reassessment at least every 12 months | developers.google.com restricted-scope-verification |
| GitHub | 100 OAuth apps per owner; up to 10 callback URLs; "Expire user access tokens" default on | docs.github.com creating-an-oauth-app |
| LinkedIn | Community Management API only for registered legal organizations; personal email fails vetting; rejected app can't reapply (new app needed); Page super admin must verify the app; no review time stated | learn.microsoft.com community-management-app-review |
| LinkedIn | Access tokens 60 days; 365-day refresh tokens only for approved Marketing Developer Platform partners | learn.microsoft.com programmatic-refresh-tokens |
| Notion | Installation scope ("Any workspace" / "Selected workspaces") can't be changed after creation; refreshing returns a new access and refresh token | developers.notion.com authorization |
| Notion | Marketplace listing: expect a reply within 5-10 business days | developers.notion.com marketplace-listing |
| Shopify | New public apps must use expiring offline access tokens; callback must check `state`, `hmac` and the shop domain; token exchange POST to `{shop}/admin/oauth/access_token` | shopify.dev authorization-code-grant |
| X | Pay-per-usage with prepaid credits (post read $0.005, user read $0.010, post create $0.015, post with URL $0.200); 3M post-reads/month cap on that plan | docs.x.com pricing, seen 2026-10-20 |
| HubSpot | Initial listing review within 10 business days; feedback loop no more than 60 days; listing needs at least 3 active unique installs | developers.hubspot.com listing requirements |
| Salesforce | "Creating connected apps is restricted as of Spring '26"; External Client Apps recommended instead | developer.salesforce.com OAuth and connected apps |
| Composio | Managed OAuth means Composio supplies the OAuth app; custom auth config needed for your own branding, custom scopes, dedicated rate limits, faster polling, private instances. Managed available for GitHub, Slack, Gmail, LinkedIn, Notion, HubSpot, Zoom, Salesforce; **not** for X and Shopify | docs.composio.dev managed-auth, custom-app-vs-managed-app, each toolkit page |

## 1b. Live-generated guide checked by hand: Typeform (2026-10-21)

Checked the guide against the applications page the agent read.
- **Confirmed:** app registration path (Developer Apps, Register a new app), client secret shown once (and can be regenerated), authorize and token URLs, 1-week access-token expiry, `offline` scope for a refresh token, refresh invalidating the old token, HTTPS redirect with a valid certificate.
- **Not found on that page:** "2 requests per second" rate limit (labelled doc-stated, but the two rate-limit pages were unreadable) and "standard accounts support API access".
- **Review claim:** the guide said "no platform review: none stated". The review page the agent tried (`.../integration-partner-program/app-review`) returned "page not found" when opened by hand, so the model had guessed the URL. "No review" was therefore an absence of evidence, not a confirmed fact.
- **Code change made because of this:** if a guide says no approval is required but none of the pages actually read are about review, the guide now adds an uncertainty note saying so.
- The same run showed the earlier fix working: raw field names in "uncertain" are now readable sentences.

## 2. Corrected

1. **Google user caps** were merged by the agent. Correct: 100 *test users* in Testing, and a separate lifetime cap of 100 *new users* while the app is unverified, which can't be reset.
2. **Google letter name:** Google uses both "Letter of Validation" and "Letter of Assessment (LOA)". Guide notes both.
3. **X difficulty:** agent rated it easy because no review is documented. I raised it to *moderate*: the account must be funded with prepaid credits before any API call works.
4. **HubSpot install counts** were flagged as a "conflict". They are two stages: 3 installs to list (confirmed), 60 to certify (2024 changelog, not re-checked).

## 3. Bugs found by testing the product (and fixed)

1. **The web page was served as a JSON dump of bytes**, so it never rendered. My first check only looked at the status code (200) and missed it; a real browser test caught it. Fixed, and `npm test` now asserts the home page is real HTML.
2. **Phone layout scrolled sideways** because of long source URLs. Fixed; all 11 pages checked at 375px wide.
3. My own strict validator wrongly rejected three honest "not tested" statements because it only read the first sentence. Fixed.

## 4. Could not verify (also listed inside each guide's "uncertain")

- Time for GitHub org-owner approval, Slack workspace-admin approval, GitHub Marketplace review: no official figure found.
- CASA cost and assessor turnaround: not published on pages read.
- GitHub "Expire user access tokens": registration page says default on; authorization page describes expiring tokens as opt-in. Not reconciled.
- LinkedIn app-verification flow and "Company Page required for every app": official help page not fetchable; partly a secondary source.
- Zoom review time: only a 2022 forum post ("around 4-12 weeks"), marked weak.
- Salesforce AppExchange review fee ($999) comes from an older page; may have changed. Several Salesforce approval-error causes come from a vendor blog, flagged weak.
- Shopify: whether a Partner account is required and its cost were not stated on pages read.

## 5. What was and was not tested in the code

- **Tested:** `npm test` runs the whole live flow against a fake Gemini: progress streaming, JSON extraction from code fences, unsafe link removal, bad labels replaced, honesty text overwritten, caching, aliases. Also tested in a real browser (Chromium): home page, 102-entry directory, opening guides, live lookup of an unknown app, Copy as Markdown, phone width, no JavaScript errors.
- **Tested with a real free Gemini key (by the project owner, 2026-10-21):** plain requests work on `gemini-3.5-flash-lite`, `3.1-flash-lite`, `3.6-flash` and `3.8-flash`; the URL-reading tool works; Google's Search tool returns "quota exceeded" on the free tier; `gemini-2.5-flash` is "no longer available to new users". The agent was redesigned around these facts.
- **Live run with a real key (2026-10-21, Calendly):** completed end to end. 4 pages were read (Composio page, Calendly OAuth-app page, API reference, help centre). The model also guessed 3 doc URLs that do not exist; Google could not read them and the guide listed them as unread rather than citing them. Found and fixed: the "uncertain" list showed raw field names (`time_to_production`); `cleanGuide` now rewrites them as sentences.
- **Not yet tested:** the DuckDuckGo search step from a real server (it may be blocked; the agent then falls back to Composio's page and model-suggested URLs). First thing to do: generate two or three unfamiliar apps, open their source links, and add your own results to section 1 above.
- No provider consoles were used; UI labels may differ from the docs.
