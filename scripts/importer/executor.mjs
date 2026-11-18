/**
 * Cookbook executor — the DUMB runtime interpreter (frozen instruction set,
 * the schemas in `COOKBOOK_SCHEMAS`; see docs/importer/COOKBOOK.md).
 *
 * Performs instructions mechanically against the seat's own opened PDF: filter
 * text runs by shipped geometry, apply shipped assembly fixes, parse with the
 * fixed pattern library, resolve tokens through shipped exact-match tables,
 * read instructed visual attributes (glyph fill colors). No judgment lives
 * here: every decision was made offline and shipped as data. Content failures
 * degrade to misses/stubs; this module never throws on content.
 *
 * Runs identically in the browser (Foundry binding) and Node (verify harness).
 */
import { pageItems, pageArtInfo, SPOIL_RE } from "./extract.mjs";
import { rowsByY, applyCellPattern, slugLabel, takeProse, joinRuns as joinCellRuns } from "./table-extract.mjs";
import { opensWithNumber, printKey } from "./printed-name.mjs";
import { scenarioRoutines } from "./statline-attacks.mjs";
import { levelFraction, DAMAGE_TYPES, SAVE_CATEGORIES, TARGET_FILTERS } from "../lib/vocab.mjs";
import { CONDITIONS } from "../lib/conditions.mjs";
import { printedFrequencyText } from "../lib/magic-vocab.mjs";
import { ceilingOf } from "../equipment/armour-limits.mjs";
import { SIZES } from "../monsters/config.mjs";
import { effectsOriginOf } from "./effects-origin.mjs";

/** Monster description sections that no mechanics scan reads (see `executeEntry`). */
const UNSCANNED_MONSTER_SECTIONS = new Set(["encounter", "lair", "notes"]);

/** The cookbook schema ids `executeEntry` accepts; any other id is a `schema-mismatch`. */
export const COOKBOOK_SCHEMAS = ["acks-cookbook/1", "acks-cookbook/2", "acks-cookbook/3"];

/** The schema id of the cookbook version that added the `grid` instruction. */
export const COOKBOOK_SCHEMA = "acks-cookbook/2";

/* -------------------------------------------- */
/*  Mechanical helpers (fixed)                  */
/* -------------------------------------------- */

// Private-use-area glyphs (icons, foot/inch marks) are stripped from prose and
// raw values; damage handling reads them before the strip.
const PUA_RE = /[\uE000-\uF8FF]/g;
const clean = (s) => (s ?? "").replace(PUA_RE, "").replace(/\s+/g, " ").trim();

// Prose keeps a damage-type mark as its word, so stripping the glyph does not
// leave the damage reading as untyped. The shipped `damageGlyph` table names the
// glyph; one the table does not know is left for clean() to strip. The mark's
// colour is not in the text layer and is not read here.
const glyphWords = (s, registers) => {
  const table = registers?.tables?.damageGlyph;
  if (!table) return s ?? "";
  return (s ?? "").replace(PUA_RE, (ch) => (table[ch]?.key ? ` ${table[ch].key} ` : ch));
};

const inBox = (it, box) => it.x >= box.x0 && it.x <= box.x1 && it.y >= box.y0 && it.y <= box.y1;

/**
 * Runs inside the instruction's box(es), in reading order (y, then x) within
 * each box, the boxes in the order listed. A run on an edge two boxes share is
 * read once, in the first. ALL matching runs are returned (and claimed by the
 * caller); dropText removal happens at join time so fix ordinals and claims
 * stay stable. Exported for the compiler, which must enumerate identically when
 * computing fixes.
 */
export function runsIn(pageData, instr) {
  const boxes = instr.boxes ?? (instr.box ? [instr.box] : []);
  const seen = new Set();
  const out = [];
  for (const b of boxes) {
    const inThis = pageData.items.filter((it) => !seen.has(it) && inBox(it, b));
    for (const it of inThis) seen.add(it);
    out.push(...orderRuns(inThis));
  }
  return out;
}

/**
 * Reading order that keeps SUPERSCRIPTS (ordinal marks) with their own line: a
 * plain (y,x) sort files them ahead of the line. Derives baselines from the
 * full-size runs, attaches every run to its nearest baseline, then orders by
 * (baseline, x). `runsIn` shares this order with the compiler, so fix ordinals
 * stay aligned; changing it requires recompiling the cookbooks.
 */
function orderRuns(items) {
  if (items.length < 2) return [...items];
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const heights = sorted.map((i) => i.h).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] || 0;
  const full = sorted.filter((i) => i.h >= median * 0.8);
  const lines = [];
  for (const it of full.length ? full : sorted) {
    const line = lines.find((l) => Math.abs(l.y - it.y) <= 2);
    if (line) {
      line.y = (line.y * line.n + it.y) / (line.n + 1);
      line.n += 1;
    } else {
      lines.push({ y: it.y, n: 1 });
    }
  }
  lines.sort((a, b) => a.y - b.y);
  const lineOf = (it) => {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < lines.length; i++) {
      const d = Math.abs(lines[i].y - it.y);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  };
  return sorted
    .map((it) => ({ it, line: lineOf(it) }))
    .sort((a, b) => a.line - b.line || a.it.x - b.it.x || a.it.y - b.it.y)
    .map((r) => r.it);
}

/**
 * Join runs applying shipped fixes ({drop,joinSpace,mergeHyphen} run ordinals)
 * and skipping dropText runs (labels/headers claimed but not part of the
 * value). Ordinals index the FULL run list. Exported for compiler parity.
 */
export function joinRuns(runs, fixes = {}, dropText) {
  // One string or several: a box can enclose runs that are in it but not of it
  // (a claimed label, a chapter tab painted into the margin).
  const dropSet = new Set(
    (Array.isArray(dropText) ? dropText : dropText == null ? [] : [dropText]).map((s) => String(s).trim()),
  );
  const drop = new Set(fixes.drop ?? []);
  const joinSpace = new Set(fixes.joinSpace ?? []);
  const mergeHyphen = new Set(fixes.mergeHyphen ?? []);
  // A run-in heading can share its run with the prose after it: strip the
  // heading's characters off the front rather than dropping the run.
  const strip = fixes.stripPrefix ?? {};
  // The other end: a run that carries a clause and then what follows it keeps
  // only the first `keepPrefix` characters.
  const keep = fixes.keepPrefix ?? {};
  let out = "";
  runs.forEach((r, i) => {
    if (drop.has(i) || dropSet.has(r.str.trim())) return;
    let s = r.str;
    if (strip[i]) s = s.slice(strip[i]);
    if (keep[i] != null) s = s.slice(0, keep[i]);
    if (mergeHyphen.has(i)) s = s.replace(/-\s*$/, "");
    out += s;
    if (joinSpace.has(i)) out += " ";
  });
  return out;
}

/**
 * Matches a trailing "[Class, Class, …]" list — the classes a JJ custom power is
 * available to. It must be the LAST thing in the text and open with capitalised
 * names, so any other bracket survives. It may close with one semicolon clause
 * qualifying who else may take it (JJ p317).
 */
const OWNER_LIST = /\s*\[\s*[A-Z][A-Za-z'’’.\- ]*(?:,\s*[A-Z][A-Za-z'’’.\- ]*)*(?:;[^\]]*)?\s*\]\s*$/;
const stripOwnerList = (text) => String(text ?? "").replace(OWNER_LIST, "").trim();

/** Names vary by small-caps and spacing between books, so compare folded. */
const convKey = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** "2 1/2" -> 2.5, "1/2" -> 0.5, "3" -> 3; null when no number reads. */
function parseCount(tok) {
  const t = String(tok ?? "").trim();
  const mixed = t.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) return +mixed[1] + +mixed[2] / +mixed[3];
  const frac = t.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) return +frac[1] / +frac[2];
  const n = parseInt(t, 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * Look a name up in the conversion table (harvested offline from the System
 * Compatibility Guide). Returns `{from, to?, status, category}` for an OGL/OSR
 * or legacy name, else null. The folded index is memoised on the registers
 * object.
 */
export function convertName(registers, token) {
  const table = registers?.tables?.conversion;
  if (!table || !token) return null;
  let index = registers.__convIndex;
  if (!index) {
    index = new Map();
    for (const [from, row] of Object.entries(table)) index.set(convKey(from), { from, ...row });
    Object.defineProperty(registers, "__convIndex", { value: index, enumerable: false });
  }
  return index.get(convKey(token)) ?? null;
}

/**
 * Exact-match table lookup: token -> {text, key?, ref?}; miss -> {text}.
 *
 * On a miss the token may be a legacy or foreign (OGL/OSR) name, so the
 * conversion table is consulted and the ACKS II equivalent retried. A name the
 * guide marks "deleted"/"absent" resolves to a conversion status rather than a
 * silent miss.
 */
function lookup(registers, tableName, token, misses) {
  const row = registers?.tables?.[tableName]?.[token];
  if (row) return { text: token, ...row };

  const conv = convertName(registers, token);
  if (conv?.status === "renamed" && conv.to) {
    const renamed = registers?.tables?.[tableName]?.[conv.to];
    if (renamed) return { text: token, ...renamed, convertedFrom: conv.from, convertedTo: conv.to };
  }
  if (conv) return { text: token, conversion: conv.status, ...(conv.to ? { convertedTo: conv.to } : {}) };

  if (token && misses) misses.push({ table: tableName, token });
  return { text: token };
}

const DICE_RE = /\d*d\d+(?:[×xX]\d+)?(?:[+-]\d+)?/;
// A damage segment is real when it has dice, a flat number, or is a "by weapon"
// placeholder.
const isDamageSeg = (s) => {
  const c = clean(s);
  return DICE_RE.test(c) || /^\d+$/.test(c) || /weapon/i.test(c);
};

/** Split on commas at parenthesis depth 0 ("a (b, c), d" -> ["a (b, c)", "d"]). */
function splitTop(s) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of s ?? "") {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur);
  return out.map((t) => t.trim()).filter(Boolean);
}

/* -------------------------------------------- */
/*  Attack model (frozen, shared with compiler) */
/* -------------------------------------------- */

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Natural-weapon stems (bit->bite): fixed vocabulary, frozen with the schema.
// Ordered so a more specific stem wins (stinger before sting).
const NW_STEMS = [
  ["bite", /^bit/], ["stinger", /^stinger/], ["sting", /^sting/], ["gore", /^gor/],
  ["horn", /^horn/], ["tusk", /^tusk/], ["spine", /^spine/], ["claw", /^claw/],
  ["talon", /^talon/], ["pincer", /^pincer/], ["hoof", /^(hoof|hoov)/], ["tail", /^tail/],
  ["tentacle", /^tentacl/], ["tongue", /^tongue/], ["constriction", /^constrict/],
  ["ram", /^ram/], ["feeler", /^feeler/], ["envelopment", /^envelop/], ["weapon", /weapon/],
];

/** The natural-weapon key `name` stems to (`NW_STEMS`, first match wins), or null. */
export function stemNw(name) {
  const n = (name ?? "").toLowerCase().trim();
  for (const [key, re] of NW_STEMS) if (re.test(n)) return key;
  return null;
}

/** Split a string on top-level " or " / " OR " (not inside parentheses). */
function splitOr(s) {
  const str = s ?? "";
  const parts = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && /\bor\b/i.test(str.slice(i, i + 4)) && str.slice(i, i + 4).toLowerCase() === " or ") {
      parts.push(cur);
      cur = "";
      i += 3;
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Parse one routine (an attack count with its parenthesised counted-name list and throw target; MM pp. 80, 152, 207) -> { count, throw, names:[{name,nw}] }. */
function parseRoutine(text) {
  const t = (text ?? "").trim();
  const m = /^(\d+)?\s*(?:\(([^)]*)\))?/.exec(t);
  const count = m?.[1] ? parseInt(m[1], 10) : null;
  const inner = (m?.[2] ?? t.replace(/^\d+\s*/, "")).trim();
  const throwM = /(-?\d+)\+/.exec(inner);
  const partsText = inner.replace(/-?\d+\+\s*$/, "").trim();
  const names = [];
  for (let token of partsText.split(",")) {
    token = token.trim().replace(/-?\d+\+\s*$/, "").trim();
    if (!token) continue;
    const counted = /^(\d+)\s+(.+)$/.exec(token);
    const pushName = (nm) => names.push({ name: cap(nm), nw: stemNw(nm) });
    if (counted) for (let k = 0; k < Math.min(parseInt(counted[1], 10), 8); k++) pushName(counted[2]);
    else pushName(token);
  }
  return { count, throw: throwM ? parseInt(throwM[1], 10) : null, names };
}

/**
 * Structured attack model: Attacks and Damage fields each split on top-level
 * " or " into aligned MODES (alternatives like "1 weapon OR 2 claws + bite").
 * Within a mode, damage segments zip 1:1 with expanded attack names. Returns
 * `modes` and `flatDamage` (all damage segs in mode order, which the compiler
 * uses to align glyph colours with the runtime's enumeration). Shared by the
 * compiler and the executor.
 */
export function attackModel(attacksText, damageRaw) {
  const damageGroups = splitOr(damageRaw);
  // A bare-number attack part ("1 or 2 (<routine>)") coalesces into the routine
  // that follows it: it is a count range, not a mode. The damage "or"-groups
  // decide how many modes exist.
  const routineStrs = [];
  let alt = null;
  for (const part of splitOr(attacksText)) {
    if (/^\d+$/.test(part.trim())) {
      alt = parseInt(part, 10);
      continue;
    }
    routineStrs.push({ text: part, alt });
    alt = null;
  }
  if (!routineStrs.length) routineStrs.push({ text: alt != null ? String(alt) : attacksText ?? "", alt: null });
  const n = Math.max(damageGroups.length, routineStrs.length, 1);
  const modes = [];
  const flatDamage = [];
  for (let i = 0; i < n; i++) {
    const r = routineStrs[i] ?? routineStrs[routineStrs.length - 1];
    const routine = parseRoutine(r.text);
    if (r.alt != null) routine.altCount = r.alt;
    const dmgGroup = damageGroups[i] ?? damageGroups[damageGroups.length - 1] ?? "";
    const dmgSegs = dmgGroup.split("/").map((s) => s.trim()).filter(isDamageSeg);
    for (const d of dmgSegs) flatDamage.push(d);
    modes.push({ ...routine, dmgSegs });
  }
  return { modes, flatDamage };
}

/* -------------------------------------------- */
/*  Defense scan (frozen, vocabulary-driven)    */
/* -------------------------------------------- */

// Damage-word -> type key. Keys mirror the damageGlyph registry; English
// synonyms map to the canonical key.
const DAMAGE_WORDS = {
  acid: "acidic", acidic: "acidic", arcane: "arcane", bludgeoning: "bludgeoning",
  necrotic: "necrotic", cold: "cold", frost: "cold", electric: "electrical",
  electrical: "electrical", electricity: "electrical", lightning: "electrical",
  fire: "fire", flame: "fire", luminous: "luminous", slashing: "slashing",
  piercing: "piercing", poison: "poisonous", poisonous: "poisonous", seismic: "seismic",
};
// A defense clause ends at the sentence end or the next defence verb / contrast
// word, so one clause's flags never leak into the next.
const DEF_BOUNDARY =
  "(?=[.;]|\\b(?:but|however|except|while|though|although|whereas)\\b|\\b(?:resistant|resistance|vulnerable|susceptible)\\b|\\bhave full effect\\b|$)";

