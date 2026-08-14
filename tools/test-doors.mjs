/**
 * The bash throw as the book prints it (RR ch. 6). Pure arithmetic — the dice
 * and the wall document are live-gate territory.
 */
import assert from "node:assert/strict";
import { bashPlan, BASH_TARGET, MAX_SPIKES } from "../scripts/formation/doors.mjs";

/* --- the book's own worked example --------------------------------------- */
// "A character with Strength 18 thus opens doors with a throw of 6+."
let p = bashPlan({ strMod: 3 });
assert.equal(p.target, BASH_TARGET);
assert.equal(p.modifier, 12, "±4 per point of Strength adjustment");
assert.equal(p.target - p.modifier, 6, "Strength 18 opens doors on a 6+");

/* --- a pair heaves with the stronger adjustment, plus four --------------- */
p = bashPlan({ strMod: 1, pair: true });
assert.equal(p.modifier, 8, "4 from Strength, 4 for the pair");

/* --- the crowbar, and size ---------------------------------------------- */
assert.equal(bashPlan({ crowbar: true }).modifier, 2);
assert.equal(bashPlan({ sizeSteps: 1 }).modifier, 8, "+8 per size above man-sized");
assert.equal(bashPlan({ sizeSteps: -1 }).modifier, -8, "and -8 per size below");

/* --- spikes: the FIRST is free, each one after costs four ---------------- */
assert.equal(bashPlan({ spikes: 0 }).modifier, 0);
assert.equal(bashPlan({ spikes: 1 }).modifier, 0, "one spike imposes no penalty");
assert.equal(bashPlan({ spikes: 2 }).modifier, -4);
assert.equal(bashPlan({ spikes: 3 }).modifier, -8);
assert.equal(bashPlan({ spikes: 4 }).modifier, -12, "four spikes is the most a door holds");
assert.equal(bashPlan({ spikes: 9 }).modifier, -12, "and more than four is still four");
assert.equal(MAX_SPIKES, 4);

/* --- everything at once, and the hopeless flag --------------------------- */
p = bashPlan({ strMod: 3, pair: true, crowbar: true, sizeSteps: 1, spikes: 4 });
assert.equal(p.modifier, 12 + 4 + 2 + 8 - 12, "modifiers sum, they do not cap");
assert.equal(p.hopeless, false);
assert.equal(bashPlan({ strMod: -1, spikes: 4 }).hopeless, true,
  "a 20 that still falls short cannot be heaved open at all");
// Spikes really do hold: three of them put the throw out of reach of anyone
// without the Strength to answer for them (20 - 8 = 12, and the door asks 18).
assert.equal(bashPlan({ spikes: 3 }).hopeless, true);
assert.equal(bashPlan({ spikes: 3, strMod: 2 }).hopeless, false, "but muscle answers for them");

/* the boundary: hopeless exactly when 20 + modifier < 18 */
assert.equal(bashPlan({ extra: -2 }).hopeless, false, "20 - 2 = 18 exactly, still possible");
assert.equal(bashPlan({ extra: -3 }).hopeless, true);

/* --- the parts are named, so a sheet can show WHY ----------------------- */
p = bashPlan({ strMod: 2, crowbar: true });
assert.deepEqual(p.parts.map((x) => x.key), ["str", "crowbar"]);
assert.equal(bashPlan({}).parts.length, 0, "a plain heave lists no modifiers");

console.log("test-doors: OK (Strength, pair, crowbar, size, spikes, hopeless, parts)");
