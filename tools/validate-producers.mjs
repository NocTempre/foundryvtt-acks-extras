/**
 * The producer gate: every ruledata table a feature reads, or declares with
 * `expectTables`, has something that writes it.
 *
 * `validate-extra.mjs` proves a read is DECLARED. A declaration is only a
 * promise, and this proves somebody keeps it: a table nothing produces is a
 * reader that answers null in every world, while the coverage report lists it
 * as "not yet imported", a state no import can change.
 *
 * Producers are read by importing the module that owns them:
 *  - `TABLE_RECIPES`: the raw tables an import reads off the page;
 *  - every module exporting `PRODUCES = { docId: { tableKey: source } }`: a
 *    binding's assembled tables, a registry's published ones, a sample's.
 *
 * Readers are found by scanning `scripts/`: calls of the registry's read
 * functions (bare, aliased on import, or through a namespace such as
 * `acksExtras.lib.tables`) and of the `optTable` wrapper, whose document
 * argument is a literal or a string constant, exported or not, declared here
 * or imported. A computed argument is skipped: a static reader cannot know
 * what it resolves to.
 *
 * A gap with a plan is listed in `WAIVERS` with the ROADMAP line that owns it.
 * A waiver whose gap has closed fails, so the list cannot outlive its gaps.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS = path.join(ROOT, "scripts");
const rel = (f) => path.relative(ROOT, f).split(path.sep).join("/");

/**
 * Known gaps, each owned by a ROADMAP line: `docId` waives a whole document,
 * `docId.tableKey` one table. `find` must appear in `roadmap`, so a waiver
 * cannot outlive the line that explains it.
 */
const WAIVERS = {
  formation: { roadmap: "docs/formation/ROADMAP.md", find: "Formation ruledata has no producer" },
  "cityTravel.encounters100": { roadmap: "docs/formation/ROADMAP.md", find: "The street encounter list has no recipe" },
  "travel.navigationBonus": { roadmap: "docs/formation/ROADMAP.md", find: "The navigation competence figures have no recipe" },
  influence: { roadmap: "docs/influence/ROADMAP.md", find: "Influence ruledata has no producer" },
  followers: { roadmap: "docs/henchmen/ROADMAP.md", find: "Followers ruledata has no producer" },
  "wages.mercenaryOfficers": { roadmap: "docs/henchmen/ROADMAP.md", find: "`wages.mercenaryOfficers`" },
  "wages.employerLevelCap": { roadmap: "docs/henchmen/ROADMAP.md", find: "`wages.employerLevelCap`" },
  "people.classRegistry": { roadmap: "docs/henchmen/ROADMAP.md", find: "`people.classRegistry`" },
  variations: { roadmap: "docs/equipment/ROADMAP.md", find: "Variation ruledata has no producer" },
  economy: { roadmap: "docs/markets/ROADMAP.md", find: "Economy ruledata has no producer" },
  "acks.selectionVocab": { roadmap: "docs/abilities/ROADMAP.md", find: "through exists (`acks.selectionVocab`)" },
};

/** The registry's read functions: which argument is the document, which the table. */
const READERS = {
  getTable: { doc: 0, table: 1 },
  optTable: { doc: 0, table: 1 },
  citeOf: { doc: 0, table: 1 },
  getThrowDef: { doc: 0 },
  getDoc: { doc: 0 },
  hasDoc: { doc: 0 },
  getLayer: { doc: 0 },
  expectTables: { doc: 0, tables: 1 },
  missingCoverage: { docs: 0 },
  missingTablesList: { docs: 0 },
};

/** Every .mjs under scripts/, with its text. */
function sources(dir = SCRIPTS, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) sources(full, out);
    else if (e.name.endsWith(".mjs")) out.push({ file: full, text: fs.readFileSync(full, "utf8") });
  }
  return out;
}

/* --- source scanning --------------------------------------------------- */

