/**
 * Weapon training as ATOMIC UNITS and the organisations that arrange them.
 *
 * A unit is one weapon of the equipment table: it has one name and one glyph
 * (its damage type) and appears exactly once whichever organisation is on
 * screen, so a reader regrouping the list follows the same pill from group to
 * group. An organisation is an ordered list of groups, each named by the ONE
 * grant token that means "all of this group" — a category key, a
 * `melee:<size>`, `missile:all`, or `all` — so a group header is a control
 * that writes the grammar of `proficiency.mjs` and nothing beside it. A unit
 * belongs to the FIRST group whose token covers it (the staff sling is both a
 * melee weapon and a missile, and sits under its melee size); a unit no
 * group's token covers falls into a trailing leftovers group with no token.
 *
 * The organisations are the KINDS of token the grammar distinguishes —
 * unrestricted, broad (size and missile clauses), narrow (a category) — and
 * that kind is each group's tier caption. The page's own pick-combinations
 * (which sizes or categories a class may pair into one choice) are not stated
 * here: that is the book's option table, and it arrives by import or not at
 * all.
 *
 * `canonicalGrant` is the inverse: from a set of units back to the shortest
 * CSV that covers exactly them, in a fixed order, so every writer of a grant
 * spells the same set the same way and a hand-read of the effect is stable.
 *
 * The book's printed groups are SHORTCUTS over the units (`shortcuts`): each
 * resolves to a set of unit keys and writes through `toggledUnits`, the path a
 * pill takes. A shortcut stores nothing and holds no state; what it shows is
 * how much of its set the grant covers (`coverageOf`), so two shortcuts may
 * hold the same weapon.
 */
import { SIZE, WEAPON_CATEGORY } from "./config.mjs";
import { optionUnits, weaponFocusGroup, weaponKeys, weaponLists, weaponOptions, weaponRow } from "../lib/weapons.mjs";
import { grantMatches, classifyGrantToken, normalizeGrantToken } from "./proficiency.mjs";
import { DAMAGE_TYPE_ICONS, UNTYPED_ICON } from "../lib/damage-type.mjs";
import { slug } from "../lib/vocab.mjs";

/**
 * The display name of a weapon key: the row's own printed name, else the key
 * set as a word (a row with no name of its own, such as a thrown flask the book
 * lists apart from its grid, has only its key to be called by).
 */
export const weaponName = (key) => weaponRow(key)?.name || String(key).charAt(0).toUpperCase() + String(key).slice(1);

/**
 * The token that names ONE unit and nothing wider: the bare key where the
 * grammar reads it as a weapon, `weapon:<key>` where the bare key is also a
 * category and the category reading would win.
 */
const unitToken = (key) => (classifyGrantToken(key) === "weapon" ? key : `weapon:${key}`);

/** The units of the rows last read: the keys, the rows by identity, the list and its index. */
let _units = { keys: [], rows: [], list: [], byKey: new Map() };

