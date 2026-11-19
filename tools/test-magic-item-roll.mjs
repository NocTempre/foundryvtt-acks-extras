/**
 * The magic-item roll service (`scripts/magic-items/roll-service.mjs`) and the
 * feature's entry (`module.mjs`) against invented tables: where a roll starts,
 * how a list is named and cited (the list's own pages before its table's, no
 * page once a Judge has overridden it), the refusals, and the contract the
 * feature publishes. Every caption, cite and item below is made up.
 */
import assert from "node:assert";
import { PRIORITY, registerTable, resetTables, expectedTables, unregisterTable } from "../scripts/lib/tables.mjs";
import * as services from "../scripts/lib/services.mjs";
import { COOKBOOK_ITEMS_CONTRACT, MAGIC_ITEM_DOC, MAGIC_ITEM_ROLL_CONTRACT } from "../scripts/magic-items/constants.mjs";
import { MAGIC_ITEM_DOC_ID } from "../scripts/importer/magic-item-binding.mjs";

let pass = 0;
const check = (label, cond) => { assert.ok(cond, label); pass++; };
const eq = (label, got, want) => { assert.deepStrictEqual(got, want, label); pass++; };

// The feature's entry registers on Hooks; collect the callbacks and run them by hand.
const hooks = { init: [], setup: [] };
globalThis.Hooks = { once: (name, fn) => hooks[name]?.push(fn) };
globalThis.game = { modules: { get: () => null } };
const { acksExtras } = await import("../scripts/namespace.mjs");
const service = await import("../scripts/magic-items/roll-service.mjs");
await import("../scripts/magic-items/module.mjs");
const { startOf, describeList, starts, rollMagicItem, readTables, foundryRoller } = service;

eq("the feature's document id is the importer's", MAGIC_ITEM_DOC, MAGIC_ITEM_DOC_ID);

/* --- where a roll starts -------------------------------------------------------- */
eq("from wins over everything", startOf({ from: "a.b", style: "heroic", rarity: "x" }), { ok: true, from: "a.b" });
eq("classic with a category starts at that list", startOf({ style: "classic", category: "kk" }), { ok: true, from: "classic.kk" });
eq("classic with none starts at the type list", startOf({ style: "classic" }), { ok: true, from: "classicType.bands" });
eq("heroic with a rarity starts at the rarity list", startOf({ style: "heroic", rarity: "rr" }), { ok: true, from: "heroic.rr" });
eq("gritty reads the same rarity lists", startOf({ style: "gritty", rarity: "rr" }), { ok: true, from: "heroic.rr" });
eq("heroic with no rarity is refused", startOf({ style: "heroic" }), { ok: false, reason: "rarity-required" });
eq("gritty with no rarity is refused", startOf({ style: "gritty" }), { ok: false, reason: "rarity-required" });
eq("an unknown style is refused", startOf({ style: "zz" }), { ok: false, reason: "unknown-style" });
eq("nothing at all is refused", startOf(), { ok: false, reason: "unknown-style" });

/* --- the registry ---------------------------------------------------------------- */
const world = () => ({
  id: MAGIC_ITEM_DOC,
  source: { book: "test" },
  cites: { classicType: "ZZ p.1-9", classic: "ZZ p.2-8", heroic: "ZZ p.3-7" },
  tables: {
    classicType: { bands: [{ min: 1, max: 2, item: "Zq Kk", hop: "classic.kk" }, { min: 3, max: 4, item: "Zq Nn", hop: "classic.nn" }] },
    classic: {
      kk: [{ min: 1, max: 10, item: "Xx ten" }],
      nn: [{ min: 1, max: 6, item: "Xx six" }],
    },
    heroic: { rr: [{ min: 1, max: 20, item: "Xx twenty" }] },
    captions: { "classicType.bands": "Zq Kinds", "classic.kk": "Zq Kk", "classic.nn": "Zq Nn", "heroic.rr": "Zq Rr" },
    listCites: { "classicType.bands": "ZZ p.1", "classic.kk": "ZZ p.2; TT p.9" },
  },
});
resetTables();
eq("no document reads as null", readTables(), null);
eq("nothing imported refuses the roll", await rollMagicItem({ style: "classic" }), { ok: false, reason: "not-imported", start: null, steps: [], item: null, rolls: [] });

