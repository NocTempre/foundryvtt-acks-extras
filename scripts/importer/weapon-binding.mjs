/**
 * Weapon-list assembly: the raw reads of the prose that names kinds of weapon
 * → the `weaponLists` tables `lib/weapons.mjs` resolves the weapons grid's
 * rows against.
 *
 * Six folios state what the grid does not: the numbered kinds Martial Training
 * adds (RR ch. 3) and the kinds a narrow class may pick (JJ ch. 12), the kinds
 * a Weapon Focus names (RR ch. 3), the weapons each physical damage type is
 * dealt by and what a thrown flask or torch deals (RR ch. 6), and the weapon
 * descriptions that say a weapon needs both hands (RR ch. 4). Each list is
 * kept as the nouns the printing uses; a noun is placed on a module token or
 * key only by the words of that token's own name (a category called
 * `flailHammerMace` is the one a flail, a hammer or a mace names, as a
 * proficiency called Alchemy is the one that word names), and an option that
 * names no such token is the module's catch-all category.
 *
 * The `options` table keeps the book's own option lists whole, each option
 * under its printed marker: the restricted, narrow and broad lists a custom
 * class selects from (JJ ch. 12) and the options Martial Training adds (RR
 * ch. 3). An option is a list of nouns, one weapon, a size or use predicate,
 * or a combination of any N weapons with the prerequisites printed beside it.
 * A level's list is kept only where the total its own sentence prints equals
 * the options read.
 *
 * A window that did not read leaves its list absent, so the resolver places
 * nothing from it; nothing is defaulted. No noun, die or type ships: the
 * parsers hold punctuation, list separators and the sentence shapes the book
 * states each fact in.
 */
import { MODULE_ID } from "./constants.mjs";
import * as services from "../lib/services.mjs";
import { getLayer, PRIORITY } from "../lib/tables.mjs";
import { DAMAGE_TYPES } from "../lib/vocab.mjs";
import { WEAPON_LISTS_DOC, fold as letters, forms } from "../lib/weapons.mjs";
import { WEAPON_CATEGORY, SIZE } from "../equipment/config.mjs";
import { assembledDoc } from "./produces.mjs";
import { firstSentence } from "./formation-binding.mjs";
import { damageTypeOf } from "./stats-map.mjs";

/** The raw document the folios' windows are read into (`TABLE_RECIPES`). */
export const WEAPON_PROSE_DOC_ID = "weaponProse";

/** The engine document both halves agree on (`lib/weapons.mjs` `expectTables`). */
export const WEAPON_LISTS_DOC_ID = WEAPON_LISTS_DOC;

/** The hook fired, with `{ assembled }`, once the lists are registered: what a reader of the option lists redraws on. */
export const WEAPON_LISTS_IMPORTED_HOOK = "acksExtras.weaponListsImported";

/** The engine tables this binding assembles, each with the raw table(s) it is read from. */
export const PRODUCES = Object.freeze({
  [WEAPON_LISTS_DOC_ID]: {
    category: ["martialProse", "narrowProse"],
    options: ["martialProse", "selectionProse"],
    focus: "focusProse",
    damageType: "damageTypeProse",
    throwables: "throwableProse",
    twoHands: ["twoHandsFirst", "twoHandsSecond"],
  },
});

/* ------------------------------------------------------------------ */
/*  Parsers                                                            */
/* ------------------------------------------------------------------ */

/** Number words a list of kinds never holds: a "any <number> weapons" item names no kind (RR p. 114). */
const NUMBER_WORD = /^(?:one|two|three|four|five|six|seven|eight|nine|ten)$/;

/** A window lowercased, whitespace collapsed, and a line-wrap hyphen closed ("staff- slings"). */
const unwrap = (text) =>
  String(text ?? "")
    .toLowerCase()
    .replace(/(\w)-\s+(\w)/g, "$1-$2")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The nouns of one list: the items between commas, slashes, "and" and "or",
 * each without a leading "any" or a trailing "weapons". An item that holds a
 * figure, is a number word, or runs past three words names no kind and is
 * dropped, which is what keeps the counted-combination items (JJ p. 290) and
 * the spelled-count items (RR p. 114) out of the lists they stand in.
 *
 * @returns {string[]} the nouns as printed (lowercase), each once, in order
 */
