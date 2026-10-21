// agent.js: the live guide-generation agent.
//
// Why it works this way: Google's FREE Gemini tier lets the model read web pages (the "URL context" tool)
// but blocks its built-in Google Search tool (we tested this with check-key.mjs). So our code does the searching.
//
// Steps (each is a small function below):
//   1. findCandidatePages: collect likely official doc pages from three places:
//        a. Composio's toolkit page for the app,
//        b. a free keyless web search (DuckDuckGo),
//        c. URLs the model itself suggests (it knows most developer-docs sites).
//   2. readAndWrite: give those URLs to Gemini; it reads them and writes the guide as JSON in the format in SYSTEM.
//   3. Google reports which pages it really read; we attach those as sources and list the ones it could not read.
//   4. lib/guide.js checks/cleans the JSON, and OUR code stamps the "not tested" statement.
//   5. `emit` streams progress to the page so the user sees what is happening.
//
// One secret needed: GEMINI_API_KEY (free at https://aistudio.google.com/apikey). Never written to any file.

import { cleanGuide } from "./lib/guide.js";

const BASE = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";
const SEARCH_URL = process.env.SEARCH_URL || "https://html.duckduckgo.com/html/";
// Current model names (ai.google.dev/gemini-api/docs/models, checked 2026-10-21). Free-tier quota is per model, so we fall through the list.
const MODELS = [process.env.GEMINI_MODEL, "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.6-flash", "gemini-3.8-flash", "gemini-flash-latest"].filter(Boolean);
const MAX_PAGES = 12; // Gemini's URL tool accepts up to 20; 12 keeps the request fast

// The instructions the agent follows. Most of the "product thinking" in this project is in this prompt.
export const SYSTEM = `You are an integrations research agent. A developer building an AI agent wants their end users to connect a third-party app via OAuth. Before launch they may need to create their own OAuth app with the provider and get it approved.

The user message lists web pages. Read them with your URL tool and base the guide ONLY on what those pages say. Prefer official developer docs, support pages and changelogs; treat blogs and forums as weak evidence and say so.

Then output ONE JSON object and nothing else, with exactly these fields:
{
  "app": string, "website": string, "category": string,
  "summary": string,                       // 2-3 plain sentences
  "difficulty": "instant" | "easy" | "moderate" | "hard" | "partner-gated",
  "time_to_first_connection": string,
  "time_to_production": string,            // include approval wait, or "no official figure"
  "effort": string,                        // what the developer must prepare/do
  "approval": { "required": boolean, "kind": string, "who_reviews": string, "stated_wait": string|null, "source_url": string|null },
  "steps": [ { "title": string, "detail": string, "owner": "agent_can_do" | "developer_must_do" | "needs_provider_review", "source_url": string|null } ],
  "requirements": [ { "text": string, "source_url": string|null } ],
  "gotchas": [ { "text": string, "source_url": string|null } ],
  "blockers": [ { "blocker": string, "what_to_do": string } ],
  "agent_vs_human": { "agent_can": [string], "human_must": [string] },
  "claims": [ { "claim": string, "evidence": "doc-stated" | "inferred" | "unverified", "source_url": string|null } ],
  "composio": { "slug": string|null, "managed_oauth_available": boolean|null, "note": string, "source_url": string|null },
  "uncertain": [string],
  "sources": [ { "title": string, "url": string } ]
}

Rules:
- Never invent timelines, fees, limits or URLs. If the pages do not state a figure, write "no official figure" and add it to "uncertain". Only use source URLs that appear in the user message.
- Label each material claim: doc-stated (a page says it), inferred (your conclusion), unverified (could not confirm).
- You cannot log in or create the app. Do not claim you tested anything.
- Separate the self-serve path (dev/testing/internal use) from the production/public path.
- "composio": if a docs.composio.dev/toolkits page is listed and readable, say whether Composio manages the OAuth app, and what a developer gives up by using it (own branding, custom scopes, own rate-limit quota). Use null if the page is missing or unreadable.
- If the app does not offer OAuth at all, still return the JSON: explain in "summary", use difficulty "easy" or "moderate", and make the steps the real alternative (for example API keys).
- Output valid JSON only, no prose, no code fences.`;

