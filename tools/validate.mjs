/**
 * Canonical pre-release validation for ACKS module repos.
 * Synced from acks-module-template — edit there and run bin/sync-toolchain.mjs;
 * do not hand-edit per module. Pure-logic module tests belong in
 * tools/test-logic.mjs (run via `npm test`); a module that needs an extra
 * check to run as PART of validation (e.g. an IP-safety lint) drops a
 * tools/validate-extra.mjs — this validator auto-runs it (section 8), so
 * `npm run validate` stays the single canonical entry point everywhere.
 *
 * Checks (each section skips cleanly when the dir/file doesn't exist):
 *   1. JS syntax (node --check) of every .mjs under scripts/ and tools/.
 *   2. Handlebars compilation of every .hbs under templates/ (parse errors
 *      otherwise only surface at render time inside Foundry).
 *   3. JSON validity: module.json, package.json, lang/*.json, ruledata/**
 *      (which must carry an `id`), packs/_source/**.
 *   4. Pack-source invariants: 16-char alphanumeric _id, _key ending in _id,
 *      no duplicate _id within a pack.
 *   5. module.json invariants: semver version, compatibility.minimum present,
 *      declared esmodules/scripts/styles/languages/packs paths exist,
 *      manifest/download point at releases/latest/download.
 *   6. i18n: every "<ID-UPPERCASED>.x" key referenced in scripts/templates/
 *      ruledata exists in lang/en.json (dynamic-suffix tolerant).
 *   7. Namespacing (one form per registry, no legacy exceptions — the
 *      2026-07-15 migration brought every module into conformance):
 *      globalThis exposures, custom hooks, and Handlebars helpers start with
 *      the camelCased module id; lang keys with "<ID-UPPERCASED>."
 *      (Foundry-owned roots like TYPES.* allowlisted); top-level CSS classes
 *      with the module id; top-level pack _ids with the mandatory
 *      module.json `flags.<id>.idPrefix` short key.
 *   8. IP leak scan (tools/ip-scan.mjs): local-only rules extracts, extraction
 *      pipeline state, and publisher attribution inside data files.
 *   9. Optional module-owned tools/validate-extra.mjs — run last if present;
 *      a non-zero exit fails validation.
 *
 * Usage:  npm run validate
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import Handlebars from "handlebars";

const ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));

/* Namespacing is enforced at the FAMILY level, not the module level (sections
 * 6, 7a, 7d). The job of these prefixes is to keep the family clear of core
 * Foundry and of the `acks` system; "acks-" does that completely. Pinning them
 * to the module id would additionally have prevented one acks-* module from
 * colliding with another — which stopped being a risk when the family merged
 * into single modules, and which in exchange would force every folded-in
 * feature's lang keys and CSS classes to be re-prefixed for no visible gain.
 * Feature-level roots (ACKS-EQUIPMENT.*, .acks-henchmen-row) stay as authored
 * and remain collision-proof by construction.
 *
 * 7b (pack _id prefix) and 7c (globals/hooks/helpers) are deliberately NOT
 * relaxed: 7b costs nothing since every existing prefix already starts "acks",
 * and 7c is what forbids a compat-alias global. */
const LANG_FAMILY = "ACKS-";
const CSS_FAMILY = "acks-";

let failed = false;
const fail = (file, message) => {
  console.error(`FAIL ${file}: ${message}`);
  failed = true;
};
const rel = (full) => path.relative(ROOT, full).replaceAll(path.sep, "/");

function walk(dir, cb) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, cb);
    else cb(full);
  }
}

/* 1. JS syntax of every script/tool module. */
for (const dir of ["scripts", "tools"]) {
  walk(path.join(ROOT, dir), (full) => {
    if (!full.endsWith(".mjs")) return;
    try {
      execFileSync(process.execPath, ["--check", full], { stdio: "pipe" });
    } catch (err) {
      fail(rel(full), String(err.stderr ?? err.message).trim().split("\n")[0]);
    }
  });
}

