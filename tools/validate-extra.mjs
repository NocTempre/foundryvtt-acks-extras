/**
 * Module-owned extra validation, run last by the canonical tools/validate.mjs.
 *
 * Two jobs:
 *  1. the offline flow tests (transfer / deploy / reform / cleanup against
 *     mocked Foundry globals), so no release ships a broken party lifecycle;
 *  2. merge guards — checks that exist because this module is eight modules
 *     folded into one, and the ways that can go wrong are all silent. Each of
 *     these caught, or would have caught, a real defect during the merge.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
let failed = false;
const fail = (msg) => {
  console.error(`FAIL validate-extra: ${msg}`);
  failed = true;
};

const walk = (d) =>
  fs.existsSync(d)
    ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]
      )
    : [];
const rel = (f) => path.relative(ROOT, f).split(path.sep).join("/");

/* -------------------------------------------------------------------------- */
/* 1. No stale family ids.                                                     */
/*                                                                             */
/* The merge rewrote every module id, flag scope, global and sub-type. A single */
/* survivor is invisible: `getFlag("acks-equipment", …)` just returns undefined */
/* and `game.modules.get("acks-lib")` is just inactive. Comments and CHANGELOG  */
/* legitimately name the old modules, so only code lines are checked.           */
/* -------------------------------------------------------------------------- */
/* The flags alternative is \b-terminated, not dot-terminated: the pack-data
 * rewrite miss that shipped an inert compendium was `"flags.acks-henchmen"` —
 * scope only, no trailing key — and a dot-anchored pattern cannot see it.
 * The bracketed alternative catches Handlebars segment literals
 * (`item.flags.[acks-monsters]`), whose `[` defeats the \b-terminated form. */
const OLD = /"acks-(lib|abilities|equipment|formation|henchmen|influence|location|monsters)"|\bglobalThis\.acks(Lib|Abilities|Equipment|Formation|Henchmen|Influence|Location|Monsters)\b|flags\.acks-(lib|abilities|equipment|formation|henchmen|influence|location|monsters)\b|flags\.\[acks-(lib|abilities|equipment|formation|henchmen|influence|location|monsters)\]/;
/* Hook and helper names retired when everything moved under acksExtras.* —
 * firing OR listening under one of these is a silent no-op for the other side. */
const RETIRED = /\backsFormation\.|\backsInfluence(RollComplete|AttitudeChanged)\b|\backsMonsters(Val|Has)\b|\backsEquipment(LockPicked|ContainerBashed)\b/;
/* Two files name the old ids as DATA and must not be flagged: this one, and the
 * cleaner macro whose entire job is finding what those modules left behind. */
const NAMES_OLD_IDS_BY_DESIGN = new Set(["tools/validate-extra.mjs", "tools/pack-data/cleanup.mjs"]);
let stale = 0;
/* Templates are scanned too: a stale scope in a .hbs reads undefined and the
 * markup it guards silently never renders, with no error anywhere. */
for (const f of [
  ...walk(path.join(ROOT, "scripts")),
  ...walk(path.join(ROOT, "tools")),
  ...walk(path.join(ROOT, "templates")),
]) {
  if (!f.endsWith(".mjs") && !f.endsWith(".hbs")) continue;
  if (NAMES_OLD_IDS_BY_DESIGN.has(rel(f))) continue;
  fs.readFileSync(f, "utf8").split("\n").forEach((line, i) => {
    if (/^\s*(\*|\/\/|\/\*)/.test(line)) return; // prose
    if (OLD.test(line)) {
      stale++;
      fail(`${rel(f)}:${i + 1} still references a pre-merge module id — ${line.trim().slice(0, 90)}`);
    }
    if (RETIRED.test(line)) {
      stale++;
      fail(`${rel(f)}:${i + 1} uses a retired hook/helper name (now acksExtras.*) — ${line.trim().slice(0, 90)}`);
    }
  });
}

/* -------------------------------------------------------------------------- */
/* 2. Flag calls are correctly shaped.                                         */
/*                                                                             */
/* setFlag throws on a scope that is not an active package, so every scope must */
/* be this module. The two-arg form changes BOTH arguments, and rewriting only  */
/* the scope leaves a call that silently reads the wrong path and returns       */
/* undefined — the highest-yield silent failure in the whole merge.             */
/* "core" and third-party ids are legitimate and allowlisted.                   */
/* -------------------------------------------------------------------------- */
const LITERAL_OK = new Set(['"acks-extras"', '"acks-importer"', '"core"']);
/* Identifier scopes are resolved to their declaration and checked by VALUE, so
 * a constant renamed or repointed cannot slip past a name allowlist. */
