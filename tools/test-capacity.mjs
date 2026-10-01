/**
 * Pure-logic tests for lib's capacity primitive (Foundry-free; the rider path
 * needs a live uuid resolver and is exercised by the live gate instead).
 * Fixtures are plain objects shaped like documents: `documentName`, `type`,
 * `system`, `flags`, `items`, `getFlag`.
 *
 * Every rate a coin is weighed at here is this file's own invention: what a
 * coin weighs is a figure off a page, and none is stated in the repo.
 */
import assert from "node:assert/strict";
import { capacity6, load6, overCapacity, capacityStone, loadStone, RIDER_BODY6, borneWeight6, carriedWeight6 } from "../scripts/lib/capacity.mjs";
import {
  STONE, isCurrency, isGoods, isPhysical, hasStock, stackCountOf, perStoneOf, systemCoinsPerStone,
  weight6Of, sumWeight6, encumbering6, contentsWeight6,
} from "../scripts/lib/item-model.mjs";

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

/** A coin row: a bare count, and how many of it make a stone where it says. */
const coin = ({ id, qty, perStone, bank = 0, flags = {} }) => {
  const all = perStone === undefined ? flags : { ...flags, "acks-extras": { ...(flags["acks-extras"] ?? {}), gear: { perStone } } };
  return {
    documentName: "Item",
    id,
    type: "money",
    system: { coppervalue: 1, quantity: qty, quantitybank: bank },
    flags: all,
    getFlag: flagReader(all),
  };
};

