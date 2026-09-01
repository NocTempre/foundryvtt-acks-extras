/**
 * Build the chef's neighborhood database — a QUERYABLE, READ-ONLY view of the
 * ability corpus, so a chef recipe-ing one entry can see every relationship
 * that touches it (aliases, refs, capability providers, merge-group siblings,
 * similarity scores) without reading 460 JSON entries.
 *
 * DIRECTION OF DATA FLOW IS THE DESIGN. The register in git is canon; this
 * database is a MATERIALIZED VIEW of it, regenerated per sweep and never
 * hand-edited. Chefs query it; they still propose recipes as JSON and the
 * merge gate still re-verifies. If the DB and the register disagree, the DB
 * is stale — `meta` carries the build time and git head so a chef can check.
 *
 * DEV-ONLY, and written OUTSIDE the repo like every audit artifact: with
 * `--packages` it ingests audit-dump packages, which carry licensed book
 * text. Same rule, same guard, no exceptions for a DB built without prose —
 * consistency beats cleverness.
 *
 * Usage:
 *   node tools/build-chefdb.mjs <outFile.db-OUTSIDE-repo>
 *        [--packages <dir>]     fold in audit-dump packages (prose + geometry)
 *        [--similarity <file>]  fold in dupe-hunt output (similarity pairs)
 *
 * Uses node:sqlite (built into Node >= 22); no new dependencies.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const COOKBOOK = path.join(ROOT, "cookbook");
const REGISTER = path.join(ROOT, "register");

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1];
};
const outArg = argv.find((a) => !a.startsWith("--") && a !== flag("--packages") && a !== flag("--similarity"));
if (!outArg) {
  console.error("usage: node tools/build-chefdb.mjs <outFile.db> [--packages <dir>] [--similarity <file>]");
  process.exit(1);
}
const outFile = path.resolve(outArg);
if (outFile.startsWith(ROOT + path.sep)) {
  console.error(`refusing: ${outFile} is inside the repo — chef databases may carry book text and must never be committable`);
  process.exit(1);
}

/* ---------------------------------------------- */
/*  Load canon                                    */
/* ---------------------------------------------- */

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

/** Compiled cookbook entries: the merged, shipping view of every definition. */
const cookbooks = {};
for (const f of fs.readdirSync(COOKBOOK)) {
  if (!f.endsWith(".json") || ["registers.json", "index.json"].includes(f)) continue;
  cookbooks[f.replace(/\.json$/, "")] = readJson(path.join(COOKBOOK, f));
}

/** Register rows: the authored side — audit dates, assists, auditor names. */
const registerRows = new Map();
const walkRegister = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!e.name.startsWith("_")) walkRegister(abs);
      continue;
    }
    if (!e.name.endsWith(".json")) continue;
    let rows;
    try {
      rows = readJson(abs);
    } catch {
      continue;
    }
    if (!Array.isArray(rows)) continue;
    for (const r of rows) if (typeof r?.id === "string") registerRows.set(r.id, { ...r, _file: path.relative(ROOT, abs) });
  }
};
walkRegister(REGISTER);

/* ---------------------------------------------- */
/*  Schema                                        */
/* ---------------------------------------------- */

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.rmSync(outFile, { force: true });
const db = new DatabaseSync(outFile);
db.exec(`
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);

  -- One row per definition or monster the cookbook ships.
  CREATE TABLE entries (
    id TEXT PRIMARY KEY, name TEXT, kind TEXT, book TEXT, file TEXT, cite TEXT,
    pages TEXT, category TEXT, general INTEGER, repeatable INTEGER,
    power_value REAL, deprecated INTEGER, alias_of TEXT, replaced_by TEXT,
    audited INTEGER, audited_date TEXT, auditor TEXT, register_file TEXT,
    icon TEXT, icon_niche TEXT
  );

  -- Every typed relationship, both authored and structural. Querying "the
  -- neighborhood of X" is one select over this instead of a corpus read.
  CREATE TABLE edges (src TEXT, rel TEXT, dst TEXT, note TEXT);
  CREATE INDEX idx_edges_src ON edges(src);
  CREATE INDEX idx_edges_dst ON edges(dst);

  -- Chef-authored effect/roll specs (what the recipe states; values are
  -- locators, never numbers — same invariant as everywhere else).
  CREATE TABLE authored_effects (
    entry_id TEXT, idx INTEGER, type TEXT, target TEXT, applies_to TEXT,
    mode TEXT, condition TEXT, note TEXT, spec_json TEXT
  );
  CREATE TABLE authored_rolls (
    entry_id TEXT, key TEXT, condition TEXT, note TEXT, spec_json TEXT
  );

  -- Text-similarity pairs from dupe-hunt, and the merge groups they imply.
  CREATE TABLE similarity (a TEXT, b TEXT, score REAL, tag TEXT);
  CREATE TABLE merge_groups (group_id INTEGER, entry_id TEXT);

  -- Only populated with --packages (audit-dump output). Licensed text: the
  -- whole DB already lives outside the repo for exactly this reason.
  CREATE TABLE prose (entry_id TEXT, idx INTEGER, text TEXT);
  CREATE TABLE extracted_effects (entry_id TEXT, idx INTEGER, effect_json TEXT);
  CREATE TABLE extracted_rolls (entry_id TEXT, idx INTEGER, roll_json TEXT);

  -- Both directions of every edge, so "everything touching X" is one WHERE.
  CREATE VIEW neighborhood AS
    SELECT src AS entry_id, 'out' AS direction, rel, dst AS other, note FROM edges
    UNION ALL
    SELECT dst AS entry_id, 'in' AS direction, rel, src AS other, note FROM edges;
`);

