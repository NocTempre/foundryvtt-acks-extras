/**
 * `splitTrapTiers` — cutting a printed trap's passage into the trap and its six
 * levels.
 *
 * What this pins is the SPLITTING: where the description ends, where each level
 * begins, and what happens to a passage the rule does not fit. What a level then
 * MEANS — save or attack, which save, how far it reaches — is deliberately not
 * read here and is not tested here, because the binding does not guess it.
 *
 * No book text is reproduced. The passages below are shaped like the printed
 * ones — same ordinals, same colon, same flow into one paragraph — with
 * invented effects.
 */
import assert from "node:assert";
import { splitTrapTiers } from "../../scripts/importer/cookbook.mjs";

let pass = 0;
const check = (label, cond) => { assert.ok(cond, label); pass++; };

/* The shape the executor hands over: block 0 the description, block 1 the
   whole tier run, exactly as the two `text` paragraphs materialize. */
const BLOCKS = [
  "A contrivance is rigged above the door. Each creature nearby must make a saving throw.",
  " 1st level: The contrivance deals 1d6  damage." +
    " 2nd level: The contrivance deals 3d6  damage." +
    " 3rd level: The contrivance deals 5d6  damage." +
    " 4th level: The contrivance deals 7d6  damage." +
    " 5th level: The contrivance deals 9d6  damage and knocks prone." +
    " 6th level: The contrivance deals 11d6+11  damage and knocks prone.",
];

const { description, levels } = splitTrapTiers(BLOCKS);

check("the description keeps only what precedes the first level", /contrivance is rigged/.test(description));
check("the description does not swallow the first level", !/1st level/.test(description));
check("six rows, always", levels.length === 6);
check("each level keeps its own sentence", /knocks prone/.test(levels[4].text) && !/knocks prone/.test(levels[0].text));
check("a level's text does not carry its own marker", !/2nd level/.test(levels[1].text));
check("damage is read per level", levels[0].damageFormula === "1d6" && levels[2].damageFormula === "5d6");
check("a signed die keeps its modifier, without the spaces", levels[5].damageFormula === "11d6+11");

/* A passage with no tiers at all: nothing invented, nothing dropped. */
const plain = splitTrapTiers(["A pit is dug and covered over."]);
check("an untiered passage stays whole as the description", plain.description === "A pit is dug and covered over.");
check("an untiered passage still yields six empty rows", plain.levels.length === 6 && plain.levels[0].text === "");

/* The tiers arrive split across blocks when a column turn interrupts them —
   Portcullis prints that way, its run continuing at the top of column two. */
const across = splitTrapTiers([
  "A weight is suspended overhead.",
  " 1st level: It deals 1d4  damage.",
  " 2nd level: It deals 2d4  damage.",
]);
check("a run broken by a column turn still splits", across.levels[1].text.includes("2d4"));
check("the description survives the join", across.description === "A weight is suspended overhead.");

/* Levels the book skips stay empty rather than shifting the ones it prints. */
const sparse = splitTrapTiers(["A snare.", " 1st level: It deals 1d2  damage. 4th level: It deals 4d2  damage."]);
check("a stated level lands on its own row", sparse.levels[3].damageFormula === "4d2");
check("the levels between stay empty", sparse.levels[1].text === "" && sparse.levels[2].text === "");

/* A level printed twice is a reprint correcting itself, not two half-rules. */
const twice = splitTrapTiers(["A dart.", " 1st level: It deals 1d3  damage. 1st level: It deals 2d3  damage."]);
check("a repeated level takes the last word", twice.levels[0].damageFormula === "2d3");

/* Degenerate input must not throw: the executor returns nothing for a book the
   seat has not connected, and the binding still has to build a document. */
check("no blocks yields six empty rows", splitTrapTiers().levels.length === 6);
check("empty blocks yield an empty description", splitTrapTiers([]).description === "");
check("a level outside 1-6 is ignored rather than written off the end", splitTrapTiers([
  "A thing.", " 7th level: It deals 9d9  damage.",
]).levels.every((l) => l.text === ""));

console.log(`test-trap-tiers: all ${pass} checks passed`);
