/**
 * Pure-logic tests for the language grant (RR §I.10). Foundry-free: the slot
 * carriers' document writes are live-gate territory.
 */
import assert from "node:assert/strict";
import { languageGrant, LITERACY } from "../scripts/classes/languages.mjs";

/* --- the plain human: what the class prints, and Intellect on top -------- */
let g = languageGrant({ intMod: 0, classLanguages: { granted: ["Common", "Krysean"], count: 0 } });
assert.deepEqual(g.granted, ["Common", "Krysean"]);
assert.equal(g.openSlots, 0, "no bonus, no free picks");
assert.equal(g.literacy, LITERACY.LITERATE, "average Intellect reads what it speaks");

g = languageGrant({ intMod: 2, classLanguages: { granted: ["Common"], count: 0 } });
assert.equal(g.fromInt, 2);
assert.equal(g.openSlots, 2, "an Intellect bonus buys that many more");

/* --- the demi-human: race and class ADD, and neither teaches twice ------- */
g = languageGrant({
  intMod: 1,
  classLanguages: { granted: ["Common", "Dwarvish"], count: 0 },
  raceLanguages: { granted: ["Dwarvish", "Goblin", "Gnome", "Kobold"], count: 0 },
});
assert.deepEqual(g.granted, ["Common", "Dwarvish", "Goblin", "Gnome", "Kobold"],
  "the shared tongue is learned once, in first-seen order");
assert.equal(g.openSlots, 1);

/* --- an allowance from either side is a slot, not a name ----------------- */
g = languageGrant({ intMod: 0, classLanguages: { count: 1 }, raceLanguages: { count: 2 } });
assert.equal(g.fromClass, 1);
assert.equal(g.fromRace, 2);
assert.equal(g.openSlots, 3);
assert.deepEqual(g.granted, []);

/* --- a penalty costs literacy, never tongues ---------------------------- */
g = languageGrant({ intMod: -2, classLanguages: { granted: ["Common"], count: 0 } });
assert.equal(g.literacy, LITERACY.ILLITERATE, "an Intellect penalty is illiterate");
assert.equal(g.openSlots, 0, "and buys nothing");
assert.deepEqual(g.granted, ["Common"], "but still speaks what it was given");

console.log("test-languages: OK (grants, stacking, dedupe, allowances, literacy)");
