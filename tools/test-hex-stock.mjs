/**
 * A hex's stock — the pure procedure: the key it is stored under, the count
 * from the imported dice and the settled share, substitution, the draws a
 * point stores, the per-formation finds and search credit, and the false
 * count a misreading party is told. Invented values throughout (QQ names,
 * made-up dice, shares and bands): these tests prove the MACHINERY and never
 * the book.
 */
import assert from "node:assert/strict";
import {
  FALSE_COUNT_TRIES,
  LAIR_KINDS,
  creditSearch,
  falseCount,
  hexStockKey,
  markFound,
  recordAssessment,
  settledCount,
  stockHex,
  stockSummary,
  substituteKind,
  unfoundPoints,
} from "../scripts/formation/hex-stock.mjs";
import { ENCOUNTERS_DOC } from "../scripts/formation/encounters.mjs";
import { registerTable, resetTables, PRIORITY } from "../scripts/lib/tables.mjs";

/** A deterministic rng: yields each queued value, then 0.5. */
const rig = (...values) => {
  const q = [...values];
  return () => (q.length ? q.shift() : 0.5);
};
// Face F on a dN wants rng() = (F - 0.5) / N, clear of every float seam.
const face = (f, n) => (f - 0.5) / n;
const deepFreeze = (o) => {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
};
const counter = (prefix) => { let n = 0; return () => `${prefix}${++n}`; };

const LISTS = {
  valuable: ["Double", "QQ V2", "QQ V3", "QQ V4", "QQ V5", "QQ V6", "QQ V7", "QQ V8", "QQ V9", "QQ V10", "QQ V11", "QQ V12"],
  dangerous: ["QQ D1", "QQ D2", "QQ D3", "QQ D4", "QQ D5", "QQ D6", "QQ D7", "QQ D8", "QQ D9", "QQ D10", "QQ D11", "QQ D12"],
  unique: ["QQ U1", "QQ U2", "QQ U3", "QQ U4", "QQ U5", "QQ U6", "QQ U7", "QQ U8", "QQ U9", "QQ U10", "QQ U11", "QQ U12"],
};
const BANDS = [
  { min: 1, max: 3, kind: "lair" },
  { min: 4, max: 5, kind: "valuable" },
  { min: 6, max: 7, kind: "dangerous" },
  { min: 8, max: 8, kind: "unique" },
];
const tables = (extra = {}) => ({
  lairsPerHex: { grassland: "1d4", forest: "2d4+1", hillsRocky: "1d6-3" },
  settledLairShare: { civilized: 0.5, borderlands: 0.4, outlands: 0.25 },
  lairSubstitution: BANDS,
  rarity: {
    unsettled: [{ min: null, max: 10, rarity: "common" }, { min: 11, max: null, rarity: "rare" }],
    borderlands: [{ min: null, max: null, rarity: "common" }],
  },
  "monsters.grasslandFarm": {
    common: [{ min: null, max: 50, name: "QQ Prowler" }, { min: 51, max: null, name: "QQ Stalker" }],
    rare: [{ min: null, max: null, name: "QQ Terror" }],
  },
  terrainEncounters: LISTS,
  ...extra,
});
const register = (extra) => {
  resetTables();
  registerTable({ id: ENCOUNTERS_DOC, tables: tables(extra) }, { priority: PRIORITY.WORLD, source: "test" });
};
register();

/* --- the key a hex is stored under ----------------------------------------- */
assert.deepEqual([...LAIR_KINDS], ["lair", "valuable", "dangerous", "unique", "placed"]);
assert.equal(hexStockKey({ offset: { i: 3, j: -2 } }), "3:-2", "a grid offset keys as i:j");
assert.equal(hexStockKey({ offset: { i: 0, j: 0 } }), "0:0", "the origin cell is a cell, not an absence");
assert.equal(hexStockKey({ label: "C4 (north)." }), "label:C4north", "a label folds to letters and digits");
assert.ok(!hexStockKey({ label: "A.B.C" }).includes("."), "no dot reaches the update path");
assert.equal(hexStockKey({ offset: { i: 1, j: 2 }, label: "C4" }), "1:2", "the offset outranks the label");
assert.equal(hexStockKey({ offset: { i: 1 }, label: "C4" }), "label:C4", "half an offset is no offset");
assert.equal(hexStockKey({ offset: { i: null, j: null } }), null);
assert.equal(hexStockKey({ label: " .- " }), null, "a label with nothing to fold names no hex");
assert.equal(hexStockKey({}), null);
assert.equal(hexStockKey(), null);

