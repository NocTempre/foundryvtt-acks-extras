/**
 * Decide which hygiene-sweep clusters need to run, and emit them as the
 * `args` payload for sweep.workflow.mjs.
 *
 * Workflow scripts have no filesystem and no child_process, so every decision
 * that needs git or disk is made here and handed over as data.
 *
 * Usage:
 *   node plan-sweep.mjs                 delta since state.json (full if absent)
 *   node plan-sweep.mjs --full          every cluster, ignore state.json
 *   node plan-sweep.mjs --cluster E4    only the named cluster(s), repeatable
 *   node plan-sweep.mjs --lens foundry  only that slice of the checklist,
 *                                       repeatable; default `all`
 *   node plan-sweep.mjs --list-lenses   show the lenses and what each covers
 *   node plan-sweep.mjs --check         coverage audit only: report source files
 *                                       no cluster owns, then exit
 *   node plan-sweep.mjs --state <dir>   override the audit dir
 *                                       (default C:/Proj/acks-rules/hygiene-audit)
 *
 * stdout is a single JSON object — the `args` value for the Workflow call.
 * Human-readable notes go to stderr so stdout stays machine-parseable.
 *
 * A lens narrows WHAT IS CHECKED, and that is load-bearing downstream: the
 * categories it leaves out are reported as "not checked", never as "confirmed
 * clean", and write-report.mjs will not mark an unchecked category's stale rows
 * Resolved. Narrowing is always announced on stderr — a bounded run that reads
 * as a full one is the failure this whole design exists to prevent.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const DEFAULT_AUDIT_DIR = "C:/Proj/acks-rules/hygiene-audit";

const argv = process.argv.slice(2);
const FULL = argv.includes("--full");
const CHECK_ONLY = argv.includes("--check");
const LIST_LENSES = argv.includes("--list-lenses");
const onlyClusters = [];
const lensNames = [];
let auditDir = DEFAULT_AUDIT_DIR;
let agentModel = "sonnet";
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--cluster") onlyClusters.push(argv[i + 1]);
  if (argv[i] === "--lens") lensNames.push(argv[i + 1]);
  if (argv[i] === "--state") auditDir = argv[i + 1];
  if (argv[i] === "--model") agentModel = argv[i + 1];
}
/* Sweep agents default to a cheap tier (standing owner instruction — a full
 * sweep is ~67 agents). `--model root` removes the override so agents inherit
 * the calling session's model; Critical findings from a cheap tier are always
 * re-verified at the root model regardless (the workflow's escalation path). */
if (!["sonnet", "haiku", "opus", "root"].includes(agentModel)) {
  note(`ERROR --model must be one of sonnet|haiku|opus|root, got: ${agentModel}`);
  process.exit(1);
}

const note = (msg) => console.error(msg);

const catalog = JSON.parse(fs.readFileSync(path.join(HERE, "clusters.json"), "utf8"));
const REPOS = catalog.repos;
const CLUSTERS = catalog.clusters;

const taxonomy = JSON.parse(fs.readFileSync(path.join(HERE, "categories.json"), "utf8"));
const GROUPS = taxonomy.groups;
const LENSES = taxonomy.lenses;
const ALL_CATEGORY_IDS = GROUPS.flatMap((g) => g.items.map(([id]) => id));

if (LIST_LENSES) {
  const width = Math.max(...Object.keys(LENSES).map((n) => n.length));
  for (const [name, lens] of Object.entries(LENSES)) {
    const ids = resolveLens([name]).categories;
    const surfaces = lens.surfaces ? `  [clusters: ${lens.surfaces.join("+")} only]` : "";
    console.log(`${name.padEnd(width)}  ${String(ids.length).padStart(2)} categor${ids.length === 1 ? "y" : "ies"}  ${lens.description}${surfaces}`);
  }
  console.log(`\n${ALL_CATEGORY_IDS.length} categories total, in ${GROUPS.length} groups: ${GROUPS.map((g) => g.slug).join(", ")}`);
  console.log(`Combine lenses by repeating --lens; they union.`);
  process.exit(0);
}

