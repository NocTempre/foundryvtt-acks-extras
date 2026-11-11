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
 *   options     `{ [list]: { cite, pick?, total?, options } }`, the book's own
 *               option lists (restricted, narrow, broad, martial), each option
 *               under its printed marker
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
 * A row that neither tier places takes a third: the kind its sub-header
 * MATES were placed into, when every other row under the same sub-header that a
 * tier placed agrees on exactly one kind (`placedBy` says `"mates"`). Mates
 * that disagree, a sub-header none of them was placed under, and a row with no
 * sub-header place nothing. A row the first two tiers found ambiguous takes the
 * mates' kind only when it is one of the kinds they were torn between.
 *
 * A single-weapon option (a restricted list's) names one weapon, and a
 * sub-header names a family, so that option matches a row by its NAME alone and
 * is never placed by `block` or by mates; noun-list options, categories, foci
 * and damage types are placed by all three tiers.
 *
 * Pure: no Foundry imports. A caller passes the grid (the rows
 * `equipment/weapon-rows.mjs` publishes, or any `{ key: { name, block, … } }`)
 * and the lists (`weaponLists()`), and receives the same rows with their
 * placements.
 *
 * The file is also the seam every reader of the weapon table goes through:
 * `weaponRow`, `weaponKeys`, `keyForName`, `hasWeaponRows`, `weaponFocusGroup`
 * and `weaponThrowsAsAnyone` answer from the one source registered with
 * `registerWeaponSource`, so a reader never names where the rows live.
 * `optionUnits` and `martialOption` read the same rows to say which weapons a
 * printed option holds, and the file registers the Martial Training pick
 * vocabulary (the martial options) with `vocab.mjs`.
 */
import { expectTables, getDoc, getLayer, hasDoc, PRIORITY } from "./tables.mjs";
import { nameKeys, registerSelectionVocab, slug } from "./vocab.mjs";

/** The ruledata document the importer writes the lists into. */
export const WEAPON_LISTS_DOC = "weaponLists";

/** The tables the document carries, in the order the resolver reads them. */
export const WEAPON_LIST_TABLES = Object.freeze(["category", "options", "focus", "damageType", "throwables", "twoHands"]);

/** The option lists the `options` table holds, in the order a reader lists them. */
export const OPTION_LISTS = Object.freeze(["restricted", "narrow", "broad", "martial"]);

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
 * What the two tiers say of a row: the kind it is of, by name when its name
 * matches any kind, else by block. A name that matches more than one kind
 * places nothing, and the block is not consulted then; neither is a block that
 * matches more than one. A key in `nameOnly` is a candidate by name and never
 * by block.
 *
 * `placed` is the kind, or null; `candidates` holds every kind the deciding
 * tier matched, so a refusal can be told from silence: two or more candidates
 * is an ambiguous row, none is a row the lists say nothing of.
 *
 * @param {Set<string>} [nameOnly] the kinds the block tier leaves out
 * @returns {{placed: {key: string, via: "name"|"block"}|null, candidates: string[]}}
 */
function place(kinds, nameRuns, blockRuns, nameOnly) {
  for (const [via, runs] of [["name", nameRuns], ["block", blockRuns]]) {
    const hits = hitKeys(kinds, runs).filter((key) => via === "name" || !nameOnly?.has(key));
    if (hits.length) return { placed: hits.length === 1 ? { key: hits[0], via } : null, candidates: hits };
  }
  return { placed: null, candidates: [] };
}

/**
 * Every row's placement against one table of kinds: both tiers, then the third.
 * A row that neither its name nor its block placed takes the kind every OTHER
 * row of its block was placed into by name or block, when those rows agree on
 * exactly one kind (`via: "mates"`). Mates that disagree, a block no row was
 * placed in, and a row with no block place nothing, and a placement made this
 * way is never itself a mate. A row the tiers found ambiguous takes a mates'
 * kind only if it is one of the kinds they were torn between, so the third tier
 * breaks a tie and never overrules a row's own words. A key in `nameOnly` is
 * never taken from mates.
 *
 * @param {[string, {name: Set<string>, block: Set<string>, blockText: string|null}][]} rows
 * @param {Set<string>} [nameOnly] the kinds the block and mates tiers leave out
 * @returns {Map<string, {key: string, via: "name"|"block"|"mates"}|null>} by row key
 */
function placeAll(kinds, rows, nameOnly) {
  const tiers = new Map(rows.map(([key, r]) => [key, place(kinds, r.name, r.block, nameOnly)]));
  const out = new Map(rows.map(([key]) => [key, tiers.get(key).placed]));
  const blocks = new Map();
  for (const [key, r] of rows) if (r.blockText) blocks.set(r.blockText, [...(blocks.get(r.blockText) ?? []), key]);
  for (const keys of blocks.values()) {
    const held = new Set(keys.map((k) => tiers.get(k).placed?.key).filter((kind) => kind && !nameOnly?.has(kind)));
    if (held.size !== 1) continue;
    const [kind] = held;
    for (const k of keys) {
      const { placed, candidates } = tiers.get(k);
      if (!placed && (!candidates.length || candidates.includes(kind))) out.set(k, { key: kind, via: "mates" });
    }
  }
  return out;
}

/** The words of a camelCase key: `holyWater` is `holy`, `water`. */
const keyWords = (key) => String(key).replace(/([A-Z])/g, " $1").toLowerCase().split(" ").filter(Boolean);

/** The table of a lists object as the resolver reads it, or an empty one. */
const table = (lists, name) => (lists && typeof lists[name] === "object" && lists[name] ? lists[name] : {});

/** What an option is, by the fields it holds, or null for one that holds none of them. */
function optionKind(option) {
  if (!option || typeof option !== "object") return null;
  if (Number.isFinite(option.any) && option.any > 0) return "combination";
  if (option.melee === true || option.missile === true) return "predicate";
  if (typeof option.weapon === "string" && option.weapon.trim()) return "weapon";
  return nounsOf(option.nouns).length ? "nouns" : null;
}

/**
 * The options of one list as stored, in printed order: each an object with a
 * whole-number `n`, the first where a number repeats; empty for a malformed list.
 */
function listOptions(lists, list) {
  const stored = table(lists, "options")[list]?.options;
  if (!Array.isArray(stored)) return [];
  const held = stored.filter((o) => o && typeof o === "object" && Number.isInteger(o.n) && o.n > 0);
  return held.filter((o, i) => held.findIndex((p) => p.n === o.n) === i).sort((a, b) => a.n - b.n);
}

/** The id an option is known by: its list and printed number, `narrow.3`. */
const optionId = (list, option) => `${list}.${option.n}`;

/**
 * One list's options that name kinds: `kinds` is `{ [id]: nouns }`, a noun list
 * as its nouns and a restricted option as its one weapon; `nameOnly` holds the
 * ids of the single-weapon options, which a row matches by name alone.
 */
function optionKinds(lists, list) {
  const kinds = {};
  const nameOnly = new Set();
  for (const option of listOptions(lists, list)) {
    const kind = optionKind(option);
    if (kind === "weapon") {
      kinds[optionId(list, option)] = [option.weapon];
      nameOnly.add(optionId(list, option));
    } else if (kind === "nouns") kinds[optionId(list, option)] = nounsOf(option.nouns);
  }
  return { kinds, nameOnly };
}

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
 *  - `options`: the ids (`narrow.3`) of the noun-list and single-weapon
 *    options that hold the row, at most one per option list. A noun-list option
 *    is placed by the same rule (name, grid sub-header, then sub-header mates);
 *    a single-weapon option, which names one weapon, is placed by the row's name
 *    alone. Size and use predicates and combinations place no row;
 *    `optionVerdict` answers for them. Empty where no option list is imported
 *  - `twoHands`: true where the descriptions say the weapon needs both hands,
 *    else null (not stated, never false)
 *  - `placedBy`: for each of `category`, `focus` and `damageType`, `"name"`,
 *    `"block"`, `"mates"` or `"throwable"` (null where nothing placed), so a
 *    reader can refuse a placement made by the sub-header alone or inferred
 *    from the rows beside it
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
  const rows = Object.entries(grid).map(([key, row]) => [
    key,
    {
      name: runForms(wordsOf(row?.name)),
      block: runForms(wordsOf(row?.block)),
      blockText: typeof row?.block === "string" && row.block.trim() ? row.block.trim() : null,
    },
  ]);
  const category = placeAll(table(lists, "category"), rows);
  const focus = placeAll(table(lists, "focus"), rows);
  const damageType = placeAll(table(lists, "damageType"), rows);
  const optionPlaced = OPTION_LISTS.map((list) => {
    const { kinds, nameOnly } = optionKinds(lists, list);
    return placeAll(kinds, rows, nameOnly);
  });
  for (const [key, row] of Object.entries(grid)) {
    out[key] = {
      ...row,
      category: category.get(key)?.key ?? null,
      focus: focus.get(key)?.key ?? null,
      damageType: damageType.get(key)?.key ?? null,
      options: optionPlaced.flatMap((placed) => {
        const hit = placed.get(key);
        return hit ? [hit.key] : [];
      }),
      twoHands: row?.name && [...nameKeys(row.name)].some((k) => twoHandsKeys.has(k)) ? true : null,
      placedBy: { category: category.get(key)?.via ?? null, focus: focus.get(key)?.via ?? null, damageType: damageType.get(key)?.via ?? null },
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
        options: [],
        throwable: { kind, ...entry },
      };
    }
  }
  byLists.set(memoKey, out);
  return out;
}

