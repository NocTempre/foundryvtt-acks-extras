/**
 * Pure-logic tests for the language grant (RR §I.10). Foundry-free: the slot
 * carriers' document writes are live-gate territory.
 */
import assert from "node:assert/strict";
import { languageGrant, LITERACY, slotsOf, freeSlots, filledLanguages, wordPrefixMatch } from "../scripts/classes/languages.mjs";

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

/* --- the carrier counts DOCUMENTS, so a deleted language frees its slot ---
 * The slot record remembers ids; the actor's items are the truth. Both are
 * plain objects here — the model reads a carrier through the same two
 * accessors whether it came from Foundry or not.                            */
const carrier = (capacity, filled) => ({
  flags: { "acks-extras": { languageSlots: { capacity, filled, source: "open" } } },
  parent: { items: new Map([["a", { id: "a", type: "language", name: "Common" }]]) },
});

let c = carrier(3, ["a"]);
assert.equal(slotsOf(c).capacity, 3);
assert.deepEqual(filledLanguages(c).map((i) => i.name), ["Common"]);
assert.equal(freeSlots(c), 2, "one spent of three");

// The id of a language the player deleted off the sheet. Nothing reconciles
// it — it is simply not there, and the slot it bought is free again.
c = carrier(3, ["a", "gone"]);
assert.deepEqual(filledLanguages(c).map((i) => i.id), ["a"], "a dead id is not a language");
assert.equal(freeSlots(c), 2, "and its slot comes back");

// A carrier can be over-full when Intellect falls; it never reports negative
// room, and the grant path never shrinks capacity below what was spent.
c = carrier(1, ["a", "gone"]);
assert.equal(freeSlots(c), 0);

assert.equal(slotsOf({ flags: {} }), null, "an ability with no slot flag is not a carrier");

/* --- a short grant adopts the one long name it word-prefixes -------------
 * The book grants "Common" in one chapter and prints "Common Auran" in the
 * taxonomy; a unique word-boundary prefix is that tongue. Anything ambiguous
 * or boundary-breaking refuses, and the caller mints what was printed.      */
const CANON = ["Common Auran", "Old Zaharan", "Dwarven", "Kemeshi"];
assert.equal(wordPrefixMatch("Common", CANON), "Common Auran", "unique word-prefix adopts");
assert.equal(wordPrefixMatch("common", CANON), "Common Auran", "case-blind");
assert.equal(wordPrefixMatch("Kemeshi", CANON), "Kemeshi", "an exact name is its own prefix");
assert.equal(wordPrefixMatch("Dwarvish", CANON), null, "a different word is not a prefix");
assert.equal(wordPrefixMatch("Dwar", CANON), null, "a mid-word prefix does not adopt");
assert.equal(wordPrefixMatch("Old", ["Old Zaharan", "Old Kem"]), null, "two candidates is ambiguous — refuse");
assert.equal(wordPrefixMatch("", CANON), null);
assert.equal(
  wordPrefixMatch("Common", CANON, (n) => ({ name: n })).name,
  "Common Auran",
  "pick maps the winner",
);

console.log("test-languages: OK (grants, stacking, dedupe, allowances, literacy, slot liveness, prefix adoption)");