const scopeValue = (text, ident) => {
  const m = new RegExp(`(?:const|let|var)\\s+${ident}\\s*=\\s*"([^"]+)"`).exec(text);
  return m ? `"${m[1]}"` : null;
};
for (const f of walk(path.join(ROOT, "scripts"))) {
  if (!f.endsWith(".mjs")) continue;
  const text = fs.readFileSync(f, "utf8");
  // the feature's constants.mjs, wherever the file sits inside the feature
  const feature = rel(f).split("/")[1];
  const constantsPath = path.join(ROOT, "scripts", feature, "constants.mjs");
  const constants = fs.existsSync(constantsPath) ? fs.readFileSync(constantsPath, "utf8") : "";
  for (const m of text.matchAll(/(?:get|set|unset)Flag\??\.?\(\s*([^,)\s]+)\s*,/g)) {
    const scope = m[1];
    if (LITERAL_OK.has(scope)) continue;
    if (scope.startsWith("_")) continue; // a mock's parameter, not a real scope
    const resolved = scopeValue(text, scope) ?? scopeValue(constants, scope);
    if (resolved && LITERAL_OK.has(resolved)) continue;
    if (scope === "MODULE_ID" && /MODULE_ID\s*=\s*"acks-extras"/.test(constants)) continue;
    fail(`${rel(f)}: flag call scope ${scope}${resolved ? ` (= ${resolved})` : ""} is not this module or "core"`);
  }
}

/* -------------------------------------------------------------------------- */
/* 2b. `module.api` is the whole acksExtras namespace.                         */
/*                                                                             */
/* Pre-merge, get("acks-<feature>").api WAS the feature surface. Post-merge it  */
/* is the namespace, and a consumer that reads a feature member straight off it */
/* gets undefined — this silently disabled the influence-hosted henchmen pages */
/* (apiVersion read off the namespace root). Every self-lookup must therefore   */
/* step through a feature key; returning or ?? -defaulting the raw api hands    */
/* the same bug to the caller.                                                  */
/* -------------------------------------------------------------------------- */
const FEATURE_KEY = /^(?:\?\.|\.)(lib|abilities|equipment|formation|henchmen|influence|location|monsters)\b/;
for (const f of [...walk(path.join(ROOT, "scripts")), ...walk(path.join(ROOT, "tools"))]) {
  if (!f.endsWith(".mjs")) continue;
  if (NAMES_OLD_IDS_BY_DESIGN.has(rel(f))) continue;
  const text = fs.readFileSync(f, "utf8");
  const lines = text.split("\n");
  const prose = (i) => /^\s*(\*|\/\/|\/\*)/.test(lines[i] ?? "");
  // (a) direct: game.modules.get(<self>)…api not followed by a feature key.
  for (const m of text.matchAll(/game\.modules\??\.get\??\.?\(\s*([^),\s]+)\s*\)\s*(?:\?\.|\.)api\b(.{0,50})/g)) {
    const lineNo = text.slice(0, m.index).split("\n").length;
    if (prose(lineNo - 1)) continue;
    const arg = m[1];
    const self =
      arg === '"acks-extras"' ||
      arg === "MODULE_ID" ||
      (/^[A-Za-z_$][\w$]*$/.test(arg) && scopeValue(text, arg) === '"acks-extras"');
    if (!self) continue; // unresolvable or genuinely external (e.g. acks-domains)
    if (FEATURE_KEY.test(m[2])) continue;
    fail(`${rel(f)}:${lineNo} reads module.api without a feature key — it is the whole namespace, not a feature`);
  }
  // (b) escaped: reading `module.api` off a variable without a feature key —
  // the shape that let (a) hide inside a helper. Assignments (and comparisons)
  // are exempt, as is anything not code-shaped after `.api` (prose in strings).
  lines.forEach((line, i) => {
    if (prose(i)) return;
    for (const m of line.matchAll(/\bmodule\.api\b(?!\s*=)(?=\s*(?:[?.;):,]|$))(.{0,50})/g)) {
      if (FEATURE_KEY.test(m[1])) continue;
      fail(`${rel(f)}:${i + 1} reads module.api without a feature key — it is the whole namespace, not a feature`);
    }
  });
}

/* -------------------------------------------------------------------------- */
/* 3. One libWrapper registration per target.                                  */
/*                                                                             */
/* libWrapper permits many PACKAGES to wrap one method but not one package to   */
/* register twice for it. Two features doing that was legal as two modules and  */
/* throws as one — and it threw inside a `ready` hook, which silently killed    */
/* everything after it. Features compose through acksExtras.lib.wrapRollAttack  */
/* instead.                                                                     */
/* -------------------------------------------------------------------------- */
const targets = new Map();
for (const f of walk(path.join(ROOT, "scripts"))) {
  if (!f.endsWith(".mjs")) continue;
  const text = fs.readFileSync(f, "utf8");
  for (const m of text.matchAll(/libWrapper\.register\(\s*[^,]+,\s*\n?\s*"([^"]+)"/g)) {
    if (!targets.has(m[1])) targets.set(m[1], []);
    targets.get(m[1]).push(rel(f));
  }
}
for (const [target, files] of targets) {
  if (files.length > 1) {
    fail(`libWrapper target "${target}" registered ${files.length}× (${files.join(", ")}) — one package may only register once`);
  }
}

