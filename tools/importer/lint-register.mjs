/**
 * IP + schema lint for everything that ships: the register source
 * (register/<book>/, _kinds/, _refs/) and the compiled cookbook (cookbook/).
 * The hard guarantee that no passage can reach a release: every literal is
 * length-capped and shapes are validated. Module-owned (NOT the synced
 * tools/validate.mjs); wired into `npm run validate` via package.json.
 *
 * No PDFs required — runs in CI. Usage: node tools/lint-register.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BOOKS } from "../../scripts/importer/books.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REGISTER = path.join(HERE, "..", "..", "register");
const COOKBOOK = path.join(HERE, "..", "..", "cookbook");

const MAX_STR = 60; // labels/names/headings/citations — never a sentence
const MAX_NOTE = 400; // authoring commentary in register sources ("note" keys)
const MAX_PATTERN = 200; // a regex locator, validated by looksLikeRegex
const COMPOSITE_ID = /^[a-z][a-z0-9]{1,3}\.[A-Za-z0-9-]+$/; // book ids may carry digits (ax2, ax3)
const DEF_ID = /^def\.[a-z]+\.[A-Za-z0-9-]+$/;
const KIND_ID = /^kind\.[a-z][A-Za-z0-9]*$/;
const SHAPES = new Set(["open", "descriptor", "keyword", "table"]);
const OPS = new Set(["expect", "text", "value", "attacks", "art", "effects", "progression", "rolls", "grid"]);
const PATTERNS = new Set(["raw", "statValue", "int", "dice", "refList", "parenSplit", "spoilList", "statline"]);
// Grid cell patterns come from table-extract's applyCellPattern library (plus
// "glyphs", the executor's PUA-char damage-mark map).
const GRID_PATTERNS = new Set(["raw", "int", "num", "dice", "dashNull", "intDash", "rollBand", "glyphs"]);

const errors = [];
const err = (s) => errors.push(s);
const readJson = (p, label) => {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    err(`${label}: invalid JSON — ${e.message}`);
    return null;
  }
};

/**
 * A `pattern` is shipped machine vocabulary (a locator applied to the reader's
 * own text), not a passage, so it gets a longer cap — but only if it actually
 * looks like a regex. The check is what keeps the allowance from becoming a
 * hole prose could ship through: it must carry regex metacharacters and must
 * not contain a long run of plain words.
 */
function looksLikeRegex(v) {
  if (!/[\\\[\](){}|+*?^$]/.test(v)) return false;
  const words = v.replace(/\\[a-zA-Z]/g, " ").match(/[A-Za-z]{2,}/g) ?? [];
  return !/(?:[A-Za-z]{2,}\s+){6,}/.test(v) && words.length <= 12;
}

/**
 * A column key must carry every qualification its printed header carries.
 *
 * The key is the only part of a column that survives into a class document's
 * ladder — the header is a locator and is dropped. So a header that narrows
 * what a value APPLIES TO ("Melee Damage Bonus") and a key that does not
 * ("damageBonus") hand the consumer a broader rule than the page states, and
 * nothing downstream can tell the difference: the paladin's melee-only bonus
 * arrives shaped exactly like the fighter's melee-and-missile one.
 *
 * Only attack-type qualifiers are checked, because they are the ones that
 * change who a value applies to. A header word the key spells differently is
 * fine — this asks that the narrowing be present, not that the names match.
 *
 * Register-only by necessity: the compiler keeps a column's key and geometry
 * and drops its header, so this is the last point where the two can be
 * compared at all.
 */
const QUALIFIERS = ["melee", "missile", "unarmed"];
function checkColQualifiers(cols, label, where) {
  for (const col of cols ?? []) {
    const header = String(col.header ?? "").toLowerCase();
    const key = String(col.key ?? "").toLowerCase();
    for (const q of QUALIFIERS) {
      if (header.includes(q) && !key.includes(q)) {
        err(`${label}: ${where} col "${col.key}" drops the "${q}" qualifier its header states ("${col.header}") — key it "${q}${(col.key[0] ?? "").toUpperCase()}${col.key.slice(1)}"`);
      }
    }
  }
}

