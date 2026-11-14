/**
 * Module-owned validation, run last by `tools/validate.mjs` (its last section).
 *
 * ## The declared-table gate
 *
 * A ruledata document has two halves that must agree: the keys a feature
 * READS out of the registry, and the keys `expectTables` DECLARES for that
 * document. The declaration is not decoration — it is the whole import
 * surface. It is what the importer lists as outstanding, what a Judge sees as
 * "not yet imported", and therefore the only route by which a printed value
 * ever reaches a reader.
 *
 * So a key read but not declared is a reader that can never be fed: the
 * coverage report says the document is complete while the derivation behind it
 * silently answers null forever. That is the same defect as a schema nobody
 * can populate, arriving from the other direction, and it is invisible to
 * every other check — the code runs, the tests pass, the table is simply
 * always absent.
 *
 * The rule: within a file holding a doc-bound `table()` helper, every
 * `table("literal")` key must appear in that document's `expectTables` list.
 * A computed key is reported and skipped, because a static reader cannot know
 * what it resolves to.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const notes = [];

/** Every .mjs under scripts/, with its text. */
function sources(dir = path.join(ROOT, "scripts"), out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) sources(full, out);
    else if (e.name.endsWith(".mjs")) out.push({ file: full, text: fs.readFileSync(full, "utf8") });
  }
  return out;
}

const files = sources();
const rel = (f) => path.relative(ROOT, f).split(path.sep).join("/");
const ALL = files.map((f) => f.text).join("\n");

/* --- 1. Resolve doc-id constants to their string values ------------------ */
const docIdOf = new Map();
for (const { text } of files) {
  for (const m of text.matchAll(/^export const ([A-Z0-9_]*DOC(?:_ID)?)\s*=\s*"([^"]+)"/gm)) {
    docIdOf.set(m[1], m[2]);
  }
}

/* --- 2. Collect every expectTables declaration --------------------------- */
const declared = new Map();      // doc id -> Set of declared keys
const declaredAt = new Map();    // doc id -> where it was declared
for (const { file, text } of files) {
  const call = /expectTables\??\.?\(\s*(?:"([^"]+)"|([A-Za-z0-9_]+))\s*,\s*([\s\S]*?)\)\s*;/g;
  for (const m of text.matchAll(call)) {
    const doc = m[1] ?? docIdOf.get(m[2]);
    if (!doc) continue;
    const body = m[3];
    const keys = [...body.matchAll(/"([^"]+)"/g)].map((k) => k[1]);
    // A list passed as a bare identifier (a shared const array) is resolved by
    // name across the tree; one that still cannot be read is noted, not failed.
    if (!keys.length) {
      const ident = /^([A-Za-z0-9_]+)$/.exec(body.trim());
      if (ident) {
        const arr = new RegExp(`const ${ident[1]}\\s*=\\s*(?:Object\\.freeze\\()?\\[([\\s\\S]*?)\\]`).exec(ALL);
        if (arr) for (const k of arr[1].matchAll(/"([^"]+)"/g)) keys.push(k[1]);
      }
      if (!keys.length) {
        notes.push(`${rel(file)}: expectTables(${doc}, …) list could not be read statically`);
        continue;
      }
    }
    if (!declared.has(doc)) { declared.set(doc, new Set()); declaredAt.set(doc, rel(file)); }
    for (const k of keys) declared.get(doc).add(k);
  }
}

