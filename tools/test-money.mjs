/**
 * Pure-logic tests for the coin planner (Foundry-free; transferCoin's document
 * writes and the reach gate are live-gate territory).
 */
import assert from "node:assert/strict";
import {
  coinKind, coinKindKey, coinCount, coinRate, coinTotalCp, coinTotalGC, coinSlots,
  planCoinSpend, planCoinPayUpTo, planChange, convertCp,
  LOOSE_STORE, containerStoreKey, placeStoreKey, readStoreKey, coinOrderOf,
} from "../scripts/lib/money-logic.mjs";

const coin = (id, name, cv, qty, bank = 0) => ({
  _id: id, type: "money", name,
  system: { coppervalue: cv, quantity: qty, quantitybank: bank },
});

/* --- kind identity: name AND rate ----------------------------------------- */
assert.equal(coinKind(coin("a", "Gold", 100, 1)), "gold|100");
assert.equal(coinKindKey("  GOLD ", 100), "gold|100", "a kind folds case and the space around a name");
assert.notEqual(coinKind(coin("a", "Gold, debased", 100, 1)), coinKind(coin("b", "Gold", 100, 1)),
  "a local variation is a separate kind at the same rate");
assert.notEqual(coinKind(coin("a", "Gold", 100, 1)), coinKind(coin("b", "Gold", 90, 1)),
  "the same name at another rate is another kind");

/* --- one count per row ---------------------------------------------------- */
const split = coin("g", "Gold", 100, 1, 9);
assert.equal(coinCount(split), 1, "a row's count is its quantity");
assert.equal(coinCount(coin("n", "Gold", 100, -4)), 0, "and never below nothing");
assert.equal(coinRate(split), 100);
assert.equal(coinRate({ type: "money", system: {} }), 1, "a row that states no rate is worth one copper each");
assert.equal(coinTotalCp([split]), 100, "the banked field is not coin anybody holds");
assert.equal(coinTotalGC([split, coin("s", "Silver", 10, 5)]), 1.5);
assert.equal(coinTotalCp([split, { _id: "x", type: "item", system: { quantity: { value: 40 } } }]), 100,
  "what is not coin counts for nothing");
assert.deepEqual(coinSlots([split]), [{ id: "g", cv: 100, qty: 1, kind: "gold|100", name: "Gold" }],
  "a slot is a row, never one field of it");
assert.equal(coinSlots([coin("z", "Token", 0, 5)]).length, 0, "a coin worth nothing is not spendable");

/* --- smallest-first with change ------------------------------------------- */
const purse = coinSlots([coin("c", "Copper", 1, 30), coin("s", "Silver", 10, 4), coin("g", "Gold", 100, 3)]);
let plan = planCoinSpend(purse, 250);
// copper 30 + silver 40 = 70, then gold covers the remaining 180: 2 gold = 200.
assert.deepEqual(plan.takes.map((t) => [t.id, t.take]), [["c", 30], ["s", 4], ["g", 2]], "smallest denominations spend first");
assert.equal(plan.changeCp, 20, "the broken gold owes 20 copper back");
assert.equal(plan.shortfallCp, 0);

plan = planCoinSpend(coinSlots([coin("g", "Gold", 100, 1)]), 250);
assert.equal(plan.shortfallCp, 150, "a short purse reports the gap");
assert.equal(plan.takes.length, 0, "and plans nothing");

plan = planCoinSpend(coinSlots([coin("c", "Copper", 1, 50)]), 50);
assert.equal(plan.changeCp, 0, "exact payment owes nothing");

/* --- a banked balance covers nothing -------------------------------------- */
plan = planCoinSpend(coinSlots([split]), 200);
assert.equal(plan.shortfallCp, 100, "one carried coin against a debt of two is short by one, whatever is banked");
plan = planCoinSpend(coinSlots([split]), 100);
assert.deepEqual(plan.takes, [{ id: "g", cv: 100, take: 1 }], "a take names the row and how many leave it");

/* --- pay only what is exactly representable ------------------------------- */
let upTo = planCoinPayUpTo(coinSlots([coin("s", "Silver", 10, 3), coin("g", "Gold", 100, 2)]), 250);
assert.deepEqual(upTo.takes.map((t) => [t.id, t.take]), [["s", 3], ["g", 2]]);
assert.equal(upTo.paidCp, 230);
assert.equal(upTo.shortCp, 20, "what no coin represents is left for the caller to book");
upTo = planCoinPayUpTo(coinSlots([coin("g", "Gold", 100, 5)]), 50);
assert.deepEqual([upTo.takes.length, upTo.paidCp, upTo.shortCp], [0, 0, 50], "no coin is broken to pay less than it is worth");
// Small coin taken first can strand what a larger coin would have paid whole.
upTo = planCoinPayUpTo(coinSlots([coin("c", "Copper", 1, 5), coin("s", "Silver", 10, 1)]), 10);
assert.deepEqual([upTo.takes.map((t) => [t.id, t.take]), upTo.paidCp, upTo.shortCp], [[["s", 1]], 10, 0],
  "the pick that pays more is the plan");
upTo = planCoinPayUpTo(coinSlots([coin("c", "Copper", 1, 3), coin("s", "Silver", 10, 1), coin("e", "Electrum", 50, 1)]), 53);
assert.deepEqual([upTo.takes.map((t) => [t.id, t.take]), upTo.shortCp], [[["e", 1], ["c", 3]], 0]);
upTo = planCoinPayUpTo(coinSlots([coin("c", "Copper", 1, 10), coin("s", "Silver", 10, 1)]), 10);
assert.deepEqual(upTo.takes.map((t) => [t.id, t.take]), [["c", 10]], "where the small coin pays it all, the small coin goes");

