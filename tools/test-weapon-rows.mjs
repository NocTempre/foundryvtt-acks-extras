/**
 * The weapon rows the library's minted weapons are published as: how a row is
 * keyed, what it carries, when it is ready, and when its change is announced.
 *
 * Library items here carry INVENTED core fields (a tiny sword, a die no page
 * prints) and invented mint ids, so each assertion is against what the item
 * says, never a constant, and the keying is shown to need no table of names.
 */
import assert from "node:assert";

globalThis.acksExtras ??= {};
globalThis.game = { settings: { get: () => undefined }, i18n: { has: () => false, localize: (x) => x, format: (k) => k }, modules: { get: () => ({ active: false }) } };

let pass = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};

const rows = await import(new URL("../scripts/equipment/weapon-rows.mjs", import.meta.url));
const reg = await import(new URL("../scripts/lib/tables.mjs", import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const savedHooks = globalThis.Hooks;
const savedConsole = console.error;
reg.unregisterTable("weapons");

const minted = (id, name, tail, sys = {}, extra = {}) => ({
  id,
  name,
  type: "weapon",
  flags: { "acks-extras": { cookbook: { id: `def.weapon.${tail}`, cite: "Invented p. 4" }, ...extra } },
  system: {
    melee: true,
    missile: false,
    size: "tiny",
    special: { cleave: false, handy: true, thrown: false },
    cleaveLimit: { numeric: 2, addStrMod: false },
    damage: { base: { formula: "9d3", types: new Set(["zap", "ache"]) }, alternate: { formula: "" } },
    ...sys,
  },
});

const handlers = {};
const fired = [];
globalThis.Hooks = {
  on: (name, fn) => (handlers[name] ??= []).push(fn),
  once: (name, fn) => (handlers[`once:${name}`] ??= []).push(fn),
  callAll: (name, ...args) => fired.push([name, ...args]),
};
game.ready = true;

const zorgle = minted("w1", "Zorgle", "zorgle", {}, { weapon: { block: "  Invented Block " } });
const axe = minted("w2", "Battle Axe", "battleAxe", {
  size: "large",
  special: { cleave: true, handy: false, thrown: true },
  cleaveLimit: { numeric: 5, addStrMod: true },
  damage: { base: { formula: "7d2", types: ["b", "a"] }, alternate: { formula: "6d4" } },
});
game.items = [zorgle, axe];

// --- keying: the tail of the mint id, folded; no table of names ------------------
check("PRODUCES names the weapons document's grid table", Object.keys(rows.PRODUCES).join() === rows.WEAPONS_DOC && "grid" in rows.PRODUCES[rows.WEAPONS_DOC]);
check("publish registers one row per minted weapon", rows.publish() === 2);
const grid = () => reg.getTable("weapons", "grid");
check("a weapon no list names is keyed by its mint id's tail", Object.keys(grid()).sort().join() === "battleaxe,zorgle");
check("a camelCase tail folds to lowercase letters", grid().battleaxe.name === "Battle Axe");
check("the key is not the item's name: a renamed item keeps its row", (() => {
  zorgle.name = "Renamed";
  game.items = [zorgle, axe];
  rows.publish();
  const ok = grid().zorgle?.name === "Renamed" && grid().renamed === undefined;
  zorgle.name = "Zorgle";
  rows.publish();
  return ok;
})());

// --- what a row carries -------------------------------------------------------------
check("a row carries the item's own name", grid().zorgle.name === "Zorgle");
check("and the sub-header the importer filed it under, trimmed", grid().zorgle.block === "Invented Block");
check("a row filed under none carries null", grid().battleaxe.block === null);
check("and the item's damage types, sorted, from a set or an array", grid().zorgle.types.join() === "ache,zap" && grid().battleaxe.types.join() === "a,b");
check("an item that states no types carries an empty list", (() => {
  const bare = minted("w3", "Bare", "bare", { damage: { base: { formula: "1d1" }, alternate: { formula: "" } } });
  game.items = [bare];
  rows.publish();
  const ok = Array.isArray(grid().bare.types) && grid().bare.types.length === 0;
  game.items = [zorgle, axe];
  rows.publish();
  return ok;
})());
check("a row carries the item's own size, grips, dice and qualities", grid().zorgle.size === "tiny" && grid().zorgle.damage === "9d3" && grid().zorgle.damage2h === "" && grid().zorgle.handy === true && grid().zorgle.thrown === false && grid().zorgle.melee === true && grid().zorgle.missile === false);
check("the alternate die and the thrown quality read off the item", grid().battleaxe.damage2h === "6d4" && grid().battleaxe.thrown === true && grid().battleaxe.special.join() === "cleave,thrown");
check("a cleaving weapon carries its limit, and one that does not carries none", grid().battleaxe.cleaveLimit.numeric === 5 && grid().battleaxe.cleaveLimit.addStrMod === true && grid().zorgle.cleaveLimit === null);
check("a row's citation is the item's stored one, and a shared one cites the table", grid().zorgle.cite === "Invented p. 4" && reg.citeOf("weapons", "grid") === "Invented p. 4");
check("the document is registered at world priority", reg.getLayer("weapons", reg.PRIORITY.WORLD) != null);
check("the block reads through getFlag where flags are not plain data", (() => {
  const viaGetter = { ...minted("w9", "Via", "via"), flags: undefined, getFlag: (m, k) => (m === "acks-extras" && k === "weapon" ? { block: "Getter Block" } : k === "cookbook" ? { id: "def.weapon.via", cite: "Invented p. 4" } : undefined) };
  return rows.rowOf(viaGetter)?.block === "Getter Block";
})());

// --- the hooks, and the first publication ---------------------------------------------
check("the hooks register for create, update and delete, and a ready publication", ["createItem", "updateItem", "deleteItem"].every((h) => handlers[h] === undefined) && (rows.registerWeaponRows(), ["createItem", "updateItem", "deleteItem", "once:ready"].every((h) => handlers[h]?.length === 1)));
let readyState = "pending";
rows.rowsReady().then(() => (readyState = "ready"));
await sleep(5);
check("rowsReady waits for the first publication", readyState === "pending");
reg.unregisterTable("weapons");
await handlers["once:ready"][0]();
await rows.rowsReady();
check("and resolves once the rows are in the registry", reg.getTable("weapons", "grid").zorgle != null);
check("a second call returns the same settled promise", (await rows.rowsReady(), true));

// A publisher that throws still releases the readers, and says so.
{
  const errors = [];
  console.error = (...a) => errors.push(a);
  const saved = Object.getOwnPropertyDescriptor(game, "items");
  Object.defineProperty(game, "items", { configurable: true, get() { throw new Error("library unreadable"); } });
  rows.registerWeaponRows();
  const failing = handlers["once:ready"].at(-1);
  await failing();
  let released = false;
  await rows.rowsReady().then(() => (released = true));
  check("a failed first publication still releases the readers", released);
  check("and is reported, not swallowed", errors.length === 1 && String(errors[0][0]).includes("could not be published"));
  Object.defineProperty(game, "items", saved ?? { configurable: true, writable: true, value: [zorgle, axe] });
  console.error = savedConsole;
  game.items = [zorgle, axe];
  handlers.createItem.length = 1;
  handlers.updateItem.length = 1;
  handlers.deleteItem.length = 1;
}

// --- republishing and the change announcement ------------------------------------------
await sleep(rows.ROWS_DEBOUNCE_MS * 2);
fired.length = 0;
rows.publish();
rows.publish();
rows.publish();
check("a burst of publications has announced nothing yet", fired.length === 0);
await sleep(rows.ROWS_DEBOUNCE_MS * 3);
check("and then announces once, under the module's own hook name", fired.length === 1 && fired[0][0] === rows.ROWS_CHANGED_HOOK && rows.ROWS_CHANGED_HOOK.startsWith("acksExtras."));

fired.length = 0;
axe.system.damage.base.formula = "8d2";
handlers.updateItem[0](axe);
check("an edit to a library weapon republishes its row", grid().battleaxe.damage === "8d2");
await sleep(rows.ROWS_DEBOUNCE_MS * 3);
check("and announces the change", fired.length === 1);

// A weapon the importer has not minted, or that sits on an actor, moves nothing.
fired.length = 0;
const owned = { ...minted("w10", "Zorgle", "zorgle", { damage: { base: { formula: "1d1" }, alternate: { formula: "" } } }), parent: { documentName: "Actor" } };
game.items = [zorgle, axe, owned];
handlers.createItem[0](owned);
check("a weapon on an actor does not republish", grid().zorgle.damage === "9d3");
await sleep(rows.ROWS_DEBOUNCE_MS * 3);
check("and announces nothing", fired.length === 0);
game.items = [zorgle, axe];

// A create adds a row.
const quux = minted("w11", "Quux", "quux", { melee: false, missile: true, size: "na", special: {} });
game.items = [zorgle, axe, quux];
handlers.createItem[0](quux);
check("a created library weapon adds its row", grid().quux != null);
check("a size the system calls na is no size (a missile row prints none)", grid().quux.size === null && grid().quux.special.length === 0);

// A delete removes it, even while the collection still lists the document.
handlers.deleteItem[0](quux);
check("a delete removes the row even before the collection drops the document", grid().quux === undefined && grid().zorgle != null);
game.items = [zorgle, axe];
handlers.deleteItem[0](axe);
check("a delete of an unlisted document removes its row", grid().battleaxe === undefined);

// --- items that carry no core fields give no row ---------------------------------------
const oldImport = minted("w12", "Mace", "mace", {});
oldImport.system = { damage: "1d4", melee: true }; // before the structured weapon fields
const noSpecial = minted("w13", "Mace", "mace", {});
delete noSpecial.system.special;
const noDie = minted("w14", "Mace", "mace", {});
noDie.system.damage = { base: {} };
game.items = [zorgle, oldImport, noSpecial, noDie];
rows.publish();
check("an item without the structured weapon fields gives no row rather than a guessed one", grid().mace === undefined && grid().zorgle != null);

// A live document always holds every field: the schema fills the defaults.
// An import from before the importer wrote the weapon fields is that shape.
const defaults = () => ({ cleave: false, entangling: false, flexible: false, handy: false, impact: false, incapacitating: false, long: false, mounted: false, silver: false, slow: false, thrown: false });
const unsized = minted("w15", "Mace", "mace", { melee: true, missile: false, size: "na", special: defaults(), cleaveLimit: { numeric: 2, addStrMod: false } });
const tagged = minted("w16", "Mace", "mace", { melee: false, missile: true, size: "na", special: defaults(), customTags: ["Handy", "Slow"] });
const taggedCleave = minted("w17", "Mace", "mace", { melee: false, missile: true, size: "na", special: defaults(), customTags: [{ title: "Cleave 2", value: "" }] });
for (const [label, item] of [["an unsized melee weapon", unsized], ["quality words left as tags", tagged], ["a cleave word left as a tag object", taggedCleave]]) {
  game.items = [zorgle, item];
  rows.publish();
  check(`${label}, every schema default, gives no row`, grid().mace === undefined);
}
const customOnly = minted("w18", "Mace", "mace", { melee: false, missile: true, size: "na", special: { ...defaults(), handy: true }, customTags: ["A tag no property names"] });
game.items = [zorgle, customOnly];
rows.publish();
check("a tag no special property names, beside lit properties, is not a legacy mark", grid().mace?.handy === true);

// --- identity -----------------------------------------------------------------------------
const handMade = { ...minted("w19", "Dagger", "dagger"), flags: {} };
const twin = minted("w20", "Zorgle", "zorgle", { damage: { base: { formula: "5d5" }, alternate: { formula: "" } } });
const other = minted("w21", "Zorgle", "homebrew", { damage: { base: { formula: "4d4" }, alternate: { formula: "" } } });
game.items = [zorgle, twin, other, handMade];
rows.publish();
check("an item the importer did not mint has no row", grid().dagger === undefined);
check("two items under one mint id: the first in library order wins", grid().zorgle.damage === "9d3");
check("two items of one name under different mint ids are two rows", grid().homebrew.damage === "4d4" && Object.keys(grid()).sort().join() === "homebrew,zorgle");
game.items = [twin, zorgle];
rows.publish();
check("and the order decides which", grid().zorgle.damage === "5d5");

// --- no rows: the document is withdrawn, and the withdrawal is announced ----------------
await sleep(rows.ROWS_DEBOUNCE_MS * 2);
fired.length = 0;
game.items = [handMade];
check("with no row to publish the document is withdrawn", rows.publish() === 0 && !reg.hasDoc("weapons"));
await sleep(rows.ROWS_DEBOUNCE_MS * 3);
check("and the withdrawal is announced", fired.length === 1);
fired.length = 0;
rows.publish();
await sleep(rows.ROWS_DEBOUNCE_MS * 3);
check("a withdrawal of nothing announces nothing", fired.length === 0);

globalThis.Hooks = savedHooks;
console.error = savedConsole;
delete game.items;
reg.unregisterTable("weapons");
console.log(`test-weapon-rows: ${pass} checks passed`);