/* -------------------------------------------------------------------------- */
/* 4. Templates resolve.                                                       */
/*                                                                             */
/* templates/ gained a directory per feature to keep two location-sheet.hbs     */
/* apart, so every path needed a feature segment. A miss only shows as a 404 at */
/* render time — or worse, as an unhandled rejection from a preload, because    */
/* loadTemplates fails async and escapes any try around it. Both the single-    */
/* literal shape and the composed `const T = …dir` + `${T}/x.hbs` shape (which  */
/* is how the henchmen preload shipped a moved template unnoticed) are checked. */
/* -------------------------------------------------------------------------- */
for (const f of walk(path.join(ROOT, "scripts"))) {
  if (!f.endsWith(".mjs")) continue;
  const text = fs.readFileSync(f, "utf8");
  for (const m of text.matchAll(/modules\/\$\{MODULE_ID\}\/(templates\/[^"`\s$]*\.hbs)/g)) {
    if (!fs.existsSync(path.join(ROOT, m[1]))) fail(`${rel(f)}: template not found — ${m[1]}`);
  }
  // composed: const T = `modules/${MODULE_ID}/templates/<feature>`; … `${T}/x.hbs`
  const dirs = new Map();
  for (const m of text.matchAll(/const\s+(\w+)\s*=\s*`modules\/\$\{MODULE_ID\}\/(templates\/[\w./-]*)`/g)) {
    dirs.set(m[1], m[2]);
  }
  if (dirs.size) {
    for (const m of text.matchAll(/\$\{(\w+)\}\/([\w./-]+\.hbs)/g)) {
      const dir = dirs.get(m[1]);
      if (!dir) continue;
      const p = `${dir}/${m[2]}`;
      if (!fs.existsSync(path.join(ROOT, p))) fail(`${rel(f)}: template not found — ${p}`);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* 5. CSS scope classes are alive.                                             */
/*                                                                             */
/* The merge renamed the CSS-hook classes inside JS `classes:` arrays (they     */
/* matched stale module ids) and the stylesheets kept the old scopes — ~255     */
/* rules matched nothing and five sheets rendered unstyled. MERGE-NOTES §4      */
/* names the gap: the old check scanned styles/*.css, never the JS class        */
/* arrays. So: every acks* class token used in a styles/*.css selector must     */
/* occur somewhere in scripts/ or templates/ (vendor/ is upstream, excluded).   */
/* -------------------------------------------------------------------------- */
{
  const surface = [
    ...walk(path.join(ROOT, "scripts")).filter((f) => f.endsWith(".mjs")),
    ...walk(path.join(ROOT, "templates")).filter((f) => f.endsWith(".hbs")),
  ]
    .map((f) => fs.readFileSync(f, "utf8"))
    .join("\n");
  /* A token is also alive when code BUILDS it from a stem — `grip--${state}`,
   * `acksm-enc-{{encumbrance.state}}` — so every separator-cut prefix is
   * tried against an interpolation start before the token is called dead. */
  const live = (token) => {
    if (new RegExp(`\\b${token}\\b`).test(surface)) return true;
    for (let i = token.length - 1; i > 0; i--) {
      if (token[i] !== "-" && token[i] !== "_") continue;
      const stem = token.slice(0, i + 1);
      if (surface.includes(`${stem}\${`) || surface.includes(`${stem}{{`)) return true;
    }
    return false;
  };
  for (const f of walk(path.join(ROOT, "styles"))) {
    if (!f.endsWith(".css")) continue;
    const css = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const seen = new Set();
    for (const m of css.matchAll(/\.((?:acks)[\w-]*)/g)) {
      const token = m[1];
      if (seen.has(token)) continue;
      seen.add(token);
      if (!live(token)) {
        fail(`${rel(f)}: selector class ".${token}" never appears in scripts/ or templates/ — dead scope (JS classes: arrays renamed without the CSS?)`);
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* 6. Icon paths resolve.                                                      */
/*                                                                             */
/* Nothing type-checks an img string: a missing file is a broken image at the  */
/* moment a user opens the sheet, and 13 shipped that way. Module-relative      */
/* paths are checked in-repo (always possible). Foundry-core `icons/**` and     */
/* system `systems/acks/**` paths are checked when an install / checkout is     */
/* discoverable, else skipped with a notice — CI stays honest about what it     */
/* did not check.                                                               */
/* -------------------------------------------------------------------------- */
{
  const FOUNDRY_PUBLIC = [
    "C:/Program Files/Foundry Virtual Tabletop/resources/app/public",
    path.join(ROOT, "..", "FoundryVTT", "resources", "app", "public"),
  ].find((p) => fs.existsSync(path.join(p, "icons")));
  const SYSTEM_SRC = [path.join(ROOT, "..", "foundryvtt-acks-core", "src")].find((p) =>
    fs.existsSync(path.join(p, "assets"))
  );
  const skipped = new Set();
  const seen = new Set();
  for (const f of [...walk(path.join(ROOT, "tools")), ...walk(path.join(ROOT, "scripts"))]) {
    if (!f.endsWith(".mjs")) continue;
    const text = fs.readFileSync(f, "utf8");
    for (const m of text.matchAll(/["'`]((?:icons|systems|modules)\/[^"'`\n${]+\.(?:svg|webp|png|jpg|jpeg))["'`]/g)) {
      const p = m[1];
      if (seen.has(p)) continue;
      seen.add(p);
      let resolved;
      if (p.startsWith("modules/acks-extras/")) resolved = path.join(ROOT, p.replace("modules/acks-extras/", ""));
      else if (p.startsWith("icons/")) resolved = FOUNDRY_PUBLIC ? path.join(FOUNDRY_PUBLIC, p) : null;
      else if (p.startsWith("systems/acks/")) resolved = SYSTEM_SRC ? path.join(SYSTEM_SRC, p.replace("systems/acks/", "")) : null;
      else continue; // another module's path — its presence is that module's business
      if (resolved === null) {
        skipped.add(p.split("/")[0]);
        continue;
      }
      if (!fs.existsSync(resolved)) fail(`${rel(f)}: icon path does not exist — ${p}`);
    }
  }
  if (skipped.size) console.log(`validate-extra: icon check skipped for ${[...skipped].join(", ")} paths (no install/checkout found)`);
}

/* -------------------------------------------------------------------------- */
/* Legacy style-variable gate. Module styles read --acks-* tokens only; the    */
/* v10-era Foundry names (--color-*, --font-size-*) were swept in 4.0 and must */
/* not creep back — a legacy read with a hex fallback silently detaches the    */
/* surface from both palettes. foundry.css is the one deliberate reader: its   */
/* LOOK block re-points ACKS names AT the host variables and must name them.   */
/* -------------------------------------------------------------------------- */
{
  const LEGACY_VAR = /var\(\s*--(?:color|font-size)-/;
  const styleFiles = [
    ...walk(path.join(ROOT, "styles")),
    ...walk(path.join(ROOT, "vendor", "acks-design")),
  ].filter((f) => f.endsWith(".css") && !rel(f).endsWith("vendor/acks-design/foundry.css"));
  for (const f of styleFiles) {
    const lines = fs.readFileSync(f, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (LEGACY_VAR.test(line)) {
        fail(`${rel(f)}:${i + 1} reads a legacy Foundry style variable — use an --acks-* token (${line.trim().slice(0, 80)})`);
      }
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Docs-site staging gate.                                                     */
/*                                                                             */
/* The site sync fails on a guide with no sidebar entry (and any other staging */
/* mismatch). CI runs it on every push — running it HERE surfaces the mismatch */
/* at the first `npm run validate` after the guide is written, not as a red    */
/* workflow discovered after a release is tagged (2026-08-14: the markets      */
/* guide shipped unregistered and the Docs site stayed red for a day).         */
/* -------------------------------------------------------------------------- */
{
  const siteSync = path.join(ROOT, "docs", "site", "tools", "sync.mjs");
  if (fs.existsSync(siteSync)) {
    try {
      execFileSync(process.execPath, [siteSync], { cwd: path.dirname(path.dirname(siteSync)), stdio: "pipe" });
    } catch (err) {
      fail(`docs site staging: ${String(err.stderr ?? err.stdout ?? err.message).trim().split("\n")[0]}`);
    }
  }
}

console.log(
  failed
    ? "validate-extra: merge guards FAILED"
    : `validate-extra: merge guards OK (${stale} stale ids, ${targets.size} distinct libWrapper target(s))`
);
if (failed) process.exit(1);

/* A class a template writes but no stylesheet claims, and a token a rule reads
 * but nobody publishes, are both silent: the element renders undressed and the
 * declaration is dropped without complaint. Checked here so neither can
 * accumulate again. */
execFileSync(process.execPath, [path.join(HERE, "audit-styles.mjs")], { stdio: "inherit" });

/* The flow suite runs last: it is the slowest, and a guard failure above makes
 * its result uninteresting anyway. */
execFileSync(process.execPath, [path.join(HERE, "test-formation-flows.mjs")], { stdio: "inherit" });