export function parseNouns(text) {
  const out = [];
  for (const piece of unwrap(text).split(/\s*(?:[,/]|\band\b|\bor\b)\s*/)) {
    if (!/^[a-z][a-z -]*$/.test(piece)) continue;
    const noun = piece.replace(/^(?:any|all)\s+/, "").replace(/\s+weapons?$/, "").trim();
    if (!noun || NUMBER_WORD.test(noun) || noun.split(" ").length > 3) continue;
    if (!out.includes(noun)) out.push(noun);
  }
  return out;
}

/**
 * The nouns of each numbered option in a window: `(1) …; (2) …` or
 * `(i) …; (ii) …`. An option ends at its first semicolon or full stop, so
 * what the page prints after the last option (a rule, the next table) is not
 * read into it. The text before the first marker is the preface and names none.
 *
 * @returns {string[][]} one noun list per option, an option that names no kind empty
 */
export function parseOptions(window) {
  return unwrap(window)
    .split(/\(\s*(?:\d+|[ivx]+)\s*\)/)
    .slice(1)
    .map((part) => parseNouns(part.split(/[;.]/)[0]));
}

/** The value of each number word a count is spelled with. */
const NUMBER_VALUE = Object.freeze({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 });

/** A count as printed: figures, or a number word. */
const COUNT = `\\d+|${Object.keys(NUMBER_VALUE).join("|")}`;

/** The count a figure or number word stands for. */
const countOf = (word) => (/^\d+$/.test(word) ? Number(word) : NUMBER_VALUE[word]);

/** An option's marker in parentheses: arabic or roman, `(3)` or `(iii)`. */
const MARKER = /\(\s*(\d+|[ivx]+)\s*\)/g;

/** The value of each roman digit a marker is written with. */
const ROMAN_DIGIT = Object.freeze({ i: 1, v: 5, x: 10 });

/** The number a printed marker stands for. */
function markerValue(marker) {
  if (/^\d+$/.test(marker)) return Number(marker);
  let total = 0;
  for (let i = 0; i < marker.length; i++) {
    const digit = ROMAN_DIGIT[marker[i]];
    total += ROMAN_DIGIT[marker[i + 1]] > digit ? -digit : digit;
  }
  return total;
}

/** An option's words without the list separators that trail or lead it. */
const trimList = (s) => s.replace(/^[\s,]*(?:(?:and|or)\s+)?/, "").replace(/(?:[\s,]+(?:and|or))?[\s,]*$/, "").trim();

/**
 * Each marked option of a window, in printed order: `(1) …` or `(i) …`. An
 * option's text runs to its first semicolon or full stop and loses the
 * separators beside it. The markers must run 1, 2, 3 … without a gap, or the
 * window is not read as a list at all.
 *
 * @returns {Array<{marker: string, n: number, text: string}>} the marker as
 *   printed, its number, and the option's words; empty where no list reads
 */
export function parseMarkedOptions(window) {
  const text = unwrap(window);
  const marks = [...text.matchAll(MARKER)];
  const options = marks.map((m, i) => ({
    marker: m[1],
    n: markerValue(m[1]),
    text: trimList(text.slice(m.index + m[0].length, marks[i + 1]?.index ?? text.length).split(/[;.]/)[0]),
  }));
  return options.length && options.every((o, i) => o.n === i + 1) ? options : [];
}

/** Words that open or join a list of kinds and name none. */
const GENERIC_WORD = new Set(["any", "all", "and", "or", "weapon", "weapons"]);

/**
 * One marked option as the table keeps it: `{n, marker, label}` and, by what
 * the words are,
 *
 *  - `any` and `prereqs`: a counted combination or a spelled-count item (RR p. 114, JJ p. 290)
 *  - `melee`, `missile` and `sizes`: a predicate, every word of which is a size
 *    or "melee" or "missile"
 *  - `weapon`: a restricted option, which names one weapon
 *  - `nouns`: a list of kinds, as `parseNouns` reads it
 *
 * Null where the words are none of these.
 *
 * @param {{n: number, marker: string, text: string}} option from `parseMarkedOptions`
 * @param {{restricted?: boolean, sizes?: string[]}} [opts] `restricted`: the list names single weapons;
 *   `sizes`: the size vocabulary a predicate is recognised against
 */