/** Text with comments blanked (same length), so a commented call is not a call. */
function stripComments(text) {
  let out = "";
  for (let i = 0; i < text.length; ) {
    const c = text[i];
    const n = text[i + 1];
    if (c === "/" && n === "/") {
      const end = text.indexOf("\n", i);
      const stop = end < 0 ? text.length : end;
      out += " ".repeat(stop - i);
      i = stop;
    } else if (c === "/" && n === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end < 0 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/**
 * The top-level arguments of the call whose `(` is at `open`, as source text,
 * and the index after its `)`.
 */
function callArgs(text, open) {
  const args = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === "\\" ? 2 : 1;
      i = j;
    } else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) {
        const last = text.slice(start, i).trim();
        if (last) args.push(last);
        return { args, end: i + 1 };
      }
    } else if (c === "," && depth === 1) {
      args.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  return { args, end: text.length };
}

/** `{ a, b as c }` → [["a", "a"], ["b", "c"]] (imported name, local name). */
const specifiers = (list) =>
  list
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [name, local] = s.split(/\s+as\s+/);
      return [name.trim(), (local ?? name).trim()];
    });

/** Per file: string constants, string-array constants, and imported names. */
function scan({ file, text }) {
  const code = stripComments(text);
  const strings = new Map();
  for (const m of code.matchAll(/(?:^|[\s;])(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(["'])([^"'\n]*)\2\s*[;\n]/g)) {
    strings.set(m[1], m[3]);
  }
  const arrays = new Map();
  for (const m of code.matchAll(/(?:^|[\s;])(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:Object\.freeze\(\s*)?\[([^\]]*)\]/g)) {
    arrays.set(m[1], m[2]);
  }
  const imports = new Map();
  const spec = (from) => (from.startsWith(".") ? path.resolve(path.dirname(file), from) : null);
  for (const m of code.matchAll(/(?:import|export)\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    const target = spec(m[2]);
    if (target) for (const [name, local] of specifiers(m[1])) imports.set(local, { file: target, name });
  }
  return { file, code, strings, arrays, imports };
}

const files = sources().map(scan);
const byFile = new Map(files.map((f) => [path.normalize(f.file), f]));

/** A string constant's value, followed through imports; null when not a string constant. */
function resolveString(f, ident, seen = new Set()) {
  if (!f || seen.has(`${f.file}:${ident}`)) return null;
  seen.add(`${f.file}:${ident}`);
  if (f.strings.has(ident)) return f.strings.get(ident);
  const imp = f.imports.get(ident);
  return imp ? resolveString(byFile.get(path.normalize(imp.file)), imp.name, seen) : null;
}

/** A string-array constant's items, followed through imports; null when unreadable. */
function resolveArray(f, ident, seen = new Set()) {
  if (!f || seen.has(`${f.file}:${ident}`)) return null;
  seen.add(`${f.file}:${ident}`);
  if (f.arrays.has(ident)) return arrayItems(f, f.arrays.get(ident));
  const imp = f.imports.get(ident);
  return imp ? resolveArray(byFile.get(path.normalize(imp.file)), imp.name, seen) : null;
}

/** The items of an array literal's body: literals and resolvable constants, else null. */
function arrayItems(f, body) {
  const items = [];
  for (const raw of body.split(",").map((s) => s.trim()).filter(Boolean)) {
    const v = valueOf(f, raw);
    if (v == null) return null;
    items.push(v);
  }
  return items;
}

/** A literal or a resolvable constant as its string; null when computed. */
function valueOf(f, src) {
  const lit = /^(["'])([^"'\\]*)\1$/.exec(src) ?? /^`([^`$\\]*)`$/.exec(src);
  if (lit) return lit[2] ?? lit[1];
  if (/^[A-Za-z_$][\w$]*$/.test(src)) return resolveString(f, src);
  return null;
}

/** The file and name that define `ident` as seen from `f`, following imports; null when neither. */
function definitionOf(f, ident, seen = new Set()) {
  if (!f || seen.has(`${f.file}:${ident}`)) return null;
  seen.add(`${f.file}:${ident}`);
  if (new RegExp(`(?:const|let|var|function\\*?|class)\\s+${ident.replace(/\$/g, "\\$")}\\b`).test(f.code)) return { f, name: ident };
  const imp = f.imports.get(ident);
  return imp ? definitionOf(byFile.get(path.normalize(imp.file)), imp.name, seen) : null;
}

/**
 * An identifier's value as its defining module exports it, for a constant built
 * by code the scanner does not evaluate (a spread, a `.map`). Undefined when
 * the definition is not exported or its module will not load under Node.
 */
const loaded = new Map();
async function exportedValue(f, ident) {
  const def = definitionOf(f, ident);
  if (!def) return undefined;
  const url = pathToFileURL(def.f.file).href;
  if (!loaded.has(url)) loaded.set(url, await import(url).catch(() => null));
  return loaded.get(url)?.[def.name];
}

/** A string argument, statically or through the exporting module; null when computed. */
async function stringArg(f, src) {
  const v = valueOf(f, src);
  if (v != null || !/^[A-Za-z_$][\w$]*$/.test(src)) return v;
  const x = await exportedValue(f, src);
  return typeof x === "string" ? x : null;
}

/** A list-of-strings argument (array literal or constant); null when computed. */
async function listArg(f, src) {
  const list = src.startsWith("[") ? arrayItems(f, src.slice(1, -1)) : resolveArray(f, src);
  if (list || !/^[A-Za-z_$][\w$]*$/.test(src)) return list;
  const x = await exportedValue(f, src);
  return Array.isArray(x) && x.every((k) => typeof k === "string") ? [...x] : null;
}

/* --- producers --------------------------------------------------------- */

const produced = new Map(); // doc id -> Set of table keys
const produce = (docId, keys) => {
  if (!produced.has(docId)) produced.set(docId, new Set());
  for (const k of keys) produced.get(docId).add(k);
};
const errors = [];
const notes = [];

const { TABLE_RECIPES } = await import(pathToFileURL(path.join(SCRIPTS, "importer", "table-recipes.mjs")).href);
for (const [docId, doc] of Object.entries(TABLE_RECIPES)) produce(docId, Object.keys(doc.tables ?? {}));

let producerModules = 0;
for (const f of files) {
  if (!/export\s+const\s+PRODUCES\b/.test(f.code)) continue;
  let mod;
  try {
    mod = await import(pathToFileURL(f.file).href);
  } catch (err) {
    errors.push(`${rel(f.file)} exports PRODUCES but will not import under Node (${err.message}) — keep PRODUCES in a module the gate can load`);
    continue;
  }
  producerModules++;
  for (const [docId, map] of Object.entries(mod.PRODUCES ?? {})) produce(docId, Object.keys(map ?? {}));
}

/* --- readers ----------------------------------------------------------- */

const reads = new Map(); // doc id -> Map(table key -> first site), "" for the document itself
const site = (f, code, at) => `${rel(f.file)}:${code.slice(0, at).split("\n").length}`;
const read = (docId, key, where) => {
  if (!reads.has(docId)) reads.set(docId, new Map());
  const keys = reads.get(docId);
  if (!keys.has(key)) keys.set(key, where);
};
const LIB_TABLES = path.join(SCRIPTS, "lib", "tables.mjs");
let computed = 0;

for (const f of files) {
  if (path.normalize(f.file) === path.normalize(LIB_TABLES)) continue;
  const { code } = f;
  // Local names that call a reader: its own name, and any alias it was imported as.
  const names = new Map(Object.keys(READERS).map((n) => [n, n]));
  for (const [local, imp] of f.imports) if (READERS[imp.name]) names.set(local, imp.name);
  // A file's own function that happens to share a reader's name is not the reader.
  const ownFunctions = new Set(
    [...code.matchAll(/(?:function\s+([A-Za-z_$][\w$]*)\s*\(|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/g)].map(
      (m) => m[1] ?? m[2],
    ),
  );

  const pattern = new RegExp(`(?<![\\w$])(${[...names.keys()].join("|")})\\s*\\(`, "g");
  for (const m of code.matchAll(pattern)) {
    const open = m.index + m[0].length - 1;
    const { args, end } = callArgs(code, open);
    // A definition, not a call: `function getTable(…) {` or a method `getTable(…) {`.
    if (/^\s*\{/.test(code.slice(end)) || /function\s*$/.test(code.slice(0, m.index))) continue;
    const member = /\??\.\s*$/.test(code.slice(0, m.index));
    if (!member && ownFunctions.has(m[1]) && !f.imports.has(m[1])) continue;
    const shape = READERS[names.get(m[1])];
    const where = site(f, code, m.index);

    if (shape.docs != null) {
      const list = await listArg(f, args[shape.docs] ?? "");
      if (!list) computed++;
      else for (const docId of list) read(docId, "", where);
      continue;
    }
    const docId = await stringArg(f, args[shape.doc] ?? "");
    if (docId == null) {
      computed++;
      continue;
    }
    read(docId, "", where);
    if (shape.table != null && args[shape.table] != null) {
      const key = await stringArg(f, args[shape.table]);
      if (key != null) read(docId, key, where);
      else computed++;
    }
    if (shape.tables != null && args[shape.tables] != null) {
      const list = await listArg(f, args[shape.tables]);
      if (!list) errors.push(`${where}: expectTables(${docId}, …) declares a list this gate cannot read — export it, or write it as literals`);
      else for (const key of list) read(docId, key, where);
    }
    // `getDoc(X).tables.key` and `getDoc(X)?.tables?.["key"]` read a table too.
    const tail = /^\s*\??\.\s*tables\s*\??\.?\s*(?:\[\s*(["'])([^"']+)\1\s*\]|([A-Za-z_$][\w$]*))/.exec(code.slice(end));
    if (tail && names.get(m[1]) === "getDoc") read(docId, tail[2] ?? tail[3], where);
  }
}

/* --- verdict ----------------------------------------------------------- */

const waived = new Set();
const waiverFor = (docId, key) => {
  for (const id of key ? [`${docId}.${key}`, docId] : [docId]) {
    if (WAIVERS[id]) {
      waived.add(id);
      return true;
    }
  }
  return false;
};

for (const [docId, keys] of [...reads].sort(([a], [b]) => a.localeCompare(b))) {
  const have = produced.get(docId);
  if (!have) {
    if (!waiverFor(docId)) {
      errors.push(`${keys.get("") ?? [...keys.values()][0]} reads ruledata "${docId}", and nothing produces it — no recipe, no PRODUCES map`);
    }
    continue;
  }
  for (const [key, where] of keys) {
    if (!key || have.has(key)) continue;
    if (!waiverFor(docId, key)) {
      errors.push(`${where} reads table "${key}" of "${docId}", and nothing produces it — its producers write ${[...have].sort().join(", ")}`);
    }
  }
}

for (const [id, w] of Object.entries(WAIVERS)) {
  if (!waived.has(id)) {
    errors.push(`WAIVERS.${id} is stale — nothing reads it unproduced any more; delete the waiver and its ROADMAP line`);
    continue;
  }
  const doc = path.join(ROOT, w.roadmap);
  if (!fs.existsSync(doc) || !fs.readFileSync(doc, "utf8").includes(w.find)) {
    errors.push(`WAIVERS.${id} points at "${w.find}" in ${w.roadmap}, which does not say it — a waiver needs the ROADMAP line that owns the gap`);
  }
}

for (const n of notes) console.log(`  note: ${n}`);
if (errors.length) {
  for (const e of errors) console.error(`  FAIL: ${e}`);
  console.error(`\nvalidate-producers: ${errors.length} problem(s)`);
  process.exit(1);
}
const nReads = [...reads.values()].reduce((n, keys) => n + keys.size, 0);
console.log(
  `  ok: every ruledata read has a producer (${reads.size} document(s) read, ${nReads} read(s); `
    + `${produced.size} document(s) produced by the recipes and ${producerModules} PRODUCES module(s); `
    + `${waived.size} waived; ${computed} computed read(s) not checkable)`,
);