/**
 * Proportions the books write as WORDS, so a locator can read them (a bonus
 * scaled by a fraction of class level, RR pp. 60, 113, carries no digit).
 */
const WORD_NUMERALS = {
  half: 0.5,
  "one-half": 0.5,
  "one half": 0.5,
  third: 1 / 3,
  "one-third": 1 / 3,
  "two-thirds": 2 / 3,
  quarter: 0.25,
  "one-quarter": 0.25,
  "three-quarters": 0.75,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  ten: 10,
  twice: 2,
  double: 2,
};

/**
 * A located number: digits, "1,000", "1/2", or a word proportion. With
 * `articles` an indefinite article reads as one; a locator asks for that only
 * where its own page wording counts by "a" or "an", so no other locator reads
 * one into a figure.
 */
function readNumber(raw, allowFraction, { articles = false } = {}) {
  const s = String(raw ?? "").trim().toLowerCase();
  if (articles && /^an?$/.test(s)) return 1;
  const word = WORD_NUMERALS[s.replace(/\s+/g, " ")];
  if (word != null) return allowFraction ? word : Math.round(word);
  const ratio = /^(\d+)\s*\/\s*(\d+)$/.exec(s);
  if (ratio) {
    const v = Number(ratio[1]) / Number(ratio[2]);
    return allowFraction ? v : Math.round(v);
  }
  // A dice expression is a formula, not a number: the digit strip below would
  // read "<n>d<m>" as one number. NaN drops the effect.
  if (/^\d+\s*d\s*\d+/i.test(s)) return NaN;
  return allowFraction ? parseFloat(s.replace(/[^\d.-]/g, "")) : parseInt(s.replace(/[^\d-]/g, ""), 10);
}

/**
 * Build a breakpoint ladder out of one match's capture groups.
 *
 * Two shapes. Plain: every group is a VALUE and the rungs are 1..N (or
 * `steps`). Paired (`pairs`): the groups alternate rung and value, so the rungs
 * are read off the page too; a leading odd group is the first rung's value,
 * whose rung is implicit.
 *
 * `accumulate` reads a COUNT the page grows by increments, each captured rung
 * adding to the one before. With `pairs`, the groups alternate rung and
 * increment (a leading odd group is the count at level one) and every
 * increment is added to the running count. Without it, the first group is the
 * count at level one, the last is the one increment every later rung adds, and
 * the groups between are the later rungs. A group that reads no number misses
 * the whole ladder: a partial sum is never returned. `articles` reads "a" or
 * "an" as one in a VALUE group (a count or an increment, in a paired ladder
 * too), never in a rung.
 */
function ladderFrom(match, { pairs = false, steps = null, accumulate = false, articles = false } = {}) {
  const groups = match.slice(1).filter((g) => g != null);
  const out = [];
  if (accumulate) {
    const value = (g) => readNumber(g, true, { articles });
    const rung = (g) => readNumber(g, false);
    const rungs = [];
    let total = 0;
    if (pairs) {
      let i = 0;
      if (groups.length % 2) {
        total = value(groups[0]);
        if (!Number.isFinite(total)) return [];
        rungs.push({ atLevel: 1, value: total });
        i = 1;
      }
      for (; i + 1 < groups.length; i += 2) {
        const atLevel = rung(groups[i]);
        const step = value(groups[i + 1]);
        if (!Number.isFinite(atLevel) || !Number.isFinite(step)) return [];
        total += step;
        rungs.push({ atLevel, value: total });
      }
    } else {
      if (groups.length < 3) return [];
      total = value(groups[0]);
      const step = value(groups[groups.length - 1]);
      if (!Number.isFinite(total) || !Number.isFinite(step)) return [];
      rungs.push({ atLevel: 1, value: total });
      for (const g of groups.slice(1, -1)) {
        const atLevel = rung(g);
        if (!Number.isFinite(atLevel)) return [];
        total += step;
        rungs.push({ atLevel, value: total });
      }
    }
    // The running count follows the page's order, so rungs that do not climb read as a miss.
    return rungs.every((r, i) => i === 0 || r.atLevel > rungs[i - 1].atLevel) ? rungs : [];
  }
  if (pairs) {
    let i = 0;
    if (groups.length % 2) {
      const value = readNumber(groups[0], true, { articles });
      if (!Number.isNaN(value)) out.push({ atLevel: 1, value });
      i = 1;
    }
    for (; i + 1 < groups.length; i += 2) {
      const atLevel = readNumber(groups[i], false);
      const value = readNumber(groups[i + 1], true, { articles });
      if (!Number.isNaN(atLevel) && !Number.isNaN(value)) out.push({ atLevel, value });
    }
  } else {
    const nums = groups.map((g) => readNumber(g, true));
    const rungs = steps ?? nums.map((_, i) => i + 1);
    for (const [i, value] of nums.entries()) {
      if (!Number.isNaN(value)) out.push({ atLevel: rungs[i] ?? i + 1, value });
    }
  }
  return out.sort((a, b) => a.atLevel - b.atLevel);
}

/**
 * Effect fields a locator may fill, and the shape each one needs. A figure and
 * the few words a page prints beside one (a dice expression, a damage type, a
 * save category, a target filter, a mark) are locatable; every other effect
 * field is shape, which the recipe states. `value` is a LevelValue SchemaField
 * and needs the object form; `amount` and `belowFraction` may be fractional;
 * `armourRung` is read through `ceilingOf`, and `sizeKey` maps a size word onto
 * a `SIZES` key. The `dice`, `damageType`, `flag`, `sizeKey`,
 * `saveCategory` and `filters` shapes serve a spell recipe (`materializeEffects`,
 * "Spell recipes"), and the paths under `save` and `target` name SpellExtras
 * fields a spell's `values` spec fills.
 */
export const LOCATABLE_FIELDS = Object.freeze({
  value: "levelValue",
  amount: "number",
  range: "integer",
  casterLevelDelta: "integer",
  choose: "integer",
  times: "integer",
  // The total at which a rider fires.
  kickerAt: "integer",
  // Roll-outcome triggers (the lib's `outcome`, RR pp. 386, 425; JJ p. 259): the
  // botch band's top edge and the notice fraction, read through the
  // word-numeral table.
  naturalMax: "integer",
  belowFraction: "number",
  // A gate's figures (the lib's `gate`, lib/typed-modifiers.mjs): its load, and
  // the clause naming the armour rung, which `ceilingOf` maps to the ladder key.
  "gate.loadMax": "number",
  "gate.armourMax": "armourRung",
  // A spell row's dice, its damage type, its printed extraordinary mark and its ceiling.
  roll: "dice",
  damage: "damageType",
  extraordinary: "flag",
  // The condition words a row's page prints, onto the lib catalogue's keys.
  conditions: "conditions",
  // A `progressionAs` row's fraction of class level: the captured proportion is
  // written as the `atLevelNum` / `atLevelDen` pair (nothing at a whole level).
  atLevel: "levelFraction",
  max: "levelValue",
  // The invocation levels a spell row applies at, both inclusive
  // (`rowInInvocationRange`); a level a page prints is a printed value.
  invocationFrom: "integer",
  invocationTo: "integer",
  // The dice a `rounds` lasting counts, and the size word at or above which a
  // target is exempt from the row (`sizeKey`: a word onto a monsters `SIZES` key).
  rounds: "dice",
  exemptSizeFrom: "sizeKey",
  exemptSizeOver: "sizeKey",
  // A spell's own SpellExtras fields.
  "save.category": "saveCategory",
  "save.modifier": "levelValue",
  "save.exemptBelowHd": "levelValue",
  "target.filters": "filters",
  "target.count": "levelValue",
  "target.hdCap": "levelValue",
  "target.hdBelow": "levelValue",
  "target.area.size": "levelValue",
  "target.area.width": "levelValue",
});

/**
 * Write a located value at `into`, a dotted path of any depth ("gate.loadMax",
 * "target.area.size"): every object along the path is copied on the way down,
 * so a shared recipe object is never written through.
 */
function setLocated(node, into, value) {
  const [head, ...rest] = into.split(".");
  if (!rest.length) {
    node[head] = value;
    return;
  }
  node[head] = { ...(node[head] ?? {}) };
  setLocated(node[head], rest.join("."), value);
}

/** The longest condition a locator may read; a longer capture ran past its clause. */
const CONDITION_MAX = 200;

/**
 * The effect fields a recipe may read off the page as a clause, each through
 * the locator named `<field>From`: the row's condition, a limitation's
 * restriction, an outcome's consequence, and the remark a capability or
 * companion row shows as its face.
 */
export const CLAUSE_FIELDS = Object.freeze(["condition", "restriction", "consequence", "note"]);

/** A captured clause, whitespace collapsed and freed of the list glyph or punctuation it sits between. */
function cleanClause(s) {
  const t = String(s ?? "")
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/[\s,;:]+$/u, "")
    .trim();
  // A clause lifted from a sentence's start keeps no capital: it reads after
  // the row's own figure. An acronym ("STR …") keeps its case.
  return /^\p{Lu}(?:\p{Ll}|\s)/u.test(t) ? t[0].toLowerCase() + t.slice(1) : t;
}

/**
 * A row's clause read off the seat's own page (`conditionFrom` on an effect
 * or roll spec, or another of `CLAUSE_FIELDS`' locators on an effect): the
 * capture `group` (default 1), or the captures `groups` names joined by ", ",
 * cleaned. Null when the locator misses, is malformed, or reads nothing or
 * more than a clause; the spec's shipped field, a neutral label or the
 * module's remark, then stands. Unlike a figure's locator, a miss never drops
 * the row.
 *
 * @param {{pattern: string, flags?: string, group?: number, groups?: number[]}} loc
 * @param {string} text the seat's extracted prose, joined
 * @returns {string|null}
 */
export function locateCondition(loc, text) {
  if (!loc?.pattern || !text) return null;
  let m = null;
  try {
    m = new RegExp(loc.pattern, loc.flags ?? "i").exec(text);
  } catch {
    return null; // a malformed locator never throws at the table
  }
  if (!m) return null;
  const groups = Array.isArray(loc.groups) && loc.groups.length ? loc.groups : [loc.group ?? 1];
  const out = groups
    .map((g) => cleanClause(m[g]))
    .filter(Boolean)
    .join(", ");
  return out && out.length <= CONDITION_MAX ? out : null;
}

/** What a locator answers when its pattern finds nothing, or finds something its field cannot hold. */
const MISS = Symbol("miss");

/** A dice expression: terms of `NdM` or a whole number, joined by + or -, with a die among them. */
const DICE_TERMS = /^(?:\d*d\d+|\d+)(?:[+-](?:\d*d\d+|\d+))*$/;

/** A captured dice expression with its spaces removed, or MISS when it is no dice formula. */
function readDice(raw) {
  const t = String(raw ?? "").toLowerCase().replace(/\s+/g, "");
  return DICE_TERMS.test(t) && /d\d/.test(t) ? t : MISS;
}

/**
 * The key of the vocabulary member a captured word names, by key or by label,
 * singular or plural; null when none, or when the member is in `skip`.
 */
