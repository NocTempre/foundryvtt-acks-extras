/**
 * The weapon seam: `lib/weapons.mjs` answers every reader of the weapon table
 * from one registered source.
 *
 * Two halves. The first holds the source equipment registers
 * (`equipment/weapon-source.mjs`): the imported `weapons` grid placed against
 * the imported `weaponLists`, in the shape the readers ask for, read from the
 * registry at every call. The second registers invented sources and shows a
 * registered source replaces the default, that its fields may be live, and that
 * a reader inside equipment follows it.
 *
 * Every weapon, noun and figure here is invented; the grid and the lists are
 * what an import would have written.
 */
import assert from "node:assert";

globalThis.acksExtras ??= {};
globalThis.game = { settings: { get: () => undefined }, i18n: { has: () => false, localize: (x) => x, format: (k) => k }, modules: { get: () => ({ active: false }) } };

let pass = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};

const seam = await import(new URL("../scripts/lib/weapons.mjs", import.meta.url));
const profiles = await import(new URL("../scripts/equipment/profiles.mjs", import.meta.url));
const { librarySource, WEAPONS_DOC, WEAPONS_TABLE } = await import(new URL("../scripts/equipment/weapon-source.mjs", import.meta.url));
const { registerTable, unregisterTable, PRIORITY } = await import(new URL("../scripts/lib/tables.mjs", import.meta.url));
const { weaponRow, weaponKeys, keyForName, hasWeaponRows, registerWeaponSource, weaponFocusGroup, weaponThrowsAsAnyone, listedKind } = seam;

// --- no import, no rows -----------------------------------------------------------
const before = registerWeaponSource(librarySource);
check("a source over an empty registry has no rows", !hasWeaponRows() && weaponKeys().length === 0 && weaponRow("zorgle") === null);
check("and no spelling resolves", keyForName("battleax") === null && keyForName("zorgle") === null);

// --- the source reads what an import wrote -----------------------------------------
const GRID = {
  zorgle: { name: "Zorgle Axe", block: "Quibs", size: "large", melee: true, damage: "7d2", special: ["zork"] },
  quib: { name: "Quib Flask", block: "Flasks", size: "small", missile: true, thrown: true, damage: "9d3" },
  zorkoil: { name: "Zork Oil", block: "Quibs", size: "small", missile: true, thrown: true, damage: "4d3" },
  twohandedsword: { name: "Two-Handed Sword", block: null, size: "large", melee: true, damage: "5d2" },
};
const LISTS = {
  id: "weaponLists",
  tables: {
    category: { axe: ["zorgle"], bow: ["quib"] },
    focus: { zorgs: ["zorgle"] },
    damageType: { slashing: ["zorgle"], fire: ["zork"] },
    twoHands: ["Zorgle Axe"],
    throwables: { oil: { damage: "4d3", types: ["fire"] }, torch: { damage: "3d4", types: ["fire"] } },
  },
};
const layer = { priority: PRIORITY.WORLD, source: "test" };
registerTable({ id: WEAPONS_DOC, tables: { [WEAPONS_TABLE]: GRID } }, layer);
registerTable(LISTS, layer);

check("the keys are the grid's, then the kinds the throwables add", weaponKeys().join() === "zorgle,quib,zorkoil,twohandedsword,torch");
check("weaponKeys is a fresh array each call", weaponKeys() !== weaponKeys());
check("a row keeps its identity from one call to the next", weaponRow("zorgle") === weaponRow("zorgle"));
const zorgle = weaponRow("zorgle");
check("a row carries the grid's figures", zorgle.size === "large" && zorgle.damage === "7d2" && zorgle.special.join() === "zork" && zorgle.melee === true);
check("the category, damage type and two hands are the lists' placement under the readers' names", zorgle.cat === "axe" && zorgle.type === "slashing" && zorgle.twoHandedForced === true);
check("a row the lists do not place has no class, no type and no forced grip", weaponRow("twohandedsword").cat === null && weaponRow("twohandedsword").type === null && weaponRow("twohandedsword").twoHandedForced === false);
check("keyForName folds a written name to the key", keyForName(" ZORGLE-! ") === "zorgle");
check("a spelling resolves only where its target is a row", keyForName("twohandsword") === "twohandedsword" && keyForName("battleax") === null);
check("a focus group is the one the lists place a row under", weaponFocusGroup("zorgle") === "zorgs" && weaponFocusGroup("quib") === null);

const oil = weaponRow("zorkoil");
check("a throwables kind row is thrown and carries the procedure's shape, with the importer's die", oil.thrown && oil.special.includes("splash") && oil.special.includes("noDamageBonus") && oil.type === "fire");
const torch = weaponRow("torch");
check("a kind with no grid row is a row of its own: thrown, melee too, a light, the book's die", torch.thrown && torch.melee && torch.special.includes("light") && torch.damage === "3d4" && torch.type === "fire");
check("a throwables kind throws as anyone", weaponThrowsAsAnyone("zorkoil") && weaponThrowsAsAnyone("torch"));
check("a thrown weapon throws as anyone by its printed name, a melee one does not", weaponThrowsAsAnyone("quib") === true && weaponThrowsAsAnyone("zorgle") === false);

