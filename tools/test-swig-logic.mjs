/**
 * The pure half of a swig (`lib/swig-logic.mjs`): the bearer's own
 * kind heals, a human or demi-human owes a save and then heals or takes the
 * condition for one turn, an unknown kind is the Judge's, and a figure the row
 * left blank is null and never replaced; who drinks is read off an actor's
 * kinds, and a consume item landing on an actor is stamped and, on a hand-on,
 * counted. Foundry-free; every figure and word below is invented.
 * Run: node tools/test-swig-logic.mjs
 */
import assert from "node:assert/strict";
import { DRINKER_KIND, drinkerKindOf, swigOutcome, swigStampPlan } from "../scripts/lib/swig-logic.mjs";
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

eq("the bearer's own kind drinks as the bearer", drinkerKindOf(new Set(["kx", "other"]), "kx"), "bearer");
eq("a human drinks as a human", drinkerKindOf(new Set(["human"]), "kx"), "human");
eq("a demi-human drinks as a human", drinkerKindOf(new Set(["demi-human"]), "kx"), "human");
eq("a kind that is neither is unknown", drinkerKindOf(new Set(["other"]), "kx"), null);
eq("an empty set is unknown", drinkerKindOf(new Set(), "kx"), null);
eq("no kinds at all is unknown", drinkerKindOf(null, "kx"), null);
eq("a blank own kind never makes a bearer", drinkerKindOf(new Set(["", "human"]), ""), "human");
eq("a missing own kind never makes a bearer", drinkerKindOf(new Set(["kx"]), undefined), null);
eq("a blank own kind with nothing else is unknown", drinkerKindOf(new Set([""]), "  "), null);
eq("the bearer's kind outranks human", drinkerKindOf(new Set(["human", "kx"]), "kx"), "bearer");
eq("a human set with an own kind it does not hold is a human", drinkerKindOf(new Set(["human"]), "ky"), "human");

eq("an item's first bearer is stamped and not counted", swigStampPlan({ bearerUuid: "", left: null, actorUuid: "Actor.a" }), { stamp: true, roll: false });
eq("no bearer stored is the first bearer", swigStampPlan({ left: null, actorUuid: "Actor.a" }), { stamp: true, roll: false });
eq("the same actor again is neither", swigStampPlan({ bearerUuid: "Actor.a", left: null, actorUuid: "Actor.a" }), { stamp: false, roll: false });
eq("a hand-on with no count is stamped and counted", swigStampPlan({ bearerUuid: "Actor.a", left: null, actorUuid: "Actor.b" }), { stamp: true, roll: true });
eq("a hand-on with an unset count is counted", swigStampPlan({ bearerUuid: "Actor.a", actorUuid: "Actor.b" }), { stamp: true, roll: true });
eq("a hand-on with a count keeps it", swigStampPlan({ bearerUuid: "Actor.a", left: 3, actorUuid: "Actor.b" }), { stamp: true, roll: false });
eq("a hand-on with a count spent to 0 keeps it", swigStampPlan({ bearerUuid: "Actor.a", left: 0, actorUuid: "Actor.b" }), { stamp: true, roll: false });
eq("a blank actor is neither", swigStampPlan({ bearerUuid: "Actor.a", left: null, actorUuid: "" }), { stamp: false, roll: false });
eq("no actor is neither", swigStampPlan({ bearerUuid: "", left: null }), { stamp: false, roll: false });
eq("nothing is neither", swigStampPlan(), { stamp: false, roll: false });

console.log(`test-swig-logic: ${pass} checks passed.`);
