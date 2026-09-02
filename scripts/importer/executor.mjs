/**
 * Cookbook executor — the DUMB runtime interpreter (frozen instruction set,
 * schema "acks-cookbook/1"; see docs/importer/COOKBOOK.md).
 *
 * Performs instructions mechanically against the seat's own opened PDF: filter
 * text runs by shipped geometry, apply shipped assembly fixes, parse with the
 * fixed pattern library, resolve tokens through shipped exact-match tables,
 * read instructed visual attributes (glyph fill colors). NO judgment lives
 * here: no detection, inference, normalization, or promotion — every decision
 * was made offline and shipped as data. Content failures degrade to misses/
 * stubs; this module never throws on content.
 *
 * Runs identically in the browser (Foundry binding) and Node (verify harness).
 */
import { pageItems, pageArtInfo, SPOIL_RE } from "./extract.mjs";
import { rowsByY, applyCellPattern, slugLabel, joinRuns as joinCellRuns } from "./table-extract.mjs";

/**
 * Schema v2 (2026-07-24) is v1 plus the `grid` instruction — nothing existing
 * changed, so every v1 cookbook keeps executing under this executor forever.
 */
export const COOKBOOK_SCHEMAS = ["acks-cookbook/1", "acks-cookbook/2", "acks-cookbook/3"];
export const COOKBOOK_SCHEMA = "acks-cookbook/2";

/* -------------------------------------------- */
/*  Mechanical helpers (fixed, part of v1)      */
/* -------------------------------------------- */

// Private-use-area glyphs (icons, foot/inch marks) are stripped from prose and
// raw values; damage handling reads them deliberately before the strip.
const PUA_RE = /[-]/g;
const clean = (s) => (s ?? "").replace(PUA_RE, "").replace(/\s+/g, " ").trim();

const inBox = (it, box) => it.x >= box.x0 && it.x <= box.x1 && it.y >= box.y0 && it.y <= box.y1;

/**
 * Runs inside the instruction's box(es), in reading order (y, then x). ALL
 * matching runs are returned (and claimed by the caller); dropText removal
 * happens at join time so fix ordinals and claims stay stable. Exported for
 * the compiler, which must enumerate identically when computing fixes.
 */
export function runsIn(pageData, instr) {
  const boxes = instr.boxes ?? (instr.box ? [instr.box] : []);
  return orderRuns(pageData.items.filter((it) => boxes.some((b) => inBox(it, b))));
}

/**
 * Reading order that keeps SUPERSCRIPTS with their own line. Ordinal marks
 * ("1st", "5th") are set ~4pt above the baseline, so a plain (y,x) sort files
 * them ahead of the entire line and the prose comes out "st When the character
 * casts…" with the digit stranded. Derive baselines from the full-size runs,
 * attach every run to its nearest baseline, then order by (baseline, x).
 *
 * Exported behaviour is shared with the compiler, so fix ORDINALS stay aligned —
 * changing this ordering requires recompiling the cookbooks.
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
  // One string or several: a box can enclose more than one run that is IN it
  // without being OF it — a claimed label, and the chapter tab the page paints
  // into its own margin, which lands mid-value and welds onto the next entry.
  const dropSet = new Set(
    (Array.isArray(dropText) ? dropText : dropText == null ? [] : [dropText]).map((s) => String(s).trim()),
  );
  const drop = new Set(fixes.drop ?? []);
  const joinSpace = new Set(fixes.joinSpace ?? []);
  const mergeHyphen = new Set(fixes.mergeHyphen ?? []);
  // A run-in heading can share its run with the prose that follows it — the PDF
  // emits `Acrobatics` and `: The character is trained to…` as two runs, so the
  // colon and the whole first line arrive together. Dropping that run to lose
  // the heading would take the opening sentence with it; strip the heading's
  // characters off the front instead.
  const strip = fixes.stripPrefix ?? {};
  let out = "";
  runs.forEach((r, i) => {
    if (drop.has(i) || dropSet.has(r.str.trim())) return;
    let s = r.str;
    if (strip[i]) s = s.slice(strip[i]);
    if (mergeHyphen.has(i)) s = s.replace(/-\s*$/, "");
    out += s;
    if (joinSpace.has(i)) out += " ";
  });
  return out;
}

/**
 * Drop a trailing "[Class, Class, …]" list — the classes a JJ custom power is
 * available to. Deliberately tight: it must be the LAST thing in the text and
 * contain only capitalised names, so a bracket used for anything else survives.
 */
const OWNER_LIST = /\s*\[\s*[A-Z][A-Za-z'’’.\- ]*(?:,\s*[A-Z][A-Za-z'’’.\- ]*)*\s*\]\s*$/;
const stripOwnerList = (text) => String(text ?? "").replace(OWNER_LIST, "").trim();

/** Names vary by small-caps and spacing between books, so compare folded. */
const convKey = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** "2 1/2" -> 2.5, "1/2" -> 0.5, "3" -> 3. Build costs print as mixed fractions. */
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
 * object so repeated lookups stay cheap.
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
 * conversion table is consulted and the ACKS II equivalent retried — that is
 * what lets a converted source resolve even though the original entry was
 * renamed. A name the guide marks "deleted"/"absent" resolves to a WARNING
 * rather than a silent miss: it is understood, just not present.
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
// A damage segment is real when it has dice, a flat number (e.g. "1"), or is a
// "by weapon" placeholder — the last two are silently dropped by a dice-only
// filter, which zeroes out most humanoid/flat-damage attacks.
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

// Natural-weapon stems (bit->bite): fixed game vocabulary, frozen with the
// schema. Ordered so a more specific stem wins (stinger before sting).
const NW_STEMS = [
  ["bite", /^bit/], ["stinger", /^stinger/], ["sting", /^sting/], ["gore", /^gor/],
  ["horn", /^horn/], ["tusk", /^tusk/], ["spine", /^spine/], ["claw", /^claw/],
  ["talon", /^talon/], ["pincer", /^pincer/], ["hoof", /^(hoof|hoov)/], ["tail", /^tail/],
  ["tentacle", /^tentacl/], ["tongue", /^tongue/], ["constriction", /^constrict/],
  ["ram", /^ram/], ["feeler", /^feeler/], ["envelopment", /^envelop/], ["weapon", /weapon/],
];
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

/** Parse one routine "3 (2 claws, bite 8+)" -> { count, throw, names:[{name,nw}] }. */
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
 * `modes` and `flatDamage` (all damage segs in mode order — the compiler uses
 * it to align glyph colours identically to what the runtime will enumerate).
 * Shared verbatim by compiler + executor so nothing drifts.
 */
