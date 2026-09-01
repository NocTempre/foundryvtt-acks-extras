/**
 * The Tongues-runin parse (RR §I.10 as the class spreads print it).
 *
 * Fixture sentences are INVENTED — structure-identical to the printed trait
 * (a `<Race> Tongues:` runin, one or two "can speak" clauses, an optional
 * trailing "tongues"/"languages") with made-up names, because a test file is
 * a repo file and ships no book values.
 */
import assert from "node:assert/strict";
import { parseTongues, parseBonusLanguages } from "../../scripts/importer/cookbook.mjs";

/* --- the two-clause shape: a list, an aside, and a second list ----------- */
let t = parseTongues(
  "Racial Traits As gribs, vaultwardens have certain powers. Grib Tongues: Gribs " +
    "can speak the Fooish and Barese tongues and, because of their frequent dealings " +
    "below, can also speak Bazlik, Quxian, and Corge. Sturdy: Gribs are tough.",
);
assert.equal(t.race, "Grib");
assert.deepEqual(t.granted, ["Fooish", "Barese", "Bazlik", "Quxian", "Corge"]);

/* --- the one-clause shape, terminated by "languages" --------------------- */
t = parseTongues("Sylph Tongues: Sylphs can speak the Fooish, Sylphin, Grackle, and Wug languages. Class Proficiencies");
assert.equal(t.race, "Sylph");
assert.deepEqual(t.granted, ["Fooish", "Sylphin", "Grackle", "Wug"]);

/* --- a two-word race label and two-word tongue names --------------------- */
t = parseTongues(
  "Vexan Tongues: Due to their background and training, all Vexan wardens can speak " +
    "Old Vexan, Fooish, Bazlik, and Thrum. Class Proficiencies Proficiency Progression: At 1st level…",
);
assert.equal(t.race, "Vexan");
assert.deepEqual(t.granted, ["Old Vexan", "Fooish", "Bazlik", "Thrum"]);

/* --- what is NOT a tongue ------------------------------------------------ */
// No runin at all — a human spread — is null, not an empty list.
assert.equal(parseTongues("Fighters fight. Battlefield Prowess (3): they are impressive."), null);
// A speak-with-beasts power outside any Tongues runin grants nothing.
assert.equal(parseTongues("Friend of Beasts (5th level): She can speak with beasts (as the spell) at will."), null);
// Inside a runin, a non-name clause fragment is discarded rather than granted.
t = parseTongues("Grib Tongues: Gribs can speak the Fooish tongues and can speak with beasts (as the spell) at will.");
assert.deepEqual(t.granted, ["Fooish"]);

/* --- glued extraction spaces --------------------------------------------- */
// Raw body extraction drops inter-run spaces, so the runin label, the speak
// verb and the list terminator all arrive glued as often as not. Measured
// live: "ElfTongues:" missed a \s+ runin entirely, and "Fooishtongues" left
// the terminator inside the captured name.
t = parseTongues("Racial Traits ElfTongues: Elves can speak the Fooish, Sylphin, and Wug languages. Class Proficiencies");
assert.equal(t.race, "Elf", "a glued runin label still parses");
assert.deepEqual(t.granted, ["Fooish", "Sylphin", "Wug"]);

t = parseTongues("Grib Tongues: Gribs can speak the Fooish and Bareselanguages and can also speakBazlik, and Corge. Sturdy:");
assert.deepEqual(t.granted, ["Fooish", "Barese", "Bazlik", "Corge"], "glued terminator and glued verb both recover");

t = parseTongues("Sylph Tongues: Sylphs can speak theFooish, Sylphin, and Wug languages.");
assert.deepEqual(t.granted, ["Fooish", "Sylphin", "Wug"], "a glued article does not eat the first tongue");

t = parseTongues("Vexan Tongues: all Vexan wardens can speak OldVexan, Fooish, and Thrum.");
assert.deepEqual(t.granted, ["Old Vexan", "Fooish", "Thrum"], "a space lost inside a name reopens at the case boundary");

// A clause the page interleaved with a neighbouring column cannot reach its
// terminator inside the cap; it drops whole instead of granting the column.
assert.equal(
  parseTongues(
    "Sylph Tongues: Sylphs can speak the Fooish, Sylphin, Grackle, Wug, Thrum, Corge, Bazlik, Quxian, " +
      "Barese, Frobnese, Wibble, Wobble, and Flob plus far too many interleaved words to be a real list languages.",
  ),
  null,
  "an interleaved clause is dropped, not granted",
);

/* --- shared names dedupe, empty parses refuse ---------------------------- */
t = parseTongues("Grib Tongues: Gribs can speak the Fooish and Fooish tongues.");
assert.deepEqual(t.granted, ["Fooish"], "the same tongue is not granted twice");
assert.equal(parseTongues("Grib Tongues: Gribs are talkative."), null, "a runin with no speak clause is null");

/* --- extra picks a class or race grants on top of any named list ---------
 * Multilingual / Linguistics grant SLOTS, not names: the book leaves them to
 * the campaign's own regions.                                              */
assert.equal(
  parseBonusLanguages("Multilingual: As travellers, gribs become conversant in many tongues, thereby gaining three bonus languages."),
  3,
  "a word-numbered bonus grant",
);
assert.equal(
  parseBonusLanguages("Linguistics: He can speak, read, and write an additional 4 languages of his choice."),
  4,
  "a digit-numbered additional grant",
);
assert.equal(parseBonusLanguages("Sylph Tongues: Sylphs speak four bonus languages."), 4);
// Glued the way the raw body arrives.
assert.equal(parseBonusLanguages("theygainthreebonuslanguages."), 3, "a fully glued grant still resolves");
// Restating the allowance must not double it.
assert.equal(
  parseBonusLanguages("They gain three bonus languages. The grib can select some or all of these languages later."),
  3,
  "a restatement is not a second grant",
);
// No grant, and a number that is not a language allowance.
assert.equal(parseBonusLanguages("Gribs are tough and speak plainly."), 0);
assert.equal(parseBonusLanguages("He gains three bonus proficiencies."), 0, "bonus proficiencies are not languages");
assert.equal(parseBonusLanguages("gaining 99 bonus languages"), 0, "an implausible count is a wandered parse");
assert.equal(parseBonusLanguages(""), 0);
assert.equal(parseBonusLanguages(null), 0);

console.log("test-class-tongues: OK (two-clause, one-clause, multi-word, refusals, dedupe, bonus picks)");
