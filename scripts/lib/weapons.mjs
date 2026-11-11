/**
 * Which kind of weapon a grid row is: the lists the importer read, and the
 * resolver that places each row of the weapons grid against them.
 *
 * The weapons grid prints a row's figures and nothing about which proficiency
 * category, Weapon Focus group or damage type it belongs to; the book states
 * those as lists of kinds in its prose ("axes", "bows and crossbows"). The
 * importer reads each list into the `weaponLists` ruledata document, as nouns
 * in the printing's own words (`importer/weapon-binding.mjs`):
 *
 *   category    `{ [token]: nouns }`, the module's proficiency category tokens
 *   focus       `{ [key]: nouns }`, one entry per Weapon Focus the book names
 *   damageType  `{ [type]: nouns }`, the weapons each physical type is dealt by
 *   throwables  `{ oil|holyWater|torch: { damage, types, extraordinary? } }`
 *   twoHands    nouns: the weapons the descriptions say need both hands
 *
 * A row is placed by its NAME first and by the grid sub-header it sits under
 * (`block`) second. A noun matches a name when it equals the name's words, or
 * any run of them, ignoring plurals: "axes" places a Battle Axe, "pole arms"
 * a Polearm. A name or block that matches the nouns of more than one kind, or
 * of none, places nothing, so an ambiguous row stays unplaced rather than
 * guessed. Nothing is placed from a missing list, and nothing stands in for
 * one.
 *
 * Pure: no Foundry imports. A caller passes the grid (the rows
 * `equipment/weapon-rows.mjs` publishes, or any `{ key: { name, block, … } }`)
 * and the lists (`weaponLists()`), and receives the same rows with their
 * placements.
 */
import { expectTables, getDoc, getLayer, hasDoc, PRIORITY } from "./tables.mjs";
import { nameKeys } from "./vocab.mjs";

/** The ruledata document the importer writes the lists into. */
export const WEAPON_LISTS_DOC = "weaponLists";

/** The tables the document carries, in the order the resolver reads them. */
export const WEAPON_LIST_TABLES = Object.freeze(["category", "focus", "damageType", "throwables", "twoHands"]);

expectTables(WEAPON_LISTS_DOC, WEAPON_LIST_TABLES);

/** Lowercase letters only: the form two spellings of one word fold to. */
export const fold = (s) => String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");

/**
 * A folded word with its singular forms: the plural of a noun of four letters
 * or more drops its `s`, and its `es` (`axes` is also `ax`'s plural).
 * @returns {string[]}
 */
export function forms(w) {
  if (w.length <= 3 || !w.endsWith("s")) return [w];
  return w.endsWith("es") && w.length > 4 ? [w, w.slice(0, -1), w.slice(0, -2)] : [w, w.slice(0, -1)];
}