/* --- the settled share, ties down ----------------------------------------- */
assert.equal(settledCount(3, 0.5), 1, "1.5 rounds DOWN");
assert.equal(settledCount(5, 0.5), 2, "2.5 rounds DOWN");
assert.equal(settledCount(4, 0.5), 2);
assert.equal(settledCount(10, 0.35), 3, "3.5 rounds DOWN");
assert.equal(settledCount(15, 0.1), 1, "a tie that floats just over still rounds down");
assert.equal(settledCount(7, 0.25), 2, "1.75 rounds up");
assert.equal(settledCount(5, 0.25), 1, "1.25 rounds down");
assert.equal(settledCount(0, 0.5), 0);
assert.equal(settledCount(1, 0.25), 0, "a share can take the count to nothing");
assert.equal(settledCount(6, null), 6, "no share leaves the roll");
assert.equal(settledCount(6, 0), 6, "a zero share is invalid");
assert.equal(settledCount(6, 1.5), 6, "a share over the whole is invalid");
assert.equal(settledCount(6, "half"), 6);
assert.equal(settledCount(6, 1), 6);

/* --- bands to kinds -------------------------------------------------------- */
assert.equal(substituteKind(1, BANDS), "lair");
assert.equal(substituteKind(3, BANDS), "lair");
assert.equal(substituteKind(4, BANDS), "valuable");
assert.equal(substituteKind(7, BANDS), "dangerous");
assert.equal(substituteKind(8, BANDS), "unique");
assert.equal(substituteKind(9, BANDS), null, "off the table names no kind");
assert.equal(substituteKind(2, null), null);
assert.equal(substituteKind(2, []), null);

/* --- a count from the imported dice --------------------------------------- */
let res = stockHex({
  row: "grassland", terrain: "grassland", territory: "unsettled", now: 4242,
  // 1d4 → 3; then per lair: rarity d20, creature d100.
  rng: rig(face(3, 4), face(5, 20), face(60, 100), face(15, 20), face(1, 100), face(10, 20), face(50, 100)),
  mintId: counter("u"),
});
assert.ok(res.ok);
let rec = res.record;
assert.equal(rec.count, 3);
assert.equal(rec.rolled, 3);
assert.equal(rec.dice, "1d4");
assert.equal(rec.row, "grassland");
assert.equal(rec.share, null, "an unsettled hex has no share");
assert.equal(rec.judgeCount, null);
assert.equal(rec.substitute, false);
assert.equal(rec.stocked, true);
assert.equal(rec.stockedAt, 4242);
assert.equal(rec.terrain, "grassland");
assert.equal(rec.territory, "unsettled");
assert.deepEqual(rec.searches, {});
assert.deepEqual(rec.assessments, {});
assert.equal(rec.points.length, 3, "one point per lair");
assert.deepEqual(rec.points.map((p) => p.id), ["u1", "u2", "u3"], "ids come from the minter");
assert.deepEqual(rec.points.map((p) => p.name), ["QQ Stalker", "QQ Terror", "QQ Prowler"]);
assert.deepEqual(rec.points.map((p) => p.rarity), ["common", "rare", "common"], "each lair throws its own rarity");
assert.deepEqual(rec.points[0].creature, { name: "QQ Stalker", roll: 60, rarityRoll: 5 }, "the creature keeps both rolls");
assert.ok(rec.points.every((p) => p.kind === "lair" && p.sub === null && p.draw === null));
assert.ok(rec.points.every((p) => p.placeUuid === null && p.note === ""));
assert.ok(rec.points.every((p) => Object.keys(p.found).length === 0), "nobody has found anything yet");

// The dice carry a modifier.
res = stockHex({ row: "forest", terrain: "grassland", territory: "unsettled", rng: rig(face(4, 4), face(2, 4)) });
assert.ok(res.ok && res.record.rolled === 4 + 2 + 1 && res.record.count === 7, "a +K modifier adds to the roll");
res = stockHex({ row: "hillsRocky", terrain: "grassland", territory: "unsettled", rng: rig(face(2, 6)) });
assert.ok(res.ok && res.record.count === 0 && res.record.points.length === 0, "a roll under the modifier floors at none");

