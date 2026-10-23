/**
 * Leaving 0th level and experience following a set level: the threshold, the
 * general-proficiency limit, the first answer for each proficiency held, where
 * experience lands when a level is set, who earns experience at all, and the
 * importer's reads of the figures.
 *
 * Every figure below is INVENTED; the printed ones arrive only through the
 * importer.
 */
import assert from "node:assert/strict";
import { SETTLE, generalLimit, settleProficiencies, zeroLevelThreshold } from "../scripts/classes/zero-level-logic.mjs";
import { xpForLevel } from "../scripts/classes/hitpoints.mjs";
import { earnsExperience, hirelingKind } from "../scripts/lib/actor-read.mjs";
import { assembleExperienceTables } from "../scripts/importer/experience-binding.mjs";

/* --- the threshold ----------------------------------------------------------- */
const table = { assumed: 300, base: 10, perProficiency: 50 };
assert.equal(zeroLevelThreshold(table, 4), 300, "the figure per proficiency short of the base");
assert.equal(zeroLevelThreshold(table, 12), 0, "holding the base or more is ready at once");
assert.equal(zeroLevelThreshold(table, 0), 300, "no proficiency held reads as a count nobody knows");
assert.equal(zeroLevelThreshold({ assumed: 300 }, 4), 300, "no formula read, the assumed figure stands");
assert.equal(zeroLevelThreshold({ base: 10, perProficiency: 50 }, 0), null);
assert.equal(zeroLevelThreshold(null, 4), null, "no table, no threshold");

/* --- the general limit --------------------------------------------------------- */
assert.equal(generalLimit({ levelPicks: 1, intBonus: 2, implicitSlots: 3 }), 6);
assert.equal(generalLimit({ levelPicks: 1, intBonus: -1, implicitSlots: 3 }), 4, "a penalty takes no slot away");
assert.equal(generalLimit({ levelPicks: 1, intBonus: 2 }), null, "no implicit slots read, nothing to count against");

/* --- the first answers ---------------------------------------------------------- */
const held = [
  { id: "a", name: "Haggling", ref: "def.prof.haggle", bucket: "general" },
  { id: "b", name: "Rope Use", bucket: "general" },
  { id: "c", name: "Fishing", bucket: "general" },
  { id: "d", name: "Lockwork", bucket: "class" },
  { id: "e", name: "Tracking", bucket: "class" },
  { id: "f", name: "Swordplay", bucket: "fighting" },
];
const settled = settleProficiencies({
  held,
  powers: [{ name: "Master Haggler", ref: "def.prof.haggle" }, { name: "Rope-use" }],
  classList: [{ name: "tracking" }],
  limit: 0,
});
assert.deepEqual(
  settled.rows.map((r) => [r.id, r.answer]),
  [["a", SETTLE.replaced], ["b", SETTLE.replaced], ["c", SETTLE.keep], ["d", SETTLE.lost], ["e", SETTLE.keep], ["f", SETTLE.keep]],
  "a power by ref or folded name replaces; an unlisted class proficiency is lost",
);
assert.equal(settled.general, 1, "a replaced general proficiency is not counted");
assert.equal(settled.over, 1);
assert.equal(settleProficiencies({ held, limit: 5 }).over, 0);
assert.equal(settleProficiencies({ held }).over, null, "no limit, nothing over it");

/* --- experience follows a set level --------------------------------------------- */
const XP = { 1: 0, 2: 100, 3: 200, 4: 400, 5: 800 };
const cls = { system: { levelRow: (n) => ({ xp: XP[n] }), nextXp: (n) => XP[n + 1] ?? null } };
assert.equal(xpForLevel(cls, 3, 1, 0), 200, "a raise below the new level's floor rises to it");
assert.equal(xpForLevel(cls, 3, 1, 250), null, "a raise already inside the band keeps its experience");
assert.equal(xpForLevel(cls, 2, 4, 900), 199, "a lowered level drops to one short of the next");
assert.equal(xpForLevel(cls, 2, 4, 150), null, "a lowered level inside its band keeps its experience");
assert.equal(xpForLevel(cls, 5, 4, 900), null, "the top level has no band above it");
assert.equal(xpForLevel(cls, 3, 3, 0), null, "an unchanged level moves nothing");
assert.equal(xpForLevel(cls, 1, 0, 50), null, "first level's floor is no step up from experience already held");

/* --- who earns experience -------------------------------------------------------- */
const person = (extra = {}, record = null) => ({
  type: "character", system: {}, getFlag: (_m, k) => (k === "record" ? record : null), ...extra,
});
assert.equal(earnsExperience(person({ hasPlayerOwner: true })), true, "a player's character");
assert.equal(earnsExperience(person()), true, "ownership read only where Foundry states it");
assert.equal(earnsExperience(person({ hasPlayerOwner: false })), false, "a character nobody owns or hired is an NPC");
assert.equal(earnsExperience(person({ hasPlayerOwner: false }, { terms: { wageBasis: "level" } })), true, "a henchman, owned or not");
assert.equal(earnsExperience(person({}, { terms: { wageBasis: "mercenary" } })), false, "a mercenary is paid in coin");
assert.equal(
  earnsExperience(person({ hasPlayerOwner: false, system: { retainer: { enabled: true, category: "henchman" } } })),
  true,
  "a henchman enrolled on the sheet",
);
assert.equal(earnsExperience({ type: "monster", getFlag: () => null }), false);
assert.equal(hirelingKind(person()), null);

/* --- the importer's figures ------------------------------------------------------- */
assert.deepEqual(
  assembleExperienceTables({ zeroLevelAdvance: { base: 10, perProficiency: 50, assumed: 300 }, implicitSlotsProse: { slots: 3 } }),
  { zeroLevelXp: { assumed: 300, base: 10, perProficiency: 50 }, implicitSlots: 3 },
);
assert.deepEqual(
  assembleExperienceTables({ zeroLevelProse: { xp: 300 } }),
  { zeroLevelXp: { assumed: 300 } },
  "the rules chapter's figure stands in where the Judge's chapter was not read",
);
assert.deepEqual(assembleExperienceTables({ zeroLevelAdvance: { base: 10 } }), {}, "half a formula is no read");
assert.deepEqual(assembleExperienceTables({ implicitSlotsProse: { slots: -1 } }), {});

console.log("test-zero-level: OK (threshold, limit, answers, experience bands, earners, importer reads)");
