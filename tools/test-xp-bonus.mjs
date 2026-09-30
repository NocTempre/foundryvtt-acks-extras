/**
 * The key-attribute experience adjustment: reading the imported bands, the
 * lower attribute governing, and the division applying it per row.
 *
 * Every band and percentage below is INVENTED; the printed table arrives only
 * through the importer.
 */
import assert from "node:assert/strict";
import { deriveXpBonus, withXpBonus } from "../scripts/classes/xp-bonus.mjs";
import { assembleExperienceTables, parseAdjustment } from "../scripts/importer/experience-binding.mjs";
import { divideXp, awardXp } from "../scripts/formation/xp-shares.mjs";

/* --- the binding --------------------------------------------------------- */
assert.equal(parseAdjustment("+7%"), 7);
assert.equal(parseAdjustment("−4%"), -4, "a typographic minus is a minus");
assert.equal(parseAdjustment("0"), 0);
assert.equal(parseAdjustment("—"), null, "a cell with no figure is no row");

const raw = {
  keyAttributeRaw: {
    b2: { min: 11, max: 20, adjustment: "+8%" },
    b1: { min: 3, max: 10, adjustment: "0" },
    b3: { __missing: true },
  },
};
const rows = assembleExperienceTables(raw).keyAttributeXp;
assert.deepEqual(rows, [{ min: 3, max: 10, bonus: 0 }, { min: 11, max: 20, bonus: 8 }],
  "bands sorted, an unread row left out rather than guessed");
assert.deepEqual(assembleExperienceTables({}), {}, "nothing read, nothing assembled");

/* --- the lower key attribute governs ------------------------------------- */
const scores = { str: 15, int: 8, dex: 12 };
assert.deepEqual(deriveXpBonus(scores, ["str"], rows), { attr: "str", score: 15, bonus: 8 });
assert.deepEqual(deriveXpBonus(scores, new Set(["str", "int"]), rows), { attr: "int", score: 8, bonus: 0 },
  "two key attributes: the lower one decides");
assert.equal(deriveXpBonus(scores, ["str"], rows.slice(0, 1)).bonus, 0, "a score in no band earns nothing");
assert.deepEqual(deriveXpBonus(scores, ["str"], null), { attr: "str", score: 15, bonus: null },
  "no table: no adjustment, and the attribute still named");
assert.equal(deriveXpBonus(scores, [], rows).bonus, null, "no key attribute, nothing to read");

/* --- applied to a gain, rounded down ------------------------------------- */
assert.equal(withXpBonus(333, 8), 359);
assert.equal(withXpBonus(400, 0), 400);

/* --- the division carries each row's adjustment -------------------------- */
const calls = [];
const pc = (name, extra = {}) => ({
  name, type: "character", system: { details: { xp: { share: 100 } } },
  getFlag: () => null, getExperience: async (v) => calls.push([name, v]), ...extra,
});
const bear = {
  name: "Bound Bear", type: "monster",
  getFlag: (_m, k) => (k === "record" ? { terms: { xpShare: 0.5, wageBasis: "hd" } } : null),
  getExperience: async (v) => calls.push(["Bound Bear", v]),
};
const keen = pc("Keen"), plain = pc("Plain"), tweaked = pc("Tweaked");
const table = new Map([
  [keen, { bonus: 8, source: "keyAttribute" }],
  [tweaked, { bonus: 8, source: "tweaks" }],
]);
const d = divideXp([keen, plain, tweaked, bear], 3500, { bonusOf: (a) => table.get(a) });
assert.deepEqual(d.rows.map((r) => [r.name, r.base, r.xp]), [
  ["Keen", 1000, 1080], ["Plain", 1000, 1000], ["Tweaked", 1000, 1080], ["Bound Bear", 500, 500],
]);
assert.equal(d.rows[3].unrecorded, true, "the system keeps no experience for a monster");

await awardXp(d);
assert.deepEqual(calls, [["Keen", 1080], ["Plain", 1000], ["Tweaked", 1000]],
  "core gets the adjusted gain, except where core applies its own Tweaks percentage; the bear is not handed to a call that drops it");

console.log("test-xp-bonus: OK (binding, lower attribute, no table, division, award)");
