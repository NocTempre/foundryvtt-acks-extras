/**
 * A weapon with no damage formula stays blank (scripts/equipment/damage-blank.mjs,
 * the named and scavenged overlays).
 *
 * What this pins: no layer writes an invented die over a blank formula; a
 * blank weapon is told apart from one that has a formula; an answer is kept
 * only when the roller's own check accepts it; and saving the answer becomes
 * the captured base of every layer that captured a blank, so the layers apply
 * over it once. The prompt itself and the save through Foundry are the live
 * recipe's (docs/equipment/TESTING.md, "A weapon with no damage formula").
 */
import assert from "node:assert/strict";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok   " + name); };

const { needsDamageFormula, damageAnswer, savedFormulaUpdates, DAMAGE_FIELD } = await import("../scripts/equipment/damage-blank.mjs");
const N = await import("../scripts/equipment/overlays/named.mjs");
const S = await import("../scripts/equipment/overlays/scavenged.mjs");

/** A weapon stand-in: `flags` are read through `getFlag` as Foundry's are. */
const weapon = (formula, flags = {}) => ({
  type: "weapon",
  system: { damage: { base: { formula } }, bonus: { attack: 0 }, weight6: 6 },
  getFlag: (_m, k) => flags[k],
});

ok("a blank or absent formula needs one; a stated one does not", () => {
  assert.equal(needsDamageFormula(weapon("")), true);
  assert.equal(needsDamageFormula(weapon("  ")), true);
  assert.equal(needsDamageFormula({ type: "weapon", system: {} }), true);
  assert.equal(needsDamageFormula(weapon("1d8")), false);
  assert.equal(needsDamageFormula({ type: "armor", system: {} }), false);
  assert.equal(needsDamageFormula(null), false);
});

ok("a flat figure a layer left over a blank snapshot still needs a formula", () => {
  assert.equal(needsDamageFormula(weapon("-1", { pristine: { damage: "" } })), true);
  assert.equal(needsDamageFormula(weapon("-1")), false, "with no blank snapshot a flat figure is the weapon's own");
  assert.equal(needsDamageFormula(weapon("1d6 - 1", { pristine: { damage: "1d6" } })), false);
});

ok("an answer is kept only when the roller accepts it", () => {
  const validate = (f) => /^\d*d\d+([+-]\d+)?$/.test(f.replace(/\s/g, ""));
  assert.equal(damageAnswer(" 1d8+1 ", validate), "1d8+1");
  assert.equal(damageAnswer("", validate), null);
  assert.equal(damageAnswer("sword", validate), null);
  assert.equal(damageAnswer("1d8", () => { throw new Error("parse"); }), null);
});

ok("saving onto a plain weapon writes the formula alone", () => {
  const { update, layers } = savedFormulaUpdates(weapon(""), "1d8");
  assert.deepEqual(update, { [DAMAGE_FIELD]: "1d8" });
  assert.deepEqual(layers, { pristine: false, named: false });
});

ok("saving onto a layered blank fills each blank captured base", () => {
  const w = weapon("", { pristine: { damage: "", bonus: 0 }, named: { base: { bonus: 0, damage: "" }, ladder: ["damage"], unlocked: 1 } });
  const { update, layers } = savedFormulaUpdates(w, "1d8");
  assert.equal(update[DAMAGE_FIELD], "1d8");
  assert.equal(update["flags.acks-extras.pristine.damage"], "1d8");
  assert.equal(update["flags.acks-extras.named.base.damage"], "1d8");
  assert.deepEqual(layers, { pristine: true, named: true });
  const kept = savedFormulaUpdates(weapon("", { pristine: { damage: "1d6" } }), "1d8");
  assert.equal("flags.acks-extras.pristine.damage" in kept.update, false, "a stated snapshot is not overwritten");
});

const namedRec = (base, unlocked = 1) => ({ trueName: "T", ladder: ["damage", "hit"], unlocked, revealed: false, guesses: {}, base });

ok("a named weapon with no formula captures a blank base, not a die", () => {
  assert.equal(N.captureBase(weapon("")).damage, "");
});

ok("an unlocked damage bonus over a blank base writes nothing to the damage field", () => {
  const w = weapon("", { named: namedRec({ bonus: 0, damage: "", weight6: 6 }) });
  const u = N.applyUpdates(w);
  assert.equal(DAMAGE_FIELD in u, false);
  assert.equal(u["system.bonus.attack"], 0);
});

ok("once the formula is saved, the bonus layers over it once and the base is re-captured", () => {
  const rec = namedRec({ bonus: 0, damage: "", weight6: 6 }, 2);
  const w = weapon("1d8", { named: rec });
  const u = N.applyUpdates(w);
  assert.equal(u[DAMAGE_FIELD], "1d8+1");
  assert.equal(u["system.bonus.attack"], 1);
  assert.equal(u["flags.acks-extras.named.base.damage"], "1d8");
  // The write lands: the stored base now holds the formula, the field the layered one.
  const after = weapon("1d8+1", { named: { ...rec, base: { ...rec.base, damage: "1d8" } } });
  const again = N.applyUpdates(after);
  assert.equal(again[DAMAGE_FIELD], "1d8+1", "a second application does not compound");
  assert.equal("flags.acks-extras.named.base.damage" in again, false);
});

ok("a level-up over a blank base advances the rung and writes no die", () => {
  const w = { ...weapon("", { named: namedRec({ bonus: 0, damage: "", weight6: 6 }, 0) }), system: { damage: { base: { formula: "" } }, bonus: { attack: 0 }, weight6: 6, equipped: true } };
  const [adv] = N.advanceWieldedOnLevelUp({ items: [w] }, 1);
  assert.equal(adv.updates["flags.acks-extras.named.unlocked"], 1);
  assert.equal(DAMAGE_FIELD in adv.updates, false);
});

ok("a scavenged damage penalty over a blank formula writes no die", () => {
  const cond = { attack: 0, damage: -1, ac: 0, encumbrance: 0, labels: [], breaks: false, cannotSneak: false, initiative: 0, valueMultiplier: 1 };
  assert.equal(DAMAGE_FIELD in S.toItemUpdates(weapon(""), cond), false);
  assert.equal(S.toItemUpdates(weapon("1d6"), cond)[DAMAGE_FIELD], "1d6-1");
});

console.log(`\n${passed} passed`);