/**
 * The key of the imported list that a written phrase names: the one entry of
 * `weaponLists()[tableName]` whose nouns match a word or a run of words of the
 * phrase, by the rule a grid row is placed by. Null when the phrase names no
 * entry or more than one, and when that list is not imported.
 *
 * @param {"category"|"focus"|"damageType"} tableName
 * @param {string} text
 * @returns {string|null}
 */
export function listedKind(tableName, text) {
  const hits = hitKeys(table(weaponLists(), tableName), runForms(wordsOf(text)));
  return hits.length === 1 ? hits[0] : null;
}

/**
 * The id of the one option of an imported list that a written phrase names:
 * the noun-list or single-weapon option whose nouns match a word or a run of
 * words of the phrase, by the rule a grid row is placed by. Null when the
 * phrase names no option or more than one, and when that list is not imported.
 *
 * @param {"restricted"|"narrow"|"broad"|"martial"} list
 * @param {string} text
 * @returns {string|null} the id, `narrow.3`
 */
export function listedOption(list, text) {
  const hits = hitKeys(optionKinds(weaponLists(), list).kinds, runForms(wordsOf(text)));
  return hits.length === 1 ? hits[0] : null;
}

/** The layers of the lists document, lowest first: what the memo below is keyed on. */
const LAYERS = Object.freeze(Object.values(PRIORITY));