/** The words of a printed phrase: letters, split at everything else, a hyphen included. */
const wordsOf = (text) =>
  String(text ?? "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);

/**
 * Every run of consecutive words, folded together and in singular form too:
 * "staff sling" holds `staff`, `sling` and `staffsling`.
 */
function runForms(words) {
  const out = new Set();
  for (let i = 0; i < words.length; i++) {
    let run = "";
    for (let j = i; j < words.length; j++) {
      run += words[j];
      for (const f of forms(run)) out.add(f);
    }
  }
  return out;
}

/** Does a noun equal a word or a run of words, plural or singular? */
const nounHits = (noun, runs) => forms(fold(noun)).some((f) => f && runs.has(f));

/** The array a stored list table holds, or empty: a Judge's override may hold anything. */
const nounsOf = (x) => (Array.isArray(x) ? x.filter((n) => typeof n === "string" && n.trim()) : []);

/** The keys of a `{ key: nouns }` table whose nouns match the words, in table order. */
function hitKeys(kinds, runs) {
  if (!kinds || typeof kinds !== "object" || Array.isArray(kinds)) return [];
  return Object.keys(kinds).filter((key) => nounsOf(kinds[key]).some((noun) => nounHits(noun, runs)));
}

/**
 * The kind a row is of: by name when its name matches any kind, else by block.
 * A name that matches more than one kind places nothing, and the block is not
 * consulted then; neither is a block that matches more than one.
 *
 * @returns {{key: string, via: "name"|"block"}|null}
 */
function place(kinds, nameRuns, blockRuns) {
  for (const [via, runs] of [["name", nameRuns], ["block", blockRuns]]) {
    const hits = hitKeys(kinds, runs);
    if (hits.length) return hits.length === 1 ? { key: hits[0], via } : null;
  }
  return null;
}

/** The words of a camelCase key: `holyWater` is `holy`, `water`. */
const keyWords = (key) => String(key).replace(/([A-Z])/g, " $1").toLowerCase().split(" ").filter(Boolean);

/** The table of a lists object as the resolver reads it, or an empty one. */
const table = (lists, name) => (lists && typeof lists[name] === "object" && lists[name] ? lists[name] : {});

/** `grid` → `lists` → resolved rows. A list-less grid is keyed on a stand-in object. */
const MEMO = new WeakMap();
const NO_LISTS = Object.freeze({});

/**
 * The grid's rows with each one's placement:
 *
 *  - `category`: the proficiency category token, or null
 *  - `focus`: the Weapon Focus key, or null
 *  - `damageType`: the damage type the combat chapter's nouns place the row
 *    under, or the throwables section's type for a flask or torch, or null
 *  - `twoHands`: true where the descriptions say the weapon needs both hands,
 *    else null (not stated, never false)
 *  - `placedBy`: for each of `category`, `focus` and `damageType`, `"name"`,
 *    `"block"` or `"throwable"` (null where nothing placed), so a reader can
 *    refuse a placement made by the sub-header alone
 *  - `throwable`: the throwables entry whose kind the row's name is (the
 *    military oil row is `oil`), else absent
 *
 * A throwables entry with no row of that name in the grid (holy water, a
 * torch) adds a kind row under its folded key: `{ kind, name: "", block: null,
 * damage, types, damageType, throwable }`, carrying only what the book states.
 * Memoized on the identity of both arguments, so a caller passing the
 * registry's own table objects pays once per import.
 *
 * @param {object|null} grid `{ [key]: row }`, the weapon rows
 * @param {object|null} lists the `weaponLists` tables
 * @returns {object} `{ [key]: row }`
 */
export function resolveRows(grid, lists) {
  if (!grid || typeof grid !== "object") return {};
  const byLists = MEMO.get(grid) ?? new WeakMap();
  MEMO.set(grid, byLists);
  const memoKey = lists && typeof lists === "object" ? lists : NO_LISTS;
  if (byLists.has(memoKey)) return byLists.get(memoKey);

  const out = {};
  const twoHandsKeys = new Set(nounsOf(lists?.twoHands).flatMap((noun) => [...nameKeys(noun)]));
  for (const [key, row] of Object.entries(grid)) {
    const nameRuns = runForms(wordsOf(row?.name));
    const blockRuns = runForms(wordsOf(row?.block));
    const category = place(table(lists, "category"), nameRuns, blockRuns);
    const focus = place(table(lists, "focus"), nameRuns, blockRuns);
    const damageType = place(table(lists, "damageType"), nameRuns, blockRuns);
    out[key] = {
      ...row,
      category: category?.key ?? null,
      focus: focus?.key ?? null,
      damageType: damageType?.key ?? null,
      twoHands: row?.name && [...nameKeys(row.name)].some((k) => twoHandsKeys.has(k)) ? true : null,
      placedBy: { category: category?.via ?? null, focus: focus?.via ?? null, damageType: damageType?.via ?? null },
    };
  }

  const throwables = table(lists, "throwables");
  for (const kind of Object.keys(throwables)) {
    const entry = throwables[kind];
    if (!entry || typeof entry !== "object") continue;
    const want = fold(keyWords(kind).join(""));
    const rows = Object.keys(out).filter((k) => runForms(wordsOf(out[k].name)).has(want));
    const types = nounsOf(entry.types);
    if (rows.length === 1) {
      const row = out[rows[0]];
      row.throwable = { kind, ...entry };
      if (types.length) {
        row.damageType = types[0];
        row.placedBy.damageType = "throwable";
      }
    } else if (!rows.length && !(want in out)) {
      out[want] = {
        kind,
        name: "",
        block: null,
        damage: typeof entry.damage === "string" ? entry.damage : "",
        types,
        damageType: types[0] ?? null,
        throwable: { kind, ...entry },
      };
    }
  }
  byLists.set(memoKey, out);
  return out;
}

/** The layers of the lists document, lowest first: what the memo below is keyed on. */
const LAYERS = Object.freeze(Object.values(PRIORITY));

/** The last read of the lists and the layer objects it was made from. */
let _lists = { docs: [], value: null };

/**
 * The imported lists, `{ category, focus, damageType, throwables, twoHands }`
 * (each present only where it was read or a Judge supplied it), or null when
 * none is imported. Layered per table, so a Judge's override of one list wins
 * over the import's; the same object is returned until a layer is registered
 * or withdrawn, which is what lets `resolveRows` memoize on it.
 *
 * @returns {object|null}
 */
export function weaponLists() {
  const docs = LAYERS.map((p) => getLayer(WEAPON_LISTS_DOC, p));
  if (docs.every((d, i) => d === _lists.docs[i])) return _lists.value;
  const tables = hasDoc(WEAPON_LISTS_DOC) ? getDoc(WEAPON_LISTS_DOC).tables ?? {} : {};
  const held = WEAPON_LIST_TABLES.filter((name) => tables[name] != null);
  _lists = { docs, value: held.length ? Object.fromEntries(held.map((name) => [name, tables[name]])) : null };
  return _lists.value;
}