export function optionOf({ n, marker, text }, { restricted = false, sizes = Object.values(SIZE) } = {}) {
  const base = { n, marker, label: text };
  const combination = new RegExp(`\\bcombination of\\s*(${COUNT})\\b|^(?:any\\s+)?(${COUNT})\\s+weapons?\\b`).exec(text);
  if (combination) {
    const count = countOf(combination[1] ?? combination[2]);
    return count ? { ...base, label: text.slice(0, combination.index + combination[0].length), any: count, prereqs: [] } : null;
  }
  const words = text.split(/[^a-z]+/).filter((w) => w && !GENERIC_WORD.has(w));
  const sized = words.filter((w) => sizes.includes(w));
  const uses = words.filter((w) => w === "melee" || w === "missile");
  if (words.length && uses.length && sized.length + uses.length === words.length) {
    return {
      ...base,
      ...(uses.includes("melee") ? { melee: true } : {}),
      ...(uses.includes("missile") ? { missile: true } : {}),
      ...(sized.length ? { sizes: sized } : {}),
    };
  }
  const nouns = parseNouns(text);
  if (!nouns.length) return null;
  return restricted && nouns.length === 1 ? { ...base, weapon: nouns[0] } : { ...base, nouns };
}

/** The leading words of a prerequisite's condition that name no weapon: connectives and the verbs of the condition clause (RR p. 114). */
const CONDITION_WORD = new Set(["also", "proficient", "in", "with", "he", "she", "already", "has", "or", "selects", "select"]);

/**
 * The prerequisites a sentence states: `can only be proficient in A or B if
 * also C` and `can only select A or B if he already has or also selects C`,
 * each clause cut where the next `can only` begins or the sentence ends.
 *
 * @returns {Array<{weapons: string[], requires: string[]}>} the kinds the
 *   clause restricts and the kinds it requires first
 */
export function parsePrereqs(text) {
  const out = [];
  const clause = /\bcan\s+only\s+(?:be\s+proficient\s+in|select)\s+(.+?)\s+if\s+(.+?)(?=\s*[;,]?\s*and\s+the\s+\w+\s+can\s+only\b|[.;]|$)/g;
  for (const m of unwrap(text).matchAll(clause)) {
    const words = m[2].split(" ");
    while (words.length && CONDITION_WORD.has(words[0])) words.shift();
    const weapons = parseNouns(m[1]);
    const requires = parseNouns(words.join(" "));
    if (weapons.length && requires.length) out.push({ weapons, requires });
  }
  return out;
}

/**
 * The options of one list window: every marked option classified, the
 * prerequisites the window states on its combination options. Null where the
 * markers do not run from 1 or an option's words are none of the shapes.
 */
function optionsOf(window, opts) {
  const marked = parseMarkedOptions(window);
  if (!marked.length) return null;
  const options = marked.map((m) => optionOf(m, opts));
  if (options.some((o) => !o)) return null;
  const prereqs = parsePrereqs(window);
  for (const o of options) if (o.any != null) o.prereqs = prereqs;
  return options;
}

/** The sentence shape that opens a selection level: `any N of the following M`. */
const PICK_OF_TOTAL = new RegExp(`\\bany\\s+(${COUNT})\\s+of\\s+the\\s+following\\s+(\\d+)\\b`);

/**
 * The selection levels of a class (JJ ch. 12) from the window that holds them
 * all. A level opens at `restricted:`, `narrow:` or `broad:` (a word boundary
 * keeps the first out of `unrestricted:`, which holds no list), runs to the
 * next level's head, and is cut at its example paragraph, whose own markers
 * are not options. A level is read only where its sentence prints a pick count
 * and a total and the total equals the options parsed: a list that disagrees
 * with its own count is dropped.
 *
 * @param {string} window
 * @param {string[]} [sizes] the size vocabulary a predicate option is recognised against
 * @returns {Record<string, {pick: number, total: number, options: object[]}>} by level
 */
export function parseSelection(window, sizes = Object.values(SIZE)) {
  const text = unwrap(window);
  const heads = [...text.matchAll(/\b(restricted|narrow|broad|unrestricted):/g)];
  const out = {};
  heads.forEach((head, i) => {
    const level = head[1];
    if (level === "unrestricted" || Object.hasOwn(out, level)) return;
    const body = text.slice(head.index + head[0].length, heads[i + 1]?.index ?? text.length);
    const cut = body.search(/\bexample\b/);
    const part = cut >= 0 ? body.slice(0, cut) : body;
    const shape = PICK_OF_TOTAL.exec(part);
    const options = optionsOf(part, { restricted: level === "restricted", sizes });
    if (!shape || !options || Number(shape[2]) !== options.length) return;
    out[level] = { pick: countOf(shape[1]), total: Number(shape[2]), options };
  });
  return out;
}

/**
 * The `options` table: the selection levels and the Martial Training options,
 * each list with the citation of the page it was read from.
 *
 * @param {object} raw the raw tables
 * @param {Record<string, string>} cites the raw document's citations by raw table
 * @param {string[]} sizes
 */