const actor = ({ type, system = {}, flags = {}, items = [] }) => ({
  documentName: "Actor",
  type,
  system,
  flags,
  items,
  getFlag: flagReader(flags),
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

/* --- currency: a stack with one count, weighed by how many make a stone --- */
const purse = coin({ id: "p", qty: 80, perStone: 40 });
assert.equal(isCurrency(purse), true);
assert.equal(isPhysical(purse), false, "coin has no cost and no weight of its own");
assert.equal(isGoods(purse), true, "and is goods all the same");
assert.equal(stackCountOf(purse), 80, "coin's bare count answers through the same door as any stack");
assert.equal(stackCountOf(item({ id: "a", qty: 12 })), 12);
assert.equal(stackCountOf(item({ id: "w", type: "weapon" })), null, "what does not stack has no count");
assert.equal(hasStock(coin({ id: "e", qty: 0, perStone: 40 })), false, "an empty purse holds nothing");
assert.equal(perStoneOf(purse), 40);
assert.equal(perStoneOf(item({ id: "a", flags: { "acks-extras": { gear: { perStone: 40 } } } })), null,
  "only currency is weighed by the stone; everything else states what one weighs");
assert.equal(weight6Of(purse), 2 * STONE, "eighty at forty to the stone is two stone");
assert.equal(weight6Of(coin({ id: "h", qty: 10, perStone: 40 })), 1.5, "a part-stone is kept, never rounded away");
assert.equal(weight6Of(coin({ id: "b", qty: 5, perStone: 40, bank: 4000 })), 0.75, "a banked balance weighs nothing");
assert.equal(encumbering6(purse), 2 * STONE, "coin encumbers like anything else");

// Nothing says how many make a stone: the row declares none and no system is loaded.
const unweighed = coin({ id: "u", qty: 500 });
assert.equal(systemCoinsPerStone(), null, "no system, no rate");
assert.equal(perStoneOf(unweighed), null);
assert.equal(weight6Of(unweighed), 0, "a coin nothing weighs weighs nothing");
for (const bad of [0, -3, "", "many", null]) {
  assert.equal(perStoneOf(coin({ id: "x", qty: 1, perStone: bad })), null, `a declared rate of ${JSON.stringify(bad)} declares nothing`);
}
assert.equal(perStoneOf(coin({ id: "x", qty: 1, perStone: "12" })), 12, "a rate typed into a form field reads as its number");

// A purse in many rows weighs what one stack of the same coins would.
const rows = [coin({ id: "r1", qty: 13, perStone: 7 }), coin({ id: "r2", qty: 8, perStone: 7 })];
assert.equal(sumWeight6(rows), 18, "one division per rate: 21 coins at 7 to the stone is 3 stone exactly");
assert.equal(sumWeight6([...rows, coin({ id: "r3", qty: 6, perStone: 12 }), item({ id: "i", weight6: 2, qty: 3 })]), 18 + 3 + 6,
  "each rate is summed on its own, and goods add what each of them weighs");
assert.equal(sumWeight6([item({ id: "c", weight6: 6, subtype: "clothing" }), purse], encumbering6), 2 * STONE,
  "the per-item reading governs what is not currency");
assert.equal(sumWeight6(null), 0);

/* --- monster / mount ------------------------------------------------------ */
const mule = actor({
  type: "monster",
  flags: { "acks-extras": { extras: { load: { normal: 20, capacity: null } } } },
  items: [
    item({ id: "a", weight6: 6 }),               // 1 stone
    item({ id: "b", weight6: 1, qty: 12 }),      // 2 stone in sixths
    item({ id: "c", weight6: 6, subtype: "clothing" }), // clothing carries free
    item({ id: "d", weight6: 60, flags: { "acks-extras": { spoil: true } } }), // its own parts
    coin({ id: "m", qty: 80, perStone: 40 }),    // 2 stone of coin
  ],
});
assert.equal(capacity6(mule), 20 * 2 * STONE, "capacity falls back to twice normal load");
assert.equal(load6(mule), 6 + 12 + 2 * STONE, "items + coin; clothing and spoils excluded");
assert.equal(loadStone(mule), 5);
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

// Coin in a container loads it, split rows and part-stones included.
const chest = item({ id: "chest", weight6: 12, flags: { "acks-extras": { gear: { capacity: 2 } } } });
const inChest = (id, qty) => coin({ id, qty, perStone: 40, flags: { "acks-extras": { containedIn: "chest" } } });
const hoard = actor({ type: "character", system: { encumbrance: { max: 20, value6: 0 } }, items: [] });
hoard.items = [chest, inChest("h1", 30), inChest("h2", 30)];
chest.parent = hoard;
assert.equal(contentsWeight6(hoard, "chest"), 9, "sixty coins at forty to the stone is a stone and a half");
assert.equal(load6(chest), 9);
assert.equal(overCapacity(chest), false);
hoard.items.push(inChest("h3", 21));
assert.equal(overCapacity(chest), true, "one coin past two stone overfills a two-stone chest");

/* --- what is borne vs what is carried ------------------------------------- */
const walker = actor({
  type: "character",
  system: { encumbrance: { max: 20, value6: 12 } },
  items: [
    item({ id: "sw", weight6: 6, type: "weapon" }),                        // a stone in hand
    item({ id: "cl", weight6: 6, subtype: "clothing" }),                   // worn: weighs, is not charged
    item({ id: "fl", weight6: 1, qty: 3 }),                                // three flasks
    item({ id: "th", weight6: 1, type: "weapon", flags: { "acks-extras": { thrownAway: true } } }), // lying where it landed
    item({ id: "sp", weight6: 60, flags: { "acks-extras": { spoil: true } } }),                     // its own parts
    coin({ id: "co", qty: 40, perStone: 40 }),                             // a stone of coin
  ],
});
assert.equal(borneWeight6(walker), 6 + 3 + STONE, "borne: kit and coin; clothing free; a thrown weapon and a spoil are not on the body");
assert.equal(carriedWeight6(walker), 6 + 6 + 3 + STONE, "carried: everything on the body at what it weighs, clothing included");
assert.equal(carriedWeight6({ documentName: "Item" }), 0, "only an actor carries");

/* --- the system's own rate, read off its arithmetic ----------------------- */
// A stand-in for the system's actor class, counting coin at a rate of this
// file's own. The reader finds the smallest purse the system calls a stone.
let asked = 0;
globalThis.CONFIG = {
  Actor: {
    documentClass: class {
      getTotalMoneyEncumbrance() {
        asked++;
        let total = 0;
        this.items.forEach((i) => {
          if (i.type === "money") total += i.system.quantity;
        });
        return { stone: Math.floor(total / 37), item: 0 };
      }
    },
  },
};
assert.equal(systemCoinsPerStone(), 37, "the smallest purse the system calls a stone");
const probes = asked;
assert.equal(systemCoinsPerStone(), 37);
assert.equal(asked, probes, "read once, then remembered");
assert.equal(perStoneOf(unweighed), 37, "a coin that declares no rate weighs what the system weighs coin at");
assert.equal(weight6Of(coin({ id: "s", qty: 74 })), 2 * STONE);
assert.equal(perStoneOf(purse), 40, "the coin's own declaration outranks the system's rate");
assert.equal(sumWeight6([coin({ id: "s1", qty: 37 }), coin({ id: "s2", qty: 40, perStone: 40 })]), 2 * STONE,
  "two rates in one purse are each divided by their own");
delete globalThis.CONFIG;

/* --- rider constant ------------------------------------------------------- */
assert.equal(RIDER_BODY6, 15 * STONE, "RR prices the adventurer at 15 stone");

console.log("test-capacity: OK (character, currency, monster, container, system rate, constants)");