// A creature the import cannot name degrades to a book line on the point.
res = stockHex({ row: "grassland", terrain: "jungle", territory: "unsettled", rng: rig(face(1, 4), face(5, 20), face(5, 100)) });
assert.ok(res.ok);
assert.equal(res.record.points[0].name, null);
assert.equal(res.record.points[0].creature.missing, "monsters.jungle", "the missing sub-table is named, not guessed");

/* --- a settled territory scales the roll ---------------------------------- */
res = stockHex({ row: "grassland", terrain: "grassland", territory: "civilized", rng: rig(face(3, 4), face(5, 20), face(5, 100)) });
assert.ok(res.ok);
assert.equal(res.record.rolled, 3, "the roll is kept as it fell");
assert.equal(res.record.share, 0.5);
assert.equal(res.record.count, 1, "3 × 0.5 is a tie and rounds down");
assert.equal(res.record.points.length, 1);
res = stockHex({ row: "grassland", terrain: "grassland", territory: "civilized", rng: rig(face(4, 4), face(5, 20), face(5, 100), face(5, 20), face(5, 100)) });
assert.equal(res.record.count, 2, "4 × 0.5 is whole");
res = stockHex({ row: "grassland", terrain: "grassland", territory: "outlands", rng: rig(face(4, 4), face(5, 20), face(5, 100)) });
assert.equal(res.record.count, 1, "the share is the territory's own");
register({ settledLairShare: undefined });
res = stockHex({ row: "grassland", terrain: "grassland", territory: "civilized", rng: rig(face(3, 4), face(5, 20), face(5, 100), face(5, 20), face(5, 100), face(5, 20), face(5, 100)) });
assert.ok(res.ok && res.record.count === 3 && res.record.share === null, "an unimported share leaves the roll alone");
register();

/* --- no count to roll, and the Judge's count ------------------------------ */
res = stockHex({ row: null, terrain: "riverLand", territory: "unsettled", rng: rig() });
assert.deepEqual([res.ok, res.needsCount, res.reason], [false, true, "noRow"], "a pick with no printed row asks for a count");
res = stockHex({ row: "swamp", terrain: "grassland", territory: "unsettled", rng: rig() });
assert.deepEqual([res.ok, res.needsCount, res.reason], [false, true, "lairsPerHex"], "a row the import lacks asks for a count");
register({ lairsPerHex: undefined });
res = stockHex({ row: "grassland", terrain: "grassland", territory: "unsettled", rng: rig() });
assert.deepEqual([res.ok, res.needsCount, res.reason], [false, true, "lairsPerHex"], "an unimported table asks for a count");
res = stockHex({ row: "grassland", terrain: "grassland", territory: "unsettled", judgeCount: 2, rng: rig(face(5, 20), face(5, 100), face(5, 20), face(5, 100)) });
assert.ok(res.ok && res.record.count === 2 && res.record.judgeCount === 2 && res.record.dice === null && res.record.rolled === null,
  "a typed count stocks without any table");
register();

let spent = 0;
const counting = (...values) => { const r = rig(...values); return () => { spent++; return r(); }; };
res = stockHex({ row: "grassland", terrain: "grassland", territory: "unsettled", judgeCount: 1, rng: counting(face(4, 4), face(5, 20), face(5, 100)) });
assert.equal(res.record.count, 1, "the typed count beats a roll of four");
assert.equal(res.record.rolled, null, "…and the dice are not rolled");
assert.equal(spent, 2, "…so the only rolls spent are the lair's rarity and creature");
assert.equal(res.record.dice, "1d4", "the row's dice stay on the record for a later false count");
res = stockHex({ row: "grassland", terrain: "grassland", territory: "unsettled", judgeCount: 0, rng: rig(face(4, 4)) });
assert.ok(res.ok && res.record.count === 0 && res.record.points.length === 0 && res.record.judgeCount === 0, "zero is a count");
res = stockHex({ row: "grassland", terrain: "grassland", territory: "borderlands", judgeCount: 3, rng: rig() });
assert.equal(res.record.count, 3, "the Judge's count is not scaled by the share");
for (const bad of [-1, 1.5, "2", NaN]) {
  res = stockHex({ row: "grassland", terrain: "grassland", territory: "unsettled", judgeCount: bad, rng: rig(face(2, 4), face(5, 20), face(5, 100), face(5, 20), face(5, 100)) });
  assert.ok(res.ok && res.record.judgeCount === null && res.record.count === 2, `${String(bad)} is not a count; the dice roll`);
}

