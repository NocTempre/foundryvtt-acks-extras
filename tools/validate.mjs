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
 *      declared esmodules/scripts/styles/languages/packs paths exist (checked
 *      CASE-SENSITIVELY against the real directory entries, since existsSync
 *      follows the local filesystem's case rules and NTFS lets a mismatch
 *      pass locally that case-sensitive CI rejects), every
 *      relationships.requires entry carries a reason and
 *      compatibility.minimum, manifest/download point at
 *      releases/latest/download.
 *   6. i18n: every ACKS-family key referenced in scripts/templates/ruledata/
 *      tools exists in lang/en.json. Roots written as `${LANG_PREFIX}.x` are
 *      resolved from module-level string constants, following named imports;
 *      a root that stays unresolvable fails. A reference captured WHOLE (a
 *      quoted literal) must match a key exactly; only a reference truncated
 *      at an interpolation (`PREFIX.${value}`) is dynamic-suffix tolerant —
 *      exact literals shielded by a longer sibling (foo passing because
 *      fooHint exists) are the miss this distinction exists to catch. The
 *      count of keys actually checked is always printed.
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

/* fs.existsSync follows the local filesystem's case rules — NTFS and APFS are
 * case-insensitive, so a declared path whose case mismatches the repo passes
 * on a dev machine and fails on case-sensitive CI. Verify each segment against
 * the parent directory's real entries instead. */
function existsExact(relPath) {
  let dir = ROOT;
  for (const segment of String(relPath).split(/[\\/]/)) {
    if (!segment || segment === ".") continue;
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return false;
    }
    if (!entries.includes(segment)) return false;
    dir = path.join(dir, segment);
  }
  return true;
}

/* null when relPath exists with exactly this case; otherwise the reason —
 * naming the case mismatch when the path exists only under different casing. */
function pathProblem(relPath) {
  if (existsExact(relPath)) return null;
  return fs.existsSync(path.join(ROOT, relPath))
    ? "exists only under a different case — case-sensitive CI will not find it"
    : "does not exist";
}

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

