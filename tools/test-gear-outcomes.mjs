/**
 * The pure outcome of a swig (`monsters/gear-outcomes.mjs`): the bearer's own
 * kind heals, a human or demi-human owes a save and then heals or takes the
 * condition for one turn, an unknown kind is the Judge's, and a figure the row
 * left blank is null and never replaced. Foundry-free; every figure and word
 * below is invented.
 * Run: node tools/test-gear-outcomes.mjs
 */
import assert from "node:assert/strict";
import { DRINKER_KIND, swigOutcome } from "../scripts/monsters/gear-outcomes.mjs";
import { readTurnLife } from "../scripts/lib/turn-life.mjs";

let pass = 0;
const eq = (label, a, b) => {
  assert.deepEqual(a, b, label);
  pass++;
};

const drink = { healDice: "2d4", saveKind: "sk", condition: "cn", successHealDice: "1d3", swigDice: "1d4" };

eq("the bearer's kind heals the full dice", swigOutcome({ drinkerKind: DRINKER_KIND.bearer, drink }), { kind: "heal", dice: "2d4" });
eq("the bearer's kind owes no save even when a result is passed", swigOutcome({ drinkerKind: DRINKER_KIND.bearer, drink, saved: false }), { kind: "heal", dice: "2d4" });
eq("a human with no result owes the save the row names", swigOutcome({ drinkerKind: DRINKER_KIND.human, drink }), { kind: "save", saveKind: "sk" });
eq("a result that is neither true nor false is no result", swigOutcome({ drinkerKind: DRINKER_KIND.human, drink, saved: null }), { kind: "save", saveKind: "sk" });
eq("a save made heals the success dice", swigOutcome({ drinkerKind: DRINKER_KIND.human, drink, saved: true }), { kind: "heal", dice: "1d3" });
eq("a save failed is the condition, lasting to the end of the bearer's next turn", swigOutcome({ drinkerKind: DRINKER_KIND.human, drink, saved: false }), { kind: "condition", condition: "cn", life: { edge: "end", count: 1 } });
eq("an unknown kind is null, for the Judge", swigOutcome({ drinkerKind: "other", drink, saved: true }), null);
eq("no kind is null", swigOutcome({ drink }), null);
eq("no drink is null", swigOutcome({ drinkerKind: DRINKER_KIND.bearer }), null);
eq("nothing is null", swigOutcome(), null);

const blank = { healDice: "2d4" };
eq("a blank save kind is null, not a default", swigOutcome({ drinkerKind: DRINKER_KIND.human, drink: blank }), { kind: "save", saveKind: null });
eq("blank success dice are null", swigOutcome({ drinkerKind: DRINKER_KIND.human, drink: blank, saved: true }), { kind: "heal", dice: null });
eq("a blank condition is null", swigOutcome({ drinkerKind: DRINKER_KIND.human, drink: blank, saved: false }).condition, null);
eq("blank healing dice are null", swigOutcome({ drinkerKind: DRINKER_KIND.bearer, drink: { condition: "cn" } }), { kind: "heal", dice: null });

const life = swigOutcome({ drinkerKind: DRINKER_KIND.human, drink, saved: false }).life;
eq("the life record, with a fight and a combatant added, reads as a turn-life record", readTurnLife({ ...life, combatId: "c", combatantId: "t" }), { combatId: "c", combatantId: "t", edge: "end", count: 1, seen: 0 });
life.count = 9;
eq("each outcome carries its own copy of the life record", swigOutcome({ drinkerKind: DRINKER_KIND.human, drink, saved: false }).life.count, 1);

console.log(`test-gear-outcomes: ${pass} checks passed.`);
