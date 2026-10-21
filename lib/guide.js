// lib/guide.js: the single definition of "what a valid guide looks like".
// Used by (1) the live agent before saving a guide, and (2) scripts/ingest-drafts.mjs for agent-researched drafts.
// Idea: fill harmless gaps with safe defaults, but REFUSE guides missing the essentials.

export const DIFFICULTIES = ["instant", "easy", "moderate", "hard", "partner-gated"];
const OWNERS = ["agent_can_do", "developer_must_do", "needs_provider_review"];
const EVIDENCE = ["doc-stated", "inferred", "unverified"];

const isHttp = (u) => typeof u === "string" && /^https?:\/\//i.test(u);
const urlOrNull = (u) => (isHttp(u) ? u : null); // never keep a non-http(s) link (blocks javascript: links)
const arr = (x) => (Array.isArray(x) ? x : []);
const str = (x) => (typeof x === "string" ? x : "");

/** Returns { guide, problems }. problems.length > 0 means: do not publish this guide. */
export function cleanGuide(input) {
  const g = { ...input };
  const problems = [];

  // 1. Essentials. Without these the guide is not useful, so reject rather than guess.
  if (!str(g.app).trim()) problems.push("missing app name");
  if (!str(g.summary).trim()) problems.push("missing summary");
  if (!DIFFICULTIES.includes(g.difficulty)) problems.push(`difficulty must be one of ${DIFFICULTIES.join(", ")} (got ${g.difficulty})`);
  if (typeof g.approval?.required !== "boolean") problems.push("approval.required must be true/false");
  if (!arr(g.steps).length) problems.push("no steps");

  // 2. Harmless gaps: default them so the page never crashes on a missing field.
  for (const k of ["time_to_first_connection", "time_to_production", "effort", "website", "category"]) g[k] = str(g[k]);
  g.steps = arr(g.steps).map((s) => ({
    title: str(s.title), detail: str(s.detail),
    owner: OWNERS.includes(s.owner) ? s.owner : "developer_must_do", // unknown owner: assume the human does it
    evidence: EVIDENCE.includes(s.evidence) ? s.evidence : undefined,
    source_url: urlOrNull(s.source_url),
  }));
  g.requirements = arr(g.requirements).map((x) => ({ text: str(x.text), source_url: urlOrNull(x.source_url) }));
  g.gotchas = arr(g.gotchas).map((x) => ({ text: str(x.text), evidence: EVIDENCE.includes(x.evidence) ? x.evidence : undefined, source_url: urlOrNull(x.source_url) }));
  g.blockers = arr(g.blockers).map((b) => ({ blocker: str(b.blocker), what_to_do: str(b.what_to_do) }));
  g.claims = arr(g.claims).map((c) => ({ claim: str(c.claim), evidence: EVIDENCE.includes(c.evidence) ? c.evidence : "unverified", source_url: urlOrNull(c.source_url) }));
  // The model sometimes lists bare field names (e.g. "time_to_production") instead of sentences. Make them readable.
  g.uncertain = arr(g.uncertain).map(str).map((u) =>
    /^[a-z_]+( [a-z_]+)?$/.test(u.trim()) ? `Not found in the pages read: ${u.trim().replace(/_/g, " ")}` : u);
  g.sources = arr(g.sources).filter((s) => isHttp(s?.url)).map((s) => ({ title: str(s.title) || s.url, url: s.url }));
  g.agent_vs_human = { agent_can: arr(g.agent_vs_human?.agent_can).map(str), human_must: arr(g.agent_vs_human?.human_must).map(str) };
  if (g.approval) g.approval = { ...g.approval, source_url: urlOrNull(g.approval.source_url) };
  if (g.composio) g.composio = { ...g.composio, source_url: urlOrNull(g.composio.source_url) };

  return { guide: g, problems };
}