/* --- 3. Every doc-bound table() helper, and what it reads ---------------- */
for (const { file, text } of files) {
  const bind = /getDoc\(\s*([A-Za-z0-9_]+)\s*\)\s*\??\.?\s*tables\s*\?\.\s*\[/.exec(text);
  if (!bind) continue;
  // Literal keys are the only checkable claim. A document read purely by a
  // computed slug — an open registry whose key set is the world's to choose —
  // declares nothing this gate could compare, so it is not this gate's
  // business either way.
  const literals = [...text.matchAll(/\btable\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]);
  if (!literals.length) continue;

  const doc = docIdOf.get(bind[1]);
  if (!doc) { notes.push(`${rel(file)}: table helper bound to unresolved ${bind[1]}`); continue; }
  if (!declared.has(doc)) {
    errors.push(`${rel(file)} reads document "${doc}", but nothing declares it with expectTables `
      + "— no importer surface can ever populate it");
    continue;
  }
  const known = declared.get(doc);
  const missing = new Set(literals.filter((k) => !known.has(k)));
  // A computed read INSIDE a file that also reads literally is worth naming:
  // the declaration cannot cover what it resolves to. The helper's own
  // definition is not a call, so it is not counted.
  for (const m of text.matchAll(/(?<!function\s)\btable\(\s*([A-Za-z_$][A-Za-z0-9_.$]*)\s*\)/g)) {
    notes.push(`${rel(file)}: table(${m[1]}) is computed — not checkable statically`);
  }
  for (const key of [...missing].sort()) {
    errors.push(
      `${rel(file)} reads table("${key}") from "${doc}", but expectTables in `
      + `${declaredAt.get(doc)} does not declare it — the importer will never `
      + "offer it, so the reader answers null forever",
    );
  }
}

/* --- 4. No i18n key is both a leaf and a parent --------------------------
   Foundry expands a flat dotted key into nested objects. If one key holds a
   STRING at a path another key needs as a PARENT, the expansion hits a string
   where it wants an object and drops the WHOLE language file — every string in
   the module renders as its raw key, with no error logged anywhere.

   That is a module-wide breakage from one added key, it survives `JSON.parse`
   (the file is perfectly valid JSON), and no other check looks for it. It cost
   a release-day debug: `reason.road` was a label, and re-keying road factors
   as `road.plain` / `road.driver` made it a parent as well. */
{
  const langPath = path.join(ROOT, "lang", "en.json");
  if (fs.existsSync(langPath)) {
    let lang = null;
    try {
      lang = JSON.parse(fs.readFileSync(langPath, "utf8"));
    } catch (err) {
      errors.push(`lang/en.json does not parse: ${err.message}`);
    }
    if (lang) {
      // Flatten nested objects the way Foundry does, so a conflict between a
      // nested branch and a flat key is caught too.
      const leaves = new Set();
      const paths = new Set();
      const walk = (node, prefix) => {
        for (const [k, v] of Object.entries(node)) {
          const full = prefix ? `${prefix}.${k}` : k;
          paths.add(full);
          if (v && typeof v === "object" && !Array.isArray(v)) walk(v, full);
          else leaves.add(full);
        }
      };
      walk(lang, "");

      for (const full of paths) {
        const parts = full.split(".");
        for (let i = 1; i < parts.length; i++) {
          const prefix = parts.slice(0, i).join(".");
          if (leaves.has(prefix)) {
            errors.push(
              `lang/en.json: "${prefix}" holds a string but "${full}" needs it as a parent — `
              + "Foundry drops the ENTIRE language file on this, so every string in the module "
              + "renders as its raw key. Rename one of the two.",
            );
          }
        }
      }
    }
  }
}

/* --- 4b. Every live walk reports its own end ------------------------------
   The runner reads a walk as passed only where it printed `WALK END`
   (`tools/walk-results.mjs` `reduce`), so a walk that never calls `walkDone()`
   from `tools/live/_walk.mjs` reduces to stopped on every run, however green.
   A walk is every `tools/live/*.mjs` but `run.mjs` and the `_` helpers. */
{
  const live = path.join(ROOT, "tools", "live");
  const walks = fs.existsSync(live) ? fs.readdirSync(live).filter((f) => f.endsWith(".mjs") && !f.startsWith("_") && f !== "run.mjs") : [];
  for (const f of walks) {
    const text = fs.readFileSync(path.join(live, f), "utf8");
    const imports = /import\s*\{[^}]*\bwalkDone\b[^}]*\}\s*from\s*["']\.\/_walk\.mjs["']/.test(text);
    const calls = (text.match(/\bwalkDone\(\);/g) ?? []).length;
    if (!imports || calls !== 1) errors.push(`tools/live/${f}: a walk imports walkDone from ./_walk.mjs and calls it once, as the last statement of its try (imports: ${imports}, calls: ${calls})`);
  }
}

for (const n of notes) console.log(`  note: ${n}`);
if (errors.length) {
  for (const e of errors) console.error(`  FAIL: ${e}`);
  console.error(`\nvalidate-extra: ${errors.length} problem(s)`);
  process.exit(1);
}
console.log(`  ok: every registry read is declared (${declared.size} document(s)); no i18n path conflicts`);

/* §1–§4b run in this process: the declared-table gate (§1–§3), the i18n
   leaf/parent check (§4) and the live-walk end report (§4b). §5–§11 are
   processes of their own. Each reads the repository and none reads what
   another writes, so they are listed here and run side by side below, every
   one to its end. §12 runs in this process just before them and only reports. */
const apart = [];

