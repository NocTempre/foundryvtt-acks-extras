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
 */
import { WEAPONS, SIZE, WEAPON_CATEGORY } from "./config.mjs";
import { grantMatches, classifyGrantToken, normalizeGrantToken } from "./proficiency.mjs";
import { DAMAGE_TYPE_ICONS, UNTYPED_ICON } from "../lib/damage-type.mjs";
import { slug } from "../lib/vocab.mjs";

/** A weapon key as a name: the table's keys are run-together words. */
const WEAPON_NAMES = Object.freeze({
  battleaxe: "Battle axe", greataxe: "Great axe", handaxe: "Hand axe", compositebow: "Composite bow", longbow: "Long bow",
  shortbow: "Short bow", morningstar: "Morning star", warhammer: "War hammer", shortsword: "Short sword",
  twohandedsword: "Two-handed sword", silverdagger: "Silver dagger", staffsling: "Staff sling", militaryoil: "Military oil",
  holywater: "Holy water",
});

/** The display name of a weapon key. */
export const weaponName = (key) => WEAPON_NAMES[key] ?? String(key).charAt(0).toUpperCase() + String(key).slice(1);

/**
 * The token that names ONE unit and nothing wider: the bare key where the
 * grammar reads it as a weapon, `weapon:<key>` where the bare key is also a
 * category (`crossbow`) and the category reading would win.
 */
const unitToken = (key) => (classifyGrantToken(key) === "weapon" ? key : `weapon:${key}`);

/**
 * Every weapon of the table as a unit, alphabetical by name. `profile` is the
 * shape `grantMatches` reads, so a token is tested against a unit the way the
 * attack roll tests it against the weapon; `token` is what a control for this
 * unit alone writes.
 */
export const WEAPON_UNITS = Object.freeze(
  Object.entries(WEAPONS)
    .map(([key, w]) =>
      Object.freeze({
        key,
        token: unitToken(key),
        name: weaponName(key),
        cat: slug(w.cat),
        size: w.size,
        melee: !!w.melee,
        missile: !!w.missile,
        icon: DAMAGE_TYPE_ICONS[w.type] ?? UNTYPED_ICON,
        profile: Object.freeze({ ...w, key }),
      }),
    )
    .sort((a, b) => a.name.localeCompare(b.name)),
);

const unitByKey = new Map(WEAPON_UNITS.map((u) => [u.key, u]));

/** Does one grant token cover one unit? Unknown tokens cover nothing. */
const covers = (token, unit) => grantMatches(token, unit.profile);

/** The units one token covers, in unit order. */
export const tokenUnits = (token) => WEAPON_UNITS.filter((u) => covers(token, u));

/** Tier captions: the kind of clause a group's token is, as the grammar names them. */
export const TIER = Object.freeze({ UNRESTRICTED: "unrestricted", BROAD: "broad", NARROW: "narrow", RESTRICTED: "restricted" });

/** The seven category tokens in the strips' order, spelled as grant tokens. */
const CATEGORY_TOKENS = Object.freeze([
  { token: "axe", cat: WEAPON_CATEGORY.AXE, label: "ACKS-LIB.weaponCat.axe" },
  { token: "sworddagger", cat: WEAPON_CATEGORY.SWORD_DAGGER, label: "ACKS-LIB.weaponCat.swordDagger" },
  { token: "flailhammermace", cat: WEAPON_CATEGORY.FLAIL_HAMMER_MACE, label: "ACKS-LIB.weaponCat.flailHammerMace" },
  { token: "spearpolearm", cat: WEAPON_CATEGORY.SPEAR_POLEARM, label: "ACKS-LIB.weaponCat.spearPolearm" },
  { token: "bow", cat: WEAPON_CATEGORY.BOW, label: "ACKS-LIB.weaponCat.bow" },
  { token: "crossbow", cat: WEAPON_CATEGORY.CROSSBOW, label: "ACKS-LIB.weaponCat.crossbow" },
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
    const members = WEAPON_UNITS.filter((u) => !placed.has(u.key) && covers(g.token, u));
    for (const u of members) placed.add(u.key);
    return { ...g, members };
  });
  const leftovers = WEAPON_UNITS.filter((u) => !placed.has(u.key));
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
    for (const u of WEAPON_UNITS) if (covers(t, u)) units.add(u.key);
  }
  return { units, unknown };
}

/**
 * The shortest grant that covers exactly `unitKeys`, in a fixed order: `all`
 * when everything is covered; else `missile:all`, the size clauses lightest
 * first, the categories in strip order — each emitted only when every unit it
 * covers is in the set and it adds one the earlier clauses did not — then the
 * remaining units by name. Unknown tokens ride at the end as written.
 */
export function canonicalGrant(unitKeys, unknown = []) {
  const want = new Set([...unitKeys].filter((k) => unitByKey.has(k)));
  const tail = unknown.map((t) => String(t).trim()).filter(Boolean);
  if (want.size === WEAPON_UNITS.length) return ["all", ...tail].join(",");
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
  for (const u of WEAPON_UNITS) if (want.has(u.key) && !covered.has(u.key)) out.push(u.token);
  return [...out, ...tail].join(",");
}

/**
 * A grant with one token switched: ON adds every unit the token covers, OFF
 * removes them; the result is written canonically. Left to decide for itself,
 * a token whose units are all covered goes OFF and any other goes ON — so a
 * partly covered group completes; pass `on` to force the direction. A token
 * the grammar does not know changes nothing and is reported as such.
 * @param {boolean|null} [on] true to grant, false to withdraw, null to decide
 * @returns {string|null} the new CSV, or null when the token means nothing
 */
export function toggledGrant(csv, token, on = null) {
  const t = normalizeGrantToken(token);
  if (!t || classifyGrantToken(t) === "unknown") return null;
  const { units, unknown } = coveredUnits(grantTokens(csv));
  const members = tokenUnits(t).map((u) => u.key);
  if (!members.length) return null;
  const grant = on == null ? !members.every((k) => units.has(k)) : !!on;
  for (const k of members) {
    if (grant) units.add(k);
    else units.delete(k);
  }
  return canonicalGrant(units, unknown);
}