/* 2. Handlebars templates precompile. */
walk(path.join(ROOT, "templates"), (full) => {
  if (!full.endsWith(".hbs")) return;
  try {
    Handlebars.precompile(fs.readFileSync(full, "utf8"));
  } catch (err) {
    fail(rel(full), err.message.split("\n").slice(0, 2).join(" "));
  }
});

/* 3. JSON validity. */
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
let module_ = null;
for (const file of ["module.json", "package.json"]) {
  try {
    const parsed = readJson(file);
    if (file === "module.json") module_ = parsed;
  } catch (err) {
    fail(file, err.message);
  }
}
walk(path.join(ROOT, "lang"), (full) => {
  if (!full.endsWith(".json")) return;
  try {
    JSON.parse(fs.readFileSync(full, "utf8"));
  } catch (err) {
    fail(rel(full), err.message);
  }
});
walk(path.join(ROOT, "ruledata"), (full) => {
  if (!full.endsWith(".json")) return;
  try {
    const doc = JSON.parse(fs.readFileSync(full, "utf8"));
    if (!doc.id) fail(rel(full), "ruledata document missing `id`");
  } catch (err) {
    fail(rel(full), err.message);
  }
});

/* 4. Pack-source document invariants, including embedded documents (items /
 *    effects / results / pages, recursively — items can nest effects).
 *    Foundry's DocumentIdField requires exactly 16 alphanumerics everywhere. */
const ID_RE = /^[A-Za-z0-9]{16}$/;
const EMBEDDED_COLLECTIONS = ["items", "effects", "results", "pages"];
function checkDoc(fileRel, doc, ids, context) {
  if (doc._id !== undefined) {
    if (!ID_RE.test(doc._id)) fail(fileRel, `${context}_id "${doc._id}" is not 16 alphanumerics`);
    if (doc._key !== undefined && !String(doc._key).endsWith(doc._id)) fail(fileRel, `${context}_key does not end with _id`);
    if (ids.has(doc._id)) fail(fileRel, `${context}duplicate _id ${doc._id}`);
    ids.add(doc._id);
  }
  for (const collection of EMBEDDED_COLLECTIONS) {
    if (!Array.isArray(doc[collection])) continue;
    const childIds = new Set(); // same child id under different parents is legal
    for (const child of doc[collection]) {
      if (child && typeof child === "object") checkDoc(fileRel, child, childIds, `${collection}: `);
    }
  }
}
const sourceRoot = path.join(ROOT, "packs", "_source");
if (fs.existsSync(sourceRoot)) {
  for (const packDir of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    if (!packDir.isDirectory()) continue;
    const ids = new Set();
    walk(path.join(sourceRoot, packDir.name), (full) => {
      if (!full.endsWith(".json")) return;
      let doc;
      try {
        doc = JSON.parse(fs.readFileSync(full, "utf8"));
      } catch (err) {
        fail(rel(full), err.message);
        return;
      }
      checkDoc(rel(full), doc, ids, "");
    });
  }
}

/* 5. module.json invariants. */
if (module_) {
  const m = module_;
  if (!m.id) fail("module.json", "missing id");
  if (!/^\d+\.\d+\.\d+$/.test(m.version ?? "")) fail("module.json", `version "${m.version}" is not plain semver X.Y.Z`);
  if (!m.compatibility?.minimum) fail("module.json", "missing compatibility.minimum");
  for (const field of ["esmodules", "scripts", "styles"]) {
    for (const p of m[field] ?? []) {
      if (!fs.existsSync(path.join(ROOT, p))) fail("module.json", `${field} entry "${p}" does not exist`);
    }
  }
  for (const l of m.languages ?? []) {
    if (!fs.existsSync(path.join(ROOT, l.path))) fail("module.json", `language "${l.lang}" path "${l.path}" does not exist`);
  }
  for (const p of m.packs ?? []) {
    const compiled = path.join(ROOT, p.path);
    const source = path.join(sourceRoot, p.name);
    if (!fs.existsSync(compiled) && !fs.existsSync(source)) {
      fail("module.json", `declared pack "${p.name}" has neither ${p.path} nor packs/_source/${p.name}`);
    }
  }
  for (const [field, suffix] of [["manifest", "module.json"], ["download", "module.zip"]]) {
    if (m[field] && !m[field].endsWith(`/releases/latest/download/${suffix}`)) {
      fail("module.json", `${field} should end with /releases/latest/download/${suffix}`);
    }
  }
  if (m.id && path.basename(ROOT) !== m.id) {
    console.warn(`WARN module.json: id "${m.id}" does not match directory name "${path.basename(ROOT)}"`);
  }
}

