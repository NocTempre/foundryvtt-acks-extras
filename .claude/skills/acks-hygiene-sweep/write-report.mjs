/**
 * Turn a sweep.workflow.mjs return value into the audit deliverables.
 *
 * Writes, into the audit dir (default C:/Proj/acks-rules/hygiene-audit):
 *   findings.csv     merged with any existing file — see MERGE RULES below
 *   TRIAGE.md        the narrative report
 *   coverage.csv     one row per category incl. zero-hit "confirmed clean"
 *   wiki-vocab.json  cached rules vocabulary, so a delta run can skip re-extraction
 *   state.json       per-repo swept sha, so the next run can compute a delta
 *
 * MERGE RULES — findings.csv is the user's own tracking surface. Its `status`
 * column is hand-edited over time (New -> Fixed / WontFix / Deferred), so a
 * re-run must never flatten it:
 *   - A row whose cluster was NOT re-audited this run is carried over verbatim,
 *     status intact.
 *   - A row whose CATEGORY was not checked this run (a --lens run) is likewise
 *     carried over verbatim, even if its cluster ran. Nothing looked for it, so
 *     its absence from the results is not evidence of anything.
 *   - A row whose cluster WAS re-audited and category WAS checked, and that
 *     still reproduces, keeps its existing status (a human "WontFix" survives
 *     re-detection) — except a claimed "Fixed" that still reproduces, which
 *     becomes "Reopened".
 *   - A row whose cluster WAS re-audited and category WAS checked and that no
 *     longer reproduces is kept and marked Resolved — never deleted, because the
 *     audit trail of what was once flagged is the point. `Resolved` is
 *     tool-observed; `Fixed` stays a human claim this script never writes.
 *   - A genuinely new row is appended with status New.
 * Row ids are stable across runs: an id, once issued, always refers to the same
 * finding.
 *
 * Usage:
 *   node write-report.mjs <result.json>
 *   node write-report.mjs --stdin  < result.json
 */
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const DEFAULT_AUDIT_DIR = "C:/Proj/acks-rules/hygiene-audit";

const COLUMNS = [
  "id", "repo", "file", "line", "category", "severity", "summary",
  "failure_scenario", "family_convention_ref", "recommended_fix", "cluster",
  "first_seen", "last_seen", "status",
];

/* --- CSV (RFC 4180: quote when needed, double interior quotes) ------------ */

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
const csvRow = (cells) => cells.map(csvCell).join(",");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ",") { row.push(cell); cell = ""; continue; }
    if (ch === "\r") continue;
    if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0];
  return rows.slice(1)
    .filter((r) => r.some((c) => c !== ""))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

/* --- input --------------------------------------------------------------- */

let raw;
if (argv.includes("--stdin")) {
  raw = fs.readFileSync(0, "utf8");
} else {
  const file = argv.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("usage: node write-report.mjs <result.json> | --stdin");
    process.exit(1);
  }
  raw = fs.readFileSync(file, "utf8");
}

let result;
try {
  result = JSON.parse(raw);
} catch (err) {
  console.error(`ERROR input is not valid JSON: ${err.message}`);
  process.exit(1);
}

const auditDir = result.auditDir || DEFAULT_AUDIT_DIR;
fs.mkdirSync(auditDir, { recursive: true });

const findingsPath = path.join(auditDir, "findings.csv");
const triagePath = path.join(auditDir, "TRIAGE.md");
const coveragePath = path.join(auditDir, "coverage.csv");
const vocabPath = path.join(auditDir, "wiki-vocab.json");
const statePath = path.join(auditDir, "state.json");

const stamp = new Date().toISOString().slice(0, 10);
const newRows = Array.isArray(result.rows) ? result.rows : [];
const swept = new Set(result.sweptClusterIds || []);
/* Which categories this run actually looked for. Empty set == no lens data in
 * the payload, which we treat as "everything was checked" for backwards
 * compatibility with an older result file. */
const checkedCats = new Set(result.checkedCategories || []);
const lens = result.lens || "all";
const categoryWasChecked = (cat) => checkedCats.size === 0 || checkedCats.has(String(cat || "").trim());

/* --- merge --------------------------------------------------------------- */

const identity = (r) =>
  [String(r.file || "").toLowerCase().trim(), String(r.line || "").trim(), String(r.category || "").trim()].join("|");

