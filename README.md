# OAuth Setup Guides

**The problem.** A developer building an AI agent wants their users to connect an app (Slack, Gmail, Shopify…). First they may need to create their own **OAuth app** with that provider and get it approved. Today that means piecing together docs and discovering blockers late: an hour of work for GitHub, a yearly security audit for Gmail.

**What this does.** Look up an app and get a shareable guide that answers five questions: *how hard is it, how long will it take, what could block me, what do I do next, and what can an agent do for me versus what must I do myself?* Every claim carries an evidence label, and every guide says plainly what was **not** tested.

- **10 researched guides** chosen because their setup paths differ: GitHub, Notion (easy) · Slack, HubSpot, Salesforce, Shopify, X (moderate) · Zoom, Gmail (hard) · LinkedIn (partner-gated).
- **Directory of 102 apps** taken from [Composio's toolkit list](https://docs.composio.dev/toolkits/managed-auth). Click one without a guide and an agent investigates it live.
- **Live generation** for any app name or website, including ones outside the directory.
- Each guide says whether **Composio can manage the OAuth app** for you to start (so you can skip registering), and when you must register your own anyway.

## Run it

```bash
npm start                  # http://localhost:3000. Node 18+, zero dependencies, nothing to install.
npm test                   # end-to-end test of live generation using a fake Gemini. No key needed.
```

Live generation needs one free key: get it at <https://aistudio.google.com/apikey> (no card), then set it as an environment variable (on Replit: *Secrets*):

```bash
export GEMINI_API_KEY=your-key     # never commit this
```

Without a key the library and directory still work; only live generation shows a message asking for the key.

**Deploy on Replit:** create a Repl, upload these files, add `GEMINI_API_KEY` under Secrets, press Run, then Deploy. `.replit` is included.

## How it works (5 lines)

1. `server.js` serves the page and the guides, and runs live generation.
2. `agent.js` finds likely official doc pages (Composio's page for the app, a keyless web search, and URLs the model suggests), then Gemini (free tier) reads those pages and answers as JSON in the guide format. Google's built-in Search tool is **not** used: our test (`node check-key.mjs`) showed it is blocked on the free tier, while page reading works.
3. `lib/guide.js` checks that JSON: it rejects guides missing essentials, fixes harmless gaps, and removes unsafe links.
4. Our code (not the model) stamps the "not tested" statement and attaches the pages the agent actually read.
5. `public/index.html` renders the guide, with evidence labels, sources, and a copy-link / copy-Markdown button.

Library guides were researched by agents using the **same prompt and format** as live generation, then checked by `scripts/ingest-drafts.mjs` before being added. Raw research for the first four is kept in `research/raw/`.

## Key decisions

1. **Organized around the developer's questions**, not the provider's docs order.
2. **Evidence labels** (`doc-stated` / `inferred` / `unverified`) because providers rarely publish approval times. We write "no official figure" instead of guessing.
3. **Honesty enforced in code.** The model cannot claim it tested anything; our code sets that text.
4. **Self-serve path vs production path** are kept separate. Most surprises live in that gap (e.g. Google's Testing mode, Slack's Marketplace-only rate limits).
5. **Simple on purpose:** no framework, no database, no build step, one model provider, so every line can be read and explained.

## Limitations (read these)

- **Live generation is only partly verified against the real Gemini API.** Verified with a real free key: plain requests and the page-reading tool work on the current models, and the Google Search tool is blocked on the free tier (so it is not used). The full flow is tested end to end against a fake Gemini and fake search page (`npm test`) and in a real browser. The web-search step (DuckDuckGo) may be blocked from some servers; the agent then relies on the model's suggested pages and Composio's page, and the guide says how many pages it could actually read. `node check-key.mjs` tells you what your own key can do.
- **No provider app was created and no approval was attempted.** Guides come from official documentation, spot-checked in `VERIFICATION.md`. Provider consoles need a logged-in human.
- Live guides come from a free-tier model: unreviewed, and its source links must be opened and confirmed.
- 10 researched guides, not 100. The directory lists 102 apps; the other 92 are generated on demand.
- Docs change. Each researched guide shows its research date (2026-10-20).
- Free tier is rate limited; the server also allows 20 live generations per hour (`GEN_PER_HOUR`).
- No accounts, database or persistence beyond JSON files.

## Files

| File | Job |
|---|---|
| `server.js` | web server + API + live generation endpoint |
| `agent.js` | the research agent (prompt + Gemini call) |
| `lib/guide.js` | validates and cleans every guide |
| `public/index.html` | the whole UI |
| `guides/*.json` | the 10 researched guides |
| `data/composio-toolkits.json` | the 102-app directory |
| `scripts/ingest-drafts.mjs` | adds agent-researched drafts to the library after checks |
| `test/smoke.mjs` | end-to-end test with a fake Gemini and fake search (`npm test`) |
| `check-key.mjs` | `node check-key.mjs`: tells you what your Gemini key can and cannot do |
| `VERIFICATION.md` | what was checked, corrected, and left unverified |