/* ---------------------------------------------- */
/*  Populate                                      */
/* ---------------------------------------------- */

let head = "unknown";
try {
  head = execFileSync("git", ["-C", ROOT, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
} catch {
  /* not fatal */
}
const putMeta = db.prepare("INSERT INTO meta VALUES (?, ?)");
putMeta.run("built_at", new Date().toISOString());
putMeta.run("git_head", head);
putMeta.run("note", "GENERATED read-only view of register+cookbook. Regenerate rather than edit; if it disagrees with the register, it is stale.");

const insEntry = db.prepare(`INSERT INTO entries VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const insEdge = db.prepare("INSERT INTO edges VALUES (?,?,?,?)");
const insAE = db.prepare("INSERT INTO authored_effects VALUES (?,?,?,?,?,?,?,?,?)");
const insAR = db.prepare("INSERT INTO authored_rolls VALUES (?,?,?,?,?)");

let entryCount = 0;
let edgeCount = 0;
const edge = (src, rel, dst, note = null) => {
  insEdge.run(src, rel, dst, note);
  edgeCount++;
};

for (const [file, cb] of Object.entries(cookbooks)) {
  const isMonsterBook = !["proficiencies", "powers", "skills"].includes(file);
  for (const [id, e] of Object.entries(cb.entries ?? {})) {
    const reg = registerRows.get(id) ?? {};
    const meta = e.meta ?? {};
    insEntry.run(
      id, e.name ?? null, isMonsterBook ? "monster" : (meta.category ?? "proficiency"),
      e.book ?? (isMonsterBook ? file : null), file, e.cite ?? null,
      JSON.stringify(e.pages ?? []), meta.category ?? null,
      meta.general ? 1 : 0, meta.repeatable ? 1 : 0,
      meta.powerValue ?? null, meta.deprecated ? 1 : 0,
      e.aliasOf ?? null, meta.replacedBy ?? null,
      e.audited ? 1 : 0, reg.audited ?? null, reg.auditor ?? null, reg._file ?? null,
      e.icon ?? null, e.iconNiche ?? null,
    );
    entryCount++;

    if (e.aliasOf) edge(id, "aliasOf", e.aliasOf);
    if (meta.replacedBy) edge(id, "replacedBy", meta.replacedBy);
    for (const t of meta.notStacksWith ?? []) edge(id, "notStacksWith", t);
    for (const t of meta.provides ?? []) edge(id, "provides", t);
    for (const t of meta.requires ?? []) edge(id, "requires", t);

    // Authored specs: flatten the queryable columns, keep the whole spec as
    // JSON so nothing is lost to the flattening.
    (e.fields?.effects?.specs ?? []).forEach((s, i) => {
      insAE.run(id, i, s.type ?? null, s.target ?? null, s.appliesTo ?? null, s.mode ?? null, s.condition ?? null, s.note ?? null, JSON.stringify(s));
      if (s.ref) edge(id, `effect:${s.type ?? "?"}`, s.ref);
      for (const r of s.refs ?? []) edge(id, `effect:${s.type ?? "?"}`, r);
      for (const r of s.ifHas ?? []) edge(id, "effect:ifHas", r);
      for (const r of s.notStacksWith ?? []) edge(id, "effect:notStacksWith", r);
      for (const r of s.stacksWith ?? []) edge(id, "effect:stacksWith", r);
    });
    (e.fields?.rolls?.specs ?? []).forEach((s) => insAR.run(id, s.key ?? null, s.condition ?? null, s.note ?? null, JSON.stringify(s)));
  }
}

/* --- similarity pairs (dupe-hunt output) + merge groups --- */
const simFile = flag("--similarity");
const insSim = db.prepare("INSERT INTO similarity VALUES (?,?,?,?)");
let simCount = 0;
if (simFile && fs.existsSync(simFile)) {
  // Map "Name [file/book CITE]" back to ids via name+cite (names collide; the
  // cite disambiguates — the same trap the icon pass fell into).
  const byNameCite = new Map();
  const all = db.prepare("SELECT id, name, cite FROM entries").all();
  for (const r of all) byNameCite.set(`${r.name}|${r.cite}`, r.id);
  const re = /^([\d.]+) (\S+)\s+(.+?) \[\w+\/\w+ (.+?)\]  ==  (.+?) \[\w+\/\w+ (.+?)\]$/;
  for (const line of fs.readFileSync(simFile, "utf8").split(/\r?\n/)) {
    const m = re.exec(line.trim());
    if (!m) continue;
    const a = byNameCite.get(`${m[3]}|${m[4]}`);
    const b = byNameCite.get(`${m[5]}|${m[6]}`);
    if (a && b) {
      insSim.run(a, b, Number(m[1]), m[2]);
      simCount++;
    }
  }
}

// Merge groups: union-find over alias links + similarity >= 0.45 — the same
// grouping that built CANDIDATES.md, recomputed here so the DB is
// self-consistent with its own similarity table.
const parent = new Map();
const find = (x) => {
  if (!parent.has(x)) parent.set(x, x);
  let r = x;
  while (parent.get(r) !== r) r = parent.get(r);
  parent.set(x, r);
  return r;
};
const union = (a, b) => parent.set(find(a), find(b));
for (const r of db.prepare("SELECT src, dst FROM edges WHERE rel='aliasOf'").all()) union(r.src, r.dst);
for (const r of db.prepare("SELECT a, b FROM similarity WHERE score >= 0.45").all()) union(r.a, r.b);
const groups = new Map();
for (const key of parent.keys()) {
  const root = find(key);
  (groups.get(root) ?? groups.set(root, []).get(root)).push(key);
}
const insGroup = db.prepare("INSERT INTO merge_groups VALUES (?,?)");
let gid = 0;
let grouped = 0;
for (const members of groups.values()) {
  if (members.length < 2) continue;
  gid++;
  for (const m of members) {
    insGroup.run(gid, m);
    grouped++;
  }
}

/* --- audit packages (prose + extracted mechanics), optional --- */
const pkgDir = flag("--packages");
const insProse = db.prepare("INSERT INTO prose VALUES (?,?,?)");
const insEE = db.prepare("INSERT INTO extracted_effects VALUES (?,?,?)");
const insER = db.prepare("INSERT INTO extracted_rolls VALUES (?,?,?)");
let pkgCount = 0;
if (pkgDir && fs.existsSync(pkgDir)) {
  for (const f of fs.readdirSync(pkgDir)) {
    if (!f.endsWith(".json")) continue;
    let pkg;
    try {
      pkg = readJson(path.join(pkgDir, f));
    } catch {
      continue;
    }
    if (!pkg?.id) continue;
    (pkg.extracted?.description ?? []).forEach((t, i) => insProse.run(pkg.id, i, t));
    (pkg.extracted?.effects ?? []).forEach((e, i) => insEE.run(pkg.id, i, JSON.stringify(e)));
    (pkg.extracted?.rolls ?? []).forEach((r, i) => insER.run(pkg.id, i, JSON.stringify(r)));
    pkgCount++;
  }
}

/* ---------------------------------------------- */
/*  Report + integrity                            */
/* ---------------------------------------------- */

// The FK check the JSON pipeline does piecemeal, done exhaustively here:
// every edge whose target is neither a known entry nor a capability token.
const dangling = db
  .prepare(`SELECT src, rel, dst FROM edges WHERE dst NOT LIKE 'kw:%' AND dst NOT IN (SELECT id FROM entries)`)
  .all();

console.error(`chef.db built at ${outFile} (git ${head})`);
console.error(`  entries: ${entryCount} | edges: ${edgeCount} | similarity pairs: ${simCount} | merge groups: ${gid} (${grouped} entries)`);
console.error(`  packages folded in: ${pkgCount}${pkgDir && !pkgCount ? " (dir empty or unreadable?)" : ""}`);
if (dangling.length) {
  console.error(`  DANGLING refs (${dangling.length}) — real defects, report them:`);
  for (const d of dangling.slice(0, 10)) console.error(`    ${d.src} -[${d.rel}]-> ${d.dst}`);
} else {
  console.error("  referential integrity: every edge resolves.");
}
db.close();