/* Status of a row that WAS re-audited and came back again.
 * `Fixed` claimed but still detected is the one case worth escalating rather
 * than honouring: the fix did not take, and silently leaving it Fixed hides
 * that. `WontFix`/`Deferred` are deliberate standing decisions and survive
 * re-detection untouched. `Resolved` is tool-observed, so a reappearance
 * legitimately returns it to the queue. */
function nextStatus(prior) {
  const status = (prior || "").trim();
  if (status === "Fixed") return "Reopened";
  if (status === "Resolved") return "New";
  return status || "New";
}

const existing = fs.existsSync(findingsPath) ? parseCsv(fs.readFileSync(findingsPath, "utf8")) : [];
const existingByIdentity = new Map(existing.map((r) => [identity(r), r]));
let maxId = existing.reduce((m, r) => Math.max(m, Number.parseInt(r.id, 10) || 0), 0);

const merged = [];
const seenIdentities = new Set();
let countNew = 0;
let countReconfirmed = 0;

for (const r of newRows) {
  const key = identity(r);
  if (seenIdentities.has(key)) continue;
  seenIdentities.add(key);
  const prior = existingByIdentity.get(key);
  if (prior) {
    countReconfirmed++;
    merged.push({
      ...prior,
      // Refresh the descriptive fields — wording improves between runs — but
      // never touch id, first_seen, or the human-owned status.
      repo: r.repo ?? prior.repo,
      severity: r.severity ?? prior.severity,
      summary: r.summary ?? prior.summary,
      failure_scenario: r.failure_scenario ?? prior.failure_scenario,
      family_convention_ref: r.family_convention_ref ?? prior.family_convention_ref,
      recommended_fix: r.recommended_fix ?? prior.recommended_fix,
      cluster: r.sourceCluster ?? prior.cluster,
      last_seen: stamp,
      status: nextStatus(prior.status),
    });
  } else {
    countNew++;
    merged.push({
      id: ++maxId,
      repo: r.repo ?? "",
      file: r.file ?? "",
      line: r.line ?? "",
      category: r.category ?? "",
      severity: r.severity ?? "",
      summary: r.summary ?? "",
      failure_scenario: r.failure_scenario ?? "",
      family_convention_ref: r.family_convention_ref ?? "",
      recommended_fix: r.recommended_fix ?? "",
      cluster: r.sourceCluster ?? "",
      first_seen: stamp,
      last_seen: stamp,
      status: "New",
    });
  }
}

let countCarried = 0;
let countCarriedByLens = 0;
let countResolved = 0;
for (const prior of existing) {
  if (seenIdentities.has(identity(prior))) continue;
  const cluster = prior.cluster || "";
  if (!categoryWasChecked(prior.category)) {
    // This lens never looked for this category. Silence here means nothing.
    countCarriedByLens++;
    merged.push(prior);
  } else if (swept.size && !swept.has(cluster)) {
    // Its cluster was not re-audited — no evidence either way, carry verbatim.
    countCarried++;
    merged.push(prior);
  } else {
    // Re-audited and it did not come back: tool-observed as gone.
    countResolved++;
    merged.push({
      ...prior,
      last_seen: prior.last_seen || prior.first_seen || "",
      status: ["Fixed", "WontFix", "Deferred"].includes(prior.status) ? prior.status : "Resolved",
    });
  }
}

merged.sort((a, b) => Number(a.id) - Number(b.id));

const csv = [csvRow(COLUMNS), ...merged.map((r) => csvRow(COLUMNS.map((c) => r[c])))].join("\n") + "\n";
fs.writeFileSync(findingsPath, csv, "utf8");

/* Round-trip the file we just wrote: a CSV whose quoting is wrong is worse
 * than no CSV, because the damage shows up in a spreadsheet weeks later. */
const reparsed = parseCsv(fs.readFileSync(findingsPath, "utf8"));
if (reparsed.length !== merged.length) {
  console.error(`ERROR findings.csv round-trip mismatch: wrote ${merged.length} rows, re-read ${reparsed.length}`);
  process.exit(1);
}
const badCell = reparsed.find((r, i) => (r.summary || "") !== (merged[i].summary ?? ""));
if (badCell) {
  console.error(`ERROR findings.csv round-trip corrupted a cell (id ${badCell.id})`);
  process.exit(1);
}

/* --- coverage ------------------------------------------------------------ */

const coverage = Array.isArray(result.coverage) ? result.coverage : [];
if (coverage.length) {
  const verdictOf = (c) => {
    if (c.checked === false) return "not checked this run";
    return c.clean ? "confirmed clean" : "findings";
  };
  const covCsv = [
    csvRow(["group", "category", "hits", "verdict", "lens"]),
    ...coverage.map((c) => csvRow([c.group, c.category, c.hits === null ? "" : c.hits, verdictOf(c), lens])),
  ].join("\n") + "\n";
  fs.writeFileSync(coveragePath, covCsv, "utf8");
}

