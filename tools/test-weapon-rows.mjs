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

// A melee weapon whose size is the system's `na` still gives its row, with no size.
const unsized = minted("w15", "Mace", "mace", { melee: true, missile: false, size: "na", special: {}, customTags: ["A tag no property names"] });
game.items = [zorgle, unsized];
rows.publish();
check("an unsized melee weapon gives its row with no size, and a custom tag changes nothing", grid().mace?.melee === true && grid().mace.size === null);

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

// --- an action waits for the first publication, and never hangs ----------------------------
{
  const warned = [];
  const savedWarn = console.warn;
  console.warn = (...a) => warned.push(a);
  const publishAtReady = () => handlers["once:ready"].at(-1)();
  const raced = (p) => Promise.race([p.then(() => "settled"), sleep(30).then(() => "pending")]);

  // Started before the publication: the action holds, then answers with the rows in.
  reg.unregisterTable("weapons");
  game.items = [zorgle, twin];
  rows.registerWeaponRows();
  let held = null;
  rows.rowsSettled().then(() => (held = reg.hasDoc("weapons")));
  await sleep(10);
  check("an action started before the first publication is still waiting, with no rows registered", held === null && !reg.hasDoc("weapons"));
  await publishAtReady();
  await sleep(5);
  check("and it resumes once the rows are in, so it reads the answer a later action reads", held === true && grid().zorgle != null);
  check("an action started after the publication does not wait", (await raced(rows.rowsSettled())) === "settled");

  // A world that imported no weapon rows settles with nothing registered.
  reg.unregisterTable("weapons");
  game.items = [handMade];
  rows.registerWeaponRows();
  const bare = rows.rowsSettled();
  check("an action waits while the library has not loaded, even for a world with no rows", (await raced(bare)) === "pending");
  await publishAtReady();
  check("a world with no weapon rows settles at the publication, with no document", (await raced(bare)) === "settled" && !reg.hasDoc("weapons"));

  // A publication that never lands releases the action at its bound, and says so.
  rows.registerWeaponRows();
  const started = Date.now();
  await rows.rowsSettled({ timeoutMs: 25 });
  check("a publication that never lands releases the action after its bound", Date.now() - started >= 20 && Date.now() - started < 2000);
  check("and the release is reported", warned.length === 1 && String(warned[0][0]).includes("not published within 25 ms"));
  check("the default bound is long enough for a library that loads in tens of seconds", rows.ROWS_WAIT_MS >= 30000);

  // A failed publisher settles the action too.
  const savedErr = console.error;
  console.error = () => {};
  const items = Object.getOwnPropertyDescriptor(game, "items");
  Object.defineProperty(game, "items", { configurable: true, get() { throw new Error("library unreadable"); } });
  rows.registerWeaponRows();
  const failing = rows.rowsSettled();
  await publishAtReady();
  check("a failed publication releases an action waiting on it", (await raced(failing)) === "settled");
  Object.defineProperty(game, "items", items ?? { configurable: true, writable: true, value: [zorgle, twin] });
  console.error = savedErr;
  console.warn = savedWarn;
  game.items = [zorgle, twin];
  for (const hook of ["createItem", "updateItem", "deleteItem"]) handlers[hook].length = 1;
  handlers["once:ready"].length = 1;
  await publishAtReady();
  await sleep(rows.ROWS_DEBOUNCE_MS * 3);
}

// --- the actions that classify a weapon start only once the rows are in -----------------------
{
  const acts = await import("../scripts/equipment/actions.mjs");
  const { equipmentContributor } = await import("../scripts/equipment/roll-wrap.mjs");
  const publishAtReady = () => handlers["once:ready"].at(-1)();
  reg.unregisterTable("weapons");
  game.items = [zorgle, twin];
  rows.registerWeaponRows();

  // A draw and a draw into a hand, started in the load window: each writes only after the publication.
  const writes = [];
  const blade = { update: async (u) => writes.push({ u, published: reg.hasDoc("weapons") }) };
  const drawing = [acts.drawItem(blade), acts.drawInto(blade, "main")];
  // The attack throw's own wait, as the seam asks it before it builds the throw.
  let gate = "pending";
  equipmentContributor.ready().then(() => (gate = reg.hasDoc("weapons") ? "rows in" : "rows out"));
  await sleep(10);
  check("a draw started before the publication has written nothing", writes.length === 0);
  check("the attack contributor holds the throw until the rows are in", gate === "pending");
  await publishAtReady();
  await Promise.all(drawing);
  await sleep(5);
  check("both draws write after the publication, with the rows in the registry", writes.length === 2 && writes.every((w) => w.published));
  check("the main-hand draw still names its hand in the one write", writes.some((w) => w.u["system.equipped"] === true && w.u["flags.acks-extras.hand"] === "main"));
  check("and the throw is released with the rows in", gate === "rows in");

  // Long after load the same calls do not wait.
  writes.length = 0;
  await acts.drawItem(blade);
  check("a draw after the publication writes at once", writes.length === 1 && writes[0].published);

  // A world with nothing imported: the draw settles at the publication and writes.
  reg.unregisterTable("weapons");
  game.items = [handMade];
  rows.registerWeaponRows();
  writes.length = 0;
  const bareDraw = acts.drawItem(blade);
  await sleep(10);
  check("with no weapon rows imported the draw also waits for the library", writes.length === 0);
  await publishAtReady();
  await bareDraw;
  check("and then writes with nothing registered: undecided, never a hang", writes.length === 1 && writes[0].published === false);

  await sleep(rows.ROWS_DEBOUNCE_MS * 3);
  game.items = [zorgle, twin];
  for (const hook of ["createItem", "updateItem", "deleteItem"]) handlers[hook].length = 1;
  handlers["once:ready"].length = 1;
}

globalThis.Hooks = savedHooks;
console.error = savedConsole;
delete game.items;
reg.unregisterTable("weapons");
console.log(`test-weapon-rows: ${pass} checks passed`);
