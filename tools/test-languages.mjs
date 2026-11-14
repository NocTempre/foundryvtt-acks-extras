/**
 * Pure-logic tests for the language grant (RR §I.10). Foundry-free: the slot
 * carriers' document writes are live-gate territory.
 */
import assert from "node:assert/strict";
import { languageGrant, LITERACY, slotsOf, freeSlots, filledLanguages, wordPrefixMatch, languagesFromAbilities } from "../scripts/classes/languages.mjs";

/* --- the plain human: what the class prints, and Intellect on top -------- */
let g = languageGrant({ intMod: 0, classLanguages: { granted: ["Common", "Zorvian"], count: 0 } });
assert.deepEqual(g.granted, ["Common", "Zorvian"]);
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

/* --- a row added on the sheet and never named grants nothing ------------- */
g = languageGrant({ intMod: 0, classLanguages: { granted: ["Common", null, undefined, " "], count: 0 } });
assert.deepEqual(g.granted, ["Common"], "an empty row is not a tongue called null");

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

/* --- a proficiency or power buys tongues too ----------------------------
 * An ability buys what ITS OWN flag says (the importer reads the count off its
 * page; the figures below are invented). Rank IS the count of same-named
 * items, so two items add twice. It is never gated on Intellect. An ability
 * with no flag buys nothing, whatever its id.                              */
const withItems = (...items) => ({ items });
const granting = (n, id = "def.prof.zz") => ({ flags: { "acks-extras": { cookbook: { id }, languageGrant: n } } });

assert.equal(languagesFromAbilities(withItems(granting(2))), 2, "one rank buys what its flag says");
assert.equal(languagesFromAbilities(withItems(granting(2), granting(2))), 4, "two takings add twice");
assert.equal(
  languagesFromAbilities(withItems(granting(2, "def.prof.zz"), granting(5, "def.power.zz"))),
  7,
  "each ability reads its own figure, so two abilities may differ",
);
assert.equal(
  languagesFromAbilities(withItems({ flags: { "acks-extras": { languageGrant: 4 } } })),
  4,
  "a Judge's own marked ability grants what it says",
);
assert.equal(
  languagesFromAbilities(withItems({ flags: { "acks-extras": { cookbook: { id: "def.prof.language" } } } })),
  0,
  "an id alone grants nothing: the figure is read, never assumed",
);
assert.equal(languagesFromAbilities(withItems({ flags: { "acks-extras": { languageGrant: null } } })), 0, "a cleared field is no figure");
assert.equal(languagesFromAbilities(withItems({ flags: { "acks-extras": { languageGrant: 0 } } })), 0, "zero grants nothing");
assert.equal(languagesFromAbilities(withItems({ flags: {} }, { name: "Riding" })), 0);
assert.equal(languagesFromAbilities(null), 0);

g = languageGrant({ intMod: -1, classLanguages: { granted: ["Common"] }, fromAbilities: 2 });
assert.equal(g.openSlots, 2, "a penalty does not cancel what a proficiency bought");
assert.equal(g.fromAbilities, 2);
assert.equal(g.literacy, LITERACY.ILLITERATE);

g = languageGrant({ intMod: 2, classLanguages: { count: 1 }, raceLanguages: { count: 2 }, fromAbilities: 4 });
assert.equal(g.openSlots, 9, "class + race + Intellect + abilities all add");

/* --- a short grant adopts the one long name it word-prefixes -------------
 * The book grants "Common" in one chapter and prints "Common Auran" in the
 * taxonomy; a unique word-boundary prefix is that tongue. Anything ambiguous
 * or boundary-breaking refuses, and the caller mints what was printed.      */
const CANON = ["Common Auran", "Old Velmaric", "Dwarven", "Kemeshi"];
assert.equal(wordPrefixMatch("Common", CANON), "Common Auran", "unique word-prefix adopts");
assert.equal(wordPrefixMatch("common", CANON), "Common Auran", "case-blind");
assert.equal(wordPrefixMatch("Kemeshi", CANON), "Kemeshi", "an exact name is its own prefix");
assert.equal(wordPrefixMatch("Dwarvish", CANON), null, "a different word is not a prefix");
assert.equal(wordPrefixMatch("Dwar", CANON), null, "a mid-word prefix does not adopt");
assert.equal(wordPrefixMatch("Old", ["Old Velmaric", "Old Kem"]), null, "two candidates is ambiguous — refuse");
assert.equal(wordPrefixMatch("", CANON), null);
assert.equal(
  wordPrefixMatch("Common", CANON, (n) => ({ name: n })).name,
  "Common Auran",
  "pick maps the winner",
);

console.log("test-languages: OK (grants, stacking, dedupe, allowances, literacy, slot liveness, ability grants, prefix adoption)");