registerTable(world(), { priority: PRIORITY.WORLD });
const r = (...totals) => ({ roller: (expr) => ({ total: totals.shift(), sides: Number(expr.slice(2)) }) });

{
  const out = await rollMagicItem({ style: "classic", ...r(2, 7) });
  eq("a classic roll walks the type list then the category", [out.ok, out.start, out.steps.map((s) => s.list), out.item.text], [true, "classicType.bands", ["classicType.bands", "classic.kk"], "Xx ten"]);
  eq("a step carries its caption", out.steps.map((s) => s.caption), ["Zq Kinds", "Zq Kk"]);
  eq("a list's own cite is preferred to its table's", out.steps[0].cite, "ZZ p.1");
  eq("a list with several books' pages keeps them", out.steps[1].cite, "ZZ p.2; TT p.9");
  eq("neither is overridden", out.steps.map((s) => s.overridden), [false, false]);
}
{
  const out = await rollMagicItem({ style: "classic", category: "nn", ...r(3) });
  eq("a list with no listCites falls back to its table's cite", [out.steps[0].cite, out.steps[0].caption], ["ZZ p.2-8", "Zq Nn"]);
  eq("a named category is one step", [out.steps.length, out.item.text], [1, "Xx six"]);
}
{
  const out = await rollMagicItem({ style: "gritty", rarity: "rr", ...r(20) });
  eq("heroic and gritty are one step", [out.steps.length, out.item.text, out.steps[0].die], [1, "Xx twenty", "1d20"]);
  eq("a list with no caption read has a null one", describeList("heroic.zz").caption, null);
}
eq("a rarity is required", (await rollMagicItem({ style: "heroic" })).reason, "rarity-required");
eq("an unknown style is refused with nothing rolled", (await rollMagicItem({ style: "q", ...r(1) })).steps, []);
{
  const out = await rollMagicItem({ from: "classic.nope", ...r(1) });
  eq("a start that is not imported keeps the error", [out.ok, out.reason, out.error], [false, "not-imported", { code: "not-imported", list: "classic.nope" }]);
}
{
  const out = await rollMagicItem({ from: "classic.kk", roller: () => ({ total: 99, sides: 10 }) });
  eq("a roller out of range is refused", [out.ok, out.reason, out.start], [false, "roll-out-of-range", "classic.kk"]);
}
{
  const out = await rollMagicItem({ style: "classic", tables: {}, ...r(1) });
  eq("tables passed in override the registry", [out.ok, out.reason], [false, "not-imported"]);
}

/* --- an override has no page ------------------------------------------------------ */
registerTable({ id: MAGIC_ITEM_DOC, tables: { classic: { kk: [{ min: 1, max: 4, item: "Xx hand" }] } } }, { priority: PRIORITY.OVERRIDE });
{
  eq("a table a Judge overrode is overridden with no cite", describeList("classic.kk"), { caption: "Zq Kk", cite: null, overridden: true });
  eq("the table is the override's unit, so its other lists are too", describeList("classic.nn").overridden, true);
  eq("a table nobody overrode is not", [describeList("heroic.rr").overridden, describeList("heroic.rr").cite], [false, "ZZ p.3-7"]);
  const out = await rollMagicItem({ from: "classic.kk", ...r(3) });
  eq("the roll reads the override's bands", [out.steps[0].die, out.item.text, out.steps[0].overridden, out.steps[0].cite], ["1d4", "Xx hand", true, null]);
}

/* --- the lists a roll may start at -------------------------------------------------- */
unregisterTable(MAGIC_ITEM_DOC, { priority: PRIORITY.OVERRIDE });
{
  const s = starts();
  eq("classic categories are labelled by their captions", s.classic.map((e) => [e.id, e.caption]), [["classic.kk", "Zq Kk"], ["classic.nn", "Zq Nn"]]);
  eq("the rarity lists are listed", s.heroic.map((e) => e.id), ["heroic.rr"]);
  eq("the type list is offered when read", s.classicType.id, "classicType.bands");
  eq("nothing imported offers nothing", starts({}), { classicType: null, classic: [], heroic: [] });
}

