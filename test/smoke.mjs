// npm test: end-to-end check of the live-generation flow WITHOUT any real API key or internet.
// It starts a fake "Gemini" and a fake web-search page, starts our server pointed at them, asks for an app that is
// not in the library, and checks: pages are found and streamed, the guide is cleaned and saved, pages Google could not
// read are flagged, honesty text is set by our code, caching works, and the home page is real HTML.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const fakeGuide = {
  app: "Acme Test App", difficulty: "moderate", summary: "A fake guide used only by the test.",
  approval: { required: true, kind: "Review by Acme", who_reviews: "Acme", stated_wait: null, source_url: "https://example.com/review" },
  steps: [
    { title: "Create the app", detail: "Open the developer portal.", owner: "BOGUS_OWNER", source_url: "javascript:alert(1)" }, // bad owner + unsafe link must be fixed
    { title: "Wait for review", detail: "Acme reviews it.", owner: "needs_provider_review", source_url: "https://example.com/review" },
  ],
  claims: [{ claim: "Review is manual", evidence: "made-up-label", source_url: "https://example.com/review" }],
  uncertain: [], sources: [{ title: "Acme docs", url: "https://example.com/docs" }],
  not_tested: "I tested everything myself", // our code must ignore this and set the honest statement
};

// 1. fake Gemini. A request WITH tools = "read these pages and write the guide"; WITHOUT tools = "suggest some URLs".
const geminiCalls = [];
const gemini = http.createServer((req, res) => {
  let body = ""; req.on("data", (d) => (body += d));
  req.on("end", () => {
    const j = JSON.parse(body || "{}");
    geminiCalls.push({ url: req.url, hasTools: !!j.tools, key: req.headers["x-goog-api-key"] });
    res.writeHead(200, { "content-type": "application/json" });
    if (!j.tools) return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: "https://example.com/oauth\nhttps://example.com/missing-page" }] } }] }));
    res.end(JSON.stringify({ candidates: [{
      content: { parts: [{ text: "```json\n" + JSON.stringify(fakeGuide) + "\n```" }] },
      urlContextMetadata: { urlMetadata: [
        { retrievedUrl: "https://example.com/oauth", urlRetrievalStatus: "URL_RETRIEVAL_STATUS_SUCCESS" },
        { retrievedUrl: "https://example.com/missing-page", urlRetrievalStatus: "URL_RETRIEVAL_STATUS_ERROR" },
      ] },
    }] }));
  });
});
await new Promise((r) => gemini.listen(4101, r));

// 2. fake web search page (DuckDuckGo wraps real links in ?uddg=)
const search = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent("https://example.com/search-hit")}&rut=x">hit</a>
           <a href="//duckduckgo.com/l/?uddg=${encodeURIComponent("https://www.reddit.com/r/blocked")}">blocked host</a>`);
});
await new Promise((r) => search.listen(4102, r));

// 3. our server, pointed at the fakes, with a throwaway folder for generated guides
const genDir = fs.mkdtempSync(path.join(os.tmpdir(), "guides-test-"));
const app = spawn("node", ["server.js"], { env: { ...process.env, PORT: "4100", GEMINI_API_KEY: "test-key", GEMINI_BASE_URL: "http://localhost:4101/v1beta", SEARCH_URL: "http://localhost:4102/html/", GENERATED_DIR: genDir }, stdio: "inherit" });
await new Promise((r) => setTimeout(r, 800));

try {
  // 4. ask for an unknown app and read the event stream
  const stream = await (await fetch("http://localhost:4100/api/generate", { method: "POST", body: JSON.stringify({ query: "Acme Test App" }) })).text();
  assert.match(stream, /event: step[\s\S]*developer docs create OAuth app/, "search queries should be streamed");
  assert.match(stream, /example\.com\/search-hit/, "pages found by web search should be streamed");
  assert.match(stream, /example\.com\/oauth/, "pages suggested by the model should be streamed");
  assert.doesNotMatch(stream, /reddit\.com/, "blocked hosts must be dropped");
  assert.match(stream, /docs\.composio\.dev\/toolkits\/acme_test_app/, "the Composio page for the app is always tried");
  assert.match(stream, /event: done/, "should finish with a done event");

  // 5. the guide is saved, cleaned and honest
  const guide = await (await fetch("http://localhost:4100/api/guides/acme-test-app")).json();
  assert.equal(guide.steps[0].owner, "developer_must_do", "unknown step owner is replaced");
  assert.equal(guide.steps[0].source_url, null, "non-http link is removed");
  assert.equal(guide.claims[0].evidence, "unverified", "unknown evidence label becomes unverified");
  assert.match(guide.not_tested, /No provider account was opened/, "honesty text is set by our code");
  assert.ok(guide.sources.some((s) => s.url === "https://example.com/oauth" && /read by the agent/.test(s.title)), "pages Google really read are attached as sources");
  assert.ok(guide.uncertain.some((u) => /could not read.*missing-page/.test(u)), "pages that could not be read are flagged");
  assert.equal(guide.generated.pages_read, 1, "pages_read counts only successfully read pages");

  // 6. the API key goes in a header (never the URL), and tools are only used for the read step
  assert.ok(geminiCalls.every((c) => c.key === "test-key" && !c.url.includes("test-key")), "key sent in header only");
  assert.ok(geminiCalls.some((c) => !c.hasTools) && geminiCalls.some((c) => c.hasTools), "one plain call (suggest URLs) and one tool call (read pages)");

  // 7. asking again is cached; library guides and aliases open; the page itself is real HTML (regression test for a real bug)
  assert.match(await (await fetch("http://localhost:4100/api/generate", { method: "POST", body: JSON.stringify({ query: "acme test app" }) })).text(), /"cached":true/, "second request should be cached");
  assert.equal((await (await fetch("http://localhost:4100/api/guides/gmail")).json()).app, "Google (Gmail API)", "alias gmail works");
  assert.match(await (await fetch("http://localhost:4100/")).text(), /^<!doctype html>/i, "home page must be real HTML");

  console.log("\n✓ all smoke tests passed");
} finally {
  app.kill(); gemini.close(); search.close(); fs.rmSync(genDir, { recursive: true, force: true });
}