/** The last read of the lists and the layer objects it was made from. */
let _lists = { docs: [], value: null };

/**
 * The imported lists, `{ category, options, focus, damageType, throwables, twoHands }`
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

/** The last flattening of the option lists and the lists object it was made from. */
let _options = { lists: null, value: null };

/** An option's prerequisites as stored, each clause with both of its noun lists non-empty. */
const prereqsOf = (stored) =>
  (Array.isArray(stored) ? stored : [])
    .map((p) => ({ weapons: nounsOf(p?.weapons), requires: nounsOf(p?.requires) }))
    .filter((p) => p.weapons.length && p.requires.length);

/**
 * Every option of every imported list, flat, in list order (restricted,
 * narrow, broad, martial) and printed order within a list:
 *
 *   `{ id, list, n, marker, label, kind, cite, … }`
 *
 * `id` is `<list>.<n>` (`narrow.3`), `marker` the number as printed, `label`
 * the option's words as printed and `cite` the page its list was read from
 * (empty when none is stored). `kind` says which of the rest it holds:
 * `"nouns"` (`nouns`), `"weapon"` (`weapon`, one weapon of a restricted list),
 * `"predicate"` (`melee` and/or `missile`, and `sizes`, empty for any size) or
 * `"combination"` (`any`, how many weapons it takes, and `prereqs`, each
 * `{ weapons, requires }`). An option that holds none of these, or repeats a
 * number its list already holds, is left out. Empty where no list is
 * imported. The same array is returned until the lists change.
 *
 * @returns {object[]}
 */