/** Cap every string leaf; "note" and validated "pattern" keys get longer caps. */
function capStrings(obj, label, keyPath = "") {
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (typeof v === "string") {
      if (k === "pattern" && looksLikeRegex(v)) {
        if (v.length > MAX_PATTERN) err(`${label}: ${keyPath}${k} is ${v.length} chars (>${MAX_PATTERN})`);
        continue;
      }
      // Icon paths are validated by their own shape rule above and are
      // routinely longer than the prose cap — a module path plus a descriptive
      // filename runs past 60 characters without being remotely prose.
      if (k === "icon" || k === "iconNiche") continue;
      const cap = k === "note" ? MAX_NOTE : MAX_STR;
      if (v.length > cap) err(`${label}: ${keyPath}${k} is ${v.length} chars (>${cap}) — looks like prose`);
    } else if (v && typeof v === "object") {
      capStrings(v, label, `${keyPath}${k}.`);
    }
  }
}

/* --- register entries --- */
const seenIds = new Set();
/**
 * Printed surfaces (names and aliases) folded to their comparison key.
 *
 * Two entries printing the SAME name is ordinary and is arbitrated at read
 * time by category rank — a proficiency and a thief skill are both called
 * Climbing. An ALIAS in that collision is not ordinary: an alias exists to
 * make one printed short form resolve, so a second claimant makes it resolve
 * to a coin toss. Only collisions touching an alias are errors.
 */
const surfaces = new Map(); // folded surface -> [{id, what}]
const nameFold = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
function recordSurface(key, id, what) {
  if (!key) return;
  const held = surfaces.get(key);
  if (!held) return void surfaces.set(key, [{ id, what }]);
  for (const prior of held) {
    if (prior.id === id) continue;
    if (what.startsWith("alias") || prior.what.startsWith("alias")) {
      err(`${id}: ${what} collides with ${prior.id} ${prior.what} — one printed surface, two definitions`);
    }
  }
  held.push({ id, what });
}
const kindIds = new Set();
const kindRoles = new Map(); // kind id -> role (composite | definition | note | table)

const kindsDir = path.join(REGISTER, "_kinds");
if (fs.existsSync(kindsDir)) {
  for (const f of fs.readdirSync(kindsDir).sort()) {
    if (!f.endsWith(".json")) continue;
    const k = readJson(path.join(kindsDir, f), `_kinds/${f}`);
    if (!k) continue;
    if (!KIND_ID.test(k.id ?? "")) err(`_kinds/${f}: bad kind id "${k.id}"`);
    kindIds.add(k.id);
    kindRoles.set(k.id, k.role);
    capStrings(k, `_kinds/${f}`);
  }
}