/* --- substitution ----------------------------------------------------------- */
res = stockHex({
  row: null, terrain: "grassland", territory: "unsettled", judgeCount: 4, substitute: true, mintId: counter("s"),
  rng: rig(
    face(2, 8), face(5, 20), face(5, 100), // lair: rarity, creature
    face(5, 8), face(3, 12), // valuable: its list roll
    face(7, 8), face(2, 12), // dangerous
    face(8, 8), face(4, 12), // unique
  ),
});
assert.ok(res.ok);
assert.equal(res.record.substitute, true);
assert.deepEqual(res.record.points.map((p) => p.kind), ["lair", "valuable", "dangerous", "unique"]);
assert.deepEqual(res.record.points.map((p) => p.sub), [{ roll: 2, die: 8 }, { roll: 5, die: 8 }, { roll: 7, die: 8 }, { roll: 8, die: 8 }],
  "the die is the bands' top");
assert.deepEqual(res.record.points.map((p) => p.name), ["QQ Prowler", "QQ V3", "QQ D2", "QQ U4"]);
assert.equal(res.record.points[0].draw, null, "a lair keeps no terrain draw");
assert.equal(res.record.points[1].creature, null, "a terrain find keeps no creature");
assert.deepEqual([res.record.points[1].draw.kind, res.record.points[1].draw.roll], ["valuable", 3], "…it keeps the draw");

// The whole draw tree is stored on the point.
res = stockHex({ row: null, terrain: "grassland", territory: "unsettled", judgeCount: 1, substitute: true, rng: rig(face(5, 8), face(1, 12), face(2, 12), face(3, 12)) });
const tree = res.record.points[0];
assert.equal(tree.name, "Double");
assert.deepEqual(tree.draw.then.map((n) => n.name), ["QQ V2", "QQ V3"], "a hand-off's nested rolls ride the point");

// A territory's draws read its own rarity column.
res = stockHex({ row: null, terrain: "grassland", territory: "borderlands", judgeCount: 1, rng: rig(face(19, 20), face(5, 100)) });
assert.equal(res.record.points[0].rarity, "common", "the settled territory's rarity column is the one thrown");

// Bands the import lacks are reported, not guessed.
register({ lairSubstitution: undefined });
res = stockHex({ row: null, terrain: "grassland", territory: "unsettled", judgeCount: 2, substitute: true, rng: rig() });
assert.deepEqual([res.ok, res.needsSubstitution, res.reason], [false, true, "lairSubstitution"]);
res = stockHex({ row: null, terrain: "grassland", territory: "unsettled", judgeCount: 1, rng: rig(face(5, 20), face(5, 100)) });
assert.ok(res.ok, "…and only when substitution was asked for");
register();

/* --- finds, per formation ------------------------------------------------- */
const base = deepFreeze(stockHex({
  row: null, terrain: "grassland", territory: "unsettled", judgeCount: 3, mintId: counter("f"),
  rng: rig(face(5, 20), face(5, 100), face(5, 20), face(5, 100), face(5, 20), face(5, 100)),
}).record);
assert.deepEqual(unfoundPoints(base, "A").map((p) => p.id), ["f1", "f2", "f3"]);
const foundA = markFound(base, "f2", "A", 900);
assert.notEqual(foundA, base, "marking a find returns a new record");
assert.deepEqual(base.points[1].found, {}, "…and leaves the input alone");
assert.deepEqual(unfoundPoints(foundA, "A").map((p) => p.id), ["f1", "f3"], "the formation that found it no longer sees it");
assert.deepEqual(unfoundPoints(foundA, "B").map((p) => p.id), ["f1", "f2", "f3"], "another formation still does");
assert.equal(foundA.points[1].found.A, 900);
const foundB = markFound(foundA, "f2", "B", 1200);
assert.deepEqual(foundB.points[1].found, { A: 900, B: 1200 }, "two formations can each find the same point");
assert.deepEqual(unfoundPoints(foundB, "B").map((p) => p.id), ["f1", "f3"]);
const atZero = markFound(base, "f1", "A", 0);
assert.deepEqual(unfoundPoints(atZero, "A").map((p) => p.id), ["f2", "f3"], "a find at world time zero is a find");
assert.deepEqual(markFound(base, "nope", "A", 5).points, base.points, "an unknown point changes nothing");
assert.deepEqual(unfoundPoints(null, "A"), []);

