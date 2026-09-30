/**
 * A player's legacy: the reserve fund's total, funerals claimed once, the
 * prior character's experience as a ceiling, and a will's bank charge; plus
 * the importer's reads of the three percentages.
 *
 * Every rate and figure below is INVENTED; the printed percentages arrive only
 * through the importer.
 */
import assert from "node:assert/strict";
import { LEGACY_KIND, legacyTotals, settleEstate, startingXp, xpForGp } from "../scripts/classes/legacy-logic.mjs";
import { assembleExperienceTables } from "../scripts/importer/experience-binding.mjs";

/* --- what gold is worth ---------------------------------------------------- */
assert.equal(xpForGp(1000, 75), 750);
assert.equal(xpForGp(333, 75), 249, "rounded down");
assert.equal(xpForGp(500, null), 0, "no rate, no experience");

/* --- the fund is never spent; a funeral is claimed once --------------------- */
const ledger = {
  entries: [
    { id: "a", kind: LEGACY_KIND.reserve, xp: 600 },
    { id: "b", kind: LEGACY_KIND.reserve, xp: 150 },
    { id: "c", kind: LEGACY_KIND.funeral, xp: 400 },
    { id: "d", kind: LEGACY_KIND.funeral, xp: 999, claimedBy: { name: "Earlier" } },
  ],
};
const t = legacyTotals(ledger);
assert.equal(t.fund, 750);
assert.equal(t.funerals, 400, "a claimed funeral is spent");
assert.deepEqual(t.open.map((e) => e.id), ["c"]);
assert.deepEqual(legacyTotals(null), { fund: 0, funerals: 0, open: [] });

/* --- starting a character ------------------------------------------------ */
let s = startingXp(ledger, 5000);
assert.deepEqual([s.xp, s.capped, s.claims], [1150, false, ["c"]], "fund plus open funerals");
s = startingXp(ledger, 900);
assert.deepEqual([s.xp, s.capped], [900, true], "never more than the character before");
assert.equal(startingXp({ entries: [] }, 3000).xp, 0);

/* --- a will ---------------------------------------------------------------- */
assert.deepEqual(settleEstate(1000, 20), { fee: 200, net: 800 });
assert.deepEqual(settleEstate(1005, 20), { fee: 201, net: 804 }, "the charge rounds up to whole gp");
assert.deepEqual(settleEstate(-5, 20), { fee: 0, net: 0 });

/* --- the importer's percentages -------------------------------------------- */
const out = assembleExperienceTables({ reserveProse: { rate: 75 }, funeralProse: { rate: 60 }, bankProse: { fee: 20 } });
assert.deepEqual(out, { reserveRate: 75, funeralRate: 60, bankFee: 20 });
assert.deepEqual(assembleExperienceTables({ reserveProse: { rate: 400 } }), {}, "an impossible percentage is no read");

console.log("test-legacy: OK (fund, funerals, ceiling, will, rates)");
