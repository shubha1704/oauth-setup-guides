// server.js: a small web server with no dependencies. It does 4 jobs:
//   1. serves the page (public/index.html), also for shareable links like /g/slack
//   2. lists and returns guides:   GET /api/guides, /api/guides/<slug>, /api/directory
//   3. creates a guide live:       POST /api/generate   (streams progress with Server-Sent Events)
//   4. protects your free API key with a simple hourly limit

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateGuide } from "./agent.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const LIBRARY = path.join(ROOT, "guides");                                   // researched guides, committed to git
let GENERATED = process.env.GENERATED_DIR || path.join(ROOT, "generated"); // guides made live, cached here (git-ignored)
const PER_HOUR = Number(process.env.GEN_PER_HOUR || 20);                     // max live generations per hour, whole server
try { fs.mkdirSync(GENERATED, { recursive: true }); }
catch { GENERATED = path.join(os.tmpdir(), "generated"); fs.mkdirSync(GENERATED, { recursive: true }); }

// "https://www.HubSpot.com/pricing" -> "hubspot". Used as the guide's file name and URL.
const slugify = (s) =>
  String(s).toLowerCase().trim()
    .replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, "")
    .replace(/\.(com|io|ai|app|co|net|org|dev)$/, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

// A few names people type that differ from our file names.
const ALIAS = { gmail: "google-gmail", google: "google-gmail", x: "twitter", "x-twitter": "twitter" };

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const DIRECTORY = (() => { try { return readJson(path.join(ROOT, "data", "composio-toolkits.json")).slugs; } catch { return []; } })();

function send(res, status, body, type = "application/json") {
  res.writeHead(status, { "content-type": type });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function loadGuide(name) {
  let slug = slugify(name);
  slug = ALIAS[slug] || slug;
  for (const [dir, source] of [[LIBRARY, "library"], [GENERATED, "generated"]]) {
    const file = path.join(dir, `${slug}.json`);
    if (fs.existsSync(file)) return { ...readJson(file), slug, source };
  }
  return null;
}

function listGuides() {
  const out = [];
  for (const [dir, source] of [[LIBRARY, "library"], [GENERATED, "generated"]]) {
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")) : []) {
      const g = readJson(path.join(dir, f));
      out.push({ slug: f.slice(0, -5), app: g.app, difficulty: g.difficulty, time_to_production: g.time_to_production, source });
    }
  }
  return out;
}

// Hourly limit. In memory, resets on restart. Enough to stop a loop or a crowd from using up the free key.
const recent = [];
function allowGeneration() {
  const now = Date.now();
  while (recent.length && now - recent[0] > 3600_000) recent.shift();
  if (recent.length >= PER_HOUR) return false;
  recent.push(now);
  return true;
}

const readBody = async (req) => { let b = ""; for await (const c of req) { b += c; if (b.length > 2000) break; } return b; };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === "/api/guides") return send(res, 200, listGuides());

    // Composio's list of supported apps, each marked with whether we already have a guide.
    if (url.pathname === "/api/directory") return send(res, 200, DIRECTORY.map((slug) => ({ slug, has_guide: !!loadGuide(slug) })));

    if (url.pathname.startsWith("/api/guides/")) {
      const guide = loadGuide(decodeURIComponent(url.pathname.split("/").pop()));
      return guide ? send(res, 200, guide) : send(res, 404, { error: "not found" });
    }

    if (url.pathname === "/api/generate" && req.method === "POST") {
      let query = "";
      try { query = String(JSON.parse((await readBody(req)) || "{}").query || "").trim(); } catch {}
      if (!query || query.length > 200 || !slugify(query)) return send(res, 400, { error: "Send an app name or website (max 200 characters)" });

      // From here on we answer as an event stream: the browser shows each line as it arrives.
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      const emit = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);

      const slug = ALIAS[slugify(query)] || slugify(query);
      if (loadGuide(slug)) { emit("done", { slug, cached: true }); return res.end(); } // already have it: instant
      if (!allowGeneration()) { emit("error", { message: "Hourly limit for live generation reached. Try again later or open a library guide." }); return res.end(); }

      const keepAlive = setInterval(() => res.write(": ping\n\n"), 15000); // stops proxies closing a quiet connection
      try {
        const guide = await generateGuide(query, emit);
        fs.writeFileSync(path.join(GENERATED, `${slug}.json`), JSON.stringify(guide, null, 2));
        emit("done", { slug, cached: false });
      } catch (e) {
        emit("error", { message: e.message });
      } finally { clearInterval(keepAlive); res.end(); }
      return;
    }

    // Everything else is a file from public/. Share links (/g/<slug>) get the same page; the page reads the slug itself.
    const rel = url.pathname === "/" || url.pathname.startsWith("/g/") ? "index.html" : url.pathname.slice(1);
    const file = path.join(ROOT, "public", path.normalize(rel));
    if (file.startsWith(path.join(ROOT, "public")) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      return send(res, 200, fs.readFileSync(file), file.endsWith(".html") ? "text/html" : "text/plain");
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => console.log(`OAuth guides running on http://localhost:${PORT}`));