/* --- 5. The importer subsystem's own gates --------------------------------
   register lint, icon ledger, cookbook drift — run from its own
   tools directory. Non-zero exit here fails validation the same way. */
apart.push([path.join(ROOT, "tools", "importer", "validate-extra.mjs")]);

/* --- 6. The docs site's staging gate --------------------------------------
   `pages.yml` fires on every push with no `paths:` filter, so a guide the
   sidebar does not name fails CI on the release commit and on every push
   after it. The release procedure tells a session a green `npm run validate`
   already covers this; that is only true while this chain is here. */
apart.push([path.join(ROOT, "docs", "site", "tools", "sync.mjs")]);

/* --- 7. Free variables in the runtime and the tooling ----------------------
   An identifier no enclosing scope binds. `node --check` (§1) parses and is
   satisfied, because a free variable is legal JavaScript that throws only
   when its line is reached — so the defect ships inside an uncalled branch
   and dies in a world. Node's bundled acorn is reachable only behind
   `--expose-internals`, which NODE_OPTIONS refuses, so it arrives by one
   re-exec per tree. */
for (const [dir, allow] of [["scripts", "free-variables-browser.json"], ["tools", "free-variables-node.json"]]) {
  apart.push(["--expose-internals", path.join(ROOT, "tools", "free-variables.mjs"), path.join(ROOT, dir), `--allow=${path.join(ROOT, "tools", allow)}`]);
}

/* --- 8. Every ruledata read has a producer --------------------------------
   §1–3 prove a read is declared; a declaration nothing keeps is the same
   always-null reader arriving one step later. `validate-producers.mjs` proves
   something writes each read table: a recipe, a binding's assembled table, a
   registry, or a sample. */
apart.push([path.join(ROOT, "tools", "validate-producers.mjs")]);

/* --- 9. No interface text or comment names a retired macro ----------------
   §6 holds prose to the macro pack's names; `validate-macro-names.mjs` holds
   the language strings, the strings and the comments in scripts/ and the pack
   documents' own fields to them. It reads a script's strings and comments
   from a parse, so it re-execs behind `--expose-internals` as §7 does. Where
   git has no history of the pack source to read, as in a shallow checkout, it
   prints a note and passes. */
apart.push(["--expose-internals", path.join(ROOT, "tools", "validate-macro-names.mjs")]);

/* --- 10. Book-specific code stays in its silo -----------------------------
   A silo owns book ids and the files written for them. `check-silos.mjs` holds
   every other file to four rules (imports, literals, closure, agreement)
   against `tools/importer/silo-baseline.json`, which only shrinks. It parses
   with the same bundled acorn as §7, so it re-execs behind `--expose-internals`. */
apart.push(["--expose-internals", path.join(ROOT, "tools", "importer", "check-silos.mjs")]);

/* --- 11. Every named import exists in the module it names -----------------
   A wrong name throws at load in the browser and nowhere else; `node --check`
   (§1) parses an import it cannot resolve and is satisfied. A failure here
   fails validation. */
apart.push([path.join(ROOT, "tools", "audit-imports.mjs")]);

{
  const { sideBySide } = await import("./side-by-side.mjs");
  const { spawnSync } = await import("node:child_process");

  /* --- 12. Style audit: reported, never failing ------------------------------
     `audit-styles.mjs` finds classes no stylesheet mentions and design tokens
     read without being declared. It carries open findings, so its exit status
     is ignored here and only its problem count and where to read them are
     printed. Run `node tools/audit-styles.mjs` for the list. */
  {
    const styles = spawnSync(process.execPath, [path.join(ROOT, "tools", "audit-styles.mjs")], { cwd: ROOT, encoding: "utf8" });
    const count = /audit-styles: (\d+) problem/.exec(`${styles.stdout}${styles.stderr}`)?.[1];
    if (count) console.log(`  note: audit-styles reports ${count} problem(s), not failing validation — run \`node tools/audit-styles.mjs\` for the list`);
    else if (styles.status === 0) console.log("  ok: audit-styles reports no problems");
    else console.log(`  note: audit-styles did not run to a verdict (status ${styles.status}) — run \`node tools/audit-styles.mjs\``);
  }

  const failed = (await sideBySide(apart, { cwd: ROOT })).filter((check) => check.status !== 0);
  if (failed.length) {
    const name = (check) => path.relative(ROOT, check.args.find((arg) => arg.endsWith(".mjs"))).split(path.sep).join("/");
    console.error(`\nvalidate-extra: FAILED — ${failed.map(name).join(", ")}`);
    process.exit(1);
  }
}