/* --- a store's rank comes before a coin's size ---------------------------- */
// The rates in this block are this file's own; none is a coin anybody mints.
const ranked = (id, cv, qty, rank) => ({ id, cv, qty, rank });
plan = planCoinSpend([ranked("looseGold", 100, 2, 1), ranked("packedSilver", 10, 30, 0), ranked("looseCopper", 1, 40, 1)], 250);
assert.deepEqual(plan.takes.map((t) => [t.id, t.take]), [["packedSilver", 25]], "the store named first pays before a smaller coin kept elsewhere");
plan = planCoinSpend([ranked("far", 1, 500, 2), ranked("near", 100, 1, 0), ranked("mid", 10, 3, 1)], 125);
assert.deepEqual(plan.takes.map((t) => [t.id, t.take]), [["near", 1], ["mid", 3]], "each store is emptied of what it can pay before the next is opened");
assert.equal(plan.changeCp, 5, "and the last coin taken may overshoot, whichever store it came from");
plan = planCoinSpend([ranked("a", 100, 1, 1), ranked("b", 100, 1, 0)], 300);
assert.equal(plan.shortfallCp, 100, "what a purse can cover does not depend on the order");
assert.deepEqual(planCoinSpend([{ id: "s", cv: 10, qty: 4 }, ranked("g", 100, 1, 0)], 30).takes.map((t) => t.id), ["s"],
  "a slot that states no rank shares the first, where the smaller coin goes first");

upTo = planCoinPayUpTo([ranked("near", 6, 1, 0), ranked("far", 4, 3, 1)], 12);
assert.deepEqual([upTo.takes.map((t) => [t.id, t.take]), upTo.paidCp, upTo.shortCp], [[["far", 3]], 12, 0],
  "where the stores taken in order strand a remainder, smallest first across all of them is weighed against it");
upTo = planCoinPayUpTo([ranked("near", 1, 5, 0), ranked("far", 10, 1, 1)], 10);
assert.deepEqual(upTo.takes.map((t) => [t.id, t.take]), [["far", 1]], "and so is largest first");
upTo = planCoinPayUpTo([ranked("near", 10, 2, 0), ranked("far", 10, 2, 1)], 30);
assert.deepEqual(upTo.takes.map((t) => [t.id, t.take]), [["near", 2], ["far", 1]], "the pick in order stands wherever it pays as much");

/* --- naming a store ------------------------------------------------------- */
assert.equal(LOOSE_STORE, "");
assert.deepEqual(readStoreKey(containerStoreKey("abc")), { kind: "container", id: "abc" });
assert.deepEqual(readStoreKey(placeStoreKey("Actor.xyz")), { kind: "place", uuid: "Actor.xyz" });
for (const nothing of ["", "item:", "place:", "elsewhere", null, undefined, 7]) {
  assert.deepEqual(readStoreKey(nothing), { kind: "loose" }, `${JSON.stringify(nothing)} names coin carried loose`);
}
assert.deepEqual(coinOrderOf({ flags: { "acks-extras": { coinOrder: { payFrom: "item:a", receiveInto: "place:Actor.b" } } } }),
  { payFrom: "item:a", receiveInto: "place:Actor.b" });
assert.deepEqual(coinOrderOf({ flags: { "acks-extras": { coinOrder: { payFrom: 3 } } } }), { payFrom: "", receiveInto: "" },
  "a half that is not stated, or not a key, is coin carried loose");
assert.deepEqual(coinOrderOf(null), { payFrom: "", receiveInto: "" });

/* --- change, largest first ------------------------------------------------ */
const kinds = [{ kind: "gold|100", cv: 100 }, { kind: "silver|10", cv: 10 }, { kind: "copper|1", cv: 1 }];
const change = planChange(kinds, 234);
assert.deepEqual(change.credits.map((c) => [c.cv, c.count]), [[100, 2], [10, 3], [1, 4]]);
assert.equal(change.remainderCp, 0);
assert.equal(planChange(kinds.slice(0, 2), 5).remainderCp, 5, "below the smallest kind is unrepresentable");

// A kind that states a count is a stack somebody holds: it gives no more than it has.
const held = [{ kind: "gold", cv: 100, qty: 1 }, { kind: "silver", cv: 10, qty: 5 }, { kind: "copper", cv: 1, qty: 30 }];
const exact = planChange(held, 164);
assert.deepEqual(exact.credits.map((c) => [c.kind, c.count]), [["gold", 1], ["silver", 5], ["copper", 14]]);
assert.equal(exact.remainderCp, 0);
const short = planChange(held.slice(0, 2), 70);
assert.deepEqual(short.credits.map((c) => [c.kind, c.count]), [["silver", 5]], "change is never rounded up with a larger coin");
assert.equal(short.remainderCp, 20, "what five silver cannot make of seventy");
assert.deepEqual(planChange([{ kind: "a", cv: 10, qty: 2 }, { kind: "b", cv: 10, qty: 9 }], 50).credits.map((c) => [c.kind, c.count]),
  [["a", 2], ["b", 3]], "among stacks of one rate the earlier is drawn on first");
assert.deepEqual(planChange([{ kind: "empty", cv: 10, qty: 0 }], 30), { credits: [], remainderCp: 30 }, "an empty stack gives nothing");

/* --- exchange terms ------------------------------------------------------- */
assert.equal(convertCp(250, { mode: "market" }), 250, "a market converts at face value");
assert.equal(convertCp(250, { mode: "none" }), null, "no changer refuses");
assert.equal(convertCp(250, null), null);

console.log("test-money: OK (kind identity, one count per row, ranked smallest-first planner, exact pay, store keys, change, terms)");
