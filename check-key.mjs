// check-key.mjs: tells you in plain words whether your GEMINI_API_KEY can run the live agent.
// Run:  node check-key.mjs      (it never prints your key)
const BASE = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta";
const key = process.env.GEMINI_API_KEY;
if (!key) { console.log("✗ GEMINI_API_KEY is not set in this Terminal window. Run: export GEMINI_API_KEY=<your key>   then try again."); process.exit(1); }

const MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.6-flash", "gemini-3.8-flash"];

async function ask(model, tools) {
  const body = { contents: [{ parts: [{ text: "Say hi in three words" }] }] };
  if (tools) body.tools = tools;
  try {
    const res = await fetch(`${BASE}/models/${model}:generateContent`, {
      method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body),
    });
    const text = await res.text();
    let note = "";
    if (!res.ok) {
      try {
        const e = JSON.parse(text).error;
        const q = (e.details || []).flatMap((d) => d.violations || []).map((v) => `${v.quotaMetric || ""} ${v.quotaId || ""}`.trim()).filter(Boolean)[0];
        note = (q ? `quota: ${q}. ` : "") + String(e.message || "").slice(0, 120);
      } catch { note = text.slice(0, 120); }
    }
    return { ok: res.ok, status: res.status, note };
  } catch (e) { return { ok: false, status: "network", note: e.message }; }
}

const show = (label, r) => console.log(`${r.ok ? "✓" : "✗"} ${label.padEnd(44)} ${r.ok ? "works" : `HTTP ${r.status}  ${r.note}`}`);

console.log("Checking your key (it is never printed)…\n");
console.log("A) Plain requests, no tools:");
let plainOk = null;
for (const m of MODELS) { const r = await ask(m, null); show(m, r); if (r.ok && !plainOk) plainOk = m; }

let searchOk = false, urlOk = false;
if (plainOk) {
  console.log(`\nB) Tools the agent needs, tested on ${plainOk}:`);
  const s = await ask(plainOk, [{ google_search: {} }]); show("Google Search tool", s); searchOk = s.ok;
  const u = await ask(plainOk, [{ url_context: {} }]); show("URL reading tool", u); urlOk = u.ok;
}

console.log("\nVERDICT");
if (!plainOk) console.log("✗ Your key cannot make even a plain request: your project has no free quota right now (or the key is invalid).\n  Send this whole output to Claude. Likely fixes: create the key from a fresh project, wait for the daily reset, or use a different provider.");
else if (!searchOk) console.log("✗ Plain requests work but the Google Search tool is blocked/limited on your free tier.\n  Send this whole output to Claude: the agent can be changed to fetch the docs itself instead.");
else console.log("✓ Everything the agent needs works. If the app still fails, send Claude the red error text (never the key).");