/* --- search credit and assessments ----------------------------------------- */
const credited = creditSearch(base, "A");
assert.deepEqual(base.searches, {}, "credit leaves the input alone");
assert.deepEqual(credited.searches, { A: 1 });
assert.deepEqual(creditSearch(creditSearch(credited, "A"), "B").searches, { A: 2, B: 1 }, "credit counts per formation");
const told = recordAssessment(base, "A", { told: 4, trustworthy: false, at: 77 });
assert.deepEqual(told.assessments, { A: { told: 4, trustworthy: false, at: 77 } });
assert.deepEqual(base.assessments, {}, "an assessment leaves the input alone");
assert.deepEqual(recordAssessment(told, "B", { told: 3, trustworthy: true, at: 80 }).assessments.A, told.assessments.A,
  "another formation's assessment is kept");

/* --- the false count ------------------------------------------------------- */
const diceRecord = { dice: "1d4", share: null };
let fc = falseCount({ record: diceRecord, truth: 2, rng: rig(face(2, 4), face(2, 4), face(3, 4)) });
assert.deepEqual(fc, { n: 3 }, "a roll equal to the truth is rolled again");
fc = falseCount({ record: { dice: "1d4", share: 0.5 }, truth: 2, rng: rig(face(3, 4)) });
assert.deepEqual(fc, { n: 1 }, "the share is applied to the false roll, ties down");
let seed = 7;
const lcg = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
for (let i = 0; i < 200; i++) {
  const truth = 1 + (i % 4);
  const got = falseCount({ record: diceRecord, truth, rng: lcg });
  assert.ok(got.askJudge || (got.n !== truth && Number.isInteger(got.n)), `a false count is never the truth (${truth})`);
}
let draws = 0;
fc = falseCount({ record: diceRecord, truth: 2, tries: 3, rng: () => { draws++; return face(2, 4); } });
assert.deepEqual(fc, { askJudge: true }, "every roll matching the truth hands the question to the Judge");
assert.equal(draws, 3, "…after exactly the tries allowed");
draws = 0;
falseCount({ record: diceRecord, truth: 2, rng: () => { draws++; return face(2, 4); } });
assert.equal(draws, FALSE_COUNT_TRIES, "the default bound is the module constant");
assert.deepEqual(falseCount({ record: { dice: "1d1" }, truth: 1, rng: lcg }), { askJudge: true }, "a die that cannot differ gives up");
assert.deepEqual(falseCount({ record: { dice: null }, truth: 2, rng: lcg }), { askJudge: true }, "no dice, no false count");
assert.deepEqual(falseCount({ record: {}, truth: 2 }), { askJudge: true });
assert.deepEqual(falseCount({ record: { dice: "garbage" }, truth: 2, rng: lcg }), { askJudge: true }, "unrollable dice ask the Judge");

/* --- the panel summary ----------------------------------------------------- */
assert.deepEqual(stockSummary(foundA), {
  stocked: true, count: 3, upTo: false, row: null, dice: null, points: 3, unfound: 2,
}, "a typed count is not a ceiling; a point someone found is no longer unfound");
const rolledSummary = stockSummary(stockHex({ row: "grassland", terrain: "grassland", territory: "unsettled", rng: rig(face(1, 4), face(5, 20), face(5, 100)) }).record);
assert.equal(rolledSummary.upTo, true, "a rolled count is a ceiling");
assert.deepEqual([rolledSummary.row, rolledSummary.dice, rolledSummary.count], ["grassland", "1d4", 1]);
assert.deepEqual(stockSummary(null), { stocked: false, count: 0, upTo: false, row: null, dice: null, points: 0, unfound: 0 });
assert.equal(stockSummary({ stocked: false }).stocked, false);

resetTables();
console.log("test-hex-stock: all checks passed");