export function weaponOptions() {
  const lists = weaponLists();
  if (_options.value && _options.lists === lists) return _options.value;
  const out = [];
  for (const list of OPTION_LISTS) {
    const cite = typeof table(lists, "options")[list]?.cite === "string" ? table(lists, "options")[list].cite : "";
    for (const option of listOptions(lists, list)) {
      const kind = optionKind(option);
      if (!kind) continue;
      const entry = { id: optionId(list, option), list, n: option.n, marker: String(option.marker ?? option.n), label: String(option.label ?? ""), kind, cite };
      if (kind === "nouns") entry.nouns = nounsOf(option.nouns);
      else if (kind === "weapon") entry.weapon = option.weapon.trim();
      else if (kind === "predicate") {
        if (option.melee === true) entry.melee = true;
        if (option.missile === true) entry.missile = true;
        entry.sizes = nounsOf(option.sizes);
      } else {
        entry.any = option.any;
        entry.prereqs = prereqsOf(option.prereqs);
      }
      out.push(entry);
    }
  }
  _options = { lists, value: Object.freeze(out) };
  return _options.value;
}

/**
 * Which printed options hold each category's rows: for every category token,
 * the ids (`narrow.3`) of the options whose resolved rows include any row the
 * category places, in `weaponOptions()` order. A category and the options sit
 * side by side; this is the provenance between them.
 *
 * @param {object} [rows] resolved rows (`resolveRows`'s answer); omitted, the
 *   rows of the registered weapon source, which carry the same placements
 * @returns {Record<string, string[]>} by category token; a token with no row on any option maps to an empty array
 */
export function categoryOptions(rows) {
  const source = rows && typeof rows === "object" ? rows : Object.fromEntries(weaponKeys().map((key) => [key, weaponRow(key)]));
  const held = {};
  for (const row of Object.values(source)) {
    const token = row?.category ?? row?.cat;
    if (typeof token !== "string" || !token) continue;
    const ids = (held[token] ??= new Set());
    for (const id of Array.isArray(row.options) ? row.options : []) ids.add(id);
  }
  const order = weaponOptions().map((o) => o.id);
  return Object.fromEntries(Object.entries(held).map(([token, ids]) => [token, order.filter((id) => ids.has(id))]));
}

/** Is any option of this list imported? */
export function optionListImported(list) {
  return weaponOptions().some((o) => o.list === list);
}

/**
 * Does an option cover a weapon? True, false, or null where the answer is not
 * known:
 *
 *  - a noun-list or single-weapon option covers the weapons the resolver
 *    placed on it: the profile's `key` must be a row of the weapon seam, whose
 *    `options` hold the option's `id`. Null with no `key`, no such row, or a
 *    row the lists never resolved
 *  - a predicate covers a melee weapon (where it names `melee`) or a missile
 *    weapon (where it names `missile`) of the sizes it lists, any size when it
 *    lists none. A size it lists against a weapon of no stated size is null
 *    unless another use of the weapon already covers it
 *  - a combination covers nothing by itself: false
 *
 * @param {object} option one entry of `weaponOptions()`
 * @param {{key?: string, melee?: boolean, missile?: boolean, size?: string|null}} profile
 */
