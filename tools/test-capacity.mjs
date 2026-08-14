/**
 * Pure-logic tests for lib's capacity primitive (Foundry-free; the rider path
 * needs a live uuid resolver and is exercised by the live gate instead).
 * Fixtures are plain objects shaped like documents: `documentName`, `type`,
 * `system`, `flags`, `items`, `getFlag`.
 */
import assert from "node:assert/strict";
import { capacity6, load6, overCapacity, capacityStone, loadStone, RIDER_BODY6 } from "../scripts/lib/capacity.mjs";
import { STONE } from "../scripts/lib/item-model.mjs";

const flagReader = (flags) => function (scope, key) {
  return flags?.[scope]?.[key];
};

const item = ({ id, weight6 = 0, qty, type = "item", subtype, flags = {} }) => ({
  documentName: "Item",
  id,
  type,
  system: { cost: 0, weight6, ...(qty !== undefined ? { quantity: { value: qty } } : {}), ...(subtype ? { subtype } : {}) },
  flags,
  getFlag: flagReader(flags),
});

const actor = ({ type, system = {}, flags = {}, items = [], money = null }) => ({
  documentName: "Actor",
  type,
  system,
  flags,
  items,
  getFlag: flagReader(flags),
  getTotalMoneyEncumbrance: money === null ? undefined : () => money,
});

/* --- character: core's resolved maximum IS the capacity ------------------- */
const pc = actor({ type: "character", system: { encumbrance: { max: 23, value6: 47, value: 8 } } });
assert.equal(capacity6(pc), 23 * STONE, "character capacity = core max (forcemax already resolved) in sixths");
assert.equal(load6(pc), 47, "character load prefers exact value6");
assert.equal(capacityStone(pc), 23);
assert.equal(overCapacity(pc), false);

const pcNoV6 = actor({ type: "character", system: { encumbrance: { max: 5, value: 8 } } });
assert.equal(load6(pcNoV6), 48, "value falls back to stone*6");
assert.equal(overCapacity(pcNoV6), true, "8 st carried over a forced max of 5 is over");

/* --- monster / mount ------------------------------------------------------ */
const mule = actor({
  type: "monster",
  flags: { "acks-extras": { extras: { load: { normal: 20, capacity: null } } } },
  items: [
    item({ id: "a", weight6: 6 }),               // 1 stone
    item({ id: "b", weight6: 1, qty: 12 }),      // 2 stone in sixths
    item({ id: "c", weight6: 6, subtype: "clothing" }), // clothing carries free
    item({ id: "d", weight6: 60, flags: { "acks-extras": { spoil: true } } }), // its own parts
  ],
  money: { stone: 2 },
});
assert.equal(capacity6(mule), 20 * 2 * STONE, "capacity falls back to twice normal load");
assert.equal(load6(mule), 6 + 12 + 2 * STONE, "items + coin; clothing and spoils excluded");
assert.equal(overCapacity(mule), false);

const declared = actor({ type: "monster", flags: { "acks-extras": { extras: { load: { normal: 20, capacity: 30 } } } } });
assert.equal(capacity6(declared), 30 * STONE, "declared capacity outranks the doubling");

const unstated = actor({ type: "monster", flags: {} });
assert.equal(capacity6(unstated), null, "no load spec = unstated");
assert.equal(overCapacity(unstated), false, "unstated never warns");

/* --- container item ------------------------------------------------------- */
const pack = item({ id: "pack", weight6: 6, flags: { "acks-extras": { gear: { capacity: 4 } } } });
const inPack = (id, weight6, qty) => item({ id, weight6, qty, flags: { "acks-extras": { containedIn: "pack" } } });
const carrier = actor({ type: "character", system: { encumbrance: { max: 20, value6: 0 } }, items: [] });
const contents = [inPack("x", 6), inPack("y", 6, 3)];
carrier.items = [pack, ...contents];
pack.parent = carrier;
assert.equal(capacity6(pack), 4 * STONE, "container capacity from declared gear capacity");
assert.equal(load6(pack), 6 + 18, "container load sums its contents");
assert.equal(overCapacity(pack), false);
carrier.items.push(inPack("z", 6, 1));
assert.equal(overCapacity(pack), true, "a fifth stone overfills a 4-stone pack");

/* --- rider constant ------------------------------------------------------- */
assert.equal(RIDER_BODY6, 15 * STONE, "RR prices the adventurer at 15 stone");

console.log("test-capacity: OK (character, monster, container, constants)");
