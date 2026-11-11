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
import { WEAPON_CATEGORY } from "../equipment/config.mjs";
import { assembledDoc } from "./produces.mjs";
import { firstSentence } from "./formation-binding.mjs";
import { damageTypeOf } from "./stats-map.mjs";

/** The raw document the folios' windows are read into (`TABLE_RECIPES`). */
export const WEAPON_PROSE_DOC_ID = "weaponProse";

/** The engine document both halves agree on (`lib/weapons.mjs` `expectTables`). */
export const WEAPON_LISTS_DOC_ID = WEAPON_LISTS_DOC;

/** The engine tables this binding assembles, each with the raw table(s) it is read from. */
export const PRODUCES = Object.freeze({
  [WEAPON_LISTS_DOC_ID]: {
    category: ["martialProse", "narrowProse"],
    focus: "focusProse",
    damageType: "damageTypeProse",
    throwables: "throwableProse",
    twoHands: ["twoHandsFirst", "twoHandsSecond"],
  },
});

/* ------------------------------------------------------------------ */
/*  Parsers                                                            */
/* ------------------------------------------------------------------ */

/** Number words a list of kinds never holds: "any four weapons" names no kind. */
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
 * dropped, which is what keeps "any combination of 3 weapons" and "any four
 * weapons" out of the lists they stand in.
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
 * nouns folded together ("slings and thrown weapons" is `slingsthrown`), the
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
 * is cut at each entry head; a sentence about one grip among several ("one or
 * two hands", "if used on foot with two hands") states no such need.
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
 * @returns {{category?: object, focus?: object, damageType?: object, throwables?: object, twoHands?: string[]}}
 */
export function assembleWeaponLists(raw = {}, categories = WEAPON_CATEGORY) {
  const out = {};
  const category = assembleCategory([raw.martialProse?.options, raw.narrowProse?.options].flatMap((w) => parseOptions(w)), categories);
  if (Object.keys(category).length) out.category = category;

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
  const engine = assembleWeaponLists(doc.tables ?? {});
  const keys = Object.keys(engine);
  if (!keys.length) return { assembled: [] };
  const lists = assembledDoc({ ...doc, id: WEAPON_LISTS_DOC_ID, tables: {} }, engine, PRODUCES[WEAPON_LISTS_DOC_ID]);
  // The raw tables stay in their own document; only the lists' pages are cited here.
  lists.cites = Object.fromEntries(keys.filter((k) => lists.cites?.[k]).map((k) => [k, lists.cites[k]]));
  await svc.importDoc(lists, { priority: PRIORITY.WORLD, source: MODULE_ID });
  return { assembled: keys };
}