/* 3. JSON validity — plus the two silent manifest corruptions (TOOLCHAIN
 * §10n): a UTF-8 BOM (PowerShell's `utf8` writes one; CI's JSON gate rejects
 * it while a BOM-tolerant local parse would not), and the cp1252→UTF-8
 * double-encoding signature (bytes c3 a2 e2 82 ac — valid UTF-8, valid JSON,
 * garbled to every reader; only a byte check catches it). */
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
let module_ = null;
for (const file of ["module.json", "package.json"]) {
  try {
    const bytes = fs.readFileSync(path.join(ROOT, file));
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      fail(file, "starts with a UTF-8 BOM — write JSON via the Edit tool or node, never PowerShell redirection");
    }
    if (bytes.includes(Buffer.from([0xc3, 0xa2, 0xe2, 0x82, 0xac]))) {
      fail(file, "carries the cp1252 double-encoding signature (c3 a2 e2 82 ac) — an em dash became â€”; rewrite from a clean source");
    }
    const parsed = readJson(file);
    if (file === "module.json") module_ = parsed;
  } catch (err) {
    fail(file, err.message);
  }
}
walk(path.join(ROOT, "lang"), (full) => {
  if (!full.endsWith(".json")) return;
  try {
    const lang = JSON.parse(fs.readFileSync(full, "utf8"));
    /* Foundry expands the flat file with expandObject: a key that is BOTH a
     * leaf and a prefix of other keys either silently eats every child (branch
     * first) or throws and drops the module's WHOLE translation file (leaf
     * first). Suffix the label instead (`nounLabel`, `methods.<key>`). */
    const keys = Object.keys(lang).filter((k) => typeof lang[k] === "string");
    const keySet = new Set(Object.keys(lang));
    for (const k of keys) {
      const clash = [...keySet].find((other) => other !== k && other.startsWith(`${k}.`));
      if (clash) fail(rel(full), `key "${k}" is both a value and a prefix of "${clash}" — expandObject collision kills the translation file`);
    }
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

/* 3b. Stray C0 control bytes in source. A tool that writes a file through a
 * shell-quoted string can land a real control character where an escape was
 * meant: `\b` inside a JS string literal is BACKSPACE, so a word-boundary regex
 * written that way becomes /…\x08/ and matches nothing, forever. The byte is
 * invisible in every editor and every diff, the file parses, the suite passes,
 * and the rule around it is simply dead. Tab, newline and carriage return are
 * the only control characters source has any business carrying. */
const CONTROL_OK = new Set([9, 10, 13]);
for (const dir of ["scripts", "tools", "templates", "styles", "lang"]) {
  walk(path.join(ROOT, dir), (full) => {
    if (!/\.(mjs|js|json|hbs|css)$/.test(full)) return;
    const text = fs.readFileSync(full, "utf8");
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if ((code >= 32 || CONTROL_OK.has(code)) && code !== 127) continue;
      const line = text.slice(0, i).split("\n").length;
      fail(
        rel(full),
        `line ${line} carries control byte 0x${code.toString(16).padStart(2, "0")} — an escape such as \\b was written as a literal character; whatever rule contains it is dead`,
      );
      return;
    }
  });
}

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
      const problem = pathProblem(p);
      if (problem) fail("module.json", `${field} entry "${p}" ${problem}`);
    }
  }
  for (const l of m.languages ?? []) {
    const problem = pathProblem(l.path);
    if (problem) fail("module.json", `language "${l.lang}" path "${l.path}" ${problem}`);
  }
  for (const p of m.packs ?? []) {
    if (existsExact(p.path) || existsExact(`packs/_source/${p.name}`)) continue;
    const caseHit = [p.path, `packs/_source/${p.name}`].find((c) => fs.existsSync(path.join(ROOT, c)));
    fail(
      "module.json",
      caseHit
        ? `declared pack "${p.name}": "${caseHit}" exists only under a different case — case-sensitive CI will not find it`
        : `declared pack "${p.name}" has neither ${p.path} nor packs/_source/${p.name}`
    );
  }
  /* Every relationships.requires entry carries a human reason; third-party
   * entries also carry compatibility.minimum. Intra-family (acks-*) entries are
   * exempt from the minimum by the §3 waiver — sibling modules co-develop at
   * current versions, so a computed floor there is development-tracking noise,
   * not a contract. The count is printed so a green line cannot mean the check
   * read nothing. */
  const requires = m.relationships?.requires ?? [];
  for (const entry of requires) {
    const who = entry.id ?? "(entry without id)";
    if (!entry.id) fail("module.json", "relationships.requires entry is missing its id");
    if (typeof entry.reason !== "string" || !entry.reason.trim()) {
      fail("module.json", `relationships.requires "${who}" is missing its reason`);
    }
    const intraFamily = typeof entry.id === "string" && entry.id.startsWith("acks-");
    if (!intraFamily && !entry.compatibility?.minimum) {
      fail("module.json", `relationships.requires "${who}" is missing compatibility.minimum`);
    }
  }
  console.log(`validate: module.json relationships.requires checked ${requires.length} entr${requires.length === 1 ? "y" : "ies"}`);
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

  /* Most code names its lang root through a constant — `${LANG_PREFIX}.ui.x`,
   * the shape the scaffold itself seeds — so a scanner that only reads quoted
   * literals sees NO keys in such a repo and prints OK having checked nothing.
   * Resolving the interpolation is what makes this section cover the family's
   * own idiom. Resolution is per file: local `const NAME = "…"` plus named
   * imports followed through relative specifiers. It can never be a repo-wide
   * name→value map — one merged module legitimately declares several different
   * LANG_PREFIX constants (ACKS-LIB, ACKS-LOCATION, …), and flattening them
   * would attribute keys to the wrong root. */
  const CONST_RE = /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(["'`])([^"'`\\\n]*)\2/g;
  const IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
  const INTERP_RE = /\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g;
  /* The same root, one indirection further out: a factory handed a lang root
   * returns a bound localizer, and every `loc("some.key")` after it names a key
   * no literal scan can see. Matched on shape, not on the helper's name — a
   * value that reaches a factory as a lang root and comes back callable with
   * dotted strings IS a localizer, whatever the repo calls it. */
  const BINDER_RE = /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*[A-Za-z_$][\w$]*\s*\(\s*(?:(["'`])([^"'`\\\n]*)\2|([A-Za-z_$][\w$]*))\s*\)/g;
  /* Only a value shaped like a lang root (or a dot-path under one) is ever
   * substituted, so an unrelated `${…}` can never be rewritten into something
   * that merely looks like a key — including this validator's own LANG_FAMILY,
   * which lives one directory below and is scanned like any other source. */
  const LANG_ROOT_RE = new RegExp(`^${LANG_FAMILY}[A-Z0-9]+(?:\\.[A-Za-z0-9._-]+)?$`);
  /* An i18n call whose key STARTS with an interpolation this pass could not
   * resolve is a key the section cannot see at all. That silence is the defect
   * — it reads as "no problems found" — so it fails instead. Only a root named
   * by something constant-shaped counts: a generic factory interpolating its
   * own `prefix` parameter is unknowable by construction, and its call sites
   * are reached through the binder pass rather than here. */
  const OPAQUE_I18N_RE = /\bi18n\s*\.\s*(?:localize|format|has)\(\s*`\$\{([^}`]*)\}/g;
  const CONSTANTISH = /[A-Z][A-Z0-9_]{2,}/;

  const files = [];
  for (const dir of ["scripts", "templates", "ruledata", "tools"]) {
    walk(path.join(ROOT, dir), (full) => {
      if (/[.](mjs|hbs|json)$/.test(full)) files.push(full);
    });
  }
  const sources = new Map(files.map((full) => [full, fs.readFileSync(full, "utf8")]));

  const substitute = (text, scope) =>
    text.replace(INTERP_RE, (whole, name) => {
      const value = scope.get(name);
      return value !== undefined && LANG_ROOT_RE.test(value) ? value : whole;
    });

  const resolveSpecifier = (fromFile, specifier) => {
    if (!specifier.startsWith(".")) return null; // bare/absolute: not ours to walk
    const base = path.resolve(path.dirname(fromFile), specifier);
    for (const candidate of [base, `${base}.mjs`, `${base}.js`, path.join(base, "index.mjs")]) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    return null;
  };
  // Module-level string constants per file, plus the named-import edges that
  // carry them between files.
  const constsOf = new Map();
  const importsOf = new Map();
  for (const full of files) {
    if (!full.endsWith(".mjs")) continue;
    const local = new Map();
    for (const m of sources.get(full).matchAll(CONST_RE)) local.set(m[1], m[3]);
    constsOf.set(full, local);
    const edges = [];
    for (const m of sources.get(full).matchAll(IMPORT_RE)) {
      const source = resolveSpecifier(full, m[2]);
      if (!constsOf.has(source) && !files.includes(source)) continue;
      for (const specifier of m[1].split(",")) {
        const [imported, alias] = specifier.trim().split(/\s+as\s+/);
        if (imported) edges.push({ source, imported, local: alias ?? imported });
      }
    }
    importsOf.set(full, edges);
  }
  const scopeFor = (full) => {
    const scope = new Map(constsOf.get(full));
    for (const edge of importsOf.get(full) ?? []) {
      const value = constsOf.get(edge.source)?.get(edge.imported);
      if (value !== undefined) scope.set(edge.local, value);
    }
    return scope;
  };
  /* A root composed from another constant — `const SUB = `${LANG_PREFIX}.ui`` —
   * only resolves once the constant it chains off has, and that one usually
   * arrives by import. So the fixed point runs across ALL files rather than
   * within each: resolving one file's constants can unblock another's. */
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (const [full, local] of constsOf) {
      const scope = scopeFor(full);
      for (const [name, value] of local) {
        const next = substitute(value, scope);
        if (next !== value) (local.set(name, next), (changed = true));
      }
    }
    if (!changed) break;
  }

  /* referenced: key -> truncated. `truncated` stays true only while EVERY
   * capture of the key was cut short — at a `${…}` interpolation or a trailing
   * dot (a concat prefix; a whole key never ends in a dot) — or sat unquoted
   * in prose (a comment naming a key family). Those get the dynamic-family
   * tolerance: any longer sibling satisfies them. One capture of the whole key
   * inside quotes pins it exact for good — an exact literal must match an
   * exact key, because prefix tolerance lets a deleted `foo` hide behind its
   * own `fooHint`, and roughly a tenth of a real repo's keys are strict
   * prefixes of a sibling under the foo/fooHint labelling convention. */
  const referenced = new Map();
  const literal = new Set(); // what a quoted-literal-only scan would have seen
  const QUOTE_RE = /["'`]/;
  /* A quoted WHOLE literal handed to something that names itself a prefix —
   * `static LOCALIZATION_PREFIXES = ["…"]`, `labelPrefix: "…"` — is a prefix
   * by API contract, not a key, and keeps the dynamic-family tolerance. */
  const PREFIX_CTX_RE = /prefix(?:es)?\s*[:=]\s*\[?\s*$/i;
  const addRef = (key, truncated) => referenced.set(key, (referenced.get(key) ?? true) && truncated);
  const collectLiteral = (text) => {
    for (const match of text.matchAll(keyRe)) literal.add(match[0].replace(/[.,]$/, ""));
  };
  const collectRefs = (text) => {
    for (const match of text.matchAll(keyRe)) {
      const key = match[0].replace(/[.,]$/, "");
      const truncated =
        key !== match[0] ||
        text.startsWith("${", match.index + match[0].length) ||
        !QUOTE_RE.test(text[match.index - 1] ?? "") ||
        PREFIX_CTX_RE.test(text.slice(Math.max(0, match.index - 64), match.index - 1));
      addRef(key, truncated);
    }
  };
  for (const full of files) {
    collectLiteral(sources.get(full));
    if (!full.endsWith(".mjs")) {
      collectRefs(sources.get(full));
      continue;
    }
    const scope = scopeFor(full);
    const resolved = substitute(sources.get(full), scope);
    collectRefs(resolved);
    for (const m of resolved.matchAll(OPAQUE_I18N_RE)) {
      if (!CONSTANTISH.test(m[1])) continue;
      fail(rel(full), `i18n key starts with unresolvable \${${m[1]}} — declare the root as a module-level string const so this check can read the key`);
    }
    for (const m of resolved.matchAll(BINDER_RE)) {
      const root = m[3] ?? scope.get(m[4]);
      if (root === undefined || !LANG_ROOT_RE.test(root)) continue;
      const callRe = new RegExp(`\\b${m[1]}\\(\\s*(["'\`])([A-Za-z0-9._-]+)\\1`, "g");
      for (const call of resolved.matchAll(callRe)) addRef(`${root}.${call[2]}`, false);
    }
  }
  const langKeySet = new Set(langKeys);
  for (const [key, truncated] of referenced) {
    // Dynamic families: code builds `PREFIX.${value}` — the captured prefix is
    // fine as long as some real key extends it. Only a TRUNCATED capture gets
    // that tolerance; an exact literal reference demands the exact key.
    if (truncated ? langKeys.some((k) => k.startsWith(key)) : langKeySet.has(key)) continue;
    const sibling = truncated ? undefined : langKeys.find((k) => k !== key && k.startsWith(key));
    fail(
      "lang/en.json",
      `missing key referenced in code: ${key}` +
        (sibling ? ` (a longer sibling "${sibling}" exists, but an exact literal reference requires the exact key)` : "")
    );
  }
  /* Always report the count. A silent OK cannot distinguish "found no problems"
   * from "found no keys", and it was the second that let a missing key ship. */
  const recovered = referenced.size - literal.size;
  console.log(
    `validate: i18n checked ${referenced.size} referenced key${referenced.size === 1 ? "" : "s"} ` +
      `across ${files.length} file${files.length === 1 ? "" : "s"}` +
      (recovered > 0 ? ` (${recovered} invisible to a quoted-literal scan: constant roots and bound localizers)` : "") +
      ` against ${langKeys.length} in lang/en.json`
  );
  const familyKeys = langKeys.filter((k) => k.startsWith(LANG_FAMILY));
  if (familyKeys.length && !referenced.size) {
    console.warn(`WARN lang/en.json: ${familyKeys.length} ${LANG_FAMILY}* keys defined but not one is referenced in code — this check verified nothing`);
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

/* 8. The UI layout contract — every window a module opens stays reachable on a
 *    small display. Two failure modes are decidable from the source, and both
 *    are invisible to every other check because they need a real viewport:
 *
 *    a. A window outside the scroll contract. Core caps an application frame at
 *       the viewport height and gives `.window-content` `overflow: hidden`, so a
 *       window taller than the cap is amputated — trailing footer first — with
 *       no scrollbar to say so. The contract is the class `<id>-scroll`, and
 *       membership in it is the whole of the fix.
 *    b. Scroll retention that can never fire. ApplicationV2 restores a part's
 *       scroll position by resolving `selector === "" ? partRoot :
 *       partRoot.querySelector(selector)`, and querySelector searches
 *       DESCENDANTS ONLY — so a part naming its own root element retains
 *       nothing while reading as entirely correct.
 *
 *    A window that must sit outside the contract says so where it is declared:
 *    `// no-scroll: <reason>` on or just above its `classes:` line. */
if (module_?.id) {
  const id = module_.id;
  const SCROLL_CLASS = `${id}-scroll`;

  // Which classes actually CARRY a scroll contract, read from the stylesheets
  // rather than assumed: a rule that claims the `.window-content` box for a
  // class is that class taking responsibility for the window's overflow. The
  // shared `<id>-scroll` is the common one, and a subsystem may own another
  // (an importer dialog, a battlemap panel) without being wrong.
  //
  // Opt-in per repo: a module whose styles claim no window-content box has no
  // contract to join, so 8a stays silent rather than inventing one.
  const contracts = new Set();
  walk(path.join(ROOT, "styles"), (full) => {
    if (!full.endsWith(".css")) return;
    const css = fs.readFileSync(full, "utf8");
    for (const m of css.matchAll(/\.([A-Za-z][\w-]*)(?:\.[\w-]+)*\.application\s+\.window-content/g)) contracts.add(m[1]);
  });
  const contractDefined = contracts.size > 0;

  // The classes on the FIRST element of each template — exactly the selectors a
  // part must not name in `scrollable`.
  const rootClasses = new Set();
  walk(path.join(ROOT, "templates"), (full) => {
    if (!full.endsWith(".hbs")) return;
    const m = /<[a-zA-Z][^>]*\sclass="([^"{]+)"/.exec(fs.readFileSync(full, "utf8"));
    if (m) for (const c of m[1].split(/\s+/).filter(Boolean)) rootClasses.add(c);
  });

  const lineOf = (text, index) => text.slice(0, index).split("\n").length;

  walk(path.join(ROOT, "scripts"), (full) => {
    if (!full.endsWith(".mjs")) return;
    const text = fs.readFileSync(full, "utf8");
    const lines = text.split("\n");

    // 8a. every declared `classes` array joins the scroll contract.
    if (contractDefined) {
      for (const m of text.matchAll(/classes:\s*\[([^\]]*)\]/g)) {
        const declared = [...m[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((c) => c[1]);
        if (declared.some((c) => contracts.has(c))) continue;
        const lineNo = lineOf(text, m.index);
        // The declaration itself, plus the contiguous comment block above it —
        // a reason worth stating is usually longer than one line, and a waiver
        // that has to fit on one encourages a reason that explains nothing.
        let i = lineNo - 1; // 0-based index of the declaration line
        let waived = lines[i]?.includes("no-scroll:") ?? false;
        for (let j = i - 1; j >= 0 && /^\s*(\/\/|\*|\/\*)/.test(lines[j] ?? ""); j--) {
          if (lines[j].includes("no-scroll:")) waived = true;
        }
        if (waived) continue;
        fail(
          rel(full),
          `line ${lineNo}: classes array joins no scroll contract — a window outside one clips its own content on a short display, with no scrollbar to say so. Add "${SCROLL_CLASS}" (or another contract class: ${[...contracts].join(", ")}), or state why not with "// no-scroll: <reason>"`,
        );
      }
    }

    // 8b. no part names its own root element as its scroll target.
    for (const m of text.matchAll(/scrollable:\s*\[([^\]]*)\]/g)) {
      for (const sel of m[1].matchAll(/["'`]([^"'`]*)["'`]/g)) {
        if (!sel[1].startsWith(".")) continue;
        const cls = sel[1].slice(1);
        if (!rootClasses.has(cls)) continue;
        fail(
          rel(full),
          `line ${lineOf(text, m.index)}: scrollable names ".${cls}", which is a template ROOT element — querySelector searches descendants only, so this part retains no scroll position. Use scrollable: [""] to address the part's own root`,
        );
      }
    }
  });
}

/* 9. IP leak scan — licensed book material must never reach a public repo or a
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

/* 10. Optional module-owned extra validation. A repo drops tools/validate-extra.mjs
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