for (const dirent of fs.existsSync(REGISTER) ? fs.readdirSync(REGISTER, { withFileTypes: true }) : []) {
  if (!dirent.isDirectory() || dirent.name.startsWith("_")) continue;
  const bookId = dirent.name;
  if (!BOOKS[bookId]) err(`register/${bookId}: unknown book directory`);
  for (const f of fs.readdirSync(path.join(REGISTER, bookId)).sort()) {
    if (!f.endsWith(".json")) continue;
    const label = `register/${bookId}/${f}`;
    const arr = readJson(path.join(REGISTER, bookId, f), label);
    if (!arr) continue;
    if (!Array.isArray(arr)) {
      err(`${label}: top level must be an array`);
      continue;
    }
    for (const e of arr) {
      const id = e.id ?? "?";
      // Composites are book-scoped (mm.griffon). DEFINITIONS are register-scoped
      // and edition-independent (def.prof.alertness) even though their entry row
      // lives under the book that prints them — the same concept can be revised
      // in another book without changing its id.
      if (kindRoles.get(e.kind) === "definition") {
        if (!DEF_ID.test(id)) err(`${label}: bad definition id "${id}" (expect def.<class>.<slug>)`);
      } else {
        if (!COMPOSITE_ID.test(id)) err(`${label}: bad composite id "${id}"`);
        if (!id.startsWith(`${bookId}.`)) err(`${id}: composite id must be book-scoped (${bookId}.*)`);
      }
      if (seenIds.has(id)) err(`duplicate id ${id}`);
      seenIds.add(id);
      if (!kindIds.has(e.kind)) err(`${id}: unknown kind "${e.kind}"`);
      if (e.book !== bookId) err(`${id}: book "${e.book}" != directory "${bookId}"`);
      if (!Array.isArray(e.pages) || !e.pages.every((p) => Number.isInteger(p) && p > 0)) err(`${id}: pages must be positive ints`);
      if (!e.name) err(`${id}: name required`);
      // A constant is a clause in the middle of a paragraph, not a titled
      // block: it has no heading of any kind to locate, so it is anchored by
      // an authored box carrying an `expect` instead. Its assists are checked
      // below in place of the anchor.
      if (e.kind === "kind.constant") {
        const a = e.assists ?? {};
        if (!a.expect?.box || typeof a.expect.text !== "string") err(`${id}: constant needs assists.expect {box, text}`);
        if (!a.value?.box) err(`${id}: constant needs assists.value {box}`);
        // The anchor must not contain the value it guards, or the number ships
        // in the cookbook after all. Edition names glue their digit to a letter
        // ("3E", "5E"), so only a STANDALONE number is the value leaking.
        if (/(?:^|[^A-Za-z0-9])\d+(?![A-Za-z])/.test(a.expect?.text ?? "")) {
          err(`${id}: expect text carries a standalone number — anchor on a clause without the value`);
        }
      } else {
        const anchorKeys = Object.keys(e.anchor ?? {});
        if (anchorKeys.length !== 1 || !["display", "runin", "label", "subheading"].includes(anchorKeys[0])) {
          err(`${id}: anchor must have exactly one of display|runin|label|subheading`);
        }
      }
      // An alias is a SECOND PRINTED SURFACE for a name this register already
      // owns — never a new name for something the module does not ship. It
      // therefore may not repeat its own entry's name, and may not collide
      // with any other entry's name or alias, which would make the surface
      // index answer one printed word with two definitions.
      if (e.aliases !== undefined) {
        if (!Array.isArray(e.aliases)) err(`${id}: aliases must be an array`);
        else {
          for (const a of e.aliases) {
            if (typeof a !== "string" || !a.trim()) err(`${id}: every alias must be a non-empty string`);
            else if (nameFold(a) === nameFold(e.name)) err(`${id}: alias "${a}" repeats the entry's own name`);
            else recordSurface(nameFold(a), id, `alias "${a}"`);
          }
        }
      }
      if (e.name) recordSurface(nameFold(e.name), id, "name");
      // An icon must at least be SHAPED like a path every seat is guaranteed
      // to have: Foundry core ("icons/...") or the ACKS system's own tree
      // ("systems/acks/assets/icons/..." — the system is a hard dependency).
      // Whether the file exists can only be checked against an install, and
      // CI has none — but a typo'd path renders as a broken image on every
      // seat, so the cheap half of the check is worth having.
      // `tools/propose-icons.mjs --search` lists real paths from an install.
      if (e.icon !== undefined) {
        if (typeof e.icon !== "string" || !/^(icons|systems\/acks\/assets\/icons)\/[\w./-]+\.(webp|svg|png|jpg)$/.test(e.icon)) {
          err(`${id}: icon must be a core or acks-system path like "icons/svg/eye.svg" (got ${JSON.stringify(e.icon)})`);
        }
      }
      // The niche path points into an OPTIONAL module, so it must be a module
      // path (never a core one) and must be paired with a core `icon` — that
      // pairing is what keeps a seat without the pack from seeing nothing.
      if (e.iconNiche !== undefined) {
        if (typeof e.iconNiche !== "string" || !/^modules\/[\w-]+\/[\w./-]+\.(webp|svg|png|jpg)$/.test(e.iconNiche)) {
          err(`${id}: iconNiche must be a module path like "modules/game-icons-net/blacktransparent/x.svg" (got ${JSON.stringify(e.iconNiche)})`);
        } else if (!e.icon) {
          err(`${id}: iconNiche needs a core "icon" beside it — a seat without that module would get nothing`);
        }
      }
      for (const [name, t] of Object.entries(e.class?.tables ?? {})) checkColQualifiers(t.cols, id, `table "${name}"`);
      capStrings(e, id);
    }
  }
}

/* --- reference registers --- */
const refsDir = path.join(REGISTER, "_refs");
if (fs.existsSync(refsDir)) {
  for (const f of fs.readdirSync(refsDir).sort()) {
    if (!f.endsWith(".json")) continue;
    const label = `_refs/${f}`;
    const r = readJson(path.join(refsDir, f), label);
    if (!r) continue;
    // The compiler keys every table by `registry` (`refs[r.registry] = r`), so a
    // file that omits it lands under the literal key "undefined" — reachable by
    // nothing, and clobbered by the next file that omits it too. Requiring the
    // key to MATCH THE BASENAME keeps one obvious name per table and makes a
    // collision impossible, since two files cannot share a filename.
    if (r.registry !== f.replace(/\.json$/, "")) {
      err(`${label}: registry "${r.registry}" must equal the file's basename`);
    }
    if (!SHAPES.has(r.shape)) err(`${label}: bad shape "${r.shape}"`);
    if (r.shape === "table") {
      if (!r.table || typeof r.table !== "object") err(`${label}: table shape requires "table"`);
    } else {
      for (const [token, row] of Object.entries(r.tokens ?? {})) {
        if (token.length > MAX_STR) err(`${label}: token "${token.slice(0, 20)}…" too long`);
        if (row.ref && !DEF_ID.test(row.ref)) err(`${label}: token "${token}" bad ref "${row.ref}"`);
        if (row.ref && !(r.nodes ?? {})[row.ref]) err(`${label}: token "${token}" ref ${row.ref} has no node in this registry`);
      }
      for (const [id, node] of Object.entries(r.nodes ?? {})) {
        if (!DEF_ID.test(id)) err(`${label}: bad node id "${id}"`);
        for (const [, ed] of Object.entries(node.editions ?? {})) {
          if (ed.book && !BOOKS[ed.book]) err(`${label}: ${id} unknown edition book "${ed.book}"`);
        }
      }
    }
    capStrings(r, label);
  }
}