function memberOf(vocab, word, skip = []) {
  const w = String(word ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return null;
  for (const form of [w, w.replace(/s$/, "")]) {
    const hit = Object.entries(vocab).find(
      ([key, v]) => !skip.includes(key) && (key.toLowerCase() === form || String(v.label ?? "").toLowerCase().replace(/[^a-z]/g, "") === form),
    );
    if (hit) return hit[0];
  }
  return null;
}

/** The most words a catalogue label runs to when a capture is read for condition names. */
const CONDITION_LABEL_WORDS = 5;

/**
 * The catalogue keys a captured list of condition words names, in the order
 * printed and once each. At each word the longest run of words that names a
 * condition wins, so a label of several words reads whole; a word that names
 * none is skipped.
 */
function conditionKeysIn(raw) {
  const words = String(raw ?? "").split(/[^A-Za-z]+/).filter(Boolean);
  const keys = [];
  for (let i = 0; i < words.length; ) {
    let took = 0;
    for (let len = Math.min(CONDITION_LABEL_WORDS, words.length - i); len > 0 && !took; len--) {
      const key = memberOf(CONDITIONS, words.slice(i, i + len).join(""));
      if (key) {
        if (!keys.includes(key)) keys.push(key);
        took = len;
      }
    }
    i += took || 1;
  }
  return keys;
}

/**
 * Read one matched locator into the value its field holds: a number, a
 * LevelValue, a dice string, a one-member damage set, a save category, a list
 * of filter keys or condition keys, a rung or the mark's `true`. MISS when the
 * match holds nothing that field can use.
 */
function locateField(loc, kind, m) {
  // A ladder reads every capture group at once, before the single-value path.
  if (kind === "levelValue" && loc.on) {
    const breakpoints = ladderFrom(m, { pairs: loc.pairs, steps: loc.steps, accumulate: loc.accumulate === true, articles: loc.articles === true });
    if (!breakpoints.length) return MISS;
    return loc.on === "level"
      ? { kind: "breakpoints", breakpoints, ...(loc.round ? { round: loc.round } : {}) }
      : { kind: "conditional", on: loc.on, breakpoints, ...(loc.round ? { round: loc.round } : {}) };
  }
  if (kind === "flag") return true;
  const raw = String(m[loc.group ?? 1] ?? m[0]);
  if (kind === "armourRung") return ceilingOf(raw) ?? MISS; // a rung is a word; a clause naming none reads none
  if (kind === "dice") return readDice(raw);
  if (kind === "sizeKey") return memberOf(SIZES, raw) ?? MISS;
  if (kind === "damageType") {
    const key = memberOf(DAMAGE_TYPES, raw, ["varies"]);
    return key ? [key] : MISS;
  }
  if (kind === "saveCategory") return memberOf(SAVE_CATEGORIES, raw, ["none"]) ?? MISS;
  // A proportion of class level, as the scan reads one: a word or a figure the
  // pair `levelFraction` states exactly; anything else is a miss.
  if (kind === "levelFraction") return levelFraction(readNumber(raw, true)) ?? MISS;
  if (kind === "conditions") {
    const keys = conditionKeysIn(raw);
    return keys.length ? keys : MISS;
  }
  if (kind === "filters") {
    const keys = [...new Set(raw.split(/[^A-Za-z]+/).map((w) => memberOf(TARGET_FILTERS, w)).filter(Boolean))];
    return keys.length ? keys : MISS;
  }
  // The punctuation strip keeps the decimal point for every field but an
  // integer one; `value` may be a fraction of class level (RR pp. 41, 60; JJ p. 311).
  const n = readNumber(raw, kind !== "integer", { articles: loc.articles === true });
  if (!Number.isFinite(n)) return MISS;
  // A rate printed apart from the base is read from its own group; `perSign`
  // is the direction the page's verb states (-1 for "reduces").
  let per = loc.per ?? n;
  if (loc.as === "perLevel" && loc.perGroup) {
    const rate = readNumber(String(m[loc.perGroup] ?? ""), true);
    if (!Number.isFinite(rate)) return MISS;
    per = (loc.perSign === -1 ? -1 : 1) * Math.abs(rate);
  }
  if (kind !== "levelValue") return n;
  return loc.as === "perLevel"
    ? // The located number is both the first-level value and the rate;
      // an explicit `per` overrides the rate.
      { kind: "perLevel", base: n, per, ...(loc.round ? { round: loc.round } : {}) }
    : { kind: "flat", flat: n };
}

/**
 * Materialize an ability's structured EFFECTS from authored specs.
 *
 * The cookbook ships the effect's STRUCTURE (type, target, mode, refs, ifHas,
 * stacking), never its numbers. A spec that carries a number points at it with
 * a locator applied to THIS SEAT'S own extracted prose. A locator that does not
 * match drops that effect. See docs/importer/MODEL.md, "An ability's modifiers: recipe or scan".
 *
 * `from` is one locator or an array of them, each naming the field it fills:
 *
 *   "from": { "pattern": "a (-?\\d+) penalty" }                    -> value
 *   "from": [{ "into": "amount", "pattern": "(\\d+)% per month" }]  -> amount
 *
 * `into` defaults to `value`. An `into` naming a field that is not locatable
 * drops the effect.
 *
 * A locator filling `value` may ask for a scaling shape instead of a flat one:
 *
 *   { "as": "perLevel", "pattern": "restore (\\d+) hit points per .*level" }
 *        -> base and rate both the located number ("N hp per level" is
 *          N·level). `per` overrides the rate; `round` ("up"|"down") states
 *          the page's rounding. `perGroup` reads the rate from that capture
 *          group instead, signed by `perSign` (-1 where the verb lowers it).
 *   { "into": "gate.loadMax", "pattern": "carrying (\\d+) stone" }
 *        -> one level of nesting: a gate's figure, beside the gate's kind the
 *          recipe ships.
 *   { "into": "gate.armourMax", "pattern": "wearing\\s*(.*?)\\s*and carrying" }
 *        -> a gate's armour rung: the capture is the clause naming what may be
 *          worn, and the heaviest ladder word in it is the rung (`ceilingOf`).
 *   { "into": "atLevel", "pattern": "as a crusader of (one half) his class level" }
 *        -> a `progressionAs` row's fraction: the captured word or figure is
 *          written as `atLevelNum` and `atLevelDen`, and as neither at a whole level.
 *   { "on": "level", "pairs": true, "pattern": "…(\\d+)…(\\d+)…(\\d+)…(\\d+)…" }
 *        -> a breakpoint ladder. `on:"level"` gives a plain `breakpoints`
 *          LevelValue; any other VALUE_SCALES scale gives a `conditional` one.
 *
 * `conditionFrom`, `restrictionFrom`, `consequenceFrom` and `noteFrom` read
 * that field off the page in place of the shipped neutral label or remark
 * (`locateCondition`, `CLAUSE_FIELDS`); none of them decides completeness.
 *
 * Spell recipes. A spell register row's `effects` become rows of the spell's
 * `effects` list, and its `values` become fragments of its SpellExtras, which
 * `bindSpell` deep-merges. Five shapes locate what a page prints beside a
 * figure: `roll` reads a dice expression (spaces removed, held to a dice
 * formula); `damage` a damage word, written as a one-member set;
 * `extraordinary` is true where its pattern matches; `save.category` reads a
 * word onto a save category; `target.filters` reads target words onto the
 * filter keys it knows; `rounds` reads a dice formula like `roll`, and
 * `exemptSizeFrom` and `exemptSizeOver` a size word onto a monsters size key. A locator for a count
 * the page writes with "a" or "an" sets `articles: true`, which reads an
 * article as one inside that locator only; a count that grows by increments sets
 * `accumulate` (see `ladderFrom`). A word no vocabulary member answers to is a miss.
 *
 * `"onMiss": "blank"` on a spec changes what a miss costs: the locator that
 * missed leaves its field unset, the row keeps every other field it located,
 * and the fields missed are listed in the row's `unread`. Without it a miss
 * drops the row, as above. `onMiss` never reaches the result.
 *
 * A spec's `each` (`{pattern, flags?, group?}`) makes it a template for a
 * printed option list: one row per match of the pattern, in page order, keyed
 * `<key><n>` with `pickOption` `<n>` (the match's 1-based place), its `from`
 * and clause locators read inside that match (`group`, default the whole). The
 * `conditions` locator reads a list of condition words onto catalogue keys and
 * skips a word none answers to; an option that names no condition is dropped.
 */
export function materializeEffects(specs, paras) {
  const text = (paras ?? []).map((p) => (typeof p === "string" ? p : p.text)).join(" ");
  const out = [];
  for (const spec of specs ?? []) {
    const { from, onMiss, each, ...effect } = spec ?? {};
    const blank = onMiss === "blank";
    // The clause locators never ride into the world: they are read here or not at all.
    const clauses = CLAUSE_FIELDS.map((field) => [field, effect[`${field}From`]]);
    for (const field of CLAUSE_FIELDS) delete effect[`${field}From`];
    const locators = (Array.isArray(from) ? from : from ? [from] : []).filter((l) => l?.pattern);
    if (each === undefined) {
      const row = materializeRow(effect, locators, clauses, blank, text, false);
      if (row) out.push(row);
      continue;
    }
    // A template row expands once per match of `each`, in page order: the n-th
    // match (counted over every match, so a dropped option leaves its number
    // unused) makes the row `<key><n>` of option `<n>`, and its locators read
    // inside that match alone.
    const group = each?.group ?? 0;
    let n = 0;
    for (const m of eachMatches(each, text)) {
      n++;
      const within = String(m[group] ?? "");
      if (!within) continue;
      const row = materializeRow({ ...effect, key: `${effect.key ?? ""}${n}`, pickOption: String(n) }, locators, clauses, blank, within, true);
      if (row) out.push(row);
    }
  }
  return out;
}

/** Every match of an `each` locator in `text`, in page order; none when it names no pattern, is malformed or the page is blank. */
function eachMatches(each, text) {
  if (!each?.pattern || !text) return [];
  const flags = each.flags ?? "i";
  try {
    return [...text.matchAll(new RegExp(each.pattern, flags.includes("g") ? flags : `${flags}g`))];
  } catch {
    return []; // a malformed locator never throws at the table
  }
}

/**
 * One effect row's locators and clause locators read over `text`: the row, or
 * null when it is dropped. A miss drops the row unless `blank`, which lists the
 * field in `unread` instead; `perOption` marks a row expanded from `each`, whose
 * condition list that names no condition is dropped even then, since an option
 * with nothing to grant has nothing to apply. A row whose invocation bound is
 * unread, or whose range runs backwards, is dropped even then: unbounded it would
 * stand at every level.
 */
function materializeRow(base, locators, clauses, blank, text, perOption) {
  const effect = { ...base };
  const unread = [];
  for (const loc of locators) {
    const into = loc.into ?? "value";
    const kind = LOCATABLE_FIELDS[into];
    if (!kind) return null; // a field that is not locatable drops the row
    let m = null;
    try {
      m = text ? new RegExp(loc.pattern, loc.flags ?? "i").exec(text) : null;
    } catch {
      m = null; // a malformed locator never throws at the table
    }
    const got = m ? locateField(loc, kind, m) : MISS;
    if (got === MISS) {
      // All or nothing unless the spec asks for blanks: a half-matched effect is dropped whole.
      // An unread invocation bound drops the row even then: unbounded, it would stand at every level.
      if (!blank || (perOption && kind === "conditions") || INVOCATION_BOUNDS.includes(into)) return null;
      unread.push(into);
      continue;
    }
    if (kind === "levelFraction") {
      // The pair a LevelValue stores; a whole level stores neither.
      if (got.num !== got.den) Object.assign(effect, { atLevelNum: got.num, atLevelDen: got.den });
    } else {
      setLocated(effect, into, got);
    }
  }
  // A range that runs backwards is dropped whole, blank or not.
  if (Number.isInteger(effect.invocationFrom) && Number.isInteger(effect.invocationTo) && effect.invocationFrom > effect.invocationTo) return null;
  for (const [field, loc] of clauses) {
    const read = locateCondition(loc, text);
    if (read) effect[field] = read;
  }
  if (unread.length) effect.unread = [...new Set(unread)];
  return effect;
}

/** The two located fields that bound a spell row's invocation levels. */
const INVOCATION_BOUNDS = Object.freeze(["invocationFrom", "invocationTo"]);

/**
 * Materialize an ability's ROLLS from authored specs — the per-entry recipe
 * that displaces `rollScan`.
 *
 * What the RECIPE ships: how many rolls the entry offers, each one's stable
 * key, its roll type and formula, and WHERE to find its parts. What comes from
 * the seat's own book: the label, the target number, and every step of a rank
 * or level ladder. A spec whose locator does not match drops that roll.
 *
 *   { key, label:{pattern,group?}, target:{pattern} | {pattern,on,steps},
 *     rollType?, formula?|{pattern,group?}, condition?, conditionFrom?, note? }
 *
 * `conditionFrom` reads the throw's condition off the page in place of the
 * shipped neutral `condition` (`locateCondition`), and never drops the roll.
 *
 * `formula` may be a locator instead of a string, for a roll whose DICE are
 * part of the printed rule. A `measure` needs no target and is complete
 * without one. A `fromLadders` spec is skipped here and expanded by the binder,
 * which can reach the class entry that publishes the ladders.
 *
 * `target.progression` (`{as, table, fraction?, round?}`) makes the throw a
 * borrowed one: the target locator proves the page prints the borrowing,
 * `as`/`table` name the class and skill ladder it reads, and `fraction` and
 * `round` are locators for the proportion of the level and the way it rounds.
 *
 * `target.on` names a VALUE_SCALES scale ("rank", "level"): the locator's
 * capture groups become the ladder's steps in order, so three targets with
 * on:"rank" are ranks 1/2/3. `steps` overrides the step numbers when the
 * book's ladder does not start at 1.
 */
export function materializeRolls(specs, paras, ctx = {}) {
  const text = (paras ?? []).map((p) => (typeof p === "string" ? p : p.text)).join(" ");
  if (!text) return [];
  const out = [];
  const run = (loc) => {
    if (!loc?.pattern) return null;
    try {
      return new RegExp(loc.pattern, loc.flags ?? "i").exec(text);
    } catch {
      return null; // a malformed locator never throws at the table
    }
  };
  for (const spec of specs ?? []) {
    const { label, target, formula, fromLadders, conditionFrom, ...rest } = spec ?? {};
    // A `fromLadders` spec is expanded by the binder, not located in prose.
    if (fromLadders) continue;
    const roll = { formula: "1d20", rollType: "above", ...rest };
    const read = locateCondition(conditionFrom, text);
    if (read) roll.condition = read;

    // The dice may be a string the spec names outright, or a locator that reads them.
    if (typeof formula === "string") roll.formula = formula;
    else if (formula?.pattern) {
      const fm = run(formula);
      const dice = fm && String(fm[formula.group ?? 1] ?? "").replace(/\s+/g, "").trim();
      if (!dice) continue; // no dice located — drop the roll, never guess one
      roll.formula = dice;
    }

    const lm = run(label);
    if (label && !lm) continue; // the recipe expects a name it cannot find here
    if (lm) {
      const text0 = String(lm[label.group ?? 1] ?? "").replace(/\s+/g, " ").trim();
      if (text0) roll.label = text0;
    }

    // The entry's own progression ladder (`ctx.progression`, read by the
    // `progression` op) as this roll's target, for an ability whose numbers
    // live in a grid and not in its prose. No ladder materialized (bookless
    // seat) drops the roll like any other unlocated target.
    if (target?.fromProgression) {
      if (!ctx.progression?.breakpoints?.length) continue;
      roll.scale = "level";
      roll.target = ctx.progression;
      out.push(roll);
      continue;
    }

    // A borrowed throw: a skill taken as another class at a fraction of class level, with a rounding clause (RR pp. 116, 121).
    // The recipe ships the class's skill and where the sentence is; the
    // proportion and the rounding are read off the seat's own prose. A named
    // proportion the page does not yield drops the roll; a rounding it does not
    // state is left off, for the caller's default.
    if (target?.progression) {
      if (!run(target)) continue;
      const { as, table, fraction, round } = target.progression;
      const borrowed = { kind: "progression", as, table };
      if (fraction) {
        const fm = run(fraction);
        const parts = fm ? levelFraction(readNumber(fm[fraction.group ?? 1], true)) : null;
        if (!parts) continue;
        if (parts.num !== parts.den) Object.assign(borrowed, { atLevelNum: parts.num, atLevelDen: parts.den });
      }
      const rm = round ? run(round) : null;
      const way = String(rm?.[round?.group ?? 1] ?? "").toLowerCase();
      if (way === "up" || way === "down") borrowed.round = way;
      roll.scale = "level";
      roll.target = borrowed;
      out.push(roll);
      continue;
    }

    // A measure is not rolled against anything, so it is complete with no target.
    if (roll.rollType === "measure") {
      out.push(roll);
      continue;
    }

    const tm = run(target);
    if (!tm) continue; // no target materialized — drop the roll, never guess
    if (target.on) {
      const breakpoints = ladderFrom(tm, { pairs: target.pairs, steps: target.steps });
      if (!breakpoints.length) continue;
      roll.scale = target.on;
      roll.target = { kind: "conditional", on: target.on, breakpoints };
    } else {
      const n = parseInt(String(tm[target.group ?? 1] ?? tm[0]).replace(/[^\d-]/g, ""), 10);
      if (Number.isNaN(n)) continue;
      roll.target = { kind: "flat", flat: n };
    }
    out.push(roll);
  }
  return out;
}

/**
 * Every ROLL an ability offers, read from the seat's own prose: each throw is
 * captured separately, with its rank ladder where the text states one. The
 * numbers come from the reader's book; what ships is the shape throws take.
 * Never labels a roll (`label` is deleted from every result).
 */
export function rollScan(paras) {
  const text = (paras ?? []).map((p) => (typeof p === "string" ? p : p.text)).join(" ");
  if (!text) return [];
  const out = [];
  const seen = new Set();
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 32);

  // Spans claimed by the rank-ladder pass, so the plain-roll pass cannot re-read
  // a ladder's first step as a separate flat throw.
  const claimed = [];
  const inClaimed = (i) => claimed.some(([a, b]) => i >= a && i < b);

  // A proficiency throw written as a slash run of three targets (RR p. 106) —
  // one roll whose target improves by RANK.
  for (const m of text.matchAll(/([a-z][a-z' -]{2,40}?)\s+(?:requires|takes)?[^.]{0,40}?proficiency throw of\s*(\d+)\+\s*\/\s*(\d+)\+\s*\/\s*(\d+)\+/gi)) {
    const label = m[1].replace(/\s+/g, " ").trim();
    const key = slug(label) || `roll${out.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    claimed.push([m.index, m.index + m[0].length]);
    out.push({
      key, formula: "1d20", rollType: "above", scale: "rank",
      target: { kind: "conditional", on: "rank", breakpoints: [1, 2, 3].map((r, i) => ({ atLevel: r, value: parseInt(m[i + 2], 10) })) },
    });
  }

  // A plain "<verb phrase> … proficiency throw of N+" / "<verb phrase> on N+".
  for (const m of text.matchAll(/([a-z][a-z' -]{2,40}?)\s+(?:on|requires[^.]{0,40}?and a)\s+(?:a\s+)?(?:proficiency throw of\s*)?(\d+)\+/gi)) {
    const label = m[1].replace(/\s+/g, " ").trim();
    if (!/[a-z]{3}/.test(label)) continue;
    if (inClaimed(m.index)) continue;
    const key = slug(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    // No `scale` on a flat target: a scale claims the number varies.
    out.push({ key, label, formula: "1d20", rollType: "above", target: { kind: "flat", flat: parseInt(m[2], 10) } });
  }
  // No labels from a scan: a scanned phrase is a parser artifact, and naming a
  // roll is per-entry recipe work.
  for (const r of out) delete r.label;
  return out;
}

/**
 * The anchors a frequency phrase is read by, each paired with the key it
 * reads to. Every key is a `SPELL_LIKE_FREQ` member (`lib/magic-vocab.mjs`);
 * `tools/test-magic.mjs` holds the table to that vocabulary. A `printed`
 * member's anchor reads a phrase the module names only as the key: the
 * words are the book's, and the row keeps them as text.
 */
export const FREQ = [
  [/\bat will\b/i, "atWill"],
  [/\bonce per round\b/i, "perRound"],
  [/\bonce (?:per|every) (?:three|3) turns\b/i, "printedFreq1"],
  [/\bonce per turn\b/i, "perTurn"],
  [/\bonce per 8 hours\b/i, "printedFreq2"],
  [/\bonce per hour\b/i, "perHour"],
  [/\b(?:three|3) times per day\b|\bthrice (?:per|a) day\b/i, "printedFreq3"],
  [/\bonce per day\b/i, "perDay"],
  [/\bonce per week\b/i, "perWeek"],
  [/\bonce per month\b/i, "perMonth"],
  [/\bonce (?:per|every) season\b/i, "perSeason"],
  [/\bonce per year\b/i, "perYear"],
];

/** A frequency phrase's key; "" when the text carries no phrase. */
export const frequencyOf = (s) => FREQ.find(([re]) => re.test(String(s ?? "")))?.[1] ?? "";

/** The words of the first anchor `frequencyOf` reads, as the page prints them; "" when none matches. */
export const frequencyPhraseOf = (s) => {
  const text = String(s ?? "");
  for (const [re] of FREQ) {
    const hit = re.exec(text);
    if (hit) return hit[0];
  }
  return "";
};

/** The page's words for a frequency the module names only as a key (a `printed` member); "" for any other. */
export const frequencyTextOf = (s) => printedFrequencyText(frequencyOf(s), frequencyPhraseOf(s));

/**
 * The frequency fields a row takes from text: `{frequency}` and, for a
 * `printed` member, `{frequencyText}` holding the phrase the page printed.
 * `{}` when the text carries no frequency.
 */
export function frequencyFieldsOf(s) {
  const frequency = frequencyOf(s);
  if (!frequency) return {};
  const frequencyText = frequencyTextOf(s);
  return { frequency, ...(frequencyText ? { frequencyText } : {}) };
}

/**
 * Derive an ability's structured EFFECTS from its OWN prose, classified against
 * a SHIPPED vocabulary (the `modifierTarget` register) plus a fixed library of
 * shape patterns. Effect type, target and value all materialize from the
 * seat's book; the cookbook pre-declares none of them. A per-entry recipe
 * replaces this scan outright (`materializeEffects`).
 */
export function effectScan(paras, registers) {
  const text = (paras ?? []).map((p) => (typeof p === "string" ? p : p.text)).join(" ");
  if (!text) return [];
  // Longest surface wins ("initiative rolls" before "initiative").
  const targets = Object.entries(registers?.tables?.modifierTarget ?? {})
    .map(([surface, row]) => [surface.toLowerCase(), row.key])
    .sort((a, b) => b[0].length - a[0].length);
  const classify = (phrase) => {
    const p = ` ${String(phrase).toLowerCase().replace(/\s+/g, " ").trim()} `;
    for (const [surface, key] of targets) if (p.includes(` ${surface} `)) return key;
    return null;
  };
  // The bare nouns a later conjunct may not be read by.
  const GENERIC_SURFACES = new Set(["throws", "throw", "rolls", "roll"]);
  /**
   * Every target a phrase names, one per conjunct, each with the conjunct that
   * named it. A phrase no conjunct names is read whole, so a surface spanning
   * the "and" still classifies. Several conjuncts naming one target are one
   * target.
   */
  const classifyAll = (phrase) => {
    const found = [];
    String(phrase)
      .split(/\s*,\s*|\s+and\s+/i)
      .forEach((part, i) => {
        const p = ` ${part.toLowerCase().replace(/\s+/g, " ").trim()} `;
        for (const [surface, key] of targets) {
          if (i > 0 && GENERIC_SURFACES.has(surface)) continue;
          if (!p.includes(` ${surface} `)) continue;
          if (!found.some((f) => f.key === key)) found.push({ key, part });
          break;
        }
      });
    if (found.length) return found;
    const key = classify(phrase);
    return key ? [{ key, part: phrase }] : [];
  };
  /** The activity each target's phrase names: the whole phrase's for one target, each conjunct's own for several. */
  const targetsOf = (phrase) => {
    const found = classifyAll(phrase);
    return found.map(({ key, part }) => ({ key, forWhat: namedActivity(found.length > 1 ? part : phrase) }));
  };

  /**
   * Which activity a target phrase names, if it names one. `classify` yields
   * only the KIND of thing modified (the vocabulary is shipped); the name is
   * read off the seat's own page. The activity is the run of capitalised words
   * the phrase opens with, joined by "and"/"or"; a phrase that opens lowercase
   * names none and returns "".
   */
  const namedActivity = (phrase) => {
    const words = String(phrase ?? "").trim().split(/\s+/);
    const taken = [];
    for (const w of words) {
      if (/^[A-Z][A-Za-z'-]*$/.test(w)) taken.push(w);
      else if (taken.length && /^(and|or|&)$/i.test(w)) taken.push(w);
      else break;
    }
    while (taken.length && /^(and|or|&)$/i.test(taken.at(-1))) taken.pop();
    return taken.join(" ");
  };
  const out = [];
  const seen = new Set();
  const push = (e) => {
    const k = JSON.stringify(e);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(e);
  };

  // Values ship as the lib's LevelValue objects, which the ability DataModel
  // requires (a bare number fails the SchemaField).
  const flat = (n) => ({ kind: "flat", flat: n });

  /* --- Context: every candidate number is judged against the sentence it came from:
   *   replace  the number stands but supersedes a default ("instead of")
   *   skip     the context inverts or voids it, or the number is not a
   *            modifier at all (a die face, an opponent's penalty)
   * Anything the scan cannot model is dropped and left to a recipe. --- */
  const bounds = [];
  {
    let at = 0;
    for (const s of text.split(/(?<=\.)\s+/)) {
      bounds.push({ start: at, end: at + s.length, s });
      at += s.length + 1;
    }
  }
  const sentenceAt = (i) => bounds.find((b) => i >= b.start && i <= b.end)?.s ?? text;

  /** A number that is a DIE FACE, not a modifier: the figure after an unmodified-roll lead-in (RR pp. 110, 113, 115, 266). */
  const isDieFace = (sentence, n) =>
    new RegExp(`(?:unmodified|natural)\\s+(?:die\\s+)?rolls?\\s+of\\s+${Math.abs(n)}\\b|rolls?\\s+of\\s+${Math.abs(n)}\\s*(?:-|–|to)\\s*\\d`, "i").test(sentence);

  const judge = (sentence, n) => {
    if (isDieFace(sentence, n)) return "skip";
    // A negation clause (a does-not-suffer, nor-is or without-penalty form; RR
    // pp. 108, 119) voids the penalty.
    if (/\b(?:does not|doesn't|no longer|never)\s+suffers?\b|\bnor is\b|\bwithout (?:any )?penalt/i.test(sentence)) return "skip";
    // An instead-of lead-in (RR p. 108) replaces a default; checked before the
    // opponent rule. A conditional replacement is skipped for a recipe, since
    // the scan cannot read the condition.
    if (/\binstead of\b|\brather than\b|\bin lieu of\b/i.test(sentence)) {
      return /\b(?:if|when|while|unless|against)\b/i.test(sentence) ? "skip" : "replace";
    }
    // A penalty stated for the opponent is not a modifier on this character.
    if (/\bopponents?\b|\benemies\b|\benemy\b|\btargets?\b/i.test(sentence) && n < 0) return "skip";
    // A conditioned bonus is marked situational; the circumstance stays in the
    // description.
    if (/\b(?:if|when|while|unless|against|versus|vs\.?)\b/i.test(sentence)) return "conditional";
    return "add";
  };

  /** Push a modifier only if its context supports the reading. */
  const pushModifier = (e, index) => {
    const sentence = sentenceAt(index);
    const v = judge(sentence, e.value?.flat ?? 0);
    if (v === "skip") return;
    push({
      ...e,
      mode: v === "replace" ? "replace" : "add",
      ...(v === "conditional" ? { condition: "situational" } : {}),
    });
  };

  const OWNER = "(?:all\\s+|his\\s+|her\\s+|their\\s+|its\\s+|the\\s+)?";
  // The target phrase cap must reach the end of a two-activity name (two
  // proficiencies joined by "and", RR p. 119).
  const TARGET = `${OWNER}[A-Za-z' -]{2,50}`;
  // A signed figure, then the word bonus or penalty, then "to"/"on" and the target (RR pp. 26, 105; JJ p. 308; MM pp. 12, 13, 267)
  for (const m of text.matchAll(new RegExp(`([+-]?\\d+)\\s+(bonus|penalty)\\s+(?:to|on)\\s+(${TARGET})`, "gi"))) {
    let n = parseInt(m[1], 10);
    if (Number.isNaN(n)) continue;
    if (/penalty/i.test(m[2])) n = -Math.abs(n);
    for (const { key, forWhat } of targetsOf(m[3])) {
      pushModifier({ type: "modifier", target: key, value: flat(n), ...(forWhat ? { forWhat } : {}) }, m.index);
    }
  }
  // A signed figure straight into "to"/"on" and the target, with no bonus/penalty word (RR pp. 105, 108; JJ p. 308) — require an explicit sign
  for (const m of text.matchAll(new RegExp(`([+-]\\d+)\\s+(?:to|on)\\s+(${TARGET})`, "gi"))) {
    for (const { key, forWhat } of targetsOf(m[2])) {
      pushModifier(
        { type: "modifier", target: key, value: flat(parseInt(m[1], 10)), ...(forWhat ? { forWhat } : {}) },
        m.index,
      );
    }
  }
  // Reversed order: the signed figure, the target, then the word bonus or penalty (RR pp. 107, 110; JJ p. 310).
  for (const m of text.matchAll(/([+-]\d+)\s+([a-z][a-z' -]{2,30}?)\s+(bonus|penalty)\b/gi)) {
    const key = classify(m[2]);
    if (!key) continue;
    let n = parseInt(m[1], 10);
    if (/penalty/i.test(m[3])) n = -Math.abs(n);
    pushModifier({ type: "modifier", target: key, value: flat(n) }, m.index);
  }
  // Verb form: "<target> is increased by <n>". Rejects "increased TO" (a
  // multiplier, not a delta).
  for (const m of text.matchAll(/([A-Za-z][A-Za-z' -]{2,50}?)\s+(?:is|are)\s+(increased|reduced|decreased)\s+by\s+(\d+)/gi)) {
    const key = classify(m[1]);
    if (!key) continue;
    const n = parseInt(m[3], 10);
    pushModifier({ type: "modifier", target: key, value: flat(/increase/i.test(m[2]) ? n : -n) }, m.index);
  }
  // "<Activity> proficiency throw of N+": the capitalised qualifier says which
  // activity, so a bundle of throws stays distinct effects.
  // A later "reduces by M per level" sentence is folded into the value as a
  // perLevel step.
  const perLevel = text.match(
    /throw(?:\s+required)?\s+(?:is\s+)?(reduce[sd]?|improve[sd]?|decrease[sd]?|lower(?:s|ed)?)\s+by\s+(\d+)\s+per\s+level/i,
  );
  for (const m of text.matchAll(/(?:([A-Z][A-Za-z-]+)\s+)?proficiency throw of (\d+)\+/g)) {
    const base = parseInt(m[2], 10);
    // The step is negative however the book phrases it: a smaller target is an easier throw.
    const value = perLevel ? { kind: "perLevel", base, per: -Math.abs(parseInt(perLevel[2], 10)) } : flat(base);
    const e = { type: "throw", value, roll: "1d20", rollType: "above" };
    if (m[1]) e.forWhat = m[1];
    push(e);
  }
  /* --- Limitations: what switches the ability off ---
   * Only shapes that reduce to a value are classified (an encumbrance ceiling,
   * an armour weight); other restrictions (RR pp. 86, 105) stay in the imported
   * description, never copied into a flag. */
  const enc = text.match(/encumbrance of more than (\d+) stone/i);
  if (enc) push({ type: "limitation", condition: "encumbrance", value: flat(parseInt(enc[1], 10)) });
  const armour = text.match(/wearing (medium or heavy|heavy|medium|light) armou?r[^.]{0,90}\bcannot\b/i);
  if (armour) push({ type: "limitation", condition: "armor", note: armour[1].toLowerCase() });

  /* --- Spell-like abilities: "can cast X (as the spell) once per week".
   * The frequency read is `frequencyFieldsOf`, above. --- */
  for (const m of text.matchAll(
    /can (?:cast|bestow|perform|use) ([a-z][a-z' -]{2,40}?)\s*(?:\(as the (?:\d+(?:st|nd|rd|th)? level )?(?:divine |arcane )?spell\)|as a spell-like ability)([^.]{0,60})/gi,
  )) {
    push({ type: "spellLike", spell: m[1].trim(), ...frequencyFieldsOf(m[2] ?? "") });
  }

  /* --- Prerequisite: a "must have the <name> power" clause, or a "requires
   * that the character have <ability>" clause (JJ p. 308) --- */
  for (const m of text.matchAll(/must have (?:the |gained )?([A-Z][A-Za-z' -]{2,40}?) (?:custom |class )?power\b/g)) {
    push({ type: "requires", note: m[1].trim() });
  }
  for (const m of text.matchAll(/requires that the character (?:have|has) the ability to ([a-z][a-z' -]{2,40})/gi)) {
    push({ type: "requires", note: m[1].trim() });
  }

  /* --- Usage limit with no spell attached: a capability carrying only the frequency. --- */
  if (!out.some((e) => e.type === "spellLike")) {
    const read = frequencyFieldsOf(text);
    if (read.frequency) push({ type: "capability", ...read });
  }

  /* --- Resource spend/gain: Fate Points, spell slots, stigma --- */
  for (const m of text.matchAll(/\b(spend|spends|spending|expend|expends|expending|gain|gains|recovers?)\b[^.]{0,24}?\b(Fate Points?|spell slots?|stigma)\b/gi)) {
    const kind = /fate/i.test(m[2]) ? "fatePoint" : /stigma/i.test(m[2]) ? "stigma" : "spellSlot";
    push({ type: "resource", resource: kind, action: /gain|recover/i.test(m[1]) ? "gain" : "spend" });
  }

  /* --- Caster-level equivalence: a count of caster levels counted above actual (RR pp. 73, 74, 108, 115; JJ pp. 311, 312, 317, 319) --- */
  const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  for (const m of text.matchAll(/\b(one|two|three|four|five|\d+)\s+(?:class|caster)\s+levels?\s+higher\s+than\s+(?:(?:his|her|their|its)\s+)?actual/gi)) {
    const n = WORD_NUM[m[1].toLowerCase()] ?? parseInt(m[1], 10);
    if (n) push({ type: "spellcastingMod", casterLevelDelta: n });
  }

  /* --- Movement grant: a mode word, then a movement-rate lead-in and a distance (RR p. 448, JJ p. 316) --- */
  for (const m of text.matchAll(/\b(flying|climbing|swimming|burrowing)\s+movement rate of\s+(\d+)/gi)) {
    const movementMode = { flying: "fly", climbing: "climb", swimming: "swim", burrowing: "burrow" }[m[1].toLowerCase()];
    push({ type: "movement", movementMode, value: flat(parseInt(m[2], 10)) });
  }

  /* --- Economic rate: a construction or research rate as an amount, coin and period (RR p. 110) --- */
  for (const m of text.matchAll(/\b(?:construction|research) rate of\s+([\d.]+)\s*(gp|sp|cp)\s*per\s+(day|week|month)/gi)) {
    push({ type: "economic", amount: parseFloat(m[1]), unit: m[2].toLowerCase(), period: m[3].toLowerCase() });
  }

  /* --- Grants a choice of proficiencies, resolved through the register --- */
  for (const m of text.matchAll(/can select one (?:class )?proficiency,\s*choosing(?:\s+from)?\s+([^.]{4,160})\./gi)) {
    const table = registers?.tables?.proficiency ?? {};
    const refs = m[1]
      .split(/,|\band\b/)
      .map((s) => s.replace(/\s+/g, " ").trim())
      .map((s) => table[s]?.ref)
      .filter(Boolean);
    if (refs.length) push({ type: "grants", refs, choose: 1 });
  }

  // A skill borrowed "as <class> of <fraction> his level" (RR pp. 108, 115; JJ
  // p. 308): the class may be plural with no article, and the class/caster
  // qualifier before "level" may be absent. The fraction between "of" and the
  // pronoun is stored as `atLevelNum` / `atLevelDen`; one the word table cannot read drops the effect.
  for (const m of text.matchAll(
    /as\s+(?:an?\s+)?(thie(?:f|ves)|crusaders?|fighters?|mages?)\s+of\s+(?:((?:[a-z]+[- ])?[a-z]+)\s+)?(?:his|her|their)\s+(?:(?:class|caster)\s+)?level/gi,
  )) {
    const as = m[1].toLowerCase().replace(/^thieves$/, "thief").replace(/s$/, "");
    if (!m[2]) {
      push({ type: "progressionAs", as });
      continue;
    }
    const parts = levelFraction(readNumber(m[2], true));
    if (!parts) continue;
    push({ type: "progressionAs", as, ...(parts.num !== parts.den ? { atLevelNum: parts.num, atLevelDen: parts.den } : {}) });
  }
  return out;
}

/**
 * Scan a monster's OWN description prose for immunity / resistance /
 * susceptibility statements, matching a SHIPPED vocabulary (damage words and
 * the `defenseEffect` register). Returns `{immunities?, resistances?,
 * susceptibilities?}`, each `{damage, effects, mundane, extraordinary}`, or null
 * when nothing reads. An immunity or resistance that turns on the damage's
 * quality also carries `silverFlaw` when the text says silver counts as
 * extraordinary; a susceptibility carries `factor` and `save` when the text
 * prints them, and neither key otherwise. Exported so authoring tools can
 * preview the same result.
 */
export function defenseScan(paras, registers) {
  const text = (paras ?? []).map((p) => (typeof p === "string" ? p : p.text)).join(" ");
  if (!text) return null;
  const effVocab = Object.entries(registers?.tables?.defenseEffect ?? {}); // [surface, {key}]
  const bucket = () => ({ damage: [], effects: [], mundane: false, extraordinary: false });
  const scan = (verbRe) => {
    const b = bucket();
    for (const m of text.matchAll(verbRe)) {
      const clause = m[1].toLowerCase();
      for (const [word, key] of Object.entries(DAMAGE_WORDS)) {
        if (new RegExp(`\\b${word}\\b`).test(clause) && !b.damage.includes(key)) b.damage.push(key);
      }
      for (const [surface, row] of effVocab) {
        const re = new RegExp(`\\b${surface.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`);
        if (re.test(clause) && !b.effects.includes(row.key)) b.effects.push(row.key);
      }
      if (/\b(mundane|ordinary|non-?magical)\b/.test(clause)) b.mundane = true;
      if (/\b(extraordinary|magical? weapons?)\b/.test(clause)) b.extraordinary = true;
    }
    return b;
  };
  // "can only be harmed/hit by extraordinary/magic" == immune to mundane damage.
  const out = {};
  const imm = scan(new RegExp(`(?:immun(?:e|ity) to|unaffected by|not affected by|cannot be) (.+?)${DEF_BOUNDARY}`, "gi"));
  if (/only be (?:harmed|hit|struck|damaged) by (?:extraordinary|magic)/i.test(text)) imm.mundane = true;
  const res = scan(new RegExp(`(?:resistan(?:t|ce) to|takes? half (?:damage )?from) (.+?)${DEF_BOUNDARY}`, "gi"));
  const sus = scan(new RegExp(`(?:susceptible|vulnerable|especially vulnerable) to (.+?)${DEF_BOUNDARY}`, "gi"));
  const any = (b) => b.damage.length || b.effects.length || b.mundane || b.extraordinary;
  // The silver flaw is a sentence of its own, so it is read off the whole text
  // and set on the defenses it can change: those that turn on the damage's quality.
  if (hasSilverFlaw(text)) for (const b of [imm, res]) if (b.mundane || b.extraordinary) b.silverFlaw = true;
  Object.assign(sus, susceptibilityFigures(text));
  if (any(imm)) out.immunities = imm;
  if (any(res)) out.resistances = res;
  if (any(sus)) out.susceptibilities = sus;
  return Object.keys(out).length ? out : null;
}

/** The sentences of a prose run, a stop followed by a space ending each. */
const sentencesOf = (text) => String(text).split(/(?<=[.!?])\s+/);

/** A figure's window as the takes read it: lowercased, with the typographic minuses a page prints as a hyphen. */
const takeWindow = (s) => s.replace(/[−–—]/g, "-").toLowerCase();

/**
 * Does the creature's own text say a silver weapon's damage counts as
 * extraordinary (RR ch. 6, "Damage Type Immunity and Resistance")? One sentence
 * names silver beside a weapon or damage and says it is extraordinary or
 * counts as magical; a sentence that only lists silver or magic among what a
 * defense covers does not say so.
 */
function hasSilverFlaw(text) {
  const silverWeapon = /\bsilver(?:ed)?\b[^.]{0,40}\b(?:weapons?|damage)\b|\b(?:weapons?|damage)\b[^.]{0,40}\bsilver(?:ed)?\b/;
  const counted = /\bextraordinary\b|\b(?:as if|as though|as|are|is|considered|counts?|treated)\s+(?:(?:they|it|them)\s+(?:were|was|are|is)\s+)?(?:being\s+)?magic(?:al)?\b/;
  return sentencesOf(text).some((s) => {
    const w = takeWindow(s);
    return silverWeapon.test(w) && counted.test(w);
  });
}

/**
 * A susceptibility's own figures from the creature's text: `factor`, the
 * multiple of damage it takes, and `save`, the signed modifier to its saving
 * throw. They are read from the sentence that names the susceptibility and the
 * one after it, each by the take a recipe would use (`times`, `signed`) and
 * each only beside its cue: a sentence about damage the creature takes for
 * `factor`, one about its saves for `save`. A figure not read is not returned.
 *
 * @returns {{factor?: number, save?: number}}
 */
function susceptibilityFigures(text) {
  const out = {};
  const sentences = sentencesOf(text);
  const named = /\b(?:susceptible|vulnerable|especially vulnerable) to\b/i;
  sentences.forEach((s, i) => {
    if (!named.test(s)) return;
    for (const near of sentences.slice(i, i + 2)) {
      const w = takeWindow(near);
      if (out.factor == null && /\b(?:damage|dice)\b/.test(w) && /\b(?:suffers?|takes?|taking|sustains?|receives?|dealt)\b/.test(w)) {
        const n = takeProse(w, "times");
        if (Number.isFinite(n) && n > 0) out.factor = n;
      }
      if (out.save == null && /\bsav(?:e|es|ing)\b/.test(w)) {
        const n = takeProse(w, "signed");
        if (Number.isFinite(n)) out.save = n;
      }
    }
  });
  return out;
}

/**
 * Union two defense objects (a creature's own prose scan first, then the
 * type-inherent ACKS rule). Sets and flags union; a note joins; a figure is the
 * first object's, so the creature's own `factor` and `save` win.
 */
export function mergeDefenses(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  const out = {};
  for (const cat of ["immunities", "resistances", "susceptibilities"]) {
    const x = a[cat];
    const y = b[cat];
    if (!x && !y) continue;
    out[cat] = {
      damage: [...new Set([...(x?.damage ?? []), ...(y?.damage ?? [])])],
      effects: [...new Set([...(x?.effects ?? []), ...(y?.effects ?? [])])],
      mundane: !!(x?.mundane || y?.mundane),
      extraordinary: !!(x?.extraordinary || y?.extraordinary),
    };
    const conditions = [...new Set([...(x?.conditions ?? []), ...(y?.conditions ?? [])])];
    if (conditions.length) out[cat].conditions = conditions;
    if (x?.silverFlaw || y?.silverFlaw) out[cat].silverFlaw = true;
    const note = [x?.note, y?.note].filter(Boolean).join("; ");
    if (note) out[cat].note = note;
    for (const key of ["factor", "save"]) {
      const figure = x?.[key] ?? y?.[key];
      if (figure != null) out[cat][key] = figure;
    }
  }
  return out;
}

/**
 * `countWord` pattern: a count printed as a digit or as an English word. The
 * first digit run or vocabulary word in the box wins; a hyphenated compound
 * sums its parts when every part is a word of the vocabulary
 * (`registers.tables.countWord`). A box that reads nothing yields 0, which the
 * consumer reads as "inherit"; a box that reads only unknown words yields 0
 * too and records a miss.
 */
export function readCountWord(text, registers, misses) {
  const vocab = registers?.tables?.countWord ?? {};
  const words = String(text ?? "").toLowerCase().match(/\d+|[a-z]+(?:-[a-z]+)*/g) ?? [];
  for (const w of words) {
    if (/^\d+$/.test(w)) return parseInt(w, 10);
    const parts = w.split("-");
    if (parts.every((p) => Object.hasOwn(vocab, p) && Number.isInteger(vocab[p]))) return parts.reduce((sum, p) => sum + vocab[p], 0);
  }
  if (words.length && misses) misses.push({ table: "countWord", token: text });
  return 0;
}

/** Fixed pattern library (frozen with the schema). */
function applyPattern(raw, instr, registers, misses) {
  let text = clean(raw);
  // Shipped config (like stripRoll): drop a trailing colon and/or one trailing
  // parenthetical before lookup (a quick-stat label "<name> (<count>):" against
  // a table keyed on clean names).
  if (instr.stripColon) text = text.replace(/\s*:\s*$/, "");
  if (instr.stripParen) text = text.replace(/\s*\([^)]*\)\s*$/, "");
  switch (instr.pattern ?? "raw") {
    case "raw":
    case "statValue":
      return instr.table ? lookup(registers, instr.table, text, misses) : text;
    case "int": {
      // A printed "not applicable" is not zero: "N/A" is kept distinct so the
      // binding leaves the field blank.
      if (/^\s*(n\s*[/\\]?\s*a|nil|not applicable|—)\s*$/i.test(text)) return "N/A";
      const m = /(-?[\d,]+)/.exec(text);
      if (!m) return null;
      // The match can be punctuation with no digit (a bare "," or "-"), which
      // parseInt turns into NaN; no number is `null`, never NaN.
      const n = parseInt(m[1].replace(/,/g, ""), 10);
      return Number.isFinite(n) ? n : null;
    }
    case "dice":
      return DICE_RE.exec(text)?.[0] ?? null;
    case "countWord":
      return readCountWord(text, registers, misses);
    case "throw": {
      // A throw target is the first "<n>+". A die's faces ("<n>d<m>+<k>") and a
      // modifier are not targets: the number may not follow a digit or a "d",
      // and the "+" may not lead into one.
      const m = /(?<![\dDd])(\d+)\+(?!\d)/.exec(text);
      return m ? parseInt(m[1], 10) : null;
    }
    case "rollTarget": {
      // The number a die must reach, printed as "<n>+", "a <n> on a d<m>" or the
      // low end of "<n> or <m>": the first number that is no die's count or
      // faces and no modifier.
      const m = /(?<![\dDd+-])(\d+)(?![\dDd])/.exec(text);
      return m ? parseInt(m[1], 10) : null;
    }
    case "refList":
      if (!text || /^none/i.test(text)) return [];
      return splitTop(text).map((t) => {
        // Shipped config: strip a trailing roll target ("<name> <n>+" -> token
        // "<name>", target n) before the exact-match lookup.
        const roll = instr.stripRoll ? /\s*(\d+)\+\s*$/.exec(t) : null;
        const token = roll ? t.slice(0, roll.index).trim() : t;
        const row = lookup(registers, instr.table, token, misses);
        return roll ? { ...row, target: parseInt(roll[1], 10) } : row;
      });
    case "parenSplit": {
      const m = /^([^(]+?)\s*(?:\(([^)]*)\))?$/.exec(text);
      if (!m) return { text };
      const main = instr.table ? lookup(registers, instr.table, m[1].trim(), misses) : { text: m[1].trim() };
      // A thousands comma between digits is not a list separator: protect
      // digit,digit before the top-level split.
      const paren = splitTop((m[2] ?? "").replace(/(\d),(\d)/g, "$10000$2"))
        .map((t) => t.replace(/0000/g, ","))
        .map((t) => (instr.parenTable ? lookup(registers, instr.parenTable, t, misses) : { text: t }));
      return { ...main, ...(paren.length ? { paren } : {}) };
    }
    case "spoilList": {
      const spoils = [];
      for (const m of text.matchAll(SPOIL_RE)) {
        spoils.push({
          name: m[1].trim(),
          weight6: (m[2] ? parseInt(m[2], 10) : 0) * 6 + (m[3] ? parseInt(m[3], 10) : 0),
          cost: parseInt(m[4].replace(/,/g, ""), 10),
          effects: splitTop(m[5] ?? "")
            .map((t) => (instr.effectsTable ? lookup(registers, instr.effectsTable, t, misses) : { text: t })),
        });
      }
      return spoils;
    }
    case "statline":
      return parseStatline(text);
    case "writeup":
      return parseWriteup(text);
    case "countParen": {
      // How many a quick-stat label says there are: its closing parenthetical.
      // A whole number is a number; anything else with a digit in it is kept as
      // printed; no digit is no count.
      const m = /\(([^()]*)\)\s*$/.exec(text);
      const count = m ? m[1].replace(/\s+/g, " ").trim() : "";
      if (!/\d/.test(count)) return null;
      return /^\d+$/.test(count) ? parseInt(count, 10) : count;
    }
    default:
      return text; // unknown pattern: degrade to raw text, never throw
  }
}

/**
 * `statline` pattern: the AX-line inline quick-stat block, e.g.
 *   "<class> <n>; Str <n>, ... Cha <n>; AC <n> (<armour>), MV <n>', HD <n>,
 *    hp <n>, #AT <n> (<weapon> <n>+), Dmg <dice>, SV <class><n>, ML <n>,
 *    AL <x>, XP <n>; Proficiencies: ...; Equipment: ..."
 * Monster lines omit the class/ability segments and sometimes a comma, so the
 * core clause is read by keyword anywhere in it, not sequentially. Purely mechanical: segments split on top-level ";", classified
 * by their leading token, unrecognized segments kept verbatim in `extra`.
 * Which box holds the block (and the name label dropped via dropText) was
 * decided at compile time. Missing keys are simply absent — never a throw.
 *
 * Damage is keyed "Dmg" or a bare "D" opening a clause. Hit points printed one
 * per creature ("hp <n>, <n>, <n>") read as `hpList`, with `hp` the first of
 * them and a closing parenthetical as `hpNote`. A printed minus sign (U+2212) reads
 * as the hyphen-minus; `text` keeps what the page printed.
 *
 * A repertoire runs on over the semicolons that close its spell levels: every
 * segment after it that opens with an ordinal ("3rd-…") joins `repertoire`.
 *
 * A line that prints each routine's throw and damage inside the `#AT`
 * parenthesis also reads `atks`, one `{text, throw, dmg, dmgType?, rider?,
 * count?}` per routine (`scenarioRoutines`), with `atk.throw` the first
 * routine's; a line that keeps its damage under `Dmg` reads no `atks`. A
 * morale dash reads as "N/A", "Wil" scores as `wis`, and `MV` and `hp` may
 * carry a colon.
 */
export function parseStatline(text) {
  const out = { text };
  const segments = text.replace(/−/g, "-").split(/;/).map((s) => s.trim()).filter(Boolean);
  // A routine parenthesis the printer split off "#AT <n>" with a semicolon rejoins it.
  for (let i = segments.length - 2; i >= 0; i--) {
    if (/#AT\s*[^\s,;(]+$/i.test(segments[i]) && segments[i + 1].startsWith("(")) segments.splice(i, 2, `${segments[i]} ${segments[i + 1]}`);
  }
  const rest = [];
  let inRepertoire = false;
  for (const seg of segments) {
    if (inRepertoire && /^\d+(?:st|nd|rd|th)/i.test(seg)) {
      out.repertoire += `; ${seg}`;
      continue;
    }
    inRepertoire = false;
    const labeled = /^(Proficiencies|Equipment|Class Abilities|Abilities|Repertoire|Spells(?:\s+\w+)?|Arcane Spells|Divine Spells)\s*:\s*(.*)$/i.exec(seg);
    if (labeled) {
      const key = labeled[1].toLowerCase();
      const body = labeled[2].trim();
      if (key === "proficiencies") out.proficiencies = splitTop(body).map((t) => t.trim());
      else if (key === "equipment") out.equipment = body;
      else if (key === "class abilities" || key === "abilities") out.classAbilities = body;
      else if (key === "repertoire") {
        out.repertoire = body;
        inRepertoire = true;
      } else out.spells = ((out.spells ? out.spells + "; " : "") + `${labeled[1]}: ${body}`).trim();
      continue;
    }
    // Ability-score segment: pairs like "Str 13, Int 18, ..." (any subset); Wil is the sheet's wis.
    if (/^(Str|Int|Wis|Wil|Dex|Con|Cha)\b/i.test(seg) && !/\bhp\b|#AT|\bAC\b/i.test(seg)) {
      for (const m of seg.matchAll(/\b(Str|Int|Wis|Wil|Dex|Con|Cha)\s+(\d+)/gi)) {
        (out.abilities ??= {})[m[1].toLowerCase() === "wil" ? "wis" : m[1].toLowerCase()] = parseInt(m[2], 10);
      }
      continue;
    }
    // A movement clause the printer closed with a semicolon stands alone.
    const bareMv = /^MV\s*([^,;]+)$/i.exec(seg);
    if (bareMv && out.mv === undefined) {
      out.mv = bareMv[1].trim();
      continue;
    }
    // Core stat clause: identified by hp/#AT/AC keywords, read by key. A
    // segment of nothing but save, morale, alignment and experience clauses
    // (at least one not experience) is one too. A key may carry a colon.
    const statTail = /^(?:SV|Save|ML|AL|XP)\s/.test(seg) && /\b(?:SV|Save|ML|AL)\s/.test(seg) && seg.split(/,\s*/).every((c) => /^(?:SV|Save|ML|AL|XP)\s+\S+$/.test(c));
    if (/\bhp\s*:?\s*\d|#AT|\bAC\s*-?\d/i.test(seg) || statTail) {
      const grab = (re) => re.exec(seg)?.slice(1);
      // Capitalised scores that run on into the clause with no semicolon read as scores.
      if (/^(STR|INT|WIL|DEX|CON|CHA)\s+\d/.test(seg)) {
        for (const m of seg.matchAll(/\b(STR|INT|WIL|DEX|CON|CHA)\s+(\d+)/g)) (out.abilities ??= {})[m[1] === "WIL" ? "wis" : m[1].toLowerCase()] = parseInt(m[2], 10);
      }
      const mv = grab(/\bMV\s*:?\s*([^,;]+?)(?=,|$)/i);
      if (mv) out.mv = mv[0].trim();
      const ac = grab(/\bAC\s*(-?\d+)\s*(?:\(([^)]*)\))?/i);
      if (ac) {
        out.ac = parseInt(ac[0], 10);
        if (ac[1]) out.acNote = ac[1].trim();
      }
      const hd = grab(/\bHD\s*((?:\d+|½)(?:[+-]\d+)?\**)/i);
      if (hd) out.hd = hd[0].trim();
      const hp = grab(/\bhp\s*:?\s*(\d+(?:\s*,\s*\d+)*)\s*(each)?\s*(?:\(([^)]*)\))?/i);
      if (hp) {
        const list = hp[0].split(/\s*,\s*/).map((n) => parseInt(n, 10));
        out.hp = list[0];
        if (list.length > 1) out.hpList = list;
        if (hp[1]) out.hpEach = true;
        if (hp[2]?.trim()) out.hpNote = hp[2].trim();
      }
      const at = grab(/#AT\s*([^,;(]+?)\s*(?:\(([^)]*?)\s*(\d+)\+\s*\)|\(([^)]*)\))?(?=,|$)/i);
      if (at) {
        out.atk = { count: at[0].trim() };
        const weapon = at[1] ?? at[3];
        if (weapon) out.atk.text = weapon.trim();
        if (at[2]) out.atk.throw = parseInt(at[2], 10);
      }
      // A parenthesis printing each routine's throw and damage (alternatives may
      // stand in parentheses of their own, joined by "or") reads routine by
      // routine; `atk` keeps the printed text and takes the first routine's throw.
      const chain = /#AT\s*([^,;(]+?)\s*((?:\([^()]*\)\s*(?:or\s*(?=\())?)+)/i.exec(seg);
      const printed = chain?.[2].trim().replace(/^\(|\)$/g, "").replace(/\)\s*or\s*\(/g, " or ");
      const routines = printed ? scenarioRoutines(printed, DAMAGE_WORDS) : null;
      if (routines) {
        out.atk = { count: chain[1].trim(), text: printed, throw: routines[0].throw };
        out.atks = routines;
      }
      const dmg = grab(/\bDmg\s*(.+?)(?=,\s*(?:Save|SV)\b|;|$)/i) ?? grab(/(?:^|,\s*)D\s+(.+?)(?=,\s*(?:Save|SV)\b|;|$)/);
      if (dmg) out.dmg = dmg[0].trim();
      const sv = grab(/\b(?:Save|SV)\s*([A-Z]+)\s*(\d+)?\s*(?:\(([^)]*)\))?/);
      if (sv) {
        out.save = { class: sv[0], ...(sv[1] ? { level: parseInt(sv[1], 10) } : {}), ...(sv[2] ? { note: sv[2].trim() } : {}) };
      }
      // A morale dash, printed where no figure applies, reads as "N/A".
      const ml = grab(/\bML\s*([+-]?\d+|N\s*\/?\s*A|[-–—](?=\s*(?:,|$)))/i);
      if (ml) out.ml = /\d/.test(ml[0]) ? parseInt(ml[0], 10) : "N/A";
      const al = grab(/\bAL\s*([A-Z])\b/);
      if (al) out.al = al[0];
      const xp = grab(/\bXP\s*([\d,]+)/i);
      if (xp) out.xp = parseInt(xp[0].replace(/,/g, ""), 10);
      continue;
    }
    // A stat that got its own ";"-separated segment ("…ML <n>; XP <n>;…").
    const xpSeg = /^XP\s+([\d,]+)$/i.exec(seg);
    if (xpSeg) {
      if (out.xp == null) out.xp = parseInt(xpSeg[1].replace(/,/g, ""), 10);
      continue;
    }
    // Class segment: "<class>* <n> (<note>)" / "<class> <n>".
    const cls = /^([A-Za-z][A-Za-z' -]*?)\*?\s+(\d+)\s*(?:\(([^)]*)\))?$/.exec(seg);
    if (cls && !out.class && !/^(XP|ML|AC|HD|MV|Dmg|Save|SV|hp)$/i.test(cls[1].trim())) {
      out.class = { name: cls[1].trim(), level: parseInt(cls[2], 10), ...(cls[3] ? { note: cls[3].trim() } : {}) };
      continue;
    }
    rest.push(seg);
  }
  if (rest.length) out.extra = rest;
  return out;
}

/**
 * A write-up's label, closed by a colon and a space, at the head or after one:
 * a label the reader knows, of one word or two, or one capitalised word it
 * does not. A known label is matched at its own first word, never from a
 * capitalised word before it (a list's last token), and an unknown label of
 * two words is not a label at all. Every label opens a clause: the known ones
 * read into fields, the rest keep their text. An unknown label may join two
 * capitalised words with a slash. The label's space is left for the next label
 * to open on, so a label with an empty body does not hide the one after it.
 */
const WRITEUP_LABEL =
  /(?:^|\s)(HP|Hit Points|AC|Armou?r Class|Saves?|Saving Throws|Attacks?|Attack Throw|Damage|Ability Scores|Attributes|Stat Line|Class Proficiencies|General Proficiencies|Proficiencies|Racial Abilities|Class Abilities|Class Powers|Abilities|Inventory|Equipment|Spellcasting|Spells|Spell Repertoire|Repertoire|Languages|Alignment|Movement|MV|XP|Side Effects|Permanent Wounds|[A-Z][a-z]+(?:\/[A-Z][a-z]+)?):(?=\s)/g;

/** A write-up's class line set level first: "Level <n> <alignment> <class> (<title>)". */
const WRITEUP_LEVEL_FIRST = /^Level\s+(\d+)\s+(Lawful|Neutral|Chaotic)\s+([A-Za-z][A-Za-z' -]*?)\s*(?:\(([^)]*)\))?\s*$/i;

/** A write-up's class line set with an ordinal: "<n>th level <class> (<title>)". */
const WRITEUP_ORDINAL_FIRST = /^(\d+)(?:st|nd|rd|th)\s+level\s+([A-Za-z][A-Za-z' -]*?)\s*(?:\(([^)]*)\))?\s*$/i;

/** The keys a labelled stat line's clauses open with. */
const WRITEUP_STAT_KEY = /^(AC|Spd|HP|ATK|Dmg|Init|Surprise|ML|AL)\b\s*(.*)$/i;

/** A key as the printer capitalises it, read where a clause runs on into the next without a comma. */
const WRITEUP_STAT_RUN_ON = /^(?:ATK|Dmg|Init|Surprise|ML|AL|HP|AC|Spd)\b/;

/**
 * A labelled stat line's clauses, as `[KEY, body]` pairs: the line splits at
 * its top-level commas, a piece that opens with no key belongs to the clause
 * before it (a damage list's own commas), and a key that follows a clause
 * with no comma between them opens a clause of its own.
 */
function statLineClauses(body) {
  const clauses = [];
  for (const piece of splitTop(body)) {
    let depth = 0;
    let from = 0;
    const cuts = [];
    for (let i = 0; i < piece.length; i++) {
      if (piece[i] === "(") depth++;
      else if (piece[i] === ")") depth = Math.max(0, depth - 1);
      else if (depth === 0 && /\s/.test(piece[i]) && WRITEUP_STAT_RUN_ON.test(piece.slice(i + 1))) cuts.push(i);
    }
    for (const cut of [...cuts, piece.length]) {
      const part = piece.slice(from, cut).trim();
      from = cut + 1;
      const m = WRITEUP_STAT_KEY.exec(part);
      if (m) clauses.push([m[1].toUpperCase(), m[2].trim()]);
      else if (clauses.length && part) clauses.at(-1)[1] += `, ${part}`;
    }
  }
  return clauses;
}

/**
 * A labelled stat line, read into `out`: the armour class (the first value
 * printed, its bracket left unread), the hit points, the attack's routine as
 * printed with its first throw, the damage, morale and alignment. The speed
 * is left to the class's own derivation; initiative and surprise have no
 * field and stay in `text`.
 */
function readLabelledStatLine(body, out) {
  for (const [key, value] of statLineClauses(body)) {
    const n = /^-?\d+/.exec(value);
    if (key === "AC" && n) out.ac = parseInt(n[0], 10);
    else if (key === "HP" && n) out.hp = parseInt(n[0], 10);
    else if (key === "ATK" && value) {
      const th = /(-?\d+)\s*\+/.exec(value);
      out.atk = { routine: value, ...(th ? { throw: parseInt(th[1], 10) } : {}) };
    } else if (key === "DMG" && value) out.dmg = value;
    else if (key === "ML") {
      const ml = /^[+-]?\d+/.exec(value);
      if (ml) out.ml = parseInt(ml[0], 10);
    } else if (key === "AL") {
      const al = /^[A-Za-z]+/.exec(value);
      if (al) out.al = al[0][0].toUpperCase() + al[0].slice(1).toLowerCase();
    }
  }
}

/** The unlabelled stat line a level-first head carries after its class line. */
const WRITEUP_STAT_LINE = /\bAC\s+-?\d/;

/** A score key as a write-up may abbreviate it; the sheet's keys are `parseStatline`'s. */
const WRITEUP_SCORE = { str: "str", int: "int", wis: "wis", wil: "wis", dex: "dex", con: "con", cha: "cha" };

/**
 * A level-first write-up's stat line, read into `out`: the armour class (the
 * first of the values printed), the move as printed, the hit points, and the
 * attack's routine with its first throw. The ATK clause takes the rest of the
 * line, commas and all, since a routine lists its weapons with them.
 */
function readStatLine(line, out) {
  const atkAt = line.search(/\bATK\s+/);
  for (const clause of splitTop(atkAt >= 0 ? line.slice(0, atkAt) : line)) {
    const m = /^(AC|Move|MV|HP)\s+(.+)$/i.exec(clause);
    if (!m) continue;
    const key = m[1].toUpperCase();
    const n = /^-?\d+/.exec(m[2]);
    if (key === "AC" && n) out.ac = parseInt(n[0], 10);
    else if (key === "HP" && n) out.hp = parseInt(n[0], 10);
    else if (key === "MOVE" || key === "MV") out.mv = m[2].trim();
  }
  if (atkAt < 0) return;
  const routine = line.slice(atkAt).replace(/^ATK\s+/, "").trim();
  const th = /(\d+)\s*\+/.exec(routine);
  out.atk = { routine, ...(th ? { throw: parseInt(th[1], 10) } : {}) };
}

/**
 * `writeup` pattern: a person written out as labelled lines rather than one
 * quick-stat line — the shape a book gives a person it spends a page on. The
 * head, before the first label, is the class line ("<class> <level>") and
 * the scores; every label then opens a clause that runs to the next. It reads
 * into `parseStatline`'s shape, so one binding serves both: the class, the
 * scores, hit points, armour class with its bracket, the attack's throw (its
 * routine kept as text, never as a weapon's name), the damage, the inventory
 * as `equipment`, and the proficiencies as two lists — `proficiencies` (the
 * general ones) and `classProficiencies` — where a token marked "(G)" or "(C)"
 * joins the list its marker names, marker dropped, whatever label it stood
 * under. Saves and abilities stay text; a one-word label this reader does not
 * know keeps its clause, labelled, under `extra`. Missing labels are absent,
 * never a throw; `text` keeps what the page printed.
 *
 * A head may instead open level first — "Level <n> <alignment> <class>
 * (<title>)" — and carry an unlabelled stat line, "AC <n>, Move <rate>, HP
 * <n>, ATK <routine>", with the scores under their own label. The alignment
 * and the title are read from the class line, and the stat line's ATK clause
 * runs to the end of the head.
 *
 * A head may also open with an ordinal — "<n>th level <class> (<title>)" —
 * leaving the alignment to the stat line, which then stands under its own
 * label, "Stat Line:", and reads by comma-separated clause (`readLabelledStatLine`).
 * "Attributes" is the scores' label as "Ability Scores" is, "Spellcasting"
 * joins `spells`, and "Spell Repertoire" is `repertoire`.
 */
export function parseWriteup(text) {
  const out = { text };
  const t = String(text ?? "").replace(/−/g, "-").replace(/\s+/g, " ").trim();
  const marks = [...t.matchAll(WRITEUP_LABEL)];
  let head = (marks.length ? t.slice(0, marks[0].index) : t).trim();
  const statAt = head.search(WRITEUP_STAT_LINE);
  if (statAt > 0) {
    readStatLine(head.slice(statAt), out);
    head = head.slice(0, statAt).trim();
  }
  const scoreRe = /\b(Str|Int|Wis|Wil|Dex|Con|Cha)\s+(\d+)/gi;
  const readScores = (s) => {
    for (const m of s.matchAll(scoreRe)) (out.abilities ??= {})[WRITEUP_SCORE[m[1].toLowerCase()]] = parseInt(m[2], 10);
  };
  readScores(head);
  const firstScore = head.search(/\b(Str|Int|Wis|Wil|Dex|Con|Cha)\s+\d+/i);
  const classText = (firstScore >= 0 ? head.slice(0, firstScore) : head).replace(/\*+/g, "").replace(/[,;]\s*$/, "").trim();
  const cls = /^([A-Za-z][A-Za-z' -]*?)\s+(\d+)$/.exec(classText);
  const levelFirst = WRITEUP_LEVEL_FIRST.exec(classText);
  const ordinalFirst = WRITEUP_ORDINAL_FIRST.exec(classText);
  if (cls) out.class = { name: cls[1].trim(), level: parseInt(cls[2], 10) };
  else if (ordinalFirst) {
    out.class = { name: ordinalFirst[2].trim(), level: parseInt(ordinalFirst[1], 10), ...(ordinalFirst[3]?.trim() ? { note: ordinalFirst[3].trim() } : {}) };
  } else if (levelFirst) {
    out.class = { name: levelFirst[3].trim(), level: parseInt(levelFirst[1], 10), ...(levelFirst[4]?.trim() ? { note: levelFirst[4].trim() } : {}) };
    out.al = levelFirst[2][0].toUpperCase() + levelFirst[2].slice(1).toLowerCase();
  } else if (classText) out.extra = [classText];
  const general = [];
  const klass = [];
  // A token's own marker outranks the label it stands under.
  const sortProfs = (body, into) => {
    for (const token of splitTop(body)) {
      const mark = /\s*\(\s*([GC])\s*\)\s*$/i.exec(token);
      const bare = mark ? token.slice(0, mark.index).trim() : token;
      if (!bare) continue;
      (mark ? (mark[1].toUpperCase() === "G" ? general : klass) : into).push(bare);
    }
  };
  marks.forEach((m, i) => {
    const key = m[1].toLowerCase().replace(/\s+/g, " ");
    const body = t.slice(m.index + m[0].length, marks[i + 1]?.index ?? t.length).trim();
    if (key === "hp" || key === "hit points") {
      const hp = /^(\d+)\s*(?:\(([^)]*)\))?/.exec(body);
      if (hp) {
        out.hp = parseInt(hp[1], 10);
        if (hp[2]?.trim()) out.hpNote = hp[2].trim();
      }
    } else if (key === "ac" || /^armou?r class$/.test(key)) {
      const ac = /^(-?\d+)\s*(?:\(([^)]*)\))?/.exec(body);
      if (ac) {
        out.ac = parseInt(ac[1], 10);
        if (ac[2]?.trim()) out.acNote = ac[2].trim();
      }
    } else if (key === "stat line") readLabelledStatLine(body, out);
    else if (key === "ability scores" || key === "attributes") readScores(body);
    else if (/^saves?$/.test(key) || key === "saving throws") out.saves = body;
    else if (/^attacks?$/.test(key)) {
      const th = /(\d+)\s*\+/.exec(body);
      out.atk = { routine: body, ...(th ? { throw: parseInt(th[1], 10) } : {}) };
    } else if (key === "damage") out.dmg = body;
    else if (key === "class proficiencies") sortProfs(body, klass);
    else if (key === "general proficiencies" || key === "proficiencies") sortProfs(body, general);
    else if (key === "racial abilities") out.racialAbilities = body;
    else if (key === "class abilities" || key === "class powers" || key === "abilities") out.classAbilities = body;
    else if (key === "inventory" || key === "equipment") out.equipment = body;
    else if (key === "spells" || key === "spellcasting") out.spells = out.spells ? `${out.spells}; ${body}` : body;
    else if (key === "repertoire" || key === "spell repertoire") out.repertoire = body;
    else if (key === "languages") out.languages = body;
    else if (key === "alignment") out.al = body;
    else if (key === "movement" || key === "mv") out.mv = body;
    else if (key === "xp") out.xp = parseInt(body.replace(/,/g, ""), 10);
    else (out.extra ??= []).push(`${m[1]}: ${body}`);
  });
  if (general.length || klass.length) {
    out.proficiencies = general;
    out.classProficiencies = klass;
  }
  return out;
}

/** Page-art selection by shipped criteria (no judgment beyond the config). */
function selectArt(infos, select = {}, name) {
  if (name) return infos.find((i) => i.name === name) ?? null;
  const { minW = 200, minH = 200, maxW = 1500, maxRatio = 3 } = select;
  return (
    infos
      .filter((i) => i.width >= minW && i.height >= minH && i.width < maxW)
      .filter((i) => i.width / i.height < maxRatio && i.height / i.width < maxRatio)
      .sort((a, b) => b.width * b.height - a.width * a.height)[0] ?? null
  );
}

/* -------------------------------------------- */
/*  Instruction execution                       */
/* -------------------------------------------- */

async function execInstruction(instr, ctx) {
  const { doc, registers, getPage, claims, misses } = ctx;
  const pd = await getPage(instr.page);

  const claim = (runs, field) => {
    if (claims) for (const r of runs) claims.set(r, field);
  };

  switch (instr.op) {
    case "expect": {
      const runs = runsIn(pd, instr);
      claim(runs, ctx.field);
      const found = clean(joinRuns(runs));
      // A printed heading can carry glyph artifacts the shipped label does not
      // (a detached superscript; RR p. 73, JJ p. 312), so compare folded and
      // fall back to a prefix: a wrong page shares no prefix. NFKD first, so
      // precomposed and decomposed accents land on the same string.
      const fold = (s) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const f = fold(found);
      const w = fold(instr.text);
      const ok = !!w && (f.startsWith(w) || (w.length >= 12 && f.startsWith(w.slice(0, 12))));
      return { ok, found: found.slice(0, 60) };
    }
    case "heading": {
      // `expect` for a name the cookbook does not carry: the box is proved by
      // the key number the heading opens with, or by a key of its folded
      // letters, and the words themselves are handed back for the binder to
      // name the document with. A name the line broke is read in `parts`; a
      // part marked `glue` continues the word the part before it broke.
      let title = "";
      for (const part of instr.parts ?? [instr]) {
        const ppd = part.page && part.page !== instr.page ? await getPage(part.page) : pd;
        const runs = runsIn(ppd, part);
        claim(runs, ctx.field);
        const piece = clean(joinRuns(runs, part.fixes, part.dropText));
        if (!piece) continue;
        title += title && !part.glue ? ` ${piece}` : piece;
      }
      const ok = instr.number != null ? opensWithNumber(title, instr.number) : !!instr.hash && printKey(title) === instr.hash;
      // A box that failed its check names nothing, and neither does a box
      // proved as a header that is not a title (`names: false`). `caps` is the
      // compiler's word that the line's case carries nothing, handed on to
      // whoever sets the name.
      const names = ok && instr.names !== false;
      return { ok, found: title.slice(0, 60), title: names ? title.slice(0, 200) : null, ...(instr.caps === true ? { caps: true } : {}) };
    }
    case "text": {
      const paras = [];
      for (const para of instr.paras ?? []) {
        // A paragraph may name its own page: an entry starting low on a page
        // continues overleaf. Absent `para.page`, the instruction's page serves.
        const ppd = para.page && para.page !== instr.page ? await getPage(para.page) : pd;
        const runs = runsIn(ppd, para);
        claim(runs, ctx.field);
        // A row the table prints empty reads as empty text and is kept; any
        // other box that reads nothing is dropped.
        if (para.empty === true) {
          paras.push({ type: "paragraph", ...(para.section ? { section: para.section } : {}), empty: true, text: "" });
          continue;
        }
        const text = clean(glyphWords(joinRuns(runs, para.fixes ?? instr.fixes, para.dropText), registers));
        if (!text) continue;
        // A box that opens mid-sentence continues the box before it (a column
        // or page turn): a lower-case first letter after a box that closed
        // without terminal punctuation. A box carrying its own section label
        // is always a new one. A box marked `continues` is the same case where
        // the turn falls before a capital, which the compiler could see.
        // A row's detail paragraph (`detail: true`) continues the detail
        // paragraph before it in the same row's block; detail paragraphs
        // otherwise stay apart and keep the mark.
        const prev = paras[paras.length - 1];
        const sameBlock = para.detail === true && prev?.detail === true && prev.section === para.section;
        if (prev && (!para.section || sameBlock) && (para.continues || (/^[a-z]/.test(text) && !/[.!?:;"”’)\]]$/.test(prev.text)))) {
          prev.text = `${prev.text} ${text}`;
          continue;
        }
        paras.push({
          type: "paragraph",
          ...(para.section ? { section: para.section } : {}),
          ...(para.detail === true ? { detail: true } : {}),
          text,
        });
      }
      // The JJ closes a custom power with a bracketed list of the classes that
      // may take it (JJ p. 308); that list is the container's, so it is stripped.
      const last = paras[paras.length - 1];
      if (last) last.text = stripOwnerList(last.text);
      return paras.filter((p) => p.text || p.empty);
    }
    case "value": {
      if (!instr.parts) {
        const runs = runsIn(pd, instr);
        claim(runs, ctx.field);
        return applyPattern(joinRuns(runs, instr.fixes, instr.dropText), instr, registers, misses);
      }
      // A value across a column or page turn: each part is one stretch, on its
      // own page with its own fixes, read in order and joined with a space.
      const pieces = [];
      for (const part of instr.parts) {
        const ppd = part.page && part.page !== instr.page ? await getPage(part.page) : pd;
        const runs = runsIn(ppd, part);
        claim(runs, ctx.field);
        const piece = joinRuns(runs, part.fixes, part.dropText).trim();
        if (piece) pieces.push(piece);
      }
      return applyPattern(pieces.join(" "), instr, registers, misses);
    }
    /**
     * One COLUMN of a level-progression table, read as a LevelValue. The recipe
     * ships the grid's coordinates (which column, which rows) and nothing else.
     * Rows are paired by vertical proximity, not by index, so a blank cell
     * shifts nothing.
     */
    case "progression": {
      const levels = runsIn(pd, { box: instr.levelBox });
      const values = runsIn(pd, { box: instr.valueBox });
      claim([...levels, ...values], ctx.field);
      const num = (s) => {
        const m = /-?\d+/.exec(String(s).replace(/[^\d+-]/g, ""));
        return m ? parseInt(m[0], 10) : null;
      };
      const breakpoints = [];
      for (const lv of levels) {
        const atLevel = num(lv.str);
        if (atLevel == null) continue;
        const cell = values.find((v) => Math.abs(v.y - lv.y) <= (instr.rowTol ?? 3));
        const value = cell ? num(cell.str) : null;
        if (value != null) breakpoints.push({ atLevel, value });
      }
      breakpoints.sort((a, b) => a.atLevel - b.atLevel);
      if (!breakpoints.length) {
        misses.push({ field: ctx.field, error: "progression table matched no rows" });
        return null;
      }
      return { kind: "breakpoints", breakpoints };
    }
    case "attacks": {
      const aRuns = runsIn(pd, { box: instr.attacksBox });
      const dRuns = runsIn(pd, { box: instr.damageBox });
      claim(aRuns, ctx.field);
      claim(dRuns, ctx.field);
      const attacksText = clean(joinRuns(aRuns, instr.fixes?.attacks, instr.dropText?.attacks));
      const damageRaw = joinRuns(dRuns, instr.fixes?.damage, instr.dropText?.damage); // glyphs preserved
      // Parse both fields into aligned MODES. `attacksOverride` is a normalized
      // routine string for a format the generic parser mishandles; damage still
      // extracts live. Quality per segment comes from the shipped colour
      // annotation, indexed by global segment position (flatDamage order); the
      // runtime never reads colours.
      const { modes } = attackModel(instr.attacksOverride ?? attacksText, damageRaw);
      const colors = instr.colors
        ? instr.colors.map((c) => (c ? (registers?.tables?.[instr.colorTable]?.[c] ?? null) : null))
        : null;
      const damageTypeOf = (seg) => {
        for (const ch of seg) {
          if (registers?.tables?.[instr.glyphTable]?.[ch]) {
            const dt = { text: ch, ...registers.tables[instr.glyphTable][ch] };
            return dt.ref || dt.key ? dt : null;
          }
        }
        return null;
      };
      let gi = 0; // global damage-segment index, matches compiler flatDamage/colors
      const outModes = modes.map((mode) => ({
        count: mode.count,
        throw: mode.throw,
        segments: mode.dmgSegs.map((seg, j) => {
          const ne = mode.names[j] ?? mode.names[mode.names.length - 1];
          const quality = colors?.[gi] ?? null;
          gi++;
          return {
            name: ne?.name ?? null,
            naturalWeapon: ne?.nw ?? null,
            damage: DICE_RE.exec(clean(seg))?.[0] ?? clean(seg),
            damageType: damageTypeOf(seg),
            quality, // "extraordinary" | "mundane" | null
          };
        }),
      }));
      return {
        text: [attacksText, clean(damageRaw)].filter(Boolean).join(" — "),
        throw: outModes[0]?.throw ?? null,
        alternatives: outModes.length > 1, // modes are OR-alternatives, GM picks
        modes: outModes,
      };
    }
    /**
     * `grid`: a printed table read by authored geometry. The recipe ships the
     * data-row band, the row-label span and the column spans with cell
     * patterns; the values are read from the reader's own page. Rows whose
     * cells nearly all fail to parse (column headers inside the band) are
     * dropped but stay claimed.
     *
     * `transpose` reads a sideways table (properties as rows, options as
     * columns): one output row per COLUMN, cells keyed by the slugged property
     * labels. The property labels as printed come back as `labels`, keyed as
     * the cells are, because `header` is keyed by column and names no property.
     */
    case "grid": {
      const runs = runsIn(pd, { box: instr.box });
      claim(runs, ctx.field);
      // Authored per-row y-bands replace line bucketing: one logical row may
      // wrap over several text lines.
      const yRows = instr.rowBands
        ? instr.rowBands
            .map((b) => ({ y: b.y0, key: b.key ?? null, items: runs.filter((it) => it.y >= b.y0 && it.y <= b.y1).sort((p, q) => p.y - q.y || p.x - q.x) }))
            .filter((r) => r.items.length)
        : rowsByY(runs, instr.rowTol ?? 3);
      const spanItems = (items, x0, x1) => items.filter((it) => it.x >= x0 && it.x <= x1);
      const spanRaw = (items, x0, x1) => spanItems(items, x0, x1).map((it) => it.str).join("");
      // Gap-aware joining (authored gapMin): small-caps runs need blind joins,
      // but a wide gap is a word space the text layer does not carry. A cell
      // that spans several printed lines has no horizontal gap at the wrap
      // point, so each line joins alone and the lines join with a space.
      const spanLines = (items, x0, x1) => {
        const inSpan = spanItems(items, x0, x1);
        const lines = new Map();
        for (const it of inSpan) {
          const k = Math.round(it.y / 3);
          (lines.get(k) ?? lines.set(k, []).get(k)).push(it);
        }
        // A hyphen at the end of a line is inside a word (cells wrap where a
        // compound breaks, RR p. 78): the lines join with no space after it, and
        // the hyphen is kept.
        const joinedLines = [...lines.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([, l]) => joinCellRuns(l.sort((p, q) => p.x - q.x), instr.gapMin ?? null));
        return clean(
          joinedLines.reduce((acc, line, i) => (i === 0 ? line : acc + (/-$/.test(acc) && /^[a-z]/.test(line) ? "" : " ") + line), ""),
        );
      };
      const spanText = instr.rowBands
        ? spanLines
        : (items, x0, x1) => clean(joinCellRuns(spanItems(items, x0, x1), instr.gapMin ?? null));
      const cellValue = (text, col, rawText) => {
        if (col.pattern === "glyphs") {
          // Each PUA glyph char maps through a shipped table (damage-type
          // marks), read from the raw join because clean() strips them.
          const hits = [];
          for (const ch of rawText ?? "") {
            const row = registers?.tables?.[col.table ?? "damageGlyph"]?.[ch];
            if (row) hits.push({ text: ch, ...row });
          }
          return hits.length ? hits : null;
        }
        const v = applyCellPattern(text, col.pattern ?? "raw");
        if (v == null || v === "") return null;
        if (col.table && typeof v === "string") {
          const row = registers?.tables?.[col.table]?.[v];
          return row ? { text: v, ...row } : { text: v };
        }
        return v;
      };
      // A table whose columns are its scale carries its header band, so the
      // scale is read here, not shipped. A header is joined by line whatever
      // the rows are.
      let header = null;
      if (instr.headerBand) {
        const hRuns = runsIn(pd, { box: { ...instr.box, y0: instr.headerBand.y0, y1: instr.headerBand.y1 } });
        claim(hRuns, ctx.field);
        header = {};
        for (const col of instr.cols ?? []) {
          const text = spanLines(hRuns, col.x0, col.x1);
          if (text) header[col.key] = text;
        }
      }
      const rows = [];
      const labels = {};
      if (instr.transpose) {
        // Property labels come from the label span of every y-row; each
        // authored column becomes one output row. A sideways table mixes value
        // shapes by row, so `props[key]` may override the column pattern per
        // property. An authored band key names its property; else the slugged
        // label does.
        const props = yRows
          .map((r) => ({ y: r.y, key: r.key, label: spanText(r.items, instr.label.x0, instr.label.x1), items: r.items }))
          .filter((r) => r.label || r.key);
        for (const col of instr.cols ?? []) {
          const cells = {};
          for (const p of props) {
            const slug = p.key ?? slugLabel(p.label);
            if (instr.dropRows?.includes(slug)) continue; // claimed header/title row
            const eff = instr.props?.[slug] ? { ...col, ...instr.props[slug] } : col;
            const v = cellValue(spanText(p.items, col.x0, col.x1), eff, spanRaw(p.items, col.x0, col.x1));
            if (v == null) continue;
            cells[slug] = v;
            if (p.label && !(slug in labels)) labels[slug] = p.label;
          }
          if (Object.keys(cells).length) rows.push({ key: col.key, label: col.label ?? col.key, cells });
        }
      } else {
        for (const r of yRows) {
          // An authored band key names a row whose printed label cannot be read
          // as text (a rotated table): the key is neutral and the label is
          // whatever the span holds.
          const label = instr.label ? spanText(r.items, instr.label.x0, instr.label.x1) : "";
          if (!label && !r.key) continue;
          if (!r.key && instr.dropRows?.includes(slugLabel(label))) continue; // claimed header row
          const cells = {};
          let parsed = 0;
          for (const col of instr.cols ?? []) {
            const v = cellValue(spanText(r.items, col.x0, col.x1), col, spanRaw(r.items, col.x0, col.x1));
            if (v != null) {
              cells[col.key] = v;
              parsed++;
            }
          }
          // A header row's cells are labels, so almost nothing parses.
          if (parsed >= (instr.minCells ?? 1)) rows.push({ key: r.key ?? slugLabel(label), label, cells });
        }
      }
      if (!rows.length) {
        misses.push({ field: ctx.field, error: "grid matched no rows" });
        return null;
      }
      const grid = header ? { rows, header } : { rows };
      if (Object.keys(labels).length) grid.labels = labels;
      return grid;
    }
    case "art": {
      const infos = await ctx.getArt(instr.page);
      const chosen = selectArt(infos, instr.select, instr.name);
      return chosen ? { name: chosen.name, width: chosen.width, height: chosen.height, kind: chosen.kind } : null;
    }
    default:
      return null; // unknown op: future schema — degrade, never throw
  }
}

/* -------------------------------------------- */
/*  Entry execution                             */
/* -------------------------------------------- */

/**
 * Execute one cookbook entry against an open document.
 * Returns { id, kind, name, cite, ok, fields, misses } — `fields` nests
 * "stats.x" instructions under fields.stats.x. With opts.trackClaims, also
 * returns `claims` (Map: text item -> field name) and `pages` touched, for the
 * verify harness's residue accounting.
 */
export async function executeEntry(doc, bookCookbook, registers, entryId, opts = {}) {
  const entry = bookCookbook?.entries?.[entryId];
  if (!entry || !COOKBOOK_SCHEMAS.includes(bookCookbook.schema)) {
    return { id: entryId, ok: false, reason: !entry ? "unknown-entry" : "schema-mismatch", fields: {} };
  }
  const pageCache = opts.pageCache ?? new Map();
  const getPage = async (n) => {
    if (!pageCache.has(n)) pageCache.set(n, await pageItems(doc, n));
    return pageCache.get(n);
  };
  // Art is cached on the same terms as text: reading a page's placed images
  // decodes them, which is far dearer than reading its text.
  const artCache = opts.artCache ?? new Map();
  const getArt = async (n) => {
    if (!artCache.has(n)) artCache.set(n, await pageArtInfo(doc, n).catch(() => []));
    return artCache.get(n);
  };
  const claims = opts.trackClaims ? new Map() : null;
  const misses = [];
  const fields = {};
  let ok = true;

  for (const [field, instr] of Object.entries(entry.fields ?? {})) {
    if (opts.skipOps?.includes(instr.op)) continue; // caller choice (e.g. verify without art)
    // assist specs applied below, once the description they read exists
    if (field === "effects" || field === "rolls" || field === "variation" || field === "values") continue;
    const ctx = { doc, registers, getPage, getArt, claims, misses, field };
    let result = null;
    try {
      result = instr.op === "ocr" ? await (await import("./picture-text.mjs")).readPictureText(instr, ctx, bookCookbook.pictures?.[instr.page], execInstruction) : await execInstruction(instr, ctx);
    } catch (err) {
      misses.push({ field, error: err.message });
      result = null;
    }
    if (field === "name") {
      // A name check that threw (null) fails exactly like `ok: false`.
      if (!result || result.ok === false) ok = false;
      fields.name = result;
      continue;
    }
    // Nest dotted fields: "stats.x" under fields.stats, "creatures.0" under fields.creatures.
    if (field.includes(".")) {
      const dot = field.indexOf(".");
      (fields[field.slice(0, dot)] ??= {})[field.slice(dot + 1)] = result;
    } else {
      fields[field] = result;
    }
  }

  // Defenses = the per-entry prose scan (this seat's own description + shipped
  // vocabulary) unioned with the creature's type-inherent defenses (authored
  // once on the type node); nothing about a specific creature's defenses is
  // baked on the entry. `effectsText` is page text the effects recipe's
  // locators read beside the description; it is not the entry's prose, so it
  // leaves the result here, read or not.
  const effectsText = Array.isArray(fields.effectsText) ? fields.effectsText : [];
  delete fields.effectsText;
  // A monster's encounter, lair and notes sections describe its prepared lair
  // and the Judge's use of it, often with other creatures' stat lines, so they
  // never feed the creature's own defenses, effects, rolls or derived values.
  const mechanics = entry.kind === "kind.monster"
    ? (fields.description ?? []).filter((p) => !UNSCANNED_MONSTER_SECTIONS.has(p.section))
    : fields.description;
  if (mechanics?.length) {
    const scanned = defenseScan(mechanics, registers);
    if (scanned) fields.defenses = scanned;
    // Structured effects: classified from this seat's prose against the shipped
    // vocabulary, unless authored specs exist for the entry, in which case the
    // recipe replaces the scan outright (as for rolls) and the two never
    // concatenate. See docs/importer/MODEL.md, "An ability's modifiers: recipe or scan".
    const authoredEffects = entry.fields?.effects?.specs;
    const effects = authoredEffects?.length
      ? materializeEffects(authoredEffects, [...mechanics, ...effectsText])
      : effectScan(mechanics, registers);
    if (effects.length) fields.effects = effects;
    // A variation's numbers: the same materializer, kept in its own field apart
    // from `effects` (what a difference costs and moves is not an ability's
    // mechanics). No scan fallback: a variation with no authored locator
    // locates nothing and is empty.
    const variationSpecs = entry.fields?.variation?.specs;
    if (variationSpecs?.length) {
      const located = materializeEffects(variationSpecs, mechanics);
      if (located.length) fields.variation = located;
    }
    // The entry's own printed numbers, located the same way and kept apart for
    // the same reason, with no scan fallback. A spec that did not match is
    // absent, so the binding sees the book's number or nothing.
    const valueSpecs = entry.fields?.values?.specs;
    if (valueSpecs?.length) {
      const located = materializeEffects(valueSpecs, mechanics);
      if (located.length) fields.values = located;
    }
    // Every roll the ability offers, each with its own target and progression.
    // An authored recipe replaces the scan outright for this entry; it never merges.
    const authored = materializeRolls(entry.fields?.rolls?.specs, mechanics, {
      progression: fields.progression,
    });
    const rolls = entry.fields?.rolls?.specs?.length ? authored : rollScan(mechanics);
    if (rolls.length) fields.rolls = rolls;
  }
  // Values the books state in prose rather than in a labelled field (the
  // custom-class build cost, a "counts as <n> custom powers" clause; JJ pp.
  // 310, 320, 322). The pattern is shipped; the number is read here from this
  // seat's own extracted text.
  if (mechanics?.length) {
    const text = mechanics.map((p) => p.text).join(" ");
    for (const [key, spec] of Object.entries(registers?.derive ?? {})) {
      let m = null;
      try {
        m = new RegExp(spec.pattern, spec.flags ?? "i").exec(text);
      } catch {
        m = null; // a malformed shipped pattern never throws at the table
      }
      if (!m) continue;
      const value = spec.as === "count" ? parseCount(m[1] ?? m[0]) : parseInt(String(m[1] ?? m[0]).replace(/[^\d-]/g, ""), 10);
      if (value != null && !Number.isNaN(value)) fields[key] = value;
    }
  }
  // An ability whose numbers live in a table: the column just read is its
  // proficiency throw, level by level. Added after the prose scan so it lands
  // even on an entry whose description says nothing mechanical.
  if (fields.progression?.breakpoints?.length) {
    (fields.effects ??= []).push({
      type: "throw",
      value: fields.progression,
      roll: "1d20",
      rollType: "above",
      forWhat: entry.name,
    });
  }
  const t = fields.stats?.type;
  const typeRefs = t?.refs ?? (t?.ref ? [t.ref] : []);
  for (const ref of typeRefs) {
    const td = registers?.nodes?.[ref]?.defenses;
    if (td) fields.defenses = mergeDefenses(fields.defenses, td);
  }

  return {
    id: entryId,
    kind: entry.kind,
    name: entry.name,
    cite: entry.cite,
    // Which reader produced `fields.effects`: "recipe" (the entry's authored
    // specs) or "scan" (the vocabulary guess), for a binding that carries only
    // the first (`effectsOriginOf`).
    effectsFrom: effectsOriginOf(entry),
    // Where the text was read from, for the citation link a binding writes: the
    // book id and the entry's first PDF page, not the printed folio `cite` names.
    book: entry.book ?? bookCookbook.book?.id ?? null,
    page: entry.pages?.[0] ?? null,
    ok,
    fields,
    misses,
    ...(claims ? { claims, pages: [...pageCache.keys()] } : {}),
  };
}