/** Union the named lenses into a category-id set, plus any cluster-surface narrowing. */
function resolveLens(names) {
  if (!names.length) names = ["all"];
  const unknown = names.filter((n) => !LENSES[n]);
  if (unknown.length) {
    note(`ERROR unknown lens: ${unknown.join(", ")}`);
    note(`Known lenses: ${Object.keys(LENSES).join(", ")}  (see --list-lenses)`);
    process.exit(1);
  }
  const picked = new Set();
  const surfaceSets = [];
  for (const name of names) {
    const lens = LENSES[name];
    for (const slug of lens.groups ?? []) {
      const group = GROUPS.find((g) => g.slug === slug);
      if (!group) {
        note(`ERROR lens "${name}" names group slug "${slug}", which categories.json does not define`);
        process.exit(1);
      }
      for (const [id] of group.items) picked.add(id);
    }
    for (const id of lens.categories ?? []) {
      if (!ALL_CATEGORY_IDS.includes(id)) {
        note(`ERROR lens "${name}" names category "${id}", which categories.json does not define`);
        process.exit(1);
      }
      picked.add(id);
    }
    // A lens with no surface restriction widens the union to every surface:
    // one unrestricted lens must not be narrowed by another's restriction.
    surfaceSets.push(lens.surfaces ?? null);
  }
  const surfaces = surfaceSets.includes(null) ? null : [...new Set(surfaceSets.flat())];
  return { categories: ALL_CATEGORY_IDS.filter((id) => picked.has(id)), surfaces };
}

/** Every file a cluster owns, whether listed outright or covered as a line range. */
function filesOf(cluster) {
  if (cluster.partial) return [cluster.partial.file];
  return cluster.files ?? [];
}