/** Every unit the weapon table's rows make now, alphabetical by name. */
function readUnits() {
  const keys = weaponKeys();
  const rows = keys.map((key) => weaponRow(key));
  if (keys.length === _units.keys.length && keys.every((k, i) => k === _units.keys[i] && rows[i] === _units.rows[i])) return _units;
  const list = Object.freeze(
    keys
      .map((key, i) => [key, rows[i]])
      .map(([key, w]) =>
        Object.freeze({
          key,
          token: unitToken(key),
          name: weaponName(key),
          cat: slug(w.cat),
          size: w.size ?? null,
          melee: !!w.melee,
          missile: !!w.missile,
          icon: DAMAGE_TYPE_ICONS[w.type] ?? UNTYPED_ICON,
          profile: Object.freeze({ ...w, key }),
        }),
      )
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
  _units = { keys, rows, list, byKey: new Map(list.map((u) => [u.key, u])) };
  return _units;
}

/**
 * Every weapon of the table as a unit, alphabetical by name: empty while the
 * table holds no rows, and rebuilt when the rows change. `profile` is the
 * shape `grantMatches` reads, so a token is tested against a unit the way the
 * attack roll tests it against the weapon; `token` is what a control for this
 * unit alone writes.
 *
 * @returns {readonly object[]}
 */
export const weaponUnits = () => readUnits().list;

/** Does one grant token cover one unit? Unknown tokens cover nothing. */
const covers = (token, unit) => grantMatches(token, unit.profile);

/** The units one token covers, in unit order. */
export const tokenUnits = (token) => weaponUnits().filter((u) => covers(token, u));

/** Tier captions: the kind of clause a group's token is, as the grammar names them. */
export const TIER = Object.freeze({ UNRESTRICTED: "unrestricted", BROAD: "broad", NARROW: "narrow", RESTRICTED: "restricted" });

/**
 * The six weapon classes in the strips' order, each as the grant token that
 * names it, the `WEAPON_CATEGORY` value a weapon declares, and the lib label
 * every surface prints — the character sheet's training and the item sheet's
 * Class control list the same six words in the same order because both read
 * this.
 */
export const CATEGORY_TOKENS = Object.freeze([
  { token: "axe", cat: WEAPON_CATEGORY.AXE, label: "ACKS-LIB.weaponCat.axe" },
  { token: "sworddagger", cat: WEAPON_CATEGORY.SWORD_DAGGER, label: "ACKS-LIB.weaponCat.swordDagger" },
  { token: "flailhammermace", cat: WEAPON_CATEGORY.FLAIL_HAMMER_MACE, label: "ACKS-LIB.weaponCat.flailHammerMace" },
  { token: "spearpolearm", cat: WEAPON_CATEGORY.SPEAR_POLEARM, label: "ACKS-LIB.weaponCat.spearPolearm" },
  { token: "bowcrossbow", cat: WEAPON_CATEGORY.BOW_CROSSBOW, label: "ACKS-LIB.weaponCat.bowCrossbow" },
  { token: "other", cat: WEAPON_CATEGORY.OTHER, label: "ACKS-LIB.weaponCat.other" },
]);

const SIZE_ORDER = Object.freeze([SIZE.TINY, SIZE.SMALL, SIZE.MEDIUM, SIZE.LARGE]);

/**
 * The organisations, in the order the view control cycles them. `groups` is
 * the group list WITHOUT members; `arrange()` places the units.
 */
export const TRAINING_VIEWS = Object.freeze([
  {
    key: "category",
    label: "ACKS-LIB.trainingView.category",
    groups: CATEGORY_TOKENS.map((c) => ({ key: c.token, token: c.token, label: c.label, tier: TIER.NARROW })),
  },
  {
    key: "size",
    label: "ACKS-LIB.trainingView.size",
    groups: [
      ...SIZE_ORDER.map((size) => ({ key: `melee-${size}`, token: `melee:${size}`, label: `ACKS-LIB.weaponGroup.melee.${size}`, tier: TIER.BROAD })),
      { key: "missile", token: "missile:all", label: "ACKS-LIB.weaponGroup.missile", tier: TIER.BROAD },
    ],
  },
  {
    key: "flat",
    label: "ACKS-LIB.trainingView.flat",
    groups: [{ key: "all", token: "all", label: "ACKS-LIB.weaponGroup.any", tier: TIER.UNRESTRICTED }],
  },
]);

/** The view after `key` in the cycle; the first when `key` is unknown. */
export function nextTrainingView(key) {
  const i = TRAINING_VIEWS.findIndex((v) => v.key === key);
  return TRAINING_VIEWS[(i + 1) % TRAINING_VIEWS.length].key;
}

/**
 * Place every unit under the view's groups, first match wins; what nothing
 * claims goes to a trailing `leftovers` group with no token.
 * @returns {{key:string, token:string|null, label:string, tier:string|null, members:object[]}[]}
 */
export function arrangeUnits(viewKey) {
  const view = TRAINING_VIEWS.find((v) => v.key === viewKey) ?? TRAINING_VIEWS[0];
  const placed = new Set();
  const groups = view.groups.map((g) => {
    const members = weaponUnits().filter((u) => !placed.has(u.key) && covers(g.token, u));
    for (const u of members) placed.add(u.key);
    return { ...g, members };
  });
  const leftovers = weaponUnits().filter((u) => !placed.has(u.key));
  if (leftovers.length) groups.push({ key: "leftovers", token: null, label: "ACKS-LIB.weaponGroup.leftovers", tier: null, members: leftovers });
  return groups;
}

/** A CSV grant as its tokens, spelling kept, blanks dropped. */
export const grantTokens = (csv) =>
  String(csv ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * The unit keys a list of tokens covers, and the tokens nothing recognises
 * (kept so a typo is never silently discarded by a click beside it).
 * @returns {{units: Set<string>, unknown: string[]}}
 */
export function coveredUnits(tokens) {
  const units = new Set();
  const unknown = [];
  for (const t of tokens) {
    const kind = classifyGrantToken(t);
    if (kind === "unknown") {
      unknown.push(t);
      continue;
    }
    for (const u of weaponUnits()) if (covers(t, u)) units.add(u.key);
  }
  return { units, unknown };
}

/**
 * The shortest grant that covers exactly `unitKeys`, in a fixed order: `all`
 * when everything is covered; else `missile:all`, the size clauses lightest
 * first, the categories in strip order — each emitted only when every unit it
 * covers is in the set and it adds one the earlier clauses did not — then the
 * remaining units by name. Unknown tokens ride at the end as written. With no
 * weapon in the table nothing is covered, so no set is every unit: the answer
 * is the unknown tokens alone, never `all`.
 */
export function canonicalGrant(unitKeys, unknown = []) {
  const { list, byKey } = readUnits();
  const want = new Set([...unitKeys].filter((k) => byKey.has(k)));
  const tail = unknown.map((t) => String(t).trim()).filter(Boolean);
  if (list.length && want.size === list.length) return ["all", ...tail].join(",");
  const out = [];
  const covered = new Set();
  const clauses = ["missile:all", ...SIZE_ORDER.map((s) => `melee:${s}`), ...CATEGORY_TOKENS.map((c) => c.token)];
  for (const token of clauses) {
    const members = tokenUnits(token);
    if (!members.length || !members.every((u) => want.has(u.key))) continue;
    if (!members.some((u) => !covered.has(u.key))) continue;
    out.push(token);
    for (const u of members) covered.add(u.key);
  }
  for (const u of list) if (want.has(u.key) && !covered.has(u.key)) out.push(u.token);
  return [...out, ...tail].join(",");
}

/**
 * A grant with a set of units switched: ON adds every one, OFF removes them;
 * the result is written canonically, so a clause that covered one of them and
 * now covers less is rewritten into the units it still holds. Left to decide
 * for itself, a set whose units are all covered goes OFF and any other goes ON,
 * so a partly covered set completes; pass `on` to force the direction. Keys the
 * table does not hold are ignored, and a set holding none changes nothing.
 * @param {Iterable<string>} unitKeys
 * @param {boolean|null} [on] true to grant, false to withdraw, null to decide
 * @returns {string|null} the new CSV, or null when no unit is named
 */
export function toggledUnits(csv, unitKeys, on = null) {
  const { byKey } = readUnits();
  const members = [...unitKeys].filter((k) => byKey.has(k));
  if (!members.length) return null;
  const { units, unknown } = coveredUnits(grantTokens(csv));
  const grant = on == null ? !members.every((k) => units.has(k)) : !!on;
  for (const k of members) {
    if (grant) units.add(k);
    else units.delete(k);
  }
  return canonicalGrant(units, unknown);
}

/**
 * A grant with one token switched: ON adds every unit the token covers, OFF
 * removes them (`toggledUnits`). A token the grammar does not know changes
 * nothing and is reported as such.
 * @param {boolean|null} [on] true to grant, false to withdraw, null to decide
 * @returns {string|null} the new CSV, or null when the token means nothing
 */
export function toggledGrant(csv, token, on = null) {
  const t = normalizeGrantToken(token);
  if (!t || classifyGrantToken(t) === "unknown") return null;
  return toggledUnits(csv, tokenUnits(t).map((u) => u.key), on);
}

/** The lists a shortcut row is drawn for, in order: the options' lists a training pick is made from, then Weapon Focus. */
export const SHORTCUT_LISTS = Object.freeze(["narrow", "broad", "martial", "focus"]);

/**
 * The printed groups as quick-select shortcuts over the units, in
 * `SHORTCUT_LISTS` order and printed order within a list. One entry per
 * imported option that holds weapons by naming them or by a size and use (a
 * noun list or a predicate), and one per Weapon Focus the import read:
 *
 *   `{ id, list, marker, label, kind, cite, units }`
 *
 * `id` is the option's (`narrow.3`), or `focus.<key>`; `marker` the number as
 * printed ("" for a focus); `label` the words as printed, a focus's nouns
 * joined; `kind` `"nouns"`, `"predicate"` or `"focus"`; `cite` the page of the
 * option's list ("" where none is stored, always for a focus: its page is the
 * lists document's `focus` cite); `units` the unit keys it holds, in unit
 * order, empty where no row is placed on it. The restricted list's single picks
 * are the units themselves and a combination names no set, so neither appears.
 * Empty where no list is imported.
 *
 * @returns {object[]}
 */
export function shortcuts() {
  const order = new Map(weaponUnits().map((u, i) => [u.key, i]));
  const inUnitOrder = (keys) => keys.filter((k) => order.has(k)).sort((a, b) => order.get(a) - order.get(b));
  const out = [];
  for (const o of weaponOptions()) {
    if (o.list === "restricted" || (o.kind !== "nouns" && o.kind !== "predicate")) continue;
    out.push({ id: o.id, list: o.list, marker: o.marker, label: o.label, kind: o.kind, cite: o.cite, units: inUnitOrder(optionUnits(o.id)) });
  }
  const focus = weaponLists()?.focus;
  if (focus && typeof focus === "object" && !Array.isArray(focus)) {
    for (const [key, nouns] of Object.entries(focus)) {
      const words = Array.isArray(nouns) ? nouns.filter((n) => typeof n === "string" && n.trim()) : [];
      if (!words.length) continue;
      out.push({ id: `focus.${key}`, list: "focus", marker: "", label: words.join(", "), kind: "focus", cite: "", units: inUnitOrder(weaponKeys().filter((k) => weaponFocusGroup(k) === key)) });
    }
  }
  return out.sort((a, b) => SHORTCUT_LISTS.indexOf(a.list) - SHORTCUT_LISTS.indexOf(b.list));
}

/** The unit keys of the shortcut an id names, or none: what a press reads, never what the page sent. */
export const shortcutUnits = (id) => shortcuts().find((s) => s.id === id)?.units ?? [];

/**
 * How much of a set of units a grant covers: `"all"`, `"some"` or `"none"`
 * (an empty set is none). `covered` is `coveredUnits(...).units`.
 * @param {Iterable<string>} unitKeys
 * @param {Set<string>} covered
 * @returns {"all"|"some"|"none"}
 */
export function coverageOf(unitKeys, covered) {
  const keys = [...unitKeys];
  const held = keys.filter((k) => covered.has(k)).length;
  return !keys.length || !held ? "none" : held === keys.length ? "all" : "some";
}