/* 6. Every localization key referenced in code should exist in lang/en.json. */
if (module_?.id && fs.existsSync(path.join(ROOT, "lang", "en.json"))) {
  const lang = readJson("lang/en.json");
  // Support flat and nested key styles by flattening to dot-paths.
  const langKeys = [];
  (function flatten(obj, prefix) {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object") flatten(v, key);
      else langKeys.push(key);
    }
  })(lang, "");
  /* Any ACKS-family lang root, not just this module's own. A merged module
   * carries the roots of everything folded into it (ACKS-EQUIPMENT.*,
   * ACKS-HENCHMEN.*, ...), and those roots stay put — re-prefixing thousands
   * of keys to match the new id buys nothing and risks collisions.
   *
   * This MUST stay in step with 7a below. Keyed to `module_.id` it would match
   * none of a merged module's keys, so `referenced` would come back empty and
   * this section would print OK having checked nothing. */
  const keyRe = new RegExp(`${LANG_FAMILY}[A-Z0-9]+\\.[A-Za-z0-9._-]+`, "g");
  const referenced = new Set();
  for (const dir of ["scripts", "templates", "ruledata", "tools"]) {
    walk(path.join(ROOT, dir), (full) => {
      if (!/[.](mjs|hbs|json)$/.test(full)) return;
      const text = fs.readFileSync(full, "utf8");
      for (const match of text.matchAll(keyRe)) referenced.add(match[0].replace(/[.,]$/, ""));
    });
  }
  for (const key of referenced) {
    // Dynamic families: code builds `PREFIX.${value}` — the captured prefix is
    // fine as long as some real key extends it.
    if (langKeys.some((k) => k.startsWith(key))) continue;
    fail("lang/en.json", `missing key referenced in code: ${key}`);
  }
}