export function attackModel(attacksText, damageRaw) {
  const damageGroups = splitOr(damageRaw);
  // Coalesce a BARE-NUMBER attack part ("1 or 2 (hooves 7+)") into the routine
  // that follows it — it is a count RANGE for one attack, not a separate mode.
  // The damage "or"-groups are authoritative for how many attack modes exist.
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

// Damage-word -> type key. Keys mirror the damageGlyph registry; a few English
// synonyms map to the canonical key. Generic vocabulary, frozen like the rest.
const DAMAGE_WORDS = {
  acid: "acidic", acidic: "acidic", arcane: "arcane", bludgeoning: "bludgeoning",
  necrotic: "necrotic", cold: "cold", frost: "cold", electric: "electrical",
  electrical: "electrical", electricity: "electrical", lightning: "electrical",
  fire: "fire", flame: "fire", luminous: "luminous", slashing: "slashing",
  piercing: "piercing", poison: "poisonous", poisonous: "poisonous", seismic: "seismic",
};
// A defense clause ends at the sentence end OR the next defence verb / contrast
// word — so "immune to X and resistant to Y" doesn't leak Y's flags into X.
const DEF_BOUNDARY =
  "(?=[.;]|\\b(?:but|however|except|while|though|although|whereas)\\b|\\b(?:resistant|resistance|vulnerable|susceptible)\\b|\\bhave full effect\\b|$)";

/**
 * Scan a monster's OWN description prose for immunity / resistance /
 * susceptibility statements, matching a SHIPPED vocabulary (damage words +
 * the defenseEffect register). Materializes per seat from that seat's book —
 * nothing about which defenses apply is ever baked. Exported so authoring
 * tools can preview the same result.
 */
/**
 * Effect fields a locator may fill, and the shape each one needs.
 *
 * Only NUMBERS are locatable, and this list is why. Everything else an effect
 * carries — `unit`, `period`, `target`, `mode`, `restriction` — is a conclusion
 * about the mechanic's shape ("this is a percentage", "this is per month"),
 * which the recipe states outright because a conclusion may ship. A number is
 * the one thing that may not, so it is the one thing that gets a locator.
 *
 * `value` alone is a LevelValue SchemaField and needs the object form; a bare
 * integer there does not survive DataModel validation. The rest are plain
 * numbers, and `amount` is the only one the schema allows to be fractional.
 */
/**
 * Proportions the books write as WORDS, so a locator can point at them.
 *
 * "a bonus to their Mortal Wounds throw of one-half his class level (round up)"
 * carries no digit at all. Without this the only ways to model it are to ship
 * 0.5 — a value read off the page — or to drop the mechanic. Both are wrong, so
 * the fraction is read from the seat's own prose like any other number.
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

/** A located number: digits, "1,000", "1/2", or a word proportion. */
function readNumber(raw, allowFraction) {
  const s = String(raw ?? "").trim().toLowerCase();
  const word = WORD_NUMERALS[s.replace(/\s+/g, " ")];
  if (word != null) return allowFraction ? word : Math.round(word);
  const ratio = /^(\d+)\s*\/\s*(\d+)$/.exec(s);
  if (ratio) {
    const v = Number(ratio[1]) / Number(ratio[2]);
    return allowFraction ? v : Math.round(v);
  }
  // A DICE EXPRESSION IS A FORMULA, NOT A NUMBER. The strip below removes every
  // non-digit, so "2d6" would read as 26 — and it does not fail: the effect
  // materializes as `{amount: 26}`, looking exactly like a value read cleanly
  // off the page. No gate can catch it (the count matches, the locator
  // "resolved"), which makes it precisely the plausible-wrong-value failure
  // this pipeline exists to prevent. Refusing it drops the effect instead, so
  // the gap is visible and reportable — a missing mechanic is honest, an
  // invented number is not. There is no locatable dice field today; when one is
  // added it must parse the formula, never fall through to here.
  if (/^\d+\s*d\s*\d+/i.test(s)) return NaN;
  return allowFraction ? parseFloat(s.replace(/[^\d.-]/g, "")) : parseInt(s.replace(/[^\d-]/g, ""), 10);
}

/**
 * Build a breakpoint ladder out of one match's capture groups.
 *
 * Two shapes, because the books write ladders two ways. Plain: every group is a
 * VALUE and the rungs are 1..N (or `steps`) — Animal Husbandry's 11+/7+/3+ by
 * rank. Paired (`pairs`): the groups alternate rung and value, so the rungs
 * come off the page too — Graceful Fighting's "+1 … at 7th level +2 … at 13th
 * level +3" would otherwise need [1,7,13] shipped, and 7 and 13 are the book's
 * numbers as much as the bonuses are. A leading odd group is the first rung's
 * value, whose rung is implicit.
 */
function ladderFrom(match, { pairs = false, steps = null } = {}) {
  const groups = match.slice(1).filter((g) => g != null);
  const out = [];
  if (pairs) {
    let i = 0;
    if (groups.length % 2) {
      const value = readNumber(groups[0], true);
      if (!Number.isNaN(value)) out.push({ atLevel: 1, value });
      i = 1;
    }
    for (; i + 1 < groups.length; i += 2) {
      const atLevel = readNumber(groups[i], false);
      const value = readNumber(groups[i + 1], true);
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

const LOCATABLE_FIELDS = {
  value: "levelValue",
  amount: "number",
  range: "integer",
  casterLevelDelta: "integer",
  choose: "integer",
  times: "integer",
  // The total at which a rider fires — Mystic Aura's "if this bonus results in
  // a total of 12 or more, the subjects act as if bewitched". The threshold is
  // the page's number like any other, so it is located, not shipped.
  kickerAt: "integer",
  // Roll-outcome triggers (acks-lib `outcome`): the botch band's top edge
  // ("on an unmodified 1–3" -> 3) and the notice fraction ("below half the
  // target value" -> 0.5, via the word-numeral table). Both are the page's
  // numbers; the recipe ships only where to read them.
  naturalMax: "integer",
  belowFraction: "number",
};

/**
 * Materialize an ability's structured EFFECTS from chef-authored specs.
 *
 * The cookbook ships the effect's STRUCTURE (type, target, mode, refs, ifHas,
 * stacking) — never its numbers. A spec that carries a number points at it with
 * a locator applied to THIS SEAT'S own extracted prose, so the value
 * materializes from the reader's book exactly like a monster stat. A locator
 * that doesn't match (different printing) drops that effect rather than
 * inventing a value.
 *
 * `from` is one locator or an array of them, each naming the field it fills:
 *
 *   "from": { "pattern": "a (-?\\d+) penalty" }                    -> value
 *   "from": [{ "into": "amount", "pattern": "(\\d+)% per month" }]  -> amount
 *
 * `into` defaults to `value`, which is what every recipe written before this
 * meant. An `into` naming a field that is not locatable drops the effect: a
 * typo must not silently produce an effect missing the number that was the
 * whole point of it.
 *
 * A locator filling `value` may ask for a scaling shape instead of a flat one:
 *
 *   { "as": "perLevel", "pattern": "restore (\\d+) hit points per .*level" }
 *        -> base and rate both the located number: "2 hp per level" is 2·level.
 *          `per` overrides the rate; `round` ("up"|"down") states the page's
 *          own rounding, which is shape, not a value.
 *   { "on": "level", "pairs": true, "pattern": "…(\\d+)…(\\d+)…(\\d+)…(\\d+)…" }
 *        -> a breakpoint ladder. `on:"level"` gives a plain `breakpoints`
 *          LevelValue; any other VALUE_SCALES scale gives a `conditional` one.
 */
export function materializeEffects(specs, paras) {
  const text = (paras ?? []).map((p) => (typeof p === "string" ? p : p.text)).join(" ");
  const out = [];
  for (const spec of specs ?? []) {
    const { from, ...effect } = spec ?? {};
    const locators = (Array.isArray(from) ? from : from ? [from] : []).filter((l) => l?.pattern);
    // All or nothing. An effect whose locators half-matched would ship a
    // mechanic with one number read from the page and another silently absent,
    // which reads as complete and is not.
    let complete = true;
    for (const loc of locators) {
      const into = loc.into ?? "value";
      const kind = LOCATABLE_FIELDS[into];
      if (!kind || !text) {
        complete = false;
        break;
      }
      let m = null;
      try {
        m = new RegExp(loc.pattern, loc.flags ?? "i").exec(text);
      } catch {
        m = null; // a malformed locator never throws at the table
      }
      if (!m) {
        complete = false;
        break;
      }
      // A LADDER reads every capture group at once, so it is handled before the
      // single-value path rather than through it.
      if (kind === "levelValue" && loc.on) {
        const breakpoints = ladderFrom(m, { pairs: loc.pairs, steps: loc.steps });
        if (!breakpoints.length) {
          complete = false;
          break;
        }
        effect[into] =
          loc.on === "level"
            ? { kind: "breakpoints", breakpoints, ...(loc.round ? { round: loc.round } : {}) }
            : { kind: "conditional", on: loc.on, breakpoints, ...(loc.round ? { round: loc.round } : {}) };
        continue;
      }
      const raw = String(m[loc.group ?? 1] ?? m[0]);
      // Strip the page's own punctuation ("1,000 gp" -> 1000) but keep the
      // decimal point for the fields allowed to be fractional — `amount`, and
      // `value` because "one-half his class level" is a rate, not a count.
      const n = readNumber(raw, kind !== "integer");
      if (!Number.isFinite(n)) {
        complete = false;
        break;
      }
      effect[into] =
        kind === "levelValue"
          ? loc.as === "perLevel"
            ? // "N per level" is N·level, so the located number is BOTH the
              // first-level value and the rate. An explicit `per` overrides it
              // for the rarer "base, then N more each level" shape.
              { kind: "perLevel", base: n, per: loc.per ?? n, ...(loc.round ? { round: loc.round } : {}) }
            : { kind: "flat", flat: n }
          : n;
    }
    if (complete) out.push(effect);
  }
  return out;
}

/**
 * Materialize an ability's ROLLS from chef-authored specs — the per-entry
 * recipe that displaces `rollScan` for entries a chef has actually read.
 *
 * What the RECIPE ships: how many rolls the entry offers, each one's stable
 * key, its roll type and formula, and WHERE to find its parts. What comes from
 * the seat's own book: the label (what the roll is for), the target number,
 * and every step of a rank or level ladder. A spec whose locator does not
 * match drops that roll rather than inventing one — a missing roll is honest,
 * a fabricated target is not.
 *
 *   { key, label:{pattern,group?}, target:{pattern} | {pattern,on,steps},
 *     rollType?, formula?|{pattern,group?}, condition?, note? }
 *
 * `formula` may be a locator instead of a string, for a roll whose DICE are
 * part of the printed rule. A `measure` needs no target and is complete
 * without one. A `fromLadders` spec is skipped here and expanded by the binder,
 * which can reach the class entry that publishes the ladders.
 *
 * `target.on` names a VALUE_SCALES scale ("rank", "level"): the locator's
 * capture groups become the ladder's steps in order, so "18+ / 14+ / 10+"
 * with on:"rank" is ranks 1/2/3. `steps` overrides the step numbers when the
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
    const { label, target, formula, fromLadders, ...rest } = spec ?? {};
    // A spec that expands from a class's published ladders is not located in
    // prose at all — the binder does it, where the other entry is reachable.
    if (fromLadders) continue;
    const roll = { formula: "1d20", rollType: "above", ...rest };

    // The DICE may be printed rather than fixed. A spec that names them
    // outright still may (a d20 throw is a d20 throw), but a roll whose dice
    // are part of the rule has to read them off the page like any other value.
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

    // The entry's own progression ladder as this roll's target. Thief skills
    // keep no numbers in their prose — the whole ladder lives in a grid the
    // `progression` op reads (`ctx.progression`) — so no prose locator can ever
    // express their throw, which left every table-driven skill's Rolls tab
    // empty (the gap three chefs hit independently). The recipe says only
    // "this roll's target IS the ladder"; the numbers still come off the
    // seat's own page, through the same op as always. No ladder materialized
    // (bookless seat) drops the roll like any other unlocated target.
    if (target?.fromProgression) {
      if (!ctx.progression?.breakpoints?.length) continue;
      roll.scale = "level";
      roll.target = ctx.progression;
      out.push(roll);
      continue;
    }

    // A MEASURE is not rolled against anything, so it is complete with no
    // target at all — requiring one would drop every effect roll the books put
    // after a successful throw.
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
 * Every ROLL an ability offers, read from the seat's own prose.
 *
 * An ability is not one roll. Animal Husbandry diagnoses (11+, and 7+ / 3+ once
 * taken twice or three times), cures (18+), cures serious injury (14+) and
 * extracts venom (18+ / 14+ / 10+). Collapsing that to a single target loses
 * most of the proficiency, so each throw is captured separately with the label
 * the sentence gives it and, where the book states one, its rank ladder.
 *
 * The LABEL and the NUMBERS come from the reader's book; nothing about them is
 * shipped. What ships is the knowledge that throws look like this.
 */
export function rollScan(paras) {
  const text = (paras ?? []).map((p) => (typeof p === "string" ? p : p.text)).join(" ");
  if (!text) return [];
  const out = [];
  const seen = new Set();
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 32);

  // Spans already claimed by the rank-ladder pass, so the plain-roll pass below
  // cannot re-read a ladder's first step as a separate flat throw. Without this
  // Animal Husbandry yields both "18+/14+/10+ by rank" AND a bogus flat 18+,
  // i.e. one printed roll presented as two, the second one wrong.
  const claimed = [];
  const inClaimed = (i) => claimed.some(([a, b]) => i >= a && i < b);

  // "a proficiency throw of 18+ / 14+ / 10+" — one roll whose target improves
  // by RANK, written as a slash run.
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

  // A plain "<verb phrase> … proficiency throw of N+" / "diagnose illness on N+".
  for (const m of text.matchAll(/([a-z][a-z' -]{2,40}?)\s+(?:on|requires[^.]{0,40}?and a)\s+(?:a\s+)?(?:proficiency throw of\s*)?(\d+)\+/gi)) {
    const label = m[1].replace(/\s+/g, " ").trim();
    if (!/[a-z]{3}/.test(label)) continue;
    if (inClaimed(m.index)) continue;
    const key = slug(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    // NO `scale` on a flat target. A scale says "this number varies with
    // something", and a flat throw does not vary — carrying the schema's
    // default made the Rolls tab appear to claim a level progression that the
    // page never states (found by first-pass audit on Mapping). The field is
    // inert for flat values, so the claim was invisible in behaviour and
    // misleading on inspection, which is the worst combination.
    out.push({ key, label, formula: "1d20", rollType: "above", target: { kind: "flat", flat: parseInt(m[2], 10) } });
  }
  // NO LABELS from a scan, ever. What a roll is FOR is a judgment about the
  // sentence, and this scan cannot make it: around Mapping's throw it read
  // "and succeeding", and around Animal Husbandry's it read "Each" — a parser
  // artifact presented as the roll's name. A first attempt at filtering the
  // bad ones out was the same mistake one level up (it dropped an informative
  // phrase and kept a meaningless one), because there is no general rule here
  // to write. Naming the rolls is per-entry recipe work; until a recipe names
  // one, the sheet says "Proficiency throw" and claims nothing.
  for (const r of out) delete r.label;
  return out;
}

/**
 * Derive an ability's structured EFFECTS from its OWN prose, classified against
 * a SHIPPED vocabulary (the `modifierTarget` register) plus a fixed library of
 * shape patterns. Effect TYPE, TARGET and VALUE all materialize from the seat's
 * book — the cookbook pre-declares none of them, exactly as the defense scan
 * ships only the keyword vocabulary and never which creature has what.
 * Per-entry assists remain the fallback for shapes this cannot classify.
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

  /**
   * WHICH activity a target phrase names, if it names one.
   *
   * `classify` answers what KIND of thing is modified ("a proficiency throw")
   * and deliberately throws away which one, because the vocabulary is shipped
   * and the name is not. But a bonus with no name on it is not usable: "+2 on
   * Lockpicking proficiency throws" and "+2 on Hiding and Sneaking proficiency
   * throws" both stored as an unattributed "+2 to proficiency throws", so a
   * consumer could only ever apply every bonus to every roll, or none. The
   * name is read off the seat's own page like every other value here.
   *
   * The activity is the run of Capitalised words the phrase opens with, joined
   * by "and"/"or" — the books name activities in title case and the rest of the
   * phrase ("proficiency throws") in lower. A phrase that opens lowercase names
   * no activity and returns "", which is the honest answer for "attack throws".
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

  // Values ship as acks-lib LevelValue objects so they satisfy the ability
  // DataModel directly (a bare number would fail the SchemaField).
  const flat = (n) => ({ kind: "flat", flat: n });

  /* --- Context. A NUMBER'S MEANING IS CONTEXTUAL. ---
   *
   * Blind Fighting reads "suffers only a -2 penalty on attack throws … instead
   * of the base -4 penalty". Scanned for a number and a target alone, that
   * stores a -2 penalty — when the ability is really a net +2. Recording it is
   * worse than recording nothing, because a wrong mechanic looks right.
   *
   * So every candidate is judged against the SENTENCE it came from:
   *   replace  the number stands but supersedes a default ("instead of")
   *   skip     the context inverts or voids it, or the number is not a
   *            modifier at all (a die face, an opponent's penalty)
   * Anything the scan cannot model honestly is dropped and left to a recipe.
   */
  const bounds = [];
  {
    let at = 0;
    for (const s of text.split(/(?<=\.)\s+/)) {
      bounds.push({ start: at, end: at + s.length, s });
      at += s.length + 1;
    }
  }
  const sentenceAt = (i) => bounds.find((b) => i >= b.start && i <= b.end)?.s ?? text;

  /** A number that is a DIE FACE, not a modifier: "on an unmodified roll of 1". */
  const isDieFace = (sentence, n) =>
    new RegExp(`(?:unmodified|natural)\\s+(?:die\\s+)?rolls?\\s+of\\s+${Math.abs(n)}\\b|rolls?\\s+of\\s+${Math.abs(n)}\\s*(?:-|–|to)\\s*\\d`, "i").test(sentence);

  const judge = (sentence, n) => {
    if (isDieFace(sentence, n)) return "skip";
    // "does not suffer a penalty", "nor is his speed reduced" — the penalty is
    // VOIDED here, so emitting it as an active modifier inverts the ability.
    if (/\b(?:does not|doesn't|no longer|never)\s+suffers?\b|\bnor is\b|\bwithout (?:any )?penalt/i.test(sentence)) return "skip";
    // "instead of the base -4" is decisive: the number is this character's, and
    // it SUPERSEDES a default. Checked before the opponent rule, which would
    // otherwise skip it for merely mentioning the enemies it applies against.
    // A replacement is almost always conditional too ("when blinded"), and the
    // scan cannot read the condition — so it defers to a recipe rather than
    // storing an unconditional value that would be wrong most of the time.
    if (/\binstead of\b|\brather than\b|\bin lieu of\b/i.test(sentence)) {
      return /\b(?:if|when|while|unless|against)\b/i.test(sentence) ? "skip" : "replace";
    }
    // A penalty stated for the OPPONENT is not a modifier on this character.
    if (/\bopponents?\b|\benemies\b|\benemy\b|\btargets?\b/i.test(sentence) && n < 0) return "skip";
    // Most bonuses are SITUATIONAL — "+4 on attack throws when ambushing",
    // "+2 on reaction rolls when negotiating". The number is right but it is not
    // unconditional, and storing it bare claims it always applies. The scan
    // cannot state the condition without copying the sentence, so it marks the
    // effect situational and leaves the circumstance to the description.
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
  // The target phrase must be long enough to reach the end of a two-activity
  // name ("Hiding and Sneaking proficiency throws"), which a shorter cap cuts
  // mid-word so the vocabulary lookup misses.
  const TARGET = `${OWNER}[A-Za-z' -]{2,50}`;
  // "gains a +1 bonus to avoid surprise" / "suffers a -2 penalty on reaction rolls"
  for (const m of text.matchAll(new RegExp(`([+-]?\\d+)\\s+(bonus|penalty)\\s+(?:to|on)\\s+(${TARGET})`, "gi"))) {
    const key = classify(m[3]);
    if (!key) continue;
    let n = parseInt(m[1], 10);
    if (Number.isNaN(n)) continue;
    if (/penalty/i.test(m[2])) n = -Math.abs(n);
    const forWhat = namedActivity(m[3]);
    pushModifier({ type: "modifier", target: key, value: flat(n), ...(forWhat ? { forWhat } : {}) }, m.index);
  }
  // "gains a +2 to saving throws" (no bonus/penalty word — require an explicit sign)
  for (const m of text.matchAll(new RegExp(`([+-]\\d+)\\s+(?:to|on)\\s+(${TARGET})`, "gi"))) {
    const key = classify(m[2]);
    if (!key) continue;
    const forWhat = namedActivity(m[2]);
    pushModifier(
      { type: "modifier", target: key, value: flat(parseInt(m[1], 10)), ...(forWhat ? { forWhat } : {}) },
      m.index,
    );
  }
  // Reversed order: "+1 initiative bonus" / "-2 saving throw penalty".
  for (const m of text.matchAll(/([+-]\d+)\s+([a-z][a-z' -]{2,30}?)\s+(bonus|penalty)\b/gi)) {
    const key = classify(m[2]);
    if (!key) continue;
    let n = parseInt(m[1], 10);
    if (/penalty/i.test(m[3])) n = -Math.abs(n);
    pushModifier({ type: "modifier", target: key, value: flat(n) }, m.index);
  }
  // Verb form: "his maximum number of cleaves is increased by 1", "morale score
  // is increased by 1". Rejects "increased TO 2x" (a multiplier, not a delta).
  for (const m of text.matchAll(/([A-Za-z][A-Za-z' -]{2,50}?)\s+(?:is|are)\s+(increased|reduced|decreased)\s+by\s+(\d+)/gi)) {
    const key = classify(m[1]);
    if (!key) continue;
    const n = parseInt(m[3], 10);
    pushModifier({ type: "modifier", target: key, value: flat(/increase/i.test(m[2]) ? n : -n) }, m.index);
  }
  // "succeeds on a Dungeonbashing proficiency throw of 18+" — the capitalised
  // qualifier says WHICH activity, so a bundle like Adventuring's five throws
  // stays five distinct effects instead of collapsing on the number.
  // A throw stated at 1st level often improves with level a sentence later —
  // "At 1st level the character must make a proficiency throw of 18+ … The
  // proficiency throw required reduces by 1 per level." Read flat, that loses
  // the entire progression, so the improvement is folded into the value.
  const perLevel = text.match(
    /throw(?:\s+required)?\s+(?:is\s+)?(reduce[sd]?|improve[sd]?|decrease[sd]?|lower(?:s|ed)?)\s+by\s+(\d+)\s+per\s+level/i,
  );
  for (const m of text.matchAll(/(?:([A-Z][A-Za-z-]+)\s+)?proficiency throw of (\d+)\+/g)) {
    const base = parseInt(m[2], 10);
    // "Reduces" makes the target NUMBER smaller, which makes the throw easier —
    // so the step is negative however the book phrases it.
    const value = perLevel ? { kind: "perLevel", base, per: -Math.abs(parseInt(perLevel[2], 10)) } : flat(base);
    const e = { type: "throw", value, roll: "1d20", rollType: "above" };
    if (m[1]) e.forWhat = m[1];
    push(e);
  }
  /* --- Limitations: what switches the ability OFF ---
   * Only shapes that reduce to a VALUE are classified — an encumbrance ceiling,
   * an armour weight. The books state plenty of other restrictions in prose
   * ("cannot tumble past the same enemy on two consecutive rounds"), and those
   * stay in the imported description on purpose: the sentence already lives
   * there, and a flag holding a second copy is one this module would have to
   * state the rule to fill. A conclusion may ship; a sentence may not. */
  const enc = text.match(/encumbrance of more than (\d+) stone/i);
  if (enc) push({ type: "limitation", condition: "encumbrance", value: flat(parseInt(enc[1], 10)) });
  const armour = text.match(/wearing (medium or heavy|heavy|medium|light) armou?r[^.]{0,90}\bcannot\b/i);
  if (armour) push({ type: "limitation", condition: "armor", note: armour[1].toLowerCase() });

  /* --- Spell-like abilities: "can cast X (as the spell) once per week" --- */
  const FREQ = [
    [/\bat will\b/i, "atWill"],
    [/\bonce per round\b/i, "perRound"],
    [/\bonce per turn\b/i, "perTurn"],
    [/\bonce per 8 hours\b/i, "per8Hours"],
    [/\bonce per hour\b/i, "perHour"],
    [/\bonce per day\b/i, "perDay"],
    [/\bonce per week\b/i, "perWeek"],
    [/\bonce per month\b/i, "perMonth"],
    [/\bonce per year\b/i, "perYear"],
  ];
  const freqOf = (s) => FREQ.find(([re]) => re.test(s))?.[1] ?? "";
  for (const m of text.matchAll(
    /can (?:cast|bestow|perform|use) ([a-z][a-z' -]{2,40}?)\s*(?:\(as the (?:\d+(?:st|nd|rd|th)? level )?(?:divine |arcane )?spell\)|as a spell-like ability)([^.]{0,60})/gi,
  )) {
    const frequency = freqOf(m[2] ?? "");
    push({ type: "spellLike", spell: m[1].trim(), ...(frequency ? { frequency } : {}) });
  }

  /* --- Prerequisite: "must have the mercantile network power" / "requires that
   * the character have the ability to inspire dread" --- */
  for (const m of text.matchAll(/must have (?:the |gained )?([A-Z][A-Za-z' -]{2,40}?) (?:custom |class )?power\b/g)) {
    push({ type: "requires", note: m[1].trim() });
  }
  for (const m of text.matchAll(/requires that the character (?:have|has) the ability to ([a-z][a-z' -]{2,40})/gi)) {
    push({ type: "requires", note: m[1].trim() });
  }

  /* --- Usage limit with no spell attached. WHAT it gates is free text, but the
   * limit itself is a clean mechanical fact worth surfacing, so it ships as a
   * capability carrying only the frequency. --- */
  if (!out.some((e) => e.type === "spellLike")) {
    const frequency = freqOf(text);
    if (frequency) push({ type: "capability", frequency });
  }

  /* --- Resource spend/gain: Fate Points, spell slots, stigma --- */
  for (const m of text.matchAll(/\b(spend|spends|spending|expend|expends|expending|gain|gains|recovers?)\b[^.]{0,24}?\b(Fate Points?|spell slots?|stigma)\b/gi)) {
    const kind = /fate/i.test(m[2]) ? "fatePoint" : /stigma/i.test(m[2]) ? "stigma" : "spellSlot";
    push({ type: "resource", resource: kind, action: /gain|recover/i.test(m[1]) ? "gain" : "spend" });
  }

  /* --- Caster-level equivalence: "two caster levels higher than actual" --- */
  const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  for (const m of text.matchAll(/\b(one|two|three|four|five|\d+)\s+(?:class|caster)\s+levels?\s+higher\s+than\s+(?:(?:his|her|their|its)\s+)?actual/gi)) {
    const n = WORD_NUM[m[1].toLowerCase()] ?? parseInt(m[1], 10);
    if (n) push({ type: "spellcastingMod", casterLevelDelta: n });
  }

  /* --- Movement grant: "gains a flying movement rate of 30'" --- */
  for (const m of text.matchAll(/\b(flying|climbing|swimming|burrowing)\s+movement rate of\s+(\d+)/gi)) {
    const movementMode = { flying: "fly", climbing: "climb", swimming: "swim", burrowing: "burrow" }[m[1].toLowerCase()];
    push({ type: "movement", movementMode, value: flat(parseInt(m[2], 10)) });
  }

  /* --- Economic rate: "construction rate of 1.33gp per day" --- */
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

  // "climb as a thief of his class level" / "control undead as a crusader of one
  // half his class level" / "as thieves of his class level" (plural, no article)
  // / "as a thief of his level" (the class/caster qualifier is sometimes absent).
  for (const m of text.matchAll(
    /as\s+(?:an?\s+)?(thie(?:f|ves)|crusaders?|fighters?|mages?)\s+of\s+(one[- ]half\s+)?(?:his|her|their)\s+(?:(?:class|caster)\s+)?level/gi,
  )) {
    const as = m[1].toLowerCase().replace(/^thieves$/, "thief").replace(/s$/, "");
    push({ type: "progressionAs", as, atLevel: m[2] ? "half" : "full" });
  }
  return out;
}

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
  if (any(imm)) out.immunities = imm;
  if (any(res)) out.resistances = res;
  if (any(sus)) out.susceptibilities = sus;
  return Object.keys(out).length ? out : null;
}

/** Union two defense objects (type-inherent ACKS rule + per-entry prose scan). */
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
  }
  return out;
}

/** Fixed pattern library (frozen with the schema). */
function applyPattern(raw, instr, registers, misses) {
  let text = clean(raw);
  // Shipped config (like stripRoll): drop a trailing colon and/or one trailing
  // parenthetical before lookup — AX quick-stat labels print as
  // "Skeletons (12):" but the creature table keys clean names. The count and
  // colon live in the reader's book; the config only says to skip them.
  if (instr.stripColon) text = text.replace(/\s*:\s*$/, "");
  if (instr.stripParen) text = text.replace(/\s*\([^)]*\)\s*$/, "");
  switch (instr.pattern ?? "raw") {
    case "raw":
    case "statValue":
      return instr.table ? lookup(registers, instr.table, text, misses) : text;
    case "int": {
      // A genuine "not applicable" (undead morale prints "N/A") is NOT zero —
      // preserve it distinctly so the binding leaves the field blank, not 0.
      if (/^\s*(n\s*[/\\]?\s*a|nil|not applicable|—)\s*$/i.test(text)) return "N/A";
      const m = /(-?[\d,]+)/.exec(text);
      if (!m) return null;
      // The match can be punctuation with no digit in it — a bare "," or "-"
      // both satisfy the pattern — and parseInt turns those into NaN. NaN is
      // typeof "number", so it slips past every downstream guard and only
      // surfaces as a schema rejection at Actor.create, which reads as a bug in
      // the importer rather than an unparseable stat. No number is `null`.
      const n = parseInt(m[1].replace(/,/g, ""), 10);
      return Number.isFinite(n) ? n : null;
    }
    case "dice":
      return DICE_RE.exec(text)?.[0] ?? null;
    case "refList":
      if (!text || /^none/i.test(text)) return [];
      return splitTop(text).map((t) => {
        // Shipped config: strip a trailing roll target ("Climbing 5+" -> token
        // "Climbing", target 5) before the exact-match lookup.
        const roll = instr.stripRoll ? /\s*(\d+)\+\s*$/.exec(t) : null;
        const token = roll ? t.slice(0, roll.index).trim() : t;
        const row = lookup(registers, instr.table, token, misses);
        return roll ? { ...row, target: parseInt(roll[1], 10) } : row;
      });
    case "parenSplit": {
      const m = /^([^(]+?)\s*(?:\(([^)]*)\))?$/.exec(text);
      if (!m) return { text };
      const main = instr.table ? lookup(registers, instr.table, m[1].trim(), misses) : { text: m[1].trim() };
      // splitTop keeps "1,600 st." whole (thousands comma is between digits and
      // not a list separator; protect digit,digit before the top-level split).
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
    default:
      return text; // unknown pattern: degrade to raw text, never throw
  }
}

/**
 * `statline` pattern: the AX-line inline quick-stat block, e.g.
 *   "Fighter 3; Str 11, ... Cha 14; AC 5 (leather), MV 120', HD 3, hp 16,
 *    #AT 1 (sword 6+), Dmg 1d6+2, SV F3, ML +1, AL N, XP 50;
 *    Proficiencies: ...; Equipment: ..."
 * Monster lines omit the class/ability segments and sometimes a comma
 * ("AC 2 HD 3+1"), so the core clause is read by keyword anywhere in it, not
 * sequentially. Purely mechanical: segments split on top-level ";", classified
 * by their leading token, unrecognized segments kept verbatim in `extra`.
 * Which box holds the block (and the name label dropped via dropText) was
 * decided at compile time. Missing keys are simply absent — never a throw.
 */
export function parseStatline(text) {
  const out = { text };
  const segments = text.split(/;/).map((s) => s.trim()).filter(Boolean);
  const rest = [];
  for (const seg of segments) {
    const labeled = /^(Proficiencies|Equipment|Class Abilities|Abilities|Spells(?:\s+\w+)?|Arcane Spells|Divine Spells)\s*:\s*(.*)$/i.exec(seg);
    if (labeled) {
      const key = labeled[1].toLowerCase();
      const body = labeled[2].trim();
      if (key === "proficiencies") out.proficiencies = splitTop(body).map((t) => t.trim());
      else if (key === "equipment") out.equipment = body;
      else if (key === "class abilities" || key === "abilities") out.classAbilities = body;
      else out.spells = ((out.spells ? out.spells + "; " : "") + `${labeled[1]}: ${body}`).trim();
      continue;
    }
    // Ability-score segment: pairs like "Str 13, Int 18, ..." (any subset).
    if (/^(Str|Int|Wis|Dex|Con|Cha)\b/i.test(seg) && !/\bhp\b|#AT|\bAC\b/i.test(seg)) {
      for (const m of seg.matchAll(/\b(Str|Int|Wis|Dex|Con|Cha)\s+(\d+)/gi)) {
        (out.abilities ??= {})[m[1].toLowerCase()] = parseInt(m[2], 10);
      }
      continue;
    }
    // Core stat clause: identified by hp/#AT/AC keywords, read by key.
    if (/\bhp\s*\d|#AT|\bAC\s*-?\d/i.test(seg)) {
      const grab = (re) => re.exec(seg)?.slice(1);
      const mv = grab(/\bMV\s*([^,;]+?)(?=,|$)/i);
      if (mv) out.mv = mv[0].trim();
      const ac = grab(/\bAC\s*(-?\d+)\s*(?:\(([^)]*)\))?/i);
      if (ac) {
        out.ac = parseInt(ac[0], 10);
        if (ac[1]) out.acNote = ac[1].trim();
      }
      const hd = grab(/\bHD\s*([\d]+(?:[+-][\d]+)?\**)/i);
      if (hd) out.hd = hd[0].trim();
      const hp = grab(/\bhp\s*(\d+)\s*(each)?/i);
      if (hp) {
        out.hp = parseInt(hp[0], 10);
        if (hp[1]) out.hpEach = true;
      }
      const at = grab(/#AT\s*([^,;(]+?)\s*(?:\(([^)]*?)\s*(\d+)\+\s*\)|\(([^)]*)\))?(?=,|$)/i);
      if (at) {
        out.atk = { count: at[0].trim() };
        const weapon = at[1] ?? at[3];
        if (weapon) out.atk.text = weapon.trim();
        if (at[2]) out.atk.throw = parseInt(at[2], 10);
      }
      const dmg = grab(/\bDmg\s*(.+?)(?=,\s*(?:Save|SV)\b|;|$)/i);
      if (dmg) out.dmg = dmg[0].trim();
      const sv = grab(/\b(?:Save|SV)\s*([A-Z]+)\s*(\d+)?\s*(?:\(([^)]*)\))?/);
      if (sv) {
        out.save = { class: sv[0], ...(sv[1] ? { level: parseInt(sv[1], 10) } : {}), ...(sv[2] ? { note: sv[2].trim() } : {}) };
      }
      const ml = grab(/\bML\s*([+-]?\d+|N\s*\/?\s*A)/i);
      if (ml) out.ml = /\d/.test(ml[0]) ? parseInt(ml[0], 10) : "N/A";
      const al = grab(/\bAL\s*([A-Z])\b/);
      if (al) out.al = al[0];
      const xp = grab(/\bXP\s*([\d,]+)/i);
      if (xp) out.xp = parseInt(xp[0].replace(/,/g, ""), 10);
      continue;
    }
    // A stat that got its own ";"-separated segment ("…ML +2; XP 1,900;…").
    const xpSeg = /^XP\s+([\d,]+)$/i.exec(seg);
    if (xpSeg) {
      if (out.xp == null) out.xp = parseInt(xpSeg[1].replace(/,/g, ""), 10);
      continue;
    }
    // Class segment: "Wizard* 5 (Fellowship)" / "Fighter 3" / "Normal Man".
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
      // ("Conjure Dark Powers (1st level)" vs "(1level)" when the superscript
      // detaches), so compare folded and fall back to a prefix. That still
      // proves we are on the right entry — a wrong page shares no prefix — but
      // does not fail over a stray glyph, and a failed expect would otherwise
      // zero the entry's mechanics.
      // NFKD first: the AX PDFs mix precomposed and decomposed
      // accents (DOPPELGÄNGER prints A+combining diaeresis); folding must land
      // both forms on the same string. Purely widens tolerance — old cookbooks
      // keep matching.
      const fold = (s) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const f = fold(found);
      const w = fold(instr.text);
      const ok = !!w && (f.startsWith(w) || (w.length >= 12 && f.startsWith(w.slice(0, 12))));
      return { ok, found: found.slice(0, 60) };
    }
    case "text": {
      const paras = [];
      for (const para of instr.paras ?? []) {
        // A paragraph may name its OWN page: definition blocks are column- and
        // page-flowed, so an entry starting low on a page continues overleaf.
        // Absent `para.page` this is exactly the old single-page behaviour.
        const ppd = para.page && para.page !== instr.page ? await getPage(para.page) : pd;
        const runs = runsIn(ppd, para);
        claim(runs, ctx.field);
        const text = clean(joinRuns(runs, para.fixes ?? instr.fixes, para.dropText));
        if (text) paras.push({ type: "paragraph", ...(para.section ? { section: para.section } : {}), text });
      }
      // The JJ closes a custom power with the classes that may take it —
      // "[Beastmaster, Cultist of Atlach-Nacha, Elven Nightblade, Fool]". That
      // is the CONTAINER's business, not the ability's: an ability does not know
      // who may take it. Strip it so the description is the ability itself.
      const last = paras[paras.length - 1];
      if (last) last.text = stripOwnerList(last.text);
      return paras.filter((p) => p.text);
    }
    case "value": {
      const runs = runsIn(pd, instr);
      claim(runs, ctx.field);
      return applyPattern(joinRuns(runs, instr.fixes, instr.dropText), instr, registers, misses);
    }
    /**
     * One COLUMN of a level-progression table, read as a LevelValue.
     *
     * Some abilities keep no numbers in their own entry at all — every thief
     * skill's target numbers live in a single grid, one column per skill, one
     * row per level. The recipe ships the grid's coordinates (which column,
     * which rows) and nothing else, so the numbers still materialize from the
     * reader's own book exactly like a monster's hit dice.
     *
     * Rows are paired by vertical proximity rather than by index, because a
     * blank cell would otherwise shift every level below it.
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
      // Parse both fields into aligned MODES ("1 weapon OR 2 claws + bite").
      // A chef may ship `attacksOverride` — a normalized routine string for a
      // rare format the generic parser mishandles; damage still extracts live.
      // Quality per segment comes from the shipped COLOR ANNOTATION indexed by
      // GLOBAL segment position (flatDamage order) — an observation the compiler
      // made; the runtime never scrapes colours.
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
     * `grid` (schema v2): a printed table read by authored geometry — the MM's
     * "characteristics by rank/age/tier" pages. The recipe ships the data-row
     * band, the row-label span and the column spans with cell patterns; the
     * values materialize here from the reader's own page, exactly like a
     * monster's hit dice. Rows whose cells nearly all fail to parse (column
     * headers caught inside the band) are dropped but stay claimed.
     *
     * `transpose` reads a sideways table (properties as rows, options as
     * columns — the elemental by-element page): one output row per COLUMN,
     * cells keyed by the slugged property labels.
     */
    case "grid": {
      const runs = runsIn(pd, { box: instr.box });
      claim(runs, ctx.field);
      // v3: authored per-row y-bands replace line bucketing — a template row's
      // equipment cell wraps over several text lines that are ONE logical row.
      const yRows = instr.rowBands
        ? instr.rowBands
            .map((b) => ({ y: b.y0, items: runs.filter((it) => it.y >= b.y0 && it.y <= b.y1).sort((p, q) => p.y - q.y || p.x - q.x) }))
            .filter((r) => r.items.length)
        : rowsByY(runs, instr.rowTol ?? 3);
      const spanItems = (items, x0, x1) => items.filter((it) => it.x >= x0 && it.x <= x1);
      const spanRaw = (items, x0, x1) => spanItems(items, x0, x1).map((it) => it.str).join("");
      // Gap-aware joining (authored gapMin, page geometry like every bound):
      // small-caps runs need blind joins, but a wide gap is a word space the
      // text layer does not carry ("1d4 + CON drain" arrives as 4 runs).
      // A rowBands cell spans several printed LINES — the wrap point has no
      // horizontal gap at all, so each line joins alone and the lines join
      // with a space.
      const spanText = instr.rowBands
        ? (items, x0, x1) => {
            const inSpan = spanItems(items, x0, x1);
            const lines = new Map();
            for (const it of inSpan) {
              const k = Math.round(it.y / 3);
              (lines.get(k) ?? lines.set(k, []).get(k)).push(it);
            }
            // A HYPHEN AT THE END OF A LINE IS INSIDE A WORD, not before a
            // space. These cells wrap where the compound breaks — "well-",
            // "blood-", "leather-" — and joining the lines with a space put
            // "Well- made wool dress" on the character sheet. The hyphen is
            // kept rather than swallowed: it is a real one in every compound
            // these tables print, and keeping it can only ever misspell
            // visibly, where dropping it would silently invent a word.
            const joinedLines = [...lines.entries()]
              .sort((a, b) => a[0] - b[0])
              .map(([, l]) => joinCellRuns(l.sort((p, q) => p.x - q.x), instr.gapMin ?? null));
            return clean(
              joinedLines.reduce((acc, line, i) => (i === 0 ? line : acc + (/-$/.test(acc) && /^[a-z]/.test(line) ? "" : " ") + line), ""),
            );
          }
        : (items, x0, x1) => clean(joinCellRuns(spanItems(items, x0, x1), instr.gapMin ?? null));
      const cellValue = (text, col, rawText) => {
        if (col.pattern === "glyphs") {
          // Each PUA glyph char maps through a shipped table (damage-type
          // marks). Read from the RAW join — clean() strips PUA chars.
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
      // A table whose columns ARE its scale carries its header band with it, so
      // the scale is READ here rather than shipped: the compiler said where the
      // headers sit, the seat's own book says what they are.
      let header = null;
      if (instr.headerBand) {
        const hRuns = runsIn(pd, { box: { ...instr.box, y0: instr.headerBand.y0, y1: instr.headerBand.y1 } });
        claim(hRuns, ctx.field);
        header = {};
        for (const col of instr.cols ?? []) {
          const text = spanText(hRuns, col.x0, col.x1);
          if (text) header[col.key] = text;
        }
      }
      const rows = [];
      if (instr.transpose) {
        // Property labels come from the label span of every y-row; each
        // authored column becomes one output row (an option). A sideways table
        // mixes value shapes BY ROW (speeds are text, damage type is glyphs),
        // so `props[slug]` may override the column pattern per property.
        const props = yRows
          .map((r) => ({ y: r.y, label: spanText(r.items, instr.label.x0, instr.label.x1), items: r.items }))
          .filter((r) => r.label);
        for (const col of instr.cols ?? []) {
          const cells = {};
          for (const p of props) {
            const slug = slugLabel(p.label);
            if (instr.dropRows?.includes(slug)) continue; // claimed header/title row
            const eff = instr.props?.[slug] ? { ...col, ...instr.props[slug] } : col;
            const v = cellValue(spanText(p.items, col.x0, col.x1), eff, spanRaw(p.items, col.x0, col.x1));
            if (v != null) cells[slug] = v;
          }
          if (Object.keys(cells).length) rows.push({ key: col.key, label: col.label ?? col.key, cells });
        }
      } else {
        for (const r of yRows) {
          const label = spanText(r.items, instr.label.x0, instr.label.x1);
          if (!label) continue;
          if (instr.dropRows?.includes(slugLabel(label))) continue; // claimed header row
          const cells = {};
          let parsed = 0;
          for (const col of instr.cols ?? []) {
            const v = cellValue(spanText(r.items, col.x0, col.x1), col, spanRaw(r.items, col.x0, col.x1));
            if (v != null) {
              cells[col.key] = v;
              parsed++;
            }
          }
          // A header row's cells are labels, not values — almost nothing parses.
          if (parsed >= (instr.minCells ?? 1)) rows.push({ key: slugLabel(label), label, cells });
        }
      }
      if (!rows.length) {
        misses.push({ field: ctx.field, error: "grid matched no rows" });
        return null;
      }
      return header ? { rows, header } : { rows };
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
  // Art is cached on the same terms as text and for a stronger reason: reading
  // a page's placed images decodes them, which costs seconds where reading its
  // text costs milliseconds. The Monstrous Manual prints several creatures to a
  // spread, so an uncached `art` op pays that once per creature.
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
      result = await execInstruction(instr, ctx);
    } catch (err) {
      misses.push({ field, error: err.message });
      result = null;
    }
    if (field === "name") {
      // A name check that THREW is a failed check, not a passed one — null
      // (the exception path above) must fail exactly like `ok: false`.
      if (!result || result.ok === false) ok = false;
      fields.name = result;
      continue;
    }
    // Nest dotted fields: "stats.x" under fields.stats, "creatures.0" under
    // fields.creatures — one generic rule so new kinds need no special case.
    if (field.includes(".")) {
      const dot = field.indexOf(".");
      (fields[field.slice(0, dot)] ??= {})[field.slice(dot + 1)] = result;
    } else {
      fields[field] = result;
    }
  }

  // Defenses = per-entry prose scan (this seat's own description + shipped
  // vocabulary) UNIONED with the creature's TYPE-inherent defenses (an ACKS
  // type rule authored once on the type node, e.g. "all undead are immune
  // to..."). Both are applied by the type/prose the SEAT extracted — nothing
  // about which defenses a specific creature has is baked on the entry.
  if (fields.description?.length) {
    const scanned = defenseScan(fields.description, registers);
    if (scanned) fields.defenses = scanned;
    // Structured effects: classified from THIS SEAT'S prose against the shipped
    // vocabulary — UNLESS a chef authored specs for this entry, in which case
    // the recipe replaces the scan outright, exactly as it does for rolls.
    //
    // These used to concatenate, which is a double-application bug: Trapfinding
    // prints "+2 on Searching and Trapbreaking proficiency throws" and the scan
    // reads it as +2 to EVERY proficiency throw, so a chef's corrected,
    // properly-scoped effect would have shipped next to the wrong one rather
    // than instead of it. A recipe states the entry's mechanics completely;
    // anything the scan additionally believes is by definition not part of them.
    const authoredEffects = entry.fields?.effects?.specs;
    const effects = authoredEffects?.length
      ? materializeEffects(authoredEffects, fields.description)
      : effectScan(fields.description, registers);
    if (effects.length) fields.effects = effects;
    // A VARIATION's numbers: the same materializer, deliberately its own field.
    // Not folded into `effects` because these are not an ability's mechanics —
    // they are what a difference costs and what it moves — and because that
    // path falls through to `effectScan` when nothing is authored, which would
    // put a scan's guesses on a document whose whole point is that its numbers
    // came off the page. No scan fallback here: a variation with no authored
    // locator locates nothing, and says so by being empty.
    const variationSpecs = entry.fields?.variation?.specs;
    if (variationSpecs?.length) {
      const located = materializeEffects(variationSpecs, fields.description);
      if (located.length) fields.variation = located;
    }
    // The entry's OWN printed numbers, located the same way and kept apart for
    // the same reason: what a thing IS is not what a difference MOVES, and
    // neither may fall through to a scan. A spec that did not match is absent,
    // so the binding sees the book's number or nothing — never a default.
    const valueSpecs = entry.fields?.values?.specs;
    if (valueSpecs?.length) {
      const located = materializeEffects(valueSpecs, fields.description);
      if (located.length) fields.values = located;
    }
    // Every roll the ability offers, each with its own target and progression.
    // A chef-authored recipe REPLACES the scan outright for this entry rather
    // than merging with it: the recipe states how many rolls the entry has, so
    // anything the scan additionally thinks it sees is a duplicate or an
    // artifact. Scans are the draft for entries nobody has read yet.
    const authored = materializeRolls(entry.fields?.rolls?.specs, fields.description, {
      progression: fields.progression,
    });
    const rolls = entry.fields?.rolls?.specs?.length ? authored : rollScan(fields.description);
    if (rolls.length) fields.rolls = rolls;
  }
  // Values the books state in PROSE rather than in a labelled field — the
  // custom-class build cost, "counts as 2 1/2 custom powers". The pattern is
  // shipped vocabulary; the NUMBER is read here, from this seat's own extracted
  // text, so no book value ever rides along in the module.
  if (fields.description?.length) {
    const text = fields.description.map((p) => p.text).join(" ");
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
  // An ability whose numbers live in a TABLE rather than in its own entry: the
  // column just read IS its proficiency throw, level by level. Added after the
  // prose scan so it lands even on an entry whose description says nothing
  // mechanical — which is exactly the case that motivated it.
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
    ok,
    fields,
    misses,
    ...(claims ? { claims, pages: [...pageCache.keys()] } : {}),
  };
}
