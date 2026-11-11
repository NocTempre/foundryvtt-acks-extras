/**
 * The weapon seam: `lib/weapons.mjs` answers every reader of the weapon table
 * from one registered source.
 *
 * Two halves. The first holds the source equipment registers to the table it
 * is built on: every accessor answers for every key exactly what the table
 * itself answers, so reading through the seam changes no answer. The second
 * registers invented sources (made-up weapons, no printed figure) and shows a
 * registered source replaces the default, that its fields may be live, and
 * that a reader inside equipment follows it.
 */
import assert from "node:assert";

globalThis.acksExtras ??= {};
globalThis.game = { settings: { get: () => undefined }, i18n: { has: () => false, localize: (x) => x, format: (k) => k }, modules: { get: () => ({ active: false }) } };

let pass = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};

const cfg = await import(new URL("../scripts/equipment/config.mjs", import.meta.url));
const seam = await import(new URL("../scripts/lib/weapons.mjs", import.meta.url));
const profiles = await import(new URL("../scripts/equipment/profiles.mjs", import.meta.url));
const { WEAPONS, WEAPON_ALIASES, WEAPON_FOCUS_GROUPS, ANYONE_THROWS } = cfg;
const { weaponRow, weaponKeys, keyForName, hasWeaponRows, registerWeaponSource, weaponFocusGroup, weaponThrowsAsAnyone } = seam;

// --- the source equipment registers answers what the table answers ----------------
const tableKeys = Object.keys(WEAPONS);
check("loading equipment's config registers a source with rows", hasWeaponRows());
check("weaponKeys lists the table's keys in the table's order", weaponKeys().join() === tableKeys.join());
check("weaponKeys is a fresh array each call", weaponKeys() !== weaponKeys());
check("weaponRow answers the table's own row for every key", tableKeys.every((k) => weaponRow(k) === WEAPONS[k]));
check("keyForName answers each key for the key", tableKeys.every((k) => keyForName(k) === k));
check("keyForName folds a written name to the key", tableKeys.every((k) => keyForName(` ${k.toUpperCase()}-! `) === k));
check(
  "keyForName answers each alias's target where the target is a row, else null",
  Object.entries(WEAPON_ALIASES).every(([alias, target]) => keyForName(alias) === (WEAPONS[target] ? target : null)),
);
check(
  "weaponFocusGroup answers the group the table files each key under, else null",
  tableKeys.every((k) => weaponFocusGroup(k) === (Object.keys(WEAPON_FOCUS_GROUPS).find((g) => WEAPON_FOCUS_GROUPS[g].includes(k)) ?? null)),
);
check(
  "weaponThrowsAsAnyone answers the tag the table carries, for every key",
  tableKeys.every((k) => weaponThrowsAsAnyone(k) === (WEAPONS[k].special ?? []).includes(ANYONE_THROWS)),
);
check("some key throws as anyone and some does not, so the check above is not vacuous", tableKeys.some(weaponThrowsAsAnyone) && !tableKeys.every(weaponThrowsAsAnyone));

// --- what the table does not name -------------------------------------------------
check("an unknown key has no row", weaponRow("zorglub") === null);
check("a key inherited from Object has no row", weaponRow("constructor") === null && weaponRow("toString") === null);
check("a non-string key has no row", weaponRow(7) === null && weaponRow(null) === null && weaponRow(undefined) === null);
check("a name that is no key and no alias answers null", keyForName("zorglub") === null && keyForName("") === null && keyForName(undefined) === null);
check("a name inherited from Object answers null", keyForName("constructor") === null);
check("an unknown key has no focus group and throws as no one", weaponFocusGroup("zorglub") === null && weaponThrowsAsAnyone("zorglub") === false);

// --- a registered source replaces the default -------------------------------------
const quib = { name: "Quib", size: "small", melee: true, damage: "9d3", special: ["zork"], cat: "other" };
const zorgle = { name: "Zorgle", size: "large", melee: true, damage: "7d2", special: [], cat: "other" };
const invented = {
  rows: { zorgle, quib },
  aliases: { zorg: "zorgle", ghost: "nothing" },
  focusGroups: { zorgs: ["zorgle"], empty: "not a list" },
  throwsAsAnyone: (key) => key === "quib",
};
const defaults = registerWeaponSource(invented);
check("registerWeaponSource returns the source it replaced", defaults !== null && defaults.rows === WEAPONS);
check("the invented source's keys replace the table's", weaponKeys().join() === "zorgle,quib");
check("none of the table's keys is a row any more", tableKeys.every((k) => weaponRow(k) === null));
check("weaponRow answers the invented row", weaponRow("zorgle") === zorgle && weaponRow("quib") === quib);
check("keyForName reads the invented key and alias", keyForName("Zorgle") === "zorgle" && keyForName("zorg") === "zorgle");
check("an alias whose target is no row answers null", keyForName("ghost") === null);
check("the table's aliases no longer answer", Object.keys(WEAPON_ALIASES).every((a) => keyForName(a) === null || a in invented.aliases));
check("weaponFocusGroup reads the invented groups and skips a malformed one", weaponFocusGroup("zorgle") === "zorgs" && weaponFocusGroup("quib") === null);
check("weaponThrowsAsAnyone reads the invented predicate", weaponThrowsAsAnyone("quib") === true && weaponThrowsAsAnyone("zorgle") === false);

// a reader inside equipment follows the registered source
const named = (name) => ({ name, type: "weapon", system: {}, flags: {} });
check("a profile reader finds the invented weapon by name", profiles.weaponKey(named("Zorgle")) === "zorgle");
check("a profile reader finds the invented weapon by alias", profiles.weaponKey(named("zorg")) === "zorgle");
check("a profile reader no longer finds a weapon of the table", profiles.weaponKey(named(tableKeys[0])) === null);
check("classifyWeapon builds the profile from the invented row", (() => {
  const p = profiles.classifyWeapon(named("Quib"));
  return p.key === "quib" && p.size === "small" && p.damage === "9d3" && p.anyoneThrows === true;
})());
check("focusGroup reads the invented groups", profiles.focusGroup({ key: "zorgle" }) === "zorgs" && profiles.focusGroup({ key: null }) === null);

// a field may be a function, read at every call
let live = { zorgle };
registerWeaponSource({ rows: () => live, aliases: () => ({}), focusGroups: () => ({}) });
check("a function-valued field is read at every call", weaponKeys().join() === "zorgle");
live = { zorgle, quib };
check("a change to what the function returns shows at once", weaponKeys().join() === "zorgle,quib" && weaponRow("quib") === quib);
check("a source with no predicate throws as no one", weaponThrowsAsAnyone("quib") === false);

// no source, and a source with nothing usable in it
registerWeaponSource(null);
check("with no source there are no rows", !hasWeaponRows() && weaponKeys().length === 0 && weaponRow("zorgle") === null);
check("with no source nothing is named", keyForName("zorgle") === null && weaponFocusGroup("zorgle") === null && weaponThrowsAsAnyone("zorgle") === false);
registerWeaponSource({ rows: "not an object", aliases: 3, focusGroups: null });
check("a malformed source answers as an empty one", !hasWeaponRows() && keyForName("zorgle") === null && weaponFocusGroup("zorgle") === null);
registerWeaponSource(42);
check("a source that is no object registers as none", !hasWeaponRows());

// the default comes back by registering the source that was replaced
registerWeaponSource(defaults);
check("registering the replaced source restores every table answer", hasWeaponRows() && weaponKeys().join() === tableKeys.join() && tableKeys.every((k) => weaponRow(k) === WEAPONS[k]));

console.log(`test-weapon-source: ${pass} checks passed`);