// ---------- talking to Gemini ----------

// One HTTP call. `tools` is [{url_context:{}}] for reading pages, or undefined for a plain request.
// Tries each model in turn; remembers why each one failed so the final error message is useful.
async function callGemini(contents, apiKey, { tools, system = SYSTEM } = {}) {
  const tried = [];
  for (const model of MODELS) {
    const body = { systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { temperature: 0.2, maxOutputTokens: 16384 } };
    if (tools) body.tools = tools;
    const res = await fetch(`${BASE}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey }, // key goes in a header, never in the URL
      body: JSON.stringify(body),
    });
    if (res.ok) return { model, data: await res.json() };
    const text = (await res.text()).slice(0, 300);
    // A bad key fails on every model: stop at once and say so.
    if ((res.status === 400 || res.status === 403) && /api key|permission|not valid|denied/i.test(text)) throw new Error(`Gemini rejected the API key (${res.status}). Create a fresh key and try again.`);
    tried.push(`${model}: HTTP ${res.status} ${text.replace(/\s+/g, " ").slice(0, 140)}`); // 404 retired, 429 quota used up, ...: try the next model
  }
  throw new Error(`Gemini could not answer on any model tried. ${tried.join(" | ")}`);
}

const textOf = (data) => (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");

// The model should return bare JSON but may add ``` fences. Take everything from the first { to the last }.
function extractJson(text) {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("no JSON found");
  return JSON.parse(text.slice(a, b + 1));
}

// ---------- step 1: find candidate pages ----------

const BLOCKED_HOSTS = ["reddit.com", "quora.com", "youtube.com", "facebook.com", "medium.com", "pinterest.com", "instagram.com", "tiktok.com", "wikipedia.org", "stackoverflow.com"];
function cleanUrl(u) {
  try {
    const x = new URL(u);
    if (x.protocol !== "https:" && x.protocol !== "http:") return null;
    if (BLOCKED_HOSTS.some((h) => x.hostname === h || x.hostname.endsWith("." + h))) return null;
    x.hash = "";
    return x.toString().replace(/\/$/, "");
  } catch { return null; }
}

// Keyless web search through DuckDuckGo's plain HTML page. May be blocked from some servers: that is fine, we have other sources.
async function webSearch(q) {
  try {
    const res = await fetch(`${SEARCH_URL}?q=${encodeURIComponent(q)}`, { headers: { "user-agent": "Mozilla/5.0 (compatible; oauth-guides)" }, signal: AbortSignal.timeout(8000) });
    const html = await res.text();
    const urls = [];
    for (const m of html.matchAll(/href="[^"]*?uddg=([^"&]+)/g)) urls.push(decodeURIComponent(m[1]));  // DuckDuckGo wraps real links in ?uddg=
    for (const m of html.matchAll(/class="result__a"[^>]*href="(https?:\/\/[^"]+)"/g)) urls.push(m[1]);   // or sometimes links directly
    return urls;
  } catch { return []; }
}

// Ask the model (no tools) which official pages probably explain OAuth setup. We verify by reading them in step 2.
async function modelSuggestedUrls(query, apiKey) {
  try {
    const ask = `List up to 6 https URLs on the official developer documentation or support site of "${query}" that most likely explain: creating or registering an OAuth app, app review / approval / marketplace listing, OAuth scopes, and rate limits. Only URLs you are confident exist. One URL per line, nothing else.`;
    const { data } = await callGemini([{ role: "user", parts: [{ text: ask }] }], apiKey, { system: "You are a careful assistant. Output only what was asked." });
    return textOf(data).match(/https?:\/\/[^\s)"'<>]+/g) || [];
  } catch { return []; }
}

async function findCandidatePages(query, apiKey, emit) {
  const composioSlug = query.toLowerCase().trim().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\.[a-z]+(\/.*)?$/, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const queries = [`${query} developer docs create OAuth app`, `${query} OAuth app review approval requirements`];
  const [found1, found2, suggested] = await Promise.all([...queries.map(webSearch), modelSuggestedUrls(query, apiKey)]);
  for (const q of queries) emit("step", { tool: "web_search", input: q });

  const ordered = [`https://docs.composio.dev/toolkits/${composioSlug}`, ...found1.slice(0, 4), ...found2.slice(0, 4), ...suggested.slice(0, 6)];
  const unique = [...new Set(ordered.map(cleanUrl).filter(Boolean))].slice(0, MAX_PAGES);
  for (const u of unique) emit("step", { tool: "web_fetch", input: u });
  return unique;
}

// ---------- step 2 to 4: read, write, check ----------

export async function generateGuide(query, emit = () => {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("No GEMINI_API_KEY set on the server. Get a free key at aistudio.google.com/apikey and add it as a secret.");

  emit("status", { message: "Finding the official documentation pages…" });
  const pages = await findCandidatePages(query, apiKey, emit);

  emit("status", { message: `Agent is reading ${pages.length} pages and writing the guide…` });
  const today = new Date().toISOString().slice(0, 10);
  let contents = [{ role: "user", parts: [{ text: `App or website to investigate: ${query}\nToday's date: ${today}\n\nRead these pages (some may not exist; skip those):\n${pages.join("\n")}\n\nThen output the JSON object only.` }] }];
  const tools = [{ url_context: {} }];

  let { model, data } = await callGemini(contents, apiKey, { tools });
  let raw;
  try { raw = extractJson(textOf(data)); }
  catch { // the model added prose: ask once more for JSON only
    emit("status", { message: "Fixing output format…" });
    contents = [...contents, { role: "model", parts: [{ text: textOf(data).slice(0, 8000) }] }, { role: "user", parts: [{ text: "Return ONLY the valid JSON object in the required format. No prose, no code fences." }] }];
    ({ data } = await callGemini(contents, apiKey, { tools }));
    try { raw = extractJson(textOf(data)); } catch { throw new Error("The agent did not return a usable guide. Try again."); }
  }

  // Google tells us which pages were genuinely read. That is better evidence than links the model typed itself.
  const meta = data.candidates?.[0]?.urlContextMetadata?.urlMetadata || [];
  const read = meta.filter((m) => /SUCCESS/i.test(m.urlRetrievalStatus || "")).map((m) => m.retrievedUrl).filter(Boolean);
  const failed = meta.filter((m) => !/SUCCESS/i.test(m.urlRetrievalStatus || "")).map((m) => m.retrievedUrl).filter(Boolean);
  if (meta.length && !read.length) throw new Error("The agent could not open any documentation page for this app. Try its website address instead (for example calendly.com).");

  const seen = new Set();
  raw.sources = [...read.map((u) => ({ title: `${u} (read by the agent)`, url: u })), ...(raw.sources || [])].filter((s) => s?.url && !seen.has(s.url) && seen.add(s.url));

  emit("status", { message: "Checking the guide…" });
  const { guide, problems } = cleanGuide(raw);
  if (problems.length) throw new Error(`The agent's guide was incomplete (${problems.join("; ")}). Try again.`);

  // Honesty fields are set by OUR code, not by the model, so they cannot be skipped or exaggerated.
  guide.not_tested = "Generated live by an AI agent reading web pages. No provider account was opened, no OAuth app was registered and no approval was attempted, so nothing here was tested hands-on.";
  guide.uncertain.push("Source links inside this guide were written by an AI model: open them and confirm any figure before relying on it.");
  if (failed.length) guide.uncertain.push(`Pages the agent tried but could not read: ${failed.slice(0, 5).join(", ")}`);
  // "No review" is only trustworthy if the agent actually read a page about review. Otherwise it just means "not found".
  if (!guide.approval.required && !read.some((u) => /review|approv|verif|publish|marketplace|submit|partner/i.test(u)))
    guide.uncertain.push("Approval: none of the pages read cover app review, so \"no review\" means not found, not confirmed. Check the provider's marketplace or publishing page.");
  if (!meta.length) guide.uncertain.push("Google did not report which pages were read, so it is unclear how much of the documentation the agent actually saw.");
  guide.generated = { live: true, at: new Date().toISOString(), model, pages_tried: pages.length, pages_read: read.length };
  return guide;
}
