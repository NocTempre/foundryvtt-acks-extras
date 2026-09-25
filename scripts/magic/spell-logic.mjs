/**
 * The spell primitive's pure logic — Foundry-free, so the suite asserts it
 * and the importer's binder shares it with the sheet.
 *
 * Two directions over one shape. `parseRangeLine` and `parseDurationLine`
 * read a printed stat line into the structured form (a `RANGE_SHAPES` or
 * `DURATION_SHAPES` member, the number, the unit, the concentration kind) and
 * keep whatever they cannot read as a note; `displayRange` and
 * `displayDuration` write the structured form back as one line, which is
 * what the acks system's own `range` and `duration` strings hold.
 * `coreFieldsFrom` is the whole of what the flag states about core's fields.
 *
 * The shapes are structure; every number is the page's and arrives through
 * the parser at import or through the sheet by hand.
 */

import { SPELL_TYPES } from "../lib/magic-vocab.mjs";

const DIST =String.raw`(?<n>\d[\d,]*(?:\.\d+)?)\s*(?<u>'|ft\.?|feet|foot|miles?|mi\.?)`;
const PER_LEVEL = String.raw`\s*(?:/|per)\s*(?:caster\s+)?level`;
const TIME_UNIT = String.raw`(rounds?|turns?|minutes?|hours?|days?|weeks?|months?|years?)`;
const TIME = String.raw`(?<n>\d[\d,]*(?:\.\d+)?)\s*(?<u>${TIME_UNIT.slice(1, -1)})`;
const TIME2 = String.raw`(?<n2>\d[\d,]*(?:\.\d+)?)\s*(?<u2>${TIME_UNIT.slice(1, -1)})`;
const DICE = String.raw`(?<d>\d+d\d+(?:\s*[+-]\s*\d+)?)\s*(?<u>${TIME_UNIT.slice(1, -1)})`;
const CONC = String.raw`(?<stat>stationary\s+)?concentration`;
// What may follow a recognised head: a parenthetical, or an "or …" clause.
const TAIL = String.raw`(?<tail>\s*\(.*\)|\s+or\s+.*)?`;

const re = (body) => new RegExp(`^${body}$`, "i");