check("listedKind finds the one entry a phrase names", listedKind("focus", "Zorgles and others") === "zorgs" && listedKind("category", "the quibs") === "bow");
check("listedKind answers null for a phrase naming none, and for a list not imported", listedKind("category", "pointy stick") === null && listedKind("damageType", "") === null);

// the registry is read at every call
unregisterTable(WEAPONS_DOC, { priority: PRIORITY.WORLD });
check("unregistering the grid takes the rows with it, at once", !hasWeaponRows() && weaponRow("zorgle") === null);
registerTable({ id: WEAPONS_DOC, tables: { [WEAPONS_TABLE]: GRID } }, layer);
check("registering it again brings them back", hasWeaponRows() && weaponRow("zorgle")?.cat === "axe");
unregisterTable(LISTS.id, { priority: PRIORITY.WORLD });
check("without the lists the rows stay and nothing is placed", weaponRow("zorgle").cat === null && weaponRow("zorgle").type === null && weaponFocusGroup("zorgle") === null);
registerTable(LISTS, layer);

// --- what the table does not name -------------------------------------------------
check("an unknown key has no row", weaponRow("zorglub") === null);
check("a key inherited from Object has no row", weaponRow("constructor") === null && weaponRow("toString") === null);
check("a non-string key has no row", weaponRow(7) === null && weaponRow(null) === null && weaponRow(undefined) === null);
check("a name that is no key and no alias answers null", keyForName("zorglub") === null && keyForName("") === null && keyForName(undefined) === null);
check("a name inherited from Object answers null", keyForName("constructor") === null);
check("an unknown key has no focus group and throws as no one", weaponFocusGroup("zorglub") === null && weaponThrowsAsAnyone("zorglub") === false);

// --- a registered source replaces the default -------------------------------------
const quib = { name: "Quib", size: "small", melee: true, damage: "9d3", special: ["zork"], cat: "other" };
const zorgleRow = { name: "Zorgle", size: "large", melee: true, damage: "7d2", special: [], cat: "other" };
const invented = {
  rows: { zorgle: zorgleRow, quib },
  aliases: { zorg: "zorgle", ghost: "nothing" },
  focusGroups: { zorgs: ["zorgle"], empty: "not a list" },
  throwsAsAnyone: (key) => key === "quib",
};
const defaults = registerWeaponSource(invented);
check("registerWeaponSource returns the source it replaced", defaults === librarySource);
check("the invented source's keys replace the library's", weaponKeys().join() === "zorgle,quib");
check("weaponRow answers the invented row", weaponRow("zorgle") === zorgleRow && weaponRow("quib") === quib);
check("keyForName reads the invented key and alias", keyForName("Zorgle") === "zorgle" && keyForName("zorg") === "zorgle");
check("an alias whose target is no row answers null", keyForName("ghost") === null);
check("the library's spellings no longer answer", keyForName("twohandsword") === null);
check("weaponFocusGroup reads the invented groups and skips a malformed one", weaponFocusGroup("zorgle") === "zorgs" && weaponFocusGroup("quib") === null);
check("weaponThrowsAsAnyone reads the invented predicate", weaponThrowsAsAnyone("quib") === true && weaponThrowsAsAnyone("zorgle") === false);

// a reader inside equipment follows the registered source
const named = (name) => ({ name, type: "weapon", system: {}, flags: {} });
check("a profile reader finds the invented weapon by name", profiles.weaponKey(named("Zorgle")) === "zorgle");
check("a profile reader finds the invented weapon by alias", profiles.weaponKey(named("zorg")) === "zorgle");
check("a profile reader no longer finds a weapon of the grid", profiles.weaponKey(named("Zork Oil")) === null);
check("classifyWeapon builds the profile from the invented row", (() => {
  const p = profiles.classifyWeapon(named("Quib"));
  return p.key === "quib" && p.size === "small" && p.damage === "9d3" && p.anyoneThrows === true;
})());
check("focusGroup reads the invented groups", profiles.focusGroup({ key: "zorgle" }) === "zorgs" && profiles.focusGroup({ key: null }) === null);

// a field may be a function, read at every call
let live = { zorgle: zorgleRow };
registerWeaponSource({ rows: () => live, aliases: () => ({}), focusGroups: () => ({}) });
check("a function-valued field is read at every call", weaponKeys().join() === "zorgle");
live = { zorgle: zorgleRow, quib };
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

// the library's source comes back by registering it again
registerWeaponSource(defaults);
check("registering the replaced source restores every answer", hasWeaponRows() && weaponKeys().join() === "zorgle,quib,zorkoil,twohandedsword,torch");

unregisterTable(WEAPONS_DOC, { priority: PRIORITY.WORLD });
unregisterTable(LISTS.id, { priority: PRIORITY.WORLD });
registerWeaponSource(before);

console.log(`test-weapon-source: ${pass} checks passed`);
