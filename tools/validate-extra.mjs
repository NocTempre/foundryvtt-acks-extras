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
 * scope only, no trailing key — and a dot-anchored pattern cannot see it. */
const OLD = /"acks-(lib|abilities|equipment|formation|henchmen|influence|location|monsters)"|\bglobalThis\.acks(Lib|Abilities|Equipment|Formation|Henchmen|Influence|Location|Monsters)\b|flags\.acks-(lib|abilities|equipment|formation|henchmen|influence|location|monsters)\b/;
/* Hook and helper names retired when everything moved under acksExtras.* —
 * firing OR listening under one of these is a silent no-op for the other side. */
const RETIRED = /\backsFormation\.|\backsInfluence(RollComplete|AttitudeChanged)\b|\backsMonsters(Val|Has)\b|\backsEquipment(LockPicked|ContainerBashed)\b/;
/* Two files name the old ids as DATA and must not be flagged: this one, and the
 * cleaner macro whose entire job is finding what those modules left behind. */
const NAMES_OLD_IDS_BY_DESIGN = new Set(["tools/validate-extra.mjs", "tools/pack-data/cleanup.mjs"]);
let stale = 0;
for (const f of [...walk(path.join(ROOT, "scripts")), ...walk(path.join(ROOT, "tools"))]) {
  if (!f.endsWith(".mjs")) continue;
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
/* render time.                                                                 */
/* -------------------------------------------------------------------------- */
for (const f of walk(path.join(ROOT, "scripts"))) {
  if (!f.endsWith(".mjs")) continue;
  const text = fs.readFileSync(f, "utf8");
  for (const m of text.matchAll(/modules\/\$\{MODULE_ID\}\/(templates\/[^"`\s]*\.hbs)/g)) {
    if (!fs.existsSync(path.join(ROOT, m[1]))) fail(`${rel(f)}: template not found — ${m[1]}`);
  }
}

console.log(
  failed
    ? "validate-extra: merge guards FAILED"
    : `validate-extra: merge guards OK (${stale} stale ids, ${targets.size} distinct libWrapper target(s))`
);
if (failed) process.exit(1);

/* The flow suite runs last: it is the slowest, and a guard failure above makes
 * its result uninteresting anyway. */
execFileSync(process.execPath, [path.join(HERE, "test-formation-flows.mjs")], { stdio: "inherit" });