/** A printed number, thousands separators removed; null when it is not one. */
export function toNumber(text) {
  const n = Number(String(text ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** One printed line normalised for matching: lower case, straight apostrophes, single spaces. */
const fold = (text) =>
  String(text ?? "")
    .toLowerCase()
    .replace(/[’′]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** A comma-separated line as a list of trimmed, non-empty entries. */
export function splitList(text) {
  if (Array.isArray(text)) return text.map((s) => String(s).trim()).filter(Boolean);
  return String(text ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A time unit as printed (singular or plural) to its `TIME_UNITS` key. */
function unitKey(word) {
  const w = String(word ?? "").toLowerCase();
  return w.endsWith("s") ? w : `${w}s`;
}

const distanceOf = (m) => ({ value: toNumber(m.groups.n), unit: /^mi/.test(m.groups.u) ? "miles" : "feet" });

const blankRange = () => ({ shape: "", value: null, unit: "", note: "" });

const RANGE_RULES = [
  [re("self"), () => ({ shape: "self" })],
  [re("touch"), () => ({ shape: "touch" })],
  [re("special"), () => ({ shape: "special" })],
  [re("unlimited"), () => ({ shape: "unlimited" })],
  [re(String.raw`touch\s*\(\s*${DIST}\s*\)`), (m) => ({ shape: "touchOrDistance", ...distanceOf(m) })],
  [re(String.raw`${DIST}\s*\(\s*touch\s*\)`), (m) => ({ shape: "touchOrDistance", ...distanceOf(m) })],
  [re(`${DIST}${PER_LEVEL}`), (m) => ({ shape: "distancePerLevel", ...distanceOf(m) })],
  [re(DIST), (m) => ({ shape: "distance", ...distanceOf(m) })],
];

/**
 * A printed range line as `{shape, value, unit, note}`. A line no rule reads
 * comes back with a blank shape and the line itself as the note, so nothing
 * printed is lost and the sheet shows what the parser could not place.
 */
export function parseRangeLine(text) {
  const raw = String(text ?? "").trim();
  const line = fold(raw);
  if (!line) return blankRange();
  for (const [rule, read] of RANGE_RULES) {
    const m = rule.exec(line);
    if (m) return { ...blankRange(), ...read(m) };
  }
  return { ...blankRange(), note: raw };
}

const blankDuration = () => ({
  shape: "",
  value: null,
  unit: "",
  dice: "",
  plus: { value: null, unit: "" },
  concentration: "",
  maxPerLevel: false,
  note: "",
});

const tailNote = (m) => (m.groups.tail ? m.groups.tail.trim() : "");
const concKind = (m) => (m.groups.stat ? "stationary" : "mobile");

const DURATION_RULES = [
  [
    re(`(?<word>instantaneous|perpetual|indefinite|permanent|special)${TAIL}`),
    (m) => ({ shape: m.groups.word, note: tailNote(m) }),
  ],
  [
    re(String.raw`${CONC}\s*\+\s*${TIME}${TAIL}`),
    (m) => ({
      shape: "concentrationPlus",
      concentration: concKind(m),
      plus: { value: toNumber(m.groups.n), unit: unitKey(m.groups.u) },
      note: tailNote(m),
    }),
  ],
  [
    re(String.raw`${CONC}\s*\(\s*${TIME}(?<pl>${PER_LEVEL})?\s*\)${TAIL}`),
    (m) => ({
      shape: "concentrationMax",
      concentration: concKind(m),
      value: toNumber(m.groups.n),
      unit: unitKey(m.groups.u),
      maxPerLevel: !!m.groups.pl,
      note: tailNote(m),
    }),
  ],
  [re(`${CONC}${TAIL}`), (m) => ({ shape: "concentration", concentration: concKind(m), note: tailNote(m) })],
  [
    re(String.raw`${TIME}\s*\+\s*${TIME2}${PER_LEVEL}${TAIL}`),
    (m) => ({
      shape: "basePlusPerLevel",
      value: toNumber(m.groups.n),
      unit: unitKey(m.groups.u),
      plus: { value: toNumber(m.groups.n2), unit: unitKey(m.groups.u2) },
      note: tailNote(m),
    }),
  ],
  [
    re(`${TIME}${PER_LEVEL}${TAIL}`),
    (m) => ({ shape: "perLevel", value: toNumber(m.groups.n), unit: unitKey(m.groups.u), note: tailNote(m) }),
  ],
  [
    re(`${DICE}${TAIL}`),
    (m) => ({ shape: "dice", dice: m.groups.d.replace(/\s+/g, ""), unit: unitKey(m.groups.u), note: tailNote(m) }),
  ],
  [re(`${TIME}${TAIL}`), (m) => ({ shape: "fixed", value: toNumber(m.groups.n), unit: unitKey(m.groups.u), note: tailNote(m) })],
];

/**
 * A printed duration line as the duration shape (`shape`, `value`, `unit`,
 * `dice`, `plus`, `concentration`, `maxPerLevel`, `note`). As with a range,
 * an unread line keeps its text as the note under a blank shape.
 */
export function parseDurationLine(text) {
  const raw = String(text ?? "").trim();
  const line = fold(raw);
  if (!line) return blankDuration();
  for (const [rule, read] of DURATION_RULES) {
    const m = rule.exec(line);
    if (m) return { ...blankDuration(), ...read(m) };
  }
  return { ...blankDuration(), note: raw };
}

/* -------------------------------------------- */

const withNote = (text, note) => [text, String(note ?? "").trim()].filter(Boolean).join(" ");

function distanceText(value, unit) {
  const n = toNumber(value);
  if (n == null) return "";
  return unit === "miles" ? `${n} ${n === 1 ? "mile" : "miles"}` : `${n}'`;
}

function timeText(value, unit) {
  const n = toNumber(value);
  if (n == null || !unit) return "";
  return `${n} ${n === 1 ? String(unit).replace(/s$/, "") : unit}`;
}

/**
 * The one-line form of a range shape — what core's `range` string holds. A
 * blank shape shows the note alone: an unread printed line still reaches the
 * field, and a shape with no note states nothing.
 */
export function displayRange(range) {
  const r = range ?? {};
  const dist = distanceText(r.value, r.unit);
  let text = "";
  switch (r.shape) {
    case "self":
    case "touch":
    case "special":
    case "unlimited":
      text = r.shape;
      break;
    case "distance":
      text = dist;
      break;
    case "distancePerLevel":
      text = dist ? `${dist}/level` : "";
      break;
    case "touchOrDistance":
      text = dist ? `touch (${dist})` : "touch";
      break;
    default:
      return String(r.note ?? "").trim();
  }
  return text ? withNote(text, r.note) : "";
}

/** The one-line form of a duration shape — what core's `duration` string holds; the note alone for a blank shape. */
export function displayDuration(duration) {
  const d = duration ?? {};
  const conc = d.concentration === "stationary" ? "stationary concentration" : "concentration";
  const base = timeText(d.value, d.unit);
  const plus = timeText(d.plus?.value, d.plus?.unit);
  let text = "";
  switch (d.shape) {
    case "instantaneous":
    case "perpetual":
    case "indefinite":
    case "permanent":
    case "special":
      text = d.shape;
      break;
    case "fixed":
      text = base;
      break;
    case "perLevel":
      text = base ? `${base}/level` : "";
      break;
    case "basePlusPerLevel":
      text = base && plus ? `${base} + ${plus}/level` : base;
      break;
    case "dice":
      text = d.dice && d.unit ? `${d.dice} ${d.unit}` : "";
      break;
    case "concentration":
      text = conc;
      break;
    case "concentrationPlus":
      text = plus ? `${conc} + ${plus}` : conc;
      break;
    case "concentrationMax":
      text = base ? `${conc} (${base}${d.maxPerLevel ? "/level" : ""})` : conc;
      break;
    default:
      return String(d.note ?? "").trim();
  }
  return text ? withNote(text, d.note) : "";
}

/** A magic-type key as core's `class` string writes it: "arcane" → "Arcane". */
export const traditionLabel = (key) => {
  const s = String(key ?? "").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
};

/**
 * What the flag states about the acks system's own spell fields: `lvl` and
 * `class` from the first list, `range` and `duration` from their shapes,
 * `save` from the save category. A key is present only where the flag says
 * something — a blank shape with no note states nothing, so core's string
 * stays as it is.
 * @returns {{lvl?: number, class?: string, range?: string, duration?: string, save?: string}}
 */
export function coreFieldsFrom(extras) {
  const x = extras ?? {};
  const out = {};
  const first = (x.lists ?? [])[0];
  if (first) {
    const level = toNumber(first.level);
    if (level != null && Number.isInteger(level)) out.lvl = level;
    if (first.source) out.class = traditionLabel(first.source);
  }
  const range = displayRange(x.range);
  if (range) out.range = range;
  const duration = displayDuration(x.duration);
  if (duration) out.duration = duration;
  if (x.save?.category) out.save = x.save.category === "none" ? "" : x.save.category;
  return out;
}

/* -------------------------------------------- */

/** Case and punctuation folded, for matching a tradition or a name. */
export const foldKey = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The traditions a spell is offered under, folded: every list's source where
 * the spell carries lists, else core's `class` string. An empty result means
 * the spell names no tradition and is offered to every caster.
 */
export function spellTraditions(extras, systemClass) {
  const listed = (extras?.lists ?? []).map((l) => foldKey(l?.source)).filter(Boolean);
  if (listed.length) return [...new Set(listed)];
  const own = foldKey(systemClass);
  return own ? [own] : [];
}

/**
 * The key two copies of one spell share in a picker: the folded name, and
 * nothing else. A core-pack copy carries no importer id, so keying an
 * imported copy by its id keeps the two apart; the name is what they share,
 * and the first offered wins.
 */
export const spellDedupeKey = (name) => `name:${foldKey(name)}`;

/* -------------------------------------------- */
/*  The printed stat block                       */
/* -------------------------------------------- */

const STAT_LABELS = ["Type", "Range", "Duration"];

/**
 * A printed stat block as its parts. The block opens with the magic types and
 * the level the spell holds on each ("Arcane 3, Divine 4"), then labelled
 * runs: `Type:` the spell types, `Range:` and `Duration:` as printed. Each
 * part comes back as printed text (`lists` as `{source, level}` pairs,
 * `types` as a list); a label the block lacks leaves its part empty.
 */
export function parseStatBlock(text) {
  const raw = String(text ?? "").replace(/\s+/g, " ").trim();
  const out = { lists: [], types: [], range: "", duration: "" };
  if (!raw) return out;
  const marks = STAT_LABELS.map((label) => ({ label, at: raw.search(new RegExp(String.raw`(?:^|\s)${label}\s*:`)) }))
    .filter((m) => m.at >= 0)
    .sort((a, b) => a.at - b.at);
  const head = marks.length ? raw.slice(0, marks[0].at) : raw;
  const parts = {};
  marks.forEach((m, i) => {
    const start = raw.indexOf(":", m.at) + 1;
    const end = i + 1 < marks.length ? marks[i + 1].at : raw.length;
    parts[m.label] = raw.slice(start, end).trim();
  });
  for (const pair of splitList(head)) {
    const m = /^(.+?)\s*(\d+)$/.exec(pair);
    if (m) out.lists.push({ source: m[1].trim(), level: toNumber(m[2]) });
  }
  out.types = splitList(parts.Type);
  out.range = parts.Range ?? "";
  out.duration = parts.Duration ?? "";
  return out;
}

/**
 * The spell primitive's fields a stat block states: the lists (sources
 * folded to keys), the primary `type` (the first type word the engine knows),
 * every type word as a school, the elements a type carries in parentheses,
 * whether the block names a ritual, and the range and duration shapes.
 */
export function spellFromStat(stat) {
  const schools = [];
  const elements = [];
  let ritual = false;
  for (const word of stat?.types ?? []) {
    const m = /^([A-Za-z][A-Za-z-]*)\s*(?:\(([^)]*)\))?$/.exec(String(word).trim());
    const key = (m ? m[1] : String(word)).trim().toLowerCase();
    if (!key) continue;
    if (key === "ritual") {
      ritual = true;
      continue;
    }
    schools.push(key);
    if (m?.[2]) elements.push(...splitList(m[2]).map((e) => e.toLowerCase()));
  }
  return {
      // no-scroll: the class keys a printed list names, not a window
    lists: (stat?.lists ?? []).map((l) => ({ source: foldKey(l.source), level: l.level, classes: [], note: "" })),
    type: schools.find((s) => s in SPELL_TYPES) ?? "",
    schools,
    elements,
    ritual,
    range: parseRangeLine(stat?.range),
    duration: parseDurationLine(stat?.duration),
  };
}

/** Words a spell's name sets in lower case when they are not its first. */
const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "nor", "of", "on", "or", "the", "to", "with"]);

/** A name as a heading prints it: each word capitalised but the small ones. */
export const headingCase = (text) =>
  String(text ?? "")
    .trim()
    .split(/\s+/)
    .map((w, i) => (i && SMALL_WORDS.has(w.toLowerCase()) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");

/**
 * How a reversible spell's prose names its reverse: "the reverse of this
 * spell, X, …", "the reverse form of this spell, X, …", "the reverse of this
 * spell (X) …", "reversed, this spell becomes X", "reversed, <spell> becomes
 * X", "the reverse, X, …", "the reverse spell, X, …", "the reverse form, X,
 * …", "the reverse of <spell> is called X", and "X, the reverse of <spell>, …"
 * where X opens a sentence.
 */
const NAME = String.raw`[^,.;()]+?`;
const REVERSE_RULES = [
  new RegExp(String.raw`\breverse(?:d)?(?: form)? of (?:this|the) spell,\s*(${NAME})\s*[,.;]`, "i"),
  new RegExp(String.raw`\breverse(?:d)?(?: form)? of (?:this|the) spell\s*\(\s*(${NAME})\s*\)`, "i"),
  new RegExp(String.raw`\breversed,\s*(?:this spell|[a-z][a-z'’ -]*?)\s+becomes\s+(${NAME})\s*[,.;]`, "i"),
  new RegExp(String.raw`\bthe reverse(?: spell| form)?,\s*(${NAME})\s*[,.;]`, "i"),
  new RegExp(String.raw`\bthe reverse of [a-z][a-z'’ -]*? is called\s+(${NAME})\s*[,.;]`, "i"),
  new RegExp(String.raw`(?:^|[.;!?]\s+)([A-Z][a-z'’ -]*?), the reverse of (?:this spell|[a-z][a-z'’ -]*?),`),
];

/** The reverse's name where the prose states one, in heading case; empty otherwise. */
export function reversedNameFrom(text) {
  const prose = String(text ?? "").replace(/\s+/g, " ");
  for (const rule of REVERSE_RULES) {
    const m = rule.exec(prose);
    if (m) return headingCase(m[1]);
  }
  return "";
}