export function optionVerdict(option, profile) {
  if (!profile || typeof profile !== "object") return null;
  const kind = optionKind(option);
  if (!kind) return null;
  if (kind === "combination") return false;
  if (kind === "predicate") {
    const sizes = nounsOf(option.sizes);
    const size = typeof profile.size === "string" ? profile.size.toLowerCase() : null;
    const uses = [];
    if (option.melee === true) uses.push(profile.melee);
    if (option.missile === true) uses.push(profile.missile);
    const verdicts = uses.map((on) => (!on ? false : !sizes.length ? true : size == null ? null : sizes.includes(size)));
    return verdicts.includes(true) ? true : verdicts.includes(null) ? null : false;
  }
  if (typeof profile.key !== "string" || typeof option.id !== "string") return null;
  const row = weaponRow(profile.key);
  return row && Array.isArray(row.options) ? row.options.includes(option.id) : null;
}

/**
 * Where the weapon rows come from. Each of `rows`, `aliases` and `focusGroups`
 * is an object or a function returning one, read at every call so a source
 * that holds live data is never stale:
 *
 *  - `rows`: `{ [key]: row }`, the weapons in the order readers list them
 *  - `aliases`: `{ [spelling]: key }`, other spellings of a row's key; an
 *    alias answers only where its target is a row
 *  - `focusGroups`: `{ [group]: key[] }`, the Weapon Focus group of each key
 *  - `throwsAsAnyone(key, row)`: whether every character throws this row
 *    proficiently
 *
 * @typedef {object} WeaponSource
 */

/** The registered source, or null: with none, every accessor answers empty. */
let _source = null;

/** The no-rows answer of a missing or malformed source field. */
const NONE = Object.freeze({});

/** One object-valued field of the source, or the empty object. */
function sourceField(name) {
  const v = typeof _source?.[name] === "function" ? _source[name]() : _source?.[name];
  return v && typeof v === "object" ? v : NONE;
}

/**
 * Register the source every weapon accessor answers from, replacing the one
 * registered before. A null source leaves no rows.
 *
 * @param {WeaponSource|null} source
 * @returns {WeaponSource|null} the source this replaced, so a caller can put it back
 */
export function registerWeaponSource(source) {
  const previous = _source;
  _source = source && typeof source === "object" ? source : null;
  return previous;
}

/** The row of a weapon key exactly as the source keys it, or null. */
export function weaponRow(key) {
  const rows = sourceField("rows");
  return typeof key === "string" && Object.hasOwn(rows, key) ? rows[key] : null;
}

/** Every weapon key the source holds, in its order. A fresh array each call. */
export function weaponKeys() {
  return Object.keys(sourceField("rows"));
}

/** Does the source hold any weapon row? */
export function hasWeaponRows() {
  return weaponKeys().length > 0;
}

/**
 * The weapon key a written name is, or null: the name folded to letters and
 * digits is a key, or an alias of one. The name as written only: no
 * reordered form and no substring match, which are `nameKeys` and the
 * caller's own ladder.
 */
export function keyForName(name) {
  const key = slug(name);
  if (!key) return null;
  if (weaponRow(key)) return key;
  const aliases = sourceField("aliases");
  const alias = Object.hasOwn(aliases, key) ? aliases[key] : null;
  return alias && weaponRow(alias) ? alias : null;
}

/** The Weapon Focus group the source files a weapon key under, or null. */
export function weaponFocusGroup(key) {
  const groups = sourceField("focusGroups");
  for (const group of Object.keys(groups)) {
    if (Array.isArray(groups[group]) && groups[group].includes(key)) return group;
  }
  return null;
}

/** Does the source say every character throws this weapon proficiently? */
export function weaponThrowsAsAnyone(key) {
  const row = weaponRow(key);
  return !!row && _source?.throwsAsAnyone?.(key, row) === true;
}

/**
 * The weapons a printed option holds, in the source's order:
 *
 *  - a noun-list or single-weapon option holds the rows whose placement lists
 *    `id` (`narrow.3`) among its `options`
 *  - a predicate holds the rows `optionVerdict` answers true for from their use
 *    and size; a row of no stated size, against an option that lists sizes, is
 *    not held
 *  - a combination names no weapons and holds none
 *
 * Empty as well for an id no imported option has and where no list or no row is
 * imported.
 *
 * @param {string} id
 * @returns {string[]}
 */