/* --- compiled cookbook (when present) --- */
if (fs.existsSync(COOKBOOK)) {
  // index.json names which cookbook files exist; it is not itself a cookbook.
  const idx = readJson(path.join(COOKBOOK, "index.json"), "cookbook/index.json");
  if (idx) {
    for (const key of ["books", "content"]) {
      if (!Array.isArray(idx[key])) err(`cookbook/index.json: "${key}" must be an array`);
      for (const name of idx[key] ?? []) {
        if (!fs.existsSync(path.join(COOKBOOK, `${name}.json`))) err(`cookbook/index.json: ${key} names missing "${name}.json"`);
      }
    }
  }
  for (const f of fs.readdirSync(COOKBOOK).sort()) {
    if (!f.endsWith(".json") || f === "index.json") continue;
    const label = `cookbook/${f}`;
    const cb = readJson(path.join(COOKBOOK, f), label);
    if (!cb) continue;
    if (!["acks-cookbook/1", "acks-cookbook/2", "acks-cookbook/3"].includes(cb.schema)) err(`${label}: bad schema "${cb.schema}"`);
    capStrings(cb, label);
    for (const [id, e] of Object.entries(cb.entries ?? {})) {
      for (const [field, instr] of Object.entries(e.fields ?? {})) {
        if (!OPS.has(instr.op)) err(`${label}: ${id}.${field} unknown op "${instr.op}"`);
        if (instr.pattern && !PATTERNS.has(instr.pattern)) err(`${label}: ${id}.${field} unknown pattern "${instr.pattern}"`);
        if (instr.op === "grid") {
          for (const col of instr.cols ?? []) {
            if (col.pattern && !GRID_PATTERNS.has(col.pattern)) err(`${label}: ${id}.${field} col "${col.key}" unknown grid pattern "${col.pattern}"`);
          }
          for (const [prop, over] of Object.entries(instr.props ?? {})) {
            if (over.pattern && !GRID_PATTERNS.has(over.pattern)) err(`${label}: ${id}.${field} prop "${prop}" unknown grid pattern "${over.pattern}"`);
          }
        }
      }
    }
  }
}

/* --- cross-references: every class award and matrix row names a real def --- */
if (fs.existsSync(COOKBOOK)) {
  const defIds = new Set();
  for (const f of fs.readdirSync(COOKBOOK)) {
    if (!f.endsWith(".json") || f === "index.json") continue;
    const cb = readJson(path.join(COOKBOOK, f), `cookbook/${f}`);
    for (const id of Object.keys(cb?.entries ?? {})) defIds.add(id);
  }
  const classes = readJson(path.join(COOKBOOK, "classes.json"), "cookbook/classes.json");
  for (const [id, e] of Object.entries(classes?.entries ?? {})) {
    for (const a of e.awards ?? []) {
      if (a.ref && a.ref.startsWith("def.") && !defIds.has(a.ref)) err(`${id}: award ref "${a.ref}" resolves to no cookbook entry`);
      // A choice award names its options as refs — each must resolve too.
      for (const ref of a.choice?.refs ?? []) {
        if (ref.startsWith("def.") && !defIds.has(ref)) err(`${id}: choice option ref "${ref}" resolves to no cookbook entry`);
      }
    }
  }
  const matrix = readJson(path.join(REGISTER, "_refs", "powerSource.json"), "_refs/powerSource.json");
  for (const [cls, rows] of Object.entries(matrix?.table ?? {})) {
    for (const r of rows ?? []) {
      if (r.ref && r.ref.startsWith("def.") && !defIds.has(r.ref)) err(`powerSource.${cls}: ref "${r.ref}" resolves to no cookbook entry`);
    }
  }
}

if (errors.length) {
  console.error(`register lint: ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`register lint OK (${seenIds.size} entr(ies), ${kindIds.size} kind(s)).`);