function assembleOptions(raw, cites, sizes) {
  const out = {};
  const cite = (id) => (cites?.[id] ? { cite: cites[id] } : {});
  for (const [level, list] of Object.entries(parseSelection(raw.selectionProse?.levels, sizes))) {
    out[level] = { ...cite("selectionProse"), ...list };
  }
  const martial = optionsOf(raw.martialProse?.options, { sizes });
  if (martial) out.martial = { ...cite("martialProse"), options: martial };
  return out;
}

/** The words of a camelCase token: `flailHammerMace` is `flail`, `hammer`, `mace`. */
const tokenWords = (token) => String(token).replace(/([A-Z])/g, " $1").toLowerCase().split(" ").filter(Boolean);

/**
 * The category token a noun names: the one whose own name holds the noun's
 * word, singular or plural; the catch-all token for a noun no token names.
 */
export function categoryOf(noun, categories = WEAPON_CATEGORY) {
  const mine = new Set(forms(letters(noun)));
  const named = Object.values(categories).filter((token) => token !== categories.OTHER && tokenWords(token).some((w) => forms(w).some((f) => mine.has(f))));
  return named.length === 1 ? named[0] : categories.OTHER;
}

/**
 * The category table from the numbered option lists of the books that name
 * them: every noun under the token it names, each noun once, in the order read.
 * @returns {Record<string, string[]>}
 */
export function assembleCategory(optionLists, categories = WEAPON_CATEGORY) {
  const out = {};
  for (const noun of optionLists.flat()) {
    const token = categoryOf(noun, categories);
    const held = (out[token] ??= []);
    if (!held.includes(noun)) held.push(noun);
  }
  return out;
}

/**
 * The Weapon Focus table from the sentence that lists them: `;` separates one
 * focus from the next and each holds its own nouns. A focus is keyed by its
 * nouns folded together (letters only, the connective dropped, as in the sling
 * focus; RR p. 121), the
 * spelling the module's focus grants already use.
 * @returns {Record<string, string[]>}
 */
export function parseFocus(window) {
  const list = unwrap(window).replace(/^[:\s]+/, "").split(/\.(?:\s|$)/)[0];
  const out = {};
  for (const group of list.split(";")) {
    const nouns = parseNouns(group);
    if (nouns.length) out[nouns.map(letters).join("")] = nouns;
  }
  return out;
}

/**
 * The weapons a damage type's entry says it is dealt by: the list after
 * "dealt by", up to the words that end it ("and so on", "and similar", "or by").
 * @returns {string[]}
 */
export function parseDealtBy(window) {
  const m = /\bdealt by\s+([^.]*)/.exec(unwrap(window));
  if (!m) return [];
  return parseNouns(m[1].split(/\b(?:and so on|and similar|or by|and by|etc)\b/)[0]);
}

/** The first dice term in a sentence, or null. */
const diceIn = (s) => /\b(\d+d\d+)\b/.exec(s)?.[1] ?? null;

/** Every damage type whose icon a sentence holds, once each, in reading order. */
function glyphTypes(sentence) {
  const out = [];
  for (const ch of sentence) {
    const type = damageTypeOf(ch);
    if (type && DAMAGE_TYPES[type] && !out.includes(type)) out.push(type);
  }
  return out;
}

/**
 * What a thrown flask or torch deals, from the sentence that states it: the
 * die, the types its icons stand for, and `extraordinary` where the sentence
 * prints the word (the page marks it by an icon's colour, which the text layer
 * does not carry, so a printing that does not spell it leaves it absent). A
 * sentence that gives no die but says the item follows the burning oil's rules
 * takes the oil's. Absent where the window holds nothing.
 *
 * @param {string} window
 * @param {string|null} [oilDamage] the oil's die, for a sentence that points to it
 * @returns {{damage?: string, types?: string[], extraordinary?: boolean}}
 */
export function parseThrowable(window, oilDamage = null) {
  const sentence = firstSentence(window);
  const out = {};
  const damage = diceIn(sentence) ?? (/\bsame rules as\b[^,]*\boil\b/.test(sentence) ? oilDamage : null);
  if (damage) out.damage = damage;
  const types = glyphTypes(sentence);
  if (types.length) out.types = types;
  if (/\bextraordinary\b/.test(sentence)) out.extraordinary = true;
  return out;
}

/** A description entry's head: the words before a colon at the start of a sentence, "axe, great" included. */
const ENTRY_HEAD = /(?:^|\.\s+)([a-z]+(?:-[a-z]+)*(?:,\s+[a-z]+(?:-[a-z]+)*)?):\s/g;