/* --- the Foundry roller -------------------------------------------------------------- */
{
  globalThis.Roll = class { constructor(expr) { this.expr = expr; this.dice = [{ faces: Number(expr.slice(2)) }]; } async evaluate() { this.total = 3; return this; } };
  const rolls = [];
  const got = await foundryRoller(rolls)("1d12");
  eq("the sides are the first die's faces", [got.total, got.sides, rolls.length, got.roll === rolls[0]], [3, 12, 1, true]);
  const out = await rollMagicItem({ from: "heroic.rr" });
  eq("the default roller keeps the Rolls it made", [out.ok, out.rolls.length, out.rolls[0].expr], [true, 1, "1d20"]);
  delete globalThis.Roll;
}

/* --- an arm is typed on a setting's column ------------------------------------------------ */
{
  const armsTables = () => ({
    classic: {
      kk: [
        { min: 1, max: 4, item: "Zq tine +1", arms: { grid: "armsZz" } },
        { min: 5, max: 6, item: "Zq weapon +1", arms: { kind: "weaponKinds.bands" } },
        { min: 7, max: 8, item: "Zq shield +1", arms: { name: true } },
        { min: 9, max: 10, item: "Zq plain" },
      ],
    },
    weaponKinds: { bands: [{ min: 1, max: 5, item: "Zq A", arms: { grid: "armsZz" } }, { min: 6, max: 6, item: "Zq B" }] },
    armsZz: { s1: [{ min: 1, max: 3, type: "Zz tine" }, { min: 4, max: 6, type: "Zz prong" }], s2: [{ min: 1, max: 6, type: "Zz lance" }] },
  });
  const calls = [];
  const rigged = (...totals) => ({ roller: (expr) => { calls.push(expr); return { total: totals.shift(), sides: Number(expr.slice(2)) }; } });
  const roll = (totals, extra = {}) => { calls.length = 0; return rollMagicItem({ from: "classic.kk", tables: armsTables(), ...extra, ...rigged(...totals) }); };

  const grid = await roll([2, 5], { armsSetting: "s1" });
  eq("a grid row is typed on the setting's column", [grid.ok, grid.item.armsType, grid.item.arms, calls], [true, "Zz prong", { grid: "armsZz" }, ["1d10", "1d6"]]);
  eq("the type's roll is not a step, so the card and the deal read what they did", [grid.steps.length, grid.steps.map((s) => s.list)], [1, ["classic.kk"]]);
  eq("the item's fields stay the row's own", Object.keys(grid.item.fields), ["item"]);

  const kind = await roll([5, 3, 2], { armsSetting: "s2" });
  eq("a generic weapon row rolls the kind list, then the column of the grid it landed on", [kind.item.armsType, kind.item.arms, calls], ["Zz lance", { kind: "weaponKinds.bands" }, ["1d10", "1d6", "1d6"]]);

  const noSetting = await roll([2]);
  eq("without a setting nothing extra is rolled and the item carries its link only", [noSetting.item.armsType, noSetting.item.arms, calls], [undefined, { grid: "armsZz" }, ["1d10"]]);
  eq("a blank setting is no setting", [(await roll([2], { armsSetting: "" })).item.armsType, calls], [undefined, ["1d10"]]);

  const named = await roll([7], { armsSetting: "s1" });
  eq("a named arm rolls nothing and has no type", [named.item.armsType, named.item.arms, calls], [undefined, { name: true }, ["1d10"]]);
  const plain = await roll([9], { armsSetting: "s1" });
  eq("a row with no link has neither field", [plain.ok, "arms" in plain.item, "armsType" in plain.item, calls], [true, false, false, ["1d10"]]);

  const badKind = await roll([5, 6], { armsSetting: "s1" });
  eq("a kind that names no grid leaves the roll ok with no type", [badKind.ok, badKind.item.text, badKind.item.armsType], [true, "Zq weapon +1", undefined]);
  const badDie = await rollMagicItem({ from: "classic.kk", tables: armsTables(), armsSetting: "s1", roller: (expr) => ({ total: 2, sides: expr === "1d10" ? 10 : 20 }) });
  eq("a die that is not the one asked for leaves the roll ok with no type", [badDie.ok, badDie.item.text, badDie.item.armsType], [true, "Zq tine +1", undefined]);
  const noColumn = await roll([2, 1], { armsSetting: "s9" });
  eq("a setting the grid does not print leaves the roll ok with no type", [noColumn.ok, noColumn.item.armsType], [true, undefined]);
  const noGrids = armsTables();
  delete noGrids.armsZz;
  const lost = await rollMagicItem({ from: "classic.kk", tables: noGrids, armsSetting: "s1", ...rigged(2) });
  eq("a grid that is not imported leaves the roll ok with no type", [lost.ok, lost.item.armsType], [true, undefined]);

  globalThis.Roll = class { constructor(expr) { this.expr = expr; this.dice = [{ faces: Number(expr.slice(2)) }]; } async evaluate() { this.total = 2; return this; } };
  const real = await rollMagicItem({ from: "classic.kk", tables: armsTables(), armsSetting: "s1" });
  eq("the default roller keeps the type's Rolls after the chain's", [real.item.armsType, real.rolls.map((x) => x.expr)], ["Zz tine", ["1d10", "1d6"]]);
  delete globalThis.Roll;
}

