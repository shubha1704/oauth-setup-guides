// Adds agent-researched drafts to the library, after the same checks the live agent uses.
// Usage: node scripts/ingest-drafts.mjs [draftsDir]    (default: ./drafts)
// A draft that fails is reported and NOT added, so bad data never reaches the library.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanGuide } from "../lib/guide.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = process.argv[2] || path.join(root, "drafts");
if (!fs.existsSync(dir)) { console.error("no drafts folder:", dir); process.exit(1); }

let added = 0, rejected = 0;
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  let draft;
  try { draft = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); }
  catch (e) { console.log(`✗ ${f}: not valid JSON`); rejected++; continue; }

  const { guide, problems } = cleanGuide(draft);

  // Extra rule for researched guides: they must say plainly that they come from docs only.
  const nt = String(draft.not_tested || "");
  if (!(/(documentation|docs|read|sources)/i.test(nt) && /\b(not|no|never|nothing|cannot|n't)\b/i.test(nt))) problems.push("not_tested must say what was NOT tested");

  if (problems.length) { console.log(`✗ ${f}:\n   - ${problems.join("\n   - ")}`); rejected++; continue; }
  guide.not_tested = nt;
  guide.generated = { live: false, researched: "2026-10-20", method: "agent research over official docs with the same prompt and format as live generation; key claims spot-checked, see VERIFICATION.md" };
  fs.writeFileSync(path.join(root, "guides", f), JSON.stringify(guide, null, 2));
  console.log(`✓ ${f}: ${guide.difficulty}, ${guide.steps.length} steps, ${guide.claims.length} labeled claims, composio managed=${guide.composio?.managed_oauth_available}`);
  added++;
}
console.log(`\n${added} added, ${rejected} rejected`);
process.exit(rejected ? 2 : 0);