/** A sentence stating a weapon needs both hands. */
const NEEDS_BOTH_HANDS = /\brequir(?:e|es|ing)\s+two\s+hands\b|\b(?:is|are)\s+two-handed\b/;

/**
 * The weapons whose description states they need both hands, named as the
 * grid names them ("great axe", for the entry headed "axe, great"). A window
 * is cut at each entry head; a sentence about one grip among several (a
 * hands-count or conditional-grip clause, RR p. 138) states no such need.
 * @returns {string[]}
 */
export function parseTwoHands(window) {
  const text = unwrap(window);
  const heads = [...text.matchAll(ENTRY_HEAD)];
  const out = [];
  heads.forEach((m, i) => {
    const body = text.slice(m.index + m[0].length, heads[i + 1]?.index ?? text.length);
    if (!NEEDS_BOTH_HANDS.test(body)) return;
    const name = m[1].split(/,\s+/).reverse().join(" ");
    if (!out.includes(name)) out.push(name);
  });
  return out;
}

/* ------------------------------------------------------------------ */
/*  Assembly                                                           */
/* ------------------------------------------------------------------ */

/**
 * The engine tables from the raw ones. Pure: the committed tests feed it
 * invented prose. Each list assembles on its own, so a window that drifted
 * costs its list and nothing beside it.
 *
 * @param {object} [raw] the raw tables of the `weaponProse` document
 * @param {object} [categories] the category tokens by name, with the catch-all
 *   under `OTHER`; the module's own unless a test supplies invented ones
 * @param {Record<string, string>} [cites] the raw document's citations by raw
 *   table, which each option list carries as its own
 * @returns {{category?: object, options?: object, focus?: object, damageType?: object, throwables?: object, twoHands?: string[]}}
 */
export function assembleWeaponLists(raw = {}, categories = WEAPON_CATEGORY, cites = {}) {
  const out = {};
  const category = assembleCategory([raw.martialProse?.options, raw.narrowProse?.options].flatMap((w) => parseOptions(w)), categories);
  if (Object.keys(category).length) out.category = category;

  const options = assembleOptions(raw, cites, Object.values(SIZE));
  if (Object.keys(options).length) out.options = options;

  const focus = parseFocus(raw.focusProse?.list);
  if (Object.keys(focus).length) out.focus = focus;

  const damageType = {};
  for (const type of Object.keys(raw.damageTypeProse ?? {})) {
    const nouns = DAMAGE_TYPES[type] ? parseDealtBy(raw.damageTypeProse[type]) : [];
    if (nouns.length) damageType[type] = nouns;
  }
  if (Object.keys(damageType).length) out.damageType = damageType;

  const prose = raw.throwableProse ?? {};
  const oil = parseThrowable(prose.oil);
  const throwables = {};
  for (const kind of Object.keys(prose)) {
    const entry = kind === "oil" ? oil : parseThrowable(prose[kind], oil.damage ?? null);
    if (Object.keys(entry).length) throwables[kind] = entry;
  }
  if (Object.keys(throwables).length) out.throwables = throwables;

  const twoHands = [raw.twoHandsFirst?.entries, raw.twoHandsSecond?.entries].flatMap((w) => parseTwoHands(w));
  if (twoHands.length) out.twoHands = [...new Set(twoHands)];
  return out;
}

/** Assemble and register, or report nothing assembled. */
export async function applyWeaponListsImport() {
  const svc = services.get("ruledata-import");
  const doc = getLayer(WEAPON_PROSE_DOC_ID, PRIORITY.WORLD);
  if (!svc || !doc) return { assembled: [] };
  const engine = assembleWeaponLists(doc.tables ?? {}, WEAPON_CATEGORY, doc.cites ?? {});
  const keys = Object.keys(engine);
  if (!keys.length) return { assembled: [] };
  const lists = assembledDoc({ ...doc, id: WEAPON_LISTS_DOC_ID, tables: {} }, engine, PRODUCES[WEAPON_LISTS_DOC_ID]);
  // The raw tables stay in their own document; only the lists' pages are cited here.
  lists.cites = Object.fromEntries(keys.filter((k) => lists.cites?.[k]).map((k) => [k, lists.cites[k]]));
  await svc.importDoc(lists, { priority: PRIORITY.WORLD, source: MODULE_ID });
  globalThis.Hooks?.callAll(WEAPON_LISTS_IMPORTED_HOOK, { assembled: keys });
  return { assembled: keys };
}