/* --- the entry ----------------------------------------------------------------------- */
for (const fn of hooks.init) fn();
check("the roll is published under its contract name", services.get(MAGIC_ITEM_ROLL_CONTRACT)?.roll === rollMagicItem);
eq("the contract name is the documented one", MAGIC_ITEM_ROLL_CONTRACT, "magic-item-roll");
check("the api carries the roll and the starts", acksExtras.magicItems.roll === rollMagicItem && acksExtras.magicItems.starts === starts);
check("the api carries the entry point and the window", typeof acksExtras.magicItems.rollAndPost === "function" && typeof acksExtras.magicItems.openRoller === "function");
{
  const out = await services.get(MAGIC_ITEM_ROLL_CONTRACT).roll({ from: "heroic.rr", ...r(5) });
  eq("the contract roll is deterministic with a roller and keeps uuid null", [out.ok, out.item.text, out.item.uuid], [true, "Xx twenty", null]);
}
/* --- a linked row fills uuid through the cookbook-items contract ----------------------- */
eq("the provider contract name is the documented one", COOKBOOK_ITEMS_CONTRACT, "cookbook-items");
{
  const linked = { classic: { kk: [{ min: 1, max: 5, item: "Xx linked", ref: "zz.item1" }, { min: 6, max: 10, item: "Xx loose", ref: null }] } };
  const asked = [];
  const roll5 = (extra = {}) => rollMagicItem({ from: "classic.kk", tables: linked, ...r(extra.total ?? 2) });
  const none = await roll5();
  eq("with no provider the uuid stays null and the ref is kept", [none.item.ref, none.item.uuid], ["zz.item1", null]);
  eq("the ref is not one of the item's fields", Object.keys(none.item.fields), ["item"]);

  services.register(COOKBOOK_ITEMS_CONTRACT, { documentOf: async (id) => { asked.push(id); return id === "zz.item1" ? { uuid: "Item.abc123" } : null; } });
  const got = await roll5();
  eq("an injected provider fills the uuid of a linked row", [got.item.ref, got.item.uuid, asked], ["zz.item1", "Item.abc123", ["zz.item1"]]);
  const loose = await roll5({ total: 8 });
  eq("a row with no ref asks nothing and keeps a null uuid", [loose.item.ref, loose.item.uuid, asked.length], [null, null, 1]);

  services.register(COOKBOOK_ITEMS_CONTRACT, { documentOf: async () => null });
  eq("a ref the provider has no document for leaves the uuid null", (await roll5()).item.uuid, null);
  services.register(COOKBOOK_ITEMS_CONTRACT, { documentOf: async () => { throw new Error("gone"); } });
  eq("a provider that throws leaves the uuid null and the roll ok", [(await roll5()).ok, (await roll5()).item.uuid], [true, null]);
  eq("a provider with no documentOf is ignored", (services.register(COOKBOOK_ITEMS_CONTRACT, {}), (await roll5()).item.uuid), null);
  services.register(COOKBOOK_ITEMS_CONTRACT, undefined);
}

for (const fn of hooks.setup) fn();
eq("the feature declares what it reads", expectedTables().find((e) => e.docId === MAGIC_ITEM_DOC)?.tableIds, ["classicType", "classic", "heroic", "captions"]);

console.log(`test-magic-item-roll: ${pass} checks passed.`);