export function optionUnits(id) {
  const held = weaponOptions().find((o) => o.id === id);
  if (!held || held.kind === "combination") return [];
  if (held.kind === "predicate") return weaponKeys().filter((key) => optionVerdict(held, { ...weaponRow(key), key }) === true);
  return weaponKeys().filter((key) => weaponRow(key)?.options?.includes(id));
}

/**
 * What the printed options leave out, as the keys the surface reports:
 *
 *  - `unplaced`: every weapon no imported option holds, by any list
 *  - `notWhole`: every category token whose weapons no single option holds all
 *    of
 *
 * Both are empty where no option list or no weapon is imported (nothing is
 * left out of a book that was never read). A category is the token a row's
 * placement names, in the source's spelling.
 *
 * @returns {{unplaced: string[], notWhole: string[]}}
 */
export function optionFindings() {
  const options = weaponOptions();
  const keys = weaponKeys();
  if (!options.length || !keys.length) return { unplaced: [], notWhole: [] };
  const held = options.map((o) => new Set(optionUnits(o.id)));
  const unplaced = keys.filter((key) => !held.some((units) => units.has(key)));
  const byCategory = new Map();
  for (const key of keys) {
    const cat = weaponRow(key)?.cat ?? weaponRow(key)?.category;
    if (typeof cat === "string" && cat) byCategory.set(cat, [...(byCategory.get(cat) ?? []), key]);
  }
  const notWhole = [...byCategory].filter(([, rows]) => !held.some((units) => rows.every((key) => units.has(key)))).map(([cat]) => cat);
  return { unplaced, notWhole };
}

/**
 * The one option of a list whose weapons all carry a category: every unit of
 * the option, and at least one, is a row of that category. Null where no option
 * qualifies or more than one does.
 *
 * @param {"restricted"|"narrow"|"broad"|"martial"} list
 * @param {string} token a category token, in any spelling `slug` folds alike
 * @returns {string|null} the id, `martial.3`
 */
export function optionOfCategory(list, token) {
  const want = slug(token);
  if (!want) return null;
  const rowCategory = (key) => slug(weaponRow(key)?.cat ?? weaponRow(key)?.category);
  const held = weaponOptions().filter((o) => {
    if (o.list !== list) return false;
    const units = optionUnits(o.id);
    return units.length > 0 && units.every((key) => rowCategory(key) === want);
  });
  return held.length === 1 ? held[0].id : null;
}

/**
 * The martial option a Martial Training pick means, or null: the option whose
 * id the pick is (`martial.3`, any kind of option), else the one option whose
 * nouns the pick names (`listedOption`), else the one option every weapon of
 * which carries the category the pick is (`optionOfCategory`).
 *
 * @param {string} pick
 * @returns {string|null} the id
 */
export function martialOption(pick) {
  const text = String(pick ?? "").trim();
  if (!text) return null;
  const id = text.toLowerCase();
  if (weaponOptions().some((o) => o.list === "martial" && o.id === id)) return id;
  return listedOption("martial", text) ?? optionOfCategory("martial", text);
}

/**
 * The Martial Training pick vocabulary: one entry per imported martial option,
 * keyed by its id, labelled with its printed words, and answering to its nouns
 * and to every category key a stored pick may still carry that `martialOption`
 * resolves to it. The entries are exact: a pick names an option outright or is
 * left as typed. Empty of entries where no martial list is imported.
 */
function martialVocab() {
  const keys = Object.keys(table(weaponLists(), "category"));
  const out = { exact: true };
  for (const option of weaponOptions()) {
    if (option.list !== "martial") continue;
    const nouns = option.kind === "nouns" ? option.nouns : option.kind === "weapon" ? [option.weapon] : [];
    out[option.id] = { label: option.label || option.id, aliases: [...nouns, ...keys.filter((key) => martialOption(key) === option.id)] };
  }
  return out;
}

registerSelectionVocab("martialtraining", martialVocab);
