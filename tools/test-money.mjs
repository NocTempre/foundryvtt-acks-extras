/**
 * Pure-logic tests for the coin planner (Foundry-free; transferCoin's document
 * writes and the reach gate are live-gate territory).
 */
import assert from "node:assert/strict";
import { coinKind, coinSlots, planCoinSpend, planChange, convertCp } from "../scripts/lib/money-logic.mjs";

const coin = (id, name, cv, qty, bank = 0) => ({
  _id: id, type: "money", name,
  system: { coppervalue: cv, quantity: qty, quantitybank: bank },
});

/* --- kind identity: name AND rate ----------------------------------------- */
assert.equal(coinKind(coin("a", "Gold", 100, 1)), "gold|100");
assert.notEqual(coinKind(coin("a", "Gold, debased", 100, 1)), coinKind(coin("b", "Gold", 100, 1)),
  "a local variation is a separate kind at the same rate");

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

/* --- carried spends before banked at equal value -------------------------- */
plan = planCoinSpend(coinSlots([coin("g", "Gold", 100, 1, 1)]), 100);
assert.deepEqual(plan.takes.map((t) => [t.field, t.take]), [["quantity", 1]], "carried before banked");

/* --- change, largest first ------------------------------------------------ */
const kinds = [{ kind: "gold|100", cv: 100 }, { kind: "silver|10", cv: 10 }, { kind: "copper|1", cv: 1 }];
const change = planChange(kinds, 234);
assert.deepEqual(change.credits.map((c) => [c.cv, c.count]), [[100, 2], [10, 3], [1, 4]]);
assert.equal(change.remainderCp, 0);
assert.equal(planChange(kinds.slice(0, 2), 5).remainderCp, 5, "below the smallest kind is unrepresentable");

/* --- exchange terms ------------------------------------------------------- */
assert.equal(convertCp(250, { mode: "market" }), 250, "a market converts at face value");
assert.equal(convertCp(250, { mode: "none" }), null, "no changer refuses");
assert.equal(convertCp(250, null), null);

console.log("test-money: OK (kind identity, smallest-first planner, change, terms)");