/* 7. Namespacing: shared-registry identifiers carry the module key. */
if (module_?.id) {
  const id = module_.id;
  const camelNs = id.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
  const idPrefix = module_.flags?.[id]?.idPrefix;
  const warn = (file, message) => console.warn(`WARN ${file}: ${message}`);

  // 7a. lang keys carry a family root (Foundry-owned roots allowlisted).
  const FOUNDRY_LANG_ROOTS = ["TYPES"];
  if (fs.existsSync(path.join(ROOT, "lang", "en.json"))) {
    const lang = readJson("lang/en.json");
    for (const key of Object.keys(lang)) {
      const ok =
        key.startsWith(LANG_FAMILY) ||
        FOUNDRY_LANG_ROOTS.some((root) => key === root || key.startsWith(`${root}.`));
      if (!ok) fail("lang/en.json", `key "${key}" is not prefixed "${LANG_FAMILY}" (Foundry-owned roots: ${FOUNDRY_LANG_ROOTS.join(", ")})`);
    }
  }

  // 7b. top-level pack _ids start with the declared idPrefix.
  if (fs.existsSync(sourceRoot)) {
    if (!idPrefix) {
      fail("module.json", `modules with packs must declare flags["${id}"].idPrefix (short key prefixing every pack document _id)`);
    } else {
      walk(sourceRoot, (full) => {
        if (!full.endsWith(".json")) return;
        let doc;
        try {
          doc = JSON.parse(fs.readFileSync(full, "utf8"));
        } catch {
          return; // JSON validity already reported in section 3/4
        }
        if (doc._id !== undefined && !String(doc._id).startsWith(idPrefix)) {
          fail(rel(full), `_id "${doc._id}" does not start with declared idPrefix "${idPrefix}"`);
        }
      });
    }
  }

  // 7c. runtime registrations in scripts/: globals, custom hooks, HB helpers.
  walk(path.join(ROOT, "scripts"), (full) => {
    if (!full.endsWith(".mjs")) return;
    const text = fs.readFileSync(full, "utf8");
    for (const m of text.matchAll(/globalThis\.([A-Za-z_$][\w$]*)\s*(?:\?\?=|\|\|=|=(?!=))/g)) {
      if (!m[1].startsWith(camelNs)) fail(rel(full), `globalThis.${m[1]} must start with "${camelNs}"`);
    }
    // One form only: the camelCase module namespace (e.g. "acksInfluenceFoo").
    for (const m of text.matchAll(/Hooks\.(?:call|callAll)\(\s*["'`]([^"'`]+)["'`]/g)) {
      if (m[1].startsWith(camelNs)) continue;
      if (/^acks/i.test(m[1])) warn(rel(full), `hook "${m[1]}" fires under a foreign acks-* namespace — fine only if it's a deliberate cross-module call`);
      else fail(rel(full), `custom hook "${m[1]}" must start with "${camelNs}"`);
    }
    for (const m of text.matchAll(/Handlebars\.registerHelper\(\s*["'`]([^"'`]+)["'`]/g)) {
      if (m[1].startsWith(camelNs)) continue;
      if (/^acks/i.test(m[1])) warn(rel(full), `helper "${m[1]}" uses a foreign acks-* namespace`);
      else fail(rel(full), `Handlebars helper "${m[1]}" must start with "${camelNs}"`);
    }
  });

  // 7d. top-level CSS classes carry the module id (kebab, like the id itself).
  const cssSeen = new Set();
  walk(path.join(ROOT, "styles"), (full) => {
    if (!full.endsWith(".css")) return;
    for (const line of fs.readFileSync(full, "utf8").split("\n")) {
      const m = /^\s*\.([a-zA-Z][\w-]*)/.exec(line);
      if (!m) continue;
      const cls = m[1];
      if (!cls.startsWith(CSS_FAMILY) && !cssSeen.has(cls)) {
        cssSeen.add(cls);
        fail(rel(full), `top-level class ".${cls}" must start with "${CSS_FAMILY}"`);
      }
    }
  });
}

/* 8. IP leak scan — licensed book material must never reach a public repo or a
 *    release artifact. CI runs this again against the built zip and quarantines
 *    the repo if it trips; running it here means you find out before the push. */
const ipScan = path.join(ROOT, "tools", "ip-scan.mjs");
if (fs.existsSync(ipScan)) {
  try {
    execFileSync(process.execPath, [ipScan], { stdio: "inherit" });
  } catch {
    failed = true; // its own output already names the offending paths
  }
}

/* 9. Optional module-owned extra validation. A repo drops tools/validate-extra.mjs
 *    for checks specific to it (e.g. an IP-safety lint); the canonical validator
 *    runs it here so `npm run validate` stays the single entry point. It should
 *    exit non-zero on failure. Modules without the file skip this cleanly. */
const extraValidator = path.join(ROOT, "tools", "validate-extra.mjs");
if (fs.existsSync(extraValidator)) {
  try {
    execFileSync(process.execPath, [extraValidator], { stdio: "inherit" });
  } catch {
    failed = true; // its own output already explains the failure
  }
}

if (failed) process.exit(1);
console.log("validate: scripts, templates, JSON, packs, module.json, i18n, and namespacing OK");
