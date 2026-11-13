/**
 * The monster load rule and default attribute score: read from the registered
 * `monsters` document, null where nothing was imported, a Judge's override
 * winning, and the standing a load takes against them. Every figure is
 * invented fixture data.
 *
 * Run: npm test
 */
import assert from "node:assert/strict";
import { LOAD_DOC, loadRule, defaultScore, loadRuleCite, loadStanding } from "../scripts/monsters/load-rule.mjs";
import { PRIORITY, registerTable, resetTables } from "../scripts/lib/tables.mjs";

const register = (tables, priority = PRIORITY.WORLD) => registerTable({ id: LOAD_DOC, source: { pages: "XX 1" }, tables }, { priority });

// Nothing imported: no figure, and no page to cite.
resetTables();
assert.deepEqual(loadRule(), { maxMultiple: null, speedShare: null }, "no document, no load rule");
assert.equal(defaultScore(), null, "no document, no default score");
assert.equal(loadRuleCite(), null, "and no page");

// Imported: both figures read, the page cited.
register({ loadRule: { maxMultiple: 3, speedShare: 0.25 }, defaultScore: { score: 7 } });
assert.deepEqual(loadRule(), { maxMultiple: 3, speedShare: 0.25 });
assert.equal(defaultScore(), 7);
assert.equal(loadRuleCite(), "XX 1");

// A figure no load or score can follow reads as not imported.
resetTables();
register({ loadRule: { maxMultiple: 1, speedShare: 1 }, defaultScore: { score: 7.5 } });
assert.deepEqual(loadRule(), { maxMultiple: null, speedShare: null }, "a multiple at one and a share of all are no figures");
assert.equal(defaultScore(), null, "a fractional score is no score");
resetTables();
register({ loadRule: { maxMultiple: "x" }, defaultScore: { score: 0 } });
assert.deepEqual(loadRule(), { maxMultiple: null, speedShare: null });
assert.equal(defaultScore(), null);
resetTables();
register({ loadRule: { __missing: true }, defaultScore: { __missing: true } });
assert.deepEqual(loadRule(), { maxMultiple: null, speedShare: null }, "a missing-row placeholder answers nothing");
assert.equal(defaultScore(), null);

// A Judge's override layer wins outright.
resetTables();
register({ loadRule: { maxMultiple: 3, speedShare: 0.25 }, defaultScore: { score: 7 } });
register({ loadRule: { maxMultiple: 5, speedShare: 0.75 }, defaultScore: { score: 11 } }, PRIORITY.OVERRIDE);
assert.deepEqual(loadRule(), { maxMultiple: 5, speedShare: 0.75 });
assert.equal(defaultScore(), 11);
assert.equal(loadRuleCite(), null, "an override has no page to point at");

// The standing of a load.
assert.equal(loadStanding({ stone: 5, normal: 10, max: 30 }).state, "unencumbered");
assert.equal(loadStanding({ stone: 10, normal: 10, max: 30 }).state, "unencumbered", "the normal load itself is not past it");
assert.equal(loadStanding({ stone: 20, normal: 10, max: 30 }).state, "encumbered");
assert.equal(loadStanding({ stone: 31, normal: 10, max: 30 }).state, "overloaded");
assert.equal(loadStanding({ stone: 31, normal: 10, maxMultiple: 3 }).state, "overloaded", "the imported multiple stands in for a maximum");
assert.equal(loadStanding({ stone: 25, normal: 10, maxMultiple: 3 }).ceiling, 30);
assert.equal(loadStanding({ stone: 25, normal: 10, max: 12, maxMultiple: 3 }).ceiling, 12, "the creature's own maximum wins");
const bare = loadStanding({ stone: 500, normal: 10 });
assert.equal(bare.state, "encumbered", "with no ceiling a heavy load is encumbered, never overloaded");
assert.equal(bare.ceiling, null);
assert.equal(bare.denom, 500, "the bar scales to the larger of the two loads");
assert.equal(loadStanding({ stone: 0, normal: 0 }).denom, 1, "a zero bar still divides");

resetTables();
console.log("test-monster-load-rule: OK");