/* --- triage, vocab cache, state ----------------------------------------- */

if (result.triageMarkdown) fs.writeFileSync(triagePath, result.triageMarkdown.trim() + "\n", "utf8");
if (result.vocab?.domains?.length) fs.writeFileSync(vocabPath, JSON.stringify(result.vocab, null, 2) + "\n", "utf8");

/* `lastSweptSha` is what the next delta diffs from, so it may only advance on
 * evidence that the full checklist was applied. Two ways that claim can be
 * false, and both must NOT move it:
 *   - only some of the repo's clusters ran (recorded, but flagged partial), and
 *   - a --lens run, which examined every selected cluster for only a slice of
 *     the checklist. Advancing on a lens run would make every unchecked
 *     category look audited as of that commit, and the gap would close in
 *     silence — the exact failure mode this skill is built to prevent.
 * A lens run still records where it got to, under its own key, so a later run
 * can report what was last looked at without ever being misled by it. */
const prevState = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : {};
const state = { ...prevState };
const fullChecklist = (result.skippedCategories || []).length === 0;
for (const [repo, sha] of Object.entries(result.heads || {})) {
  if (!sha) continue;
  const prefix = repo === "foundryvtt-acks-extras" ? "E" : "I";
  const ranHere = (result.sweptClusterIds || []).filter((id) => id.startsWith(prefix));
  const missedHere = (result.carriedClusterIds || []).filter((id) => id.startsWith(prefix));
  if (!ranHere.length) continue; // nothing from this repo was examined at all
  const entry = { ...(prevState[repo] || {}) };
  if (fullChecklist) {
    entry.lastSweptSha = sha;
    entry.sweptAt = stamp;
    entry.mode = result.mode;
    if (missedHere.length) entry.partial = true;
    else delete entry.partial;
  } else {
    // Lens run: remember it, but leave the delta baseline where it was.
    entry.lastLensSweep = { lens, sha, at: stamp, clusters: ranHere.length };
  }
  state[repo] = entry;
}
fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", "utf8");

/* --- report ------------------------------------------------------------- */

const checkedCount = coverage.filter((c) => c.checked !== false).length;
const cleanCount = coverage.filter((c) => c.checked !== false && c.clean).length;
const notChecked = coverage.filter((c) => c.checked === false).length;
console.log(`wrote ${findingsPath.replaceAll("\\", "/")}   (lens: ${lens})`);
console.log(
  `  ${merged.length} row(s) total: ${countNew} new, ${countReconfirmed} still reproducing, ` +
    `${countCarried} carried (cluster not re-audited), ${countCarriedByLens} carried (category not in lens), ${countResolved} newly Resolved`
);
if (coverage.length) {
  console.log(`  coverage: ${cleanCount}/${checkedCount} checked categories confirmed clean${notChecked ? `, ${notChecked} not checked this run` : ""}`);
}
if (result.triageMarkdown) console.log(`wrote TRIAGE.md (${result.triageMarkdown.length} chars)`);
console.log(
  `state.json: ` +
    Object.entries(state)
      .map(([r, s]) => {
        const base = s.lastSweptSha ? `${String(s.lastSweptSha).slice(0, 8)}${s.partial ? " (partial)" : ""}` : "no full-checklist baseline yet";
        const lensNote = s.lastLensSweep ? ` +lens:${s.lastLensSweep.lens}@${String(s.lastLensSweep.sha).slice(0, 8)}` : "";
        return `${r.replace("foundryvtt-acks-", "")}=${base}${lensNote}`;
      })
      .join(", ")
);
if (!fullChecklist) console.log(`  NOTE lens run — the delta baseline was deliberately NOT advanced, so the next full sweep still re-checks everything since ${Object.values(prevState)[0]?.lastSweptSha?.slice(0, 8) ?? "the beginning"}.`);
const failed = (result.clusterStatus || []).filter((s) => !s.ok);
if (failed.length) console.log(`WARN ${failed.length} cluster(s) returned nothing and are UNVERIFIED: ${failed.map((s) => s.id).join(", ")}`);
if ((result.unownedFiles || []).length) console.log(`WARN ${result.unownedFiles.length} source file(s) are owned by no cluster — see plan-sweep.mjs --check`);