function git(repoRoot, args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function headOf(repoRoot) {
  try {
    return git(repoRoot, ["rev-parse", "HEAD"]);
  } catch {
    return null;
  }
}

/* File discovery and ownership. Discovery asks git, not a directory allowlist:
 * everything git can see (tracked plus untracked-but-not-ignored — .gitignore
 * is the filter) with an audited extension is in scope. clusters.json is a
 * GROUPING HINT, not an allowlist: a file no cluster lists is auto-assigned to
 * the cluster owning its nearest directory, or to a per-repo catch-all as the
 * last resort — so repo growth is swept by default and a new file can never
 * silently fall out of audit. Two deliberate exclusions remain, both invisible
 * to .gitignore because they are committed: vendored third-party pdf.js (not
 * ours to audit; vendor/acks-design stays IN scope — those tokens are the
 * family's own), and .claude/ hooks, which are template-synced canon audited
 * at their source, not per-copy. */
const AUDITED_EXT = /\.(mjs|hbs|css)$/;
const DELIBERATE_SKIP = /(^|\/)vendor\/(pdf[.\w]*\.mjs|wasm)(\/|$)|^\.claude\//;

function repoSourceFiles(root) {
  return git(root, ["ls-files", "--cached", "--others", "--exclude-standard"])
    .split("\n")
    .map((f) => f.replaceAll("\\", "/").trim())
    .filter((f) => f && AUDITED_EXT.test(f) && !DELIBERATE_SKIP.test(f));
}

function assignOwnership() {
  const assigned = [];
  for (const [repo, root] of Object.entries(REPOS)) {
    let files;
    try {
      files = repoSourceFiles(root);
    } catch (err) {
      note(`WARN ${repo}: git ls-files failed (${err.message.split("\n")[0]}) — ownership audit skipped`);
      continue;
    }
    const repoClusters = CLUSTERS.filter((c) => c.repo === repo);
    const owned = new Set(repoClusters.flatMap((c) => filesOf(c).map((f) => f.replaceAll("\\", "/"))));
    // Directory affinity: which non-partial cluster owns the most files in
    // each directory. Partial clusters own line ranges of one oversized file
    // and must never receive appended siblings.
    const dirCounts = new Map();
    for (const c of repoClusters) {
      if (c.partial) continue;
      for (const f of filesOf(c)) {
        const dir = f.replaceAll("\\", "/").split("/").slice(0, -1).join("/");
        let m = dirCounts.get(dir);
        if (!m) dirCounts.set(dir, (m = new Map()));
        m.set(c.id, (m.get(c.id) ?? 0) + 1);
      }
    }
    let catchAll = CLUSTERS.find((c) => c.repo === repo && c.catchAll) ?? null;
    for (const f of files) {
      if (owned.has(f)) continue;
      let dir = f.split("/").slice(0, -1).join("/");
      let targetId = null;
      while (!targetId && dir !== null) {
        const m = dirCounts.get(dir);
        if (m) targetId = [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
        dir = dir.includes("/") ? dir.split("/").slice(0, -1).join("/") : dir === "" ? null : "";
      }
      if (targetId) {
        const c = repoClusters.find((x) => x.id === targetId);
        (c.files ??= []).push(f);
      } else {
        if (!catchAll) {
          catchAll = {
            id: repo.includes("extras") ? "E0" : "I0",
            repo,
            label: "unassigned growth (auto-owned)",
            files: [],
            catchAll: true,
          };
          CLUSTERS.push(catchAll);
        }
        catchAll.files.push(f);
        targetId = catchAll.id;
      }
      assigned.push(`${repo}/${f} -> ${targetId}`);
    }
  }
  return assigned;
}

const autoOwned = assignOwnership();
if (autoOwned.length) {
  note(`auto-owned ${autoOwned.length} file(s) no cluster listed (audited this run; consider adopting into clusters.json):`);
  for (const line of autoOwned) note(`  + ${line}`);
} else {
  note(`coverage: every git-visible .mjs/.hbs/.css is explicitly owned by a cluster`);
}
if (CHECK_ONLY) process.exit(0);

const statePath = path.join(auditDir, "state.json");
let state = null;
if (!FULL && fs.existsSync(statePath)) {
  try {
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch (err) {
    note(`WARN state.json unreadable (${err.message}) — falling back to a full sweep`);
  }
}

const heads = {};
for (const [repo, root] of Object.entries(REPOS)) heads[repo] = headOf(root);

let selected;
let mode;
let changedByRepo = {};

if (onlyClusters.length) {
  mode = "explicit";
  selected = CLUSTERS.filter((c) => onlyClusters.includes(c.id));
  const unknown = onlyClusters.filter((id) => !CLUSTERS.some((c) => c.id === id));
  if (unknown.length) {
    note(`ERROR unknown cluster id(s): ${unknown.join(", ")}`);
    process.exit(1);
  }
} else if (!state || FULL) {
  mode = "full";
  selected = CLUSTERS;
  note(FULL ? "mode: full (--full)" : "mode: full (no usable state.json — first run)");
} else {
  mode = "delta";
  const touched = new Set();
  for (const [repo, root] of Object.entries(REPOS)) {
    const since = state?.[repo]?.lastSweptSha;
    if (!since) {
      note(`${repo}: no recorded sha — sweeping all of its clusters`);
      for (const c of CLUSTERS.filter((x) => x.repo === repo)) touched.add(c.id);
      continue;
    }
    let changed;
    try {
      changed = git(root, ["diff", "--name-only", `${since}`, "HEAD"]).split("\n").filter(Boolean);
    } catch (err) {
      note(`WARN ${repo}: git diff from ${since.slice(0, 8)} failed (${err.message.split("\n")[0]}) — sweeping all of its clusters`);
      for (const c of CLUSTERS.filter((x) => x.repo === repo)) touched.add(c.id);
      continue;
    }
    // Uncommitted work is real code the user is building on — audit it too.
    let dirty = [];
    try {
      dirty = git(root, ["status", "--porcelain"])
        .split("\n").filter(Boolean)
        .map((line) => line.slice(3).trim())
        .filter(Boolean);
    } catch {
      /* a clean-status failure is not worth aborting over */
    }
    const all = [...new Set([...changed, ...dirty])].map((f) => f.replaceAll("\\", "/"));
    changedByRepo[repo] = all;
    for (const c of CLUSTERS.filter((x) => x.repo === repo)) {
      if (filesOf(c).some((owned) => all.includes(owned.replaceAll("\\", "/")))) touched.add(c.id);
    }
    note(`${repo}: ${all.length} changed file(s) since ${since.slice(0, 8)}`);
  }
  selected = CLUSTERS.filter((c) => touched.has(c.id));
}

/* ------------------------------------------------------------ the lens ---- */

const lens = resolveLens(lensNames);
const lensLabel = lensNames.length ? lensNames.join("+") : "all";
const CHECKED = new Set(lens.categories);
const skippedCategories = ALL_CATEGORY_IDS.filter((id) => !CHECKED.has(id));

// Only the groups/items the lens selected reach the workflow's prompts.
const selectedGroups = GROUPS
  .map((g) => ({ group: g.group, slug: g.slug, items: g.items.filter(([id]) => CHECKED.has(id)) }))
  .filter((g) => g.items.length);

if (lens.surfaces) {
  const before = selected.length;
  selected = selected.filter((c) => lens.surfaces.includes(c.surface ?? "scripts"));
  const dropped = before - selected.length;
  if (dropped) {
    note(`lens ${lensLabel}: restricted to ${lens.surfaces.join("+")} clusters — ${dropped} cluster(s) skipped as unable to carry these categories`);
  }
}
if (skippedCategories.length) {
  note(`lens ${lensLabel}: checking ${lens.categories.length}/${ALL_CATEGORY_IDS.length} categories; ${skippedCategories.length} NOT checked this run (reported as "not checked", never as clean)`);
}

/* Wiki vocabulary is only re-extracted when a selected cluster could actually
 * carry a rules-vocabulary finding, AND the lens actually checks that category.
 * The snapshot never changes on its own, so a cached list from a previous run is
 * as good as a fresh one — and skipping the two extraction agents is most of a
 * delta run's savings. */
const VOCAB_RELEVANT = new Set(["E1", "E2", "E5", "E6", "E9", "E11", "E13", "I3", "I4", "I5", "I7", "I8"]);
const cachePath = path.join(auditDir, "wiki-vocab.json");
let vocabCache = null;
if (fs.existsSync(cachePath)) {
  try {
    vocabCache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  } catch {
    note("WARN wiki-vocab.json unreadable — will re-extract");
  }
}
const needVocab = CHECKED.has("rules-vocabulary-gap") && selected.some((c) => VOCAB_RELEVANT.has(c.id));
const reuseVocab = Boolean(vocabCache) && mode !== "full";

const payload = {
  mode,
  auditDir,
  heads,
  lens: lensLabel,
  categoryGroups: selectedGroups,
  checkedCategories: lens.categories,
  skippedCategories,
  allCategories: ALL_CATEGORY_IDS,
  clusters: selected.map((c) => ({
    id: c.id,
    repo: c.repo,
    root: REPOS[c.repo],
    label: c.label,
    files: c.files ?? null,
    partial: c.partial ?? null,
    toolingCluster: Boolean(c.toolingCluster),
    surface: c.surface ?? "scripts",
  })),
  allClusterIds: CLUSTERS.map((c) => c.id),
  sweptClusterIds: selected.map((c) => c.id),
  carriedClusterIds: CLUSTERS.map((c) => c.id).filter((id) => !selected.some((c) => c.id === id)),
  extractVocab: needVocab && !reuseVocab,
  vocab: reuseVocab ? vocabCache : null,
  autoOwnedFiles: autoOwned,
  agentModel,
};

note(
  `plan: mode=${mode} lens=${lensLabel} categories=${lens.categories.length}/${ALL_CATEGORY_IDS.length}` +
    ` clusters=${selected.length}/${CLUSTERS.length}` +
    ` (${selected.map((c) => c.id).join(",") || "none"})` +
    ` vocab=${payload.extractVocab ? "extract" : reuseVocab ? "cached" : "not needed"}`
);

/* ------------------------------------------------- emit a runnable script --- */

/* The plan is ~20 KB of JSON. Handing it to Workflow as `args` means a human or
 * an agent retyping it into a tool call, where one mangled character — an em
 * dash, an HTML-escaped ampersand, an object that arrives stringified — fails in
 * a way that looks like the script itself is broken. So instead we write a
 * self-contained copy of the workflow with the plan baked in as a literal, and
 * print its path. A path cannot be mistranscribed. */
function emitRunnable() {
  const template = fs.readFileSync(path.join(HERE, "sweep.workflow.mjs"), "utf8");
  const SLOT = "const BAKED_PLAN = null // ACKS_SWEEP_PLAN_SLOT";
  if (!template.includes(SLOT)) {
    note(`ERROR sweep.workflow.mjs is missing its plan slot line — cannot generate a runnable script.`);
    note(`Expected to find, verbatim: ${SLOT}`);
    process.exit(1);
  }
  // JSON is a valid JS expression except for these two raw line terminators,
  // which are legal in JSON strings but break a JS source literal.
  const literal = JSON.stringify(payload, null, 2).replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
  const generated = template.replace(SLOT, `const BAKED_PLAN = ${literal}`);
  const runDir = path.join(auditDir, "run");
  fs.mkdirSync(runDir, { recursive: true });
  // Stable filename: Workflow's resumeFromRunId requires the same scriptPath,
  // and a stable name keeps the audit dir from filling with generated copies.
  const out = path.join(runDir, "sweep.run.mjs");
  fs.writeFileSync(out, generated, "utf8");
  return out.replaceAll("\\", "/");
}

if (!selected.length) {
  note(
    lens.surfaces
      ? "No selected cluster can carry this lens's categories — widen the lens or pass --full."
      : "Nothing changed since the last sweep — no workflow run needed."
  );
  note("No runnable script written; there is nothing to sweep.");
} else {
  const runPath = emitRunnable();
  note("");
  note(`RUN: ${runPath}`);
  note(`Pass that to the Workflow tool as scriptPath, with NO args:`);
  note(`  Workflow({ scriptPath: "${runPath}" })`);
}

// stdout stays the raw plan, for inspection or a programmatic caller.
process.stdout.write(JSON.stringify(payload, null, 2));
