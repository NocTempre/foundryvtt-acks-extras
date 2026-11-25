/**
 * The hoard generator's engine on invented rows: a made-up treasure type, made-up
 * kind names, a coin unit of 37, a d7 band list. No page is read and no figure
 * here is printed anywhere; these checks prove the MACHINERY (the cell grammar,
 * noun matching, the chance and count throws, the die assertions, lot
 * substitution) and never the book. A roller here supplies each total, so every
 * die the engine asks for is asserted: a wrong die must fail by its declared
 * range, not by the value the rig happened to return.
 */
import assert from "node:assert/strict";
import {
  checkBands,
  dealHoard,
  parseCell,
  parseDice,
  resolveNoun,
  rollChecked,
  rollOnBands,
  rollerFrom,
} from "../scripts/treasure/hoard-logic.mjs";
import { seededRng } from "../scripts/lib/template-logic.mjs";

let n = 0;
const ok = (cond, label) => { assert.ok(cond, label); n++; };
const eq = (got, want, label) => { assert.deepEqual(got, want, label); n++; };

/** A roller that returns each queued total on whatever die is asked, recording the asks. */
const scripted = (...totals) => {
  const q = [...totals];
  const asked = [];
  const roll = (expr) => {
    asked.push(expr);
    const p = parseDice(expr);
    return { total: q.shift(), sides: p.sides };
  };
  roll.asked = asked;
  roll.left = () => q.length;
  return roll;
};
/** A roller that throws the wrong die: it reports six faces whatever it is asked. */
const sixSided = (total) => () => ({ total, sides: 6 });

/* --- dice ------------------------------------------------------------------ */
eq(parseDice("2d4"), { count: 2, sides: 4, mod: 0, min: 2, max: 8 }, "NdM range");
eq(parseDice("d7+30"), { count: 1, sides: 7, mod: 30, min: 31, max: 37 }, "a bare d with a modifier shifts the range");
eq(parseDice("9").sides, null, "a whole number is not thrown");
eq(parseDice("d"), null, "no faces");
eq(parseDice("0d6"), null, "no dice");

/* --- the cell grammar ------------------------------------------------------- */
eq(parseCell("40% 1d4", { column: "c1" }), { terms: [{ chance: 40, count: "1d4", noun: null, column: "c1" }], note: null }, "chance, dice, noun left to the column");
eq(parseCell("30% 1d6 glimmerstones").terms[0], { chance: 30, count: "1d6", noun: "glimmerstones", column: null }, "chance, dice, noun");
eq(parseCell("2d6 wonders").terms[0].chance, null, "no chance is no throw");
eq(parseCell("7 wonders").terms[0].count, "7", "a whole count");
eq(parseCell("0% Nothing here").terms, [{ chance: 0, count: null, noun: null, column: null }], "a zero chance never fires and its remainder is not read");
eq(parseCell("wonders 2").terms[0], { chance: null, count: "2", noun: "wonders", nounFirst: true, column: null }, "noun then count");
eq(parseCell("10% wonders 3 (1,537gp)"), { terms: [{ chance: 10, count: "3", noun: "wonders", nounFirst: true, column: null }], note: "(1,537gp)" }, "a trailing average is set aside");
ok(parseCell("whatever 2").terms[0].nounFirst === true, "a noun-first clause carries nounFirst");
ok(parseCell("2 widget").terms[0].nounFirst !== true, "a count-first clause does not carry nounFirst");
eq(parseCell("25% whatever 3 + 1 widget").terms.map((t) => [t.noun, t.count, t.nounFirst === true]), [["whatever", "3", true], ["widget", "1", false]], "a mixed cell reads one clause of each order");
eq(parseCell("50% 1 thing, gizmo, or doodad; 20% 2 wonders").terms.map((t) => [t.chance, t.count, t.noun]), [[50, "1", "thing, gizmo, or doodad"], [20, "2", "wonders"]], "a semicolon splits; commas inside a noun do not");
eq(parseCell("50% 1 wonders, 25% 1d2 relics, 5% 1 doodad").terms.map((t) => t.noun), ["wonders", "relics", "doodad"], "a comma before a figure splits");
eq(parseCell("any 3 + 1 wonders + 2 relics").terms.map((t) => [t.noun, t.count]), [["any", "3"], ["wonders", "1"], ["relics", "2"]], "a plus splits");
eq(parseCell("d100+80 gems").terms[0].count, "d100+80", "a count with a modifier");
for (const empty of [null, undefined, "", "   ", "-", "—", "– –"]) eq(parseCell(empty), { terms: [], note: null }, `nothing in the cell: ${JSON.stringify(empty)}`);

// Failing cells are typed results and never throw.
for (const bad of ["???", "wonders", "ten glimmerstones"]) {
  const r = parseCell(bad);
  ok(r.error?.code === "unparseable" && r.error.cell === bad, `unparseable cell: ${bad}`);
}
eq(parseCell("3% wonders").error.code, "missing-count", "a chance and a noun with no count is not guessed at 1");
eq(parseCell("30%").error.code, "missing-count", "a chance alone");
eq(parseCell("130% 1d4").error.code, "bad-chance", "a chance above 100");
eq(parseCell("20% 1d4; ???").error.code, "unparseable", "one bad clause fails the cell");

/* --- nouns matched against the kinds passed in ------------------------------- */
const KINDS = [
  { key: "c1", pool: "coins", column: "c1", names: ["quills"] },
  { key: "c2", pool: "coins", column: "c2", names: ["marks"] },
  { key: "glim", pool: "gems", column: "gems", names: ["glimmerstones", "glimmerstone"], values: "gv", die: "2d4" },
  { key: "spk", pool: "gems", column: "gems", names: ["Sparkles"], values: "gv", die: "d3+6" },
  { key: "bng", pool: "jewelry", column: "jewelry", names: ["bangles"], values: "jv", die: "1d7" },
  { key: "wnd", pool: "magic", column: "magic", names: ["wonders", "any"], tableRef: "tref-w" },
  { key: "dood", pool: "magic", column: "magic", names: ["thing, gizmo, or doodad"], tableRef: "tref-d" },
  { key: "twin1", pool: "magic", column: "magic", names: ["twin"] },
  { key: "twin2", pool: "magic", column: "magic", names: ["twin"] },
];
eq(resolveNoun("Glimmerstones", KINDS, "gems").kind.key, "glim", "case folds");
eq(resolveNoun("  sparkles. ", KINDS, "gems").kind.key, "spk", "edge punctuation and space fold");
eq(resolveNoun("thing, gizmo, or doodad", KINDS, "magic").kind.key, "dood", "a noun phrase matches whole");
eq(resolveNoun(null, KINDS, "c1").kind.key, "c1", "a column with one kind names it");
eq(resolveNoun(null, KINDS, "gems").error.code, "noun-missing", "a column with two kinds needs a noun");
eq(resolveNoun(null, KINDS, "nowhere").error.code, "unknown-noun", "a column no kind holds");
eq(resolveNoun("fizzlers", KINDS, "gems").error, { code: "unknown-noun", noun: "fizzlers", column: "gems" }, "a noun no kind names is reported with the noun");
eq(resolveNoun("twin", KINDS, "magic").error.code, "ambiguous-noun", "two kinds with one name is not first-wins");
eq(resolveNoun("bangles", KINDS, "gems").error.code, "column-mismatch", "a noun from another column");
eq(resolveNoun("wond", KINDS, "magic").error.code, "unknown-noun", "no prefix or plural guessing");

/* --- band lists held to their die -------------------------------------------- */
const band = (...edges) => edges.map(([min, max, value]) => ({ min, max, value, type: `t${min}` }));
const D7 = band([1, 2, "5"], [3, 3, "6"], [4, 7, "9"]);
eq(checkBands(D7, { min: 1, max: 7 }, { exact: true }).bands.length, 3, "a d7 list tiles its die exactly");
eq(checkBands(band([1, 2], [3, 5]), { min: 1, max: 7 }).error.code, "band-short", "the top band stops short of the die");
eq(checkBands(band([1, 2], [4, 7]), { min: 1, max: 7 }).error, { code: "band-gap", after: 2 }, "a gap");
eq(checkBands(band([1, 3], [3, 7]), { min: 1, max: 7 }).error, { code: "band-overlap", at: 3 }, "an overlap");
eq(checkBands(band([2, 7]), { min: 1, max: 7 }).error.code, "band-start", "the lowest throw is not on a band");
eq(checkBands([...D7.slice(0, 2), { __missing: true }], { min: 1, max: 7 }).error.code, "band-bad-edge", "a missing-row placeholder is a gap");
eq(checkBands(band([1, 9]), { min: 1, max: 7 }, { exact: true }).error.code, "band-over", "an exact list reaching past the die");
ok(!checkBands(band([1, 9]), { min: 1, max: 7 }).error, "a shared list may reach past one die's range");
eq(checkBands([{ lo: 1, hi: 4 }, { lo: 5, hi: 7 }], { min: 1, max: 7 }).bands.length, 2, "lo/hi edges read as min/max");
eq(checkBands([], { min: 1, max: 7 }).error.code, "bands-empty", "an empty list");
eq(checkBands(band([1, 2], [2, 1]), { min: 1, max: 2 }).error.code, "band-bad-edge", "a band whose max is under its min");

// The die is asserted, not trusted: a list of twenty bands read on a d6.
const D20 = Array.from({ length: 20 }, (_, i) => ({ min: i + 1, max: i + 1, result: `r${i + 1}` }));
eq(rollOnBands({ bands: D20 }, "1d6", scripted(4), { exact: true }).error.code, "band-over", "a d20 list declared on a d6 is refused by its range, whatever the roll");
eq(rollOnBands({ bands: D20 }, "1d20", sixSided(4), { exact: true }).error, { code: "die-mismatch", expr: "1d20", expected: 20, got: 6 }, "a d6 roll offered to a d20 list is refused by its faces");
eq(rollOnBands({ bands: D20 }, "1d20", scripted(4), { exact: true }).row.result, "r4", "the same list on its own die rolls");
eq(rollOnBands({ bands: D20 }, "1d20", scripted(21), { exact: true }).error.code, "roll-out-of-range", "a total above the die");
eq(rollOnBands({ bands: D20 }, "1d20", scripted(0), { exact: true }).error.code, "roll-out-of-range", "a total below the die");
eq(rollOnBands({ bands: D20 }, null, scripted(4)).error.code, "die-unknown", "no die supplied is never derived from the top band");
eq(rollOnBands({ bands: D20 }, "banana", scripted(4)).error.code, "die-unreadable", "an unreadable die");
eq(rollOnBands({ bands: D7 }, "2d3", scripted(6)).row.value, "9", "a multi-die expression is held to its sum range");
eq(rollChecked(scripted(null), "1d4").error.code, "roll-failed", "a roller that returns no total");

/* --- the chance throw, at both edges ------------------------------------------ */
const ROW = (cell, col = "c1") => ({ type: { rows: { ZZ9: { category: "x", avgValue: "1", [col]: cell } }, cite: "INV type" } });
const dealCell = (cell, rolls, extra = {}) => dealHoard({ type: "ZZ9", tables: ROW(cell), kinds: KINDS, roll: scripted(...rolls), units: { coin: 37 }, ...extra });
eq(dealCell("30% 1d4", [30, 2]).cards.length, 1, "a throw equal to the chance succeeds");
eq(dealCell("30% 1d4", [31]).cards.length, 0, "a throw one above the chance fails");
eq(dealCell("1% 1d4", [1, 2]).cards.length, 1, "a one-in-a-hundred chance on a 1");
eq(dealCell("1% 1d4", [2]).cards.length, 0, "a one-in-a-hundred chance on a 2");
eq(dealCell("100% 1d4", [100, 2]).cards.length, 1, "a certain chance on the top of the die");
eq(dealCell("30% 1d4", [101]).errors[0].code, "roll-out-of-range", "a percentile throw above 100 is an error, not a miss");
eq(dealCell("30% 1d4", [0]).errors[0].code, "roll-out-of-range", "a percentile throw of 0 is an error");
eq(dealCell("30% 1d4", [30], {}).audit[0], { where: "ZZ9.c1", expr: "1d100", sides: 100, min: 1, max: 100, total: 30, cite: "INV type", chance: 30, hit: true }, "a throw is audited with its die, range, total and cite");
eq(dealHoard({ type: "ZZ9", tables: ROW("30% 1d4"), kinds: KINDS, roll: sixSided(3), units: { coin: 37 } }).errors[0].code, "die-mismatch", "a roller on the wrong die is caught in a deal");

/* --- a whole hoard ------------------------------------------------------------ */
const VALUES = {
  gv: { cite: "INV gem list", bands: [{ min: 1, max: 3, value: "10", type: "Alpha stone" }, { min: 4, max: 6, value: "1,257", type: "Beta stone" }, { min: 7, max: 9, value: "2,003", type: "Gamma stone" }] },
  jv: { cite: "INV jewelry list", die: "1d7", bands: [{ min: 1, max: 4, value: "40", type: "Armlet" }, { min: 5, max: 7, value: "90", type: "Circlet" }] },
};
const TABLES = {
  type: { cite: "INV type", rows: { ZZ9: { category: "Hoarder", avgValue: "123gp", c1: "100% 1d4", c2: "0% None", gems: "100% 2 glimmerstones", jewelry: "50% 1d3 bangles", magic: "wonders 2; 100% 1 thing, gizmo, or doodad (777gp)" } } },
  values: VALUES,
};
let deal = dealHoard({ type: "ZZ9", tables: TABLES, kinds: KINDS, roll: scripted(40, 3, 7, 3, 8, 51, 100), units: { coin: 37 } });
eq(deal.errors, [], "a clean deal reports nothing");
eq(deal.cards, [
  { pool: "coins", coin: { key: "c1", count: 111 }, label: "quills", cite: "INV type" },
  { pool: "gems", valueGp: 10, label: "Alpha stone", cite: "INV gem list" },
  { pool: "gems", valueGp: 2003, label: "Gamma stone", cite: "INV gem list" },
  { pool: "magic", tableRef: "tref-w", label: "wonders", cite: "INV type" },
  { pool: "magic", tableRef: "tref-w", label: "wonders", cite: "INV type" },
  { pool: "magic", tableRef: "tref-d", label: "thing, gizmo, or doodad", cite: "INV type" },
], "coins count in the supplied unit, each gem is thrown on its list, a missed chance deals nothing, magic is a placeholder per unit");
ok(deal.audit.every((a) => a.cite), "every audited throw carries a cite");
ok(deal.audit.filter((a) => a.expr === "2d4").every((a) => a.min === 2 && a.max === 8), "the gem dice are audited with their range");
eq(deal.audit.find((a) => a.chance === 50), { where: "ZZ9.jewelry", expr: "1d100", sides: 100, min: 1, max: 100, total: 51, cite: "INV type", chance: 50, hit: false }, "the missed chance is in the audit");

// The jewelry list rolled on its own die.
const JEW = { ...TABLES, type: { cite: "INV type", rows: { ZZ9: { jewelry: "1 bangles" } } } };
deal = dealHoard({ type: "ZZ9", tables: JEW, kinds: KINDS, roll: scripted(5), units: {} });
eq(deal.cards, [{ pool: "jewelry", valueGp: 90, label: "Circlet", cite: "INV jewelry list" }], "a whole-number count is not thrown, the unit is");
eq(deal.audit[0].expr, "1d7", "the jewelry list is thrown on the die its kind declares");

// A value printed as a throw is thrown on the deal's roller and multiplied.
const THROWN = { cite: "INV thrown list", die: "1d7", bands: [
  { min: 1, max: 2, value: "1d4 × 10", type: "Ring" },
  { min: 3, max: 3, value: "2d6", type: "Brooch" },
  { min: 4, max: 4, value: "3d6 x 1,000", type: "Tiara" },
  { min: 5, max: 5, value: "d8+1*100", type: "Chain" },
  { min: 6, max: 6, value: "75", type: "Pin" },
  { min: 7, max: 7, value: "lots", type: "Mystery" },
] };
const dealThrown = (...rolls) => dealHoard({ type: "ZZ9", tables: { ...JEW, values: { ...VALUES, jv: THROWN } }, kinds: KINDS, roll: scripted(...rolls), units: {} });
deal = dealThrown(2, 3);
eq(deal.errors, [], "a value printed as a throw is dealt");
eq(deal.cards, [{ pool: "jewelry", valueGp: 30, label: "Ring", cite: "INV thrown list" }], "the throw times the figure is the worth");
eq(deal.audit, [
  { where: "ZZ9.jewelry", expr: "1d7", sides: 7, min: 1, max: 7, total: 2, cite: "INV thrown list", valueGp: 30 },
  { where: "ZZ9.jewelry", expr: "1d4", sides: 4, min: 1, max: 4, total: 3, cite: "INV thrown list", valueGp: 30, value: true },
], "the band throw and the value throw are both audited, the second marked as the value's");
eq(dealThrown(3, 9).cards[0].valueGp, 9, "a dice expression alone is the worth as thrown");
eq(dealThrown(4, 11).cards[0].valueGp, 11000, "the figure may carry a thousands comma and the sign may be an x");
eq(dealThrown(5, 9).cards[0].valueGp, 900, "a modifier and a star sign are read, the range running to the modifier");
const plain = dealThrown(6);
eq([plain.errors, plain.cards[0].valueGp, plain.audit.length], [[], 75, 1], "a plain figure beside the throws is not thrown");
const bad = dealThrown(7);
eq([bad.errors.map((e) => e.code), bad.cards], [["bad-value"], []], "an unreadable value is still refused");
eq(dealThrown(1, 5).errors[0].code, "roll-out-of-range", "a value throw outside its die is caught");
eq(dealHoard({ type: "ZZ9", tables: { ...JEW, values: { ...VALUES, jv: THROWN } }, kinds: KINDS, roll: sixSided(1), units: {} }).errors.length, 1, "a roller on the wrong die fails the deal's throw");

{
  // On a seeded production roller, every thrown value is its throw times its figure.
  const only = { ...THROWN, bands: [{ min: 1, max: 7, value: "1d4 × 10", type: "Ring" }] };
  const seeded = rollerFrom(seededRng(11));
  let sound = true;
  let seen = 0;
  for (let i = 0; i < 100; i++) {
    const d = dealHoard({ type: "ZZ9", tables: { ...JEW, values: { ...VALUES, jv: only } }, kinds: KINDS, roll: seeded, units: {} });
    const v = d.audit.find((a) => a.value);
    seen++;
    if (d.errors.length || !v || v.valueGp !== v.total * 10 || d.cards[0].valueGp !== v.valueGp || v.min !== 1 || v.max !== 4) sound = false;
  }
  ok(sound && seen === 100, "a seeded roller's thrown values are each the throw times its figure, in the audit and on the card");
}

// Failures are reported beside what still dealt.
const MIXED = { ...TABLES, type: { cite: "INV type", rows: { ZZ9: { c1: "100% 1d4", c2: "100% 1d4", gems: "100% 1 fizzlers", jewelry: "???", magic: "1 wonders" } } } };
deal = dealHoard({ type: "ZZ9", tables: MIXED, kinds: KINDS, roll: scripted(10, 2, 10, 2), units: { c1: 37 } });
eq(deal.errors.map((e) => [e.where, e.code]), [["ZZ9.c1", "unit-missing"], ["ZZ9.c2", "unit-missing"], ["ZZ9.gems", "unknown-noun"], ["ZZ9.jewelry", "unparseable"]], "each failure is typed and placed, in column order");
eq(deal.cards.map((c) => c.pool), ["magic"], "what could be dealt still is");
eq(deal.errors[2].noun, "fizzlers", "an unmatched noun is named, not dropped");
eq(dealHoard({ type: "NOPE", tables: TABLES, kinds: KINDS, roll: scripted(), units: {} }).errors, [{ code: "unknown-type", type: "NOPE" }], "a type the table does not have");

// A gem kind with no die, and a missing list.
const NODIE = KINDS.map((k) => (k.key === "glim" ? { ...k, die: undefined } : k));
eq(dealHoard({ type: "ZZ9", tables: TABLES, kinds: NODIE, roll: scripted(1, 1, 1, 99, 1), units: { coin: 37 } }).errors.find((e) => e.where === "ZZ9.gems").code, "die-unknown", "no legend die for a kind is reported");
eq(dealHoard({ type: "ZZ9", tables: { ...TABLES, values: {} }, kinds: KINDS, roll: scripted(1, 1, 1, 99, 1), units: { coin: 37 } }).errors.find((e) => e.where === "ZZ9.gems").code, "table-missing", "a band list that was not imported");
// A shared list whose reach is short of one grade's die.
eq(dealHoard({ type: "ZZ9", tables: { ...TABLES, values: { ...VALUES, gv: { bands: VALUES.gv.bands.slice(0, 2) } } }, kinds: KINDS, roll: scripted(1, 1, 1, 99, 1), units: { coin: 37 } }).errors.find((e) => e.where === "ZZ9.gems").code, "band-short", "a list that stops under the die's top");
// The coin unit may be a map.
eq(dealCell("100% 1d4", [100, 2], { units: { coin: { c1: 5 } } }).cards[0].coin.count, 10, "a per-coin unit map");

/* --- special treasure ---------------------------------------------------------- */
const SPECIAL_BANDS = [{ min: 1, max: 1, result: "stays" }, { min: 2, max: 2, result: "40 quills" }, { min: 3, max: 3, result: "2d3 crates of flotsam" }, { min: 4, max: 4, result: "a bauble" }];
const withSpecial = (special, row) => ({ type: { cite: "INV type", rows: { ZY1: row } }, values: VALUES, special });
const SPECIAL = { c1: { bands: SPECIAL_BANDS, die: "1d4", per: 50, cite: "INV special c1", keep: ["Stays"] } };
const dealSp = (row, rolls, special = SPECIAL, extra = {}) => dealHoard({ type: "ZY1", tables: withSpecial(special, row), kinds: KINDS, roll: scripted(...rolls), units: { coin: 37 }, ...extra });
// 4 x 37 = 148 coin = two lots of 50 and a remainder of 48.
deal = dealSp({ c1: "1d4" }, [4, 1, 3]);
eq(deal.errors, [], "special deal is clean");
eq(deal.cards, [{ pool: "coins", coin: { key: "c1", count: 98 }, label: "quills", cite: "INV type" }, { pool: "special", label: "2d3 crates of flotsam", cite: "INV special c1" }], "a lot kept stays, a lot replaced leaves the coin and deals the result; the remainder is no lot");
eq(deal.audit.filter((a) => a.special).map((a) => [a.where, a.expr, a.total, a.cite]), [["special.c1", "1d4", 1, "INV special c1"], ["special.c1", "1d4", 3, "INV special c1"]], "one throw per lot, audited with its list's cite");
deal = dealSp({ c1: "1d4" }, [4, 2, 2]);
eq(deal.cards, [{ pool: "coins", coin: { key: "c1", count: 148 - 100 + 80 }, label: "quills", cite: "INV type" }], "a result that counts a coin kind returns coin to its card");
deal = dealSp({ c1: "1d4" }, [4, 2, 2], { c1: { ...SPECIAL.c1, bands: [{ min: 1, max: 4, result: "40 quills (3 st)" }] } });
eq(deal.cards, [{ pool: "coins", coin: { key: "c1", count: 148 - 100 + 80 }, label: "quills", cite: "INV type" }], "a coin result's trailing note is set aside, not read as part of the coin's name");
deal = dealSp({ c1: "1d4" }, [1]);
eq(deal.cards.length, 1, "a count under one lot throws nothing on the special list");
eq(deal.audit.filter((a) => a.special).length, 0, "and audits nothing");
deal = dealSp({ c1: "1d4" }, [1, 4], { c1: { ...SPECIAL.c1, per: 37 } });
eq(deal.cards, [{ pool: "special", label: "a bauble", cite: "INV special c1" }], "a lot that takes the whole coin card empties it, and an empty card is dropped");
deal = dealSp({ gems: "1 glimmerstones" }, [5, 3], { glim: { bands: [{ min: 1, max: 3, result: "a trinket" }], die: "1d3", cite: "INV special glim" } });
eq(deal.cards, [{ pool: "special", label: "a trinket", cite: "INV special glim" }], "a gem is a lot of one and the result replaces it");
deal = dealSp({ gems: "1 glimmerstones" }, [5, 1], { glim: { bands: [{ min: 1, max: 3, result: "same" }], die: "1d3", keep: ["SAME"] } });
eq(deal.cards.map((c) => c.pool), ["gems"], "a kept result leaves the gem");
eq(dealSp({ c1: "1d4" }, [4], { c1: { ...SPECIAL.c1, per: undefined } }).errors[0].code, "lot-unit-missing", "a coin list with no lot size is reported");
eq(dealSp({ c1: "1d4" }, [4], {}).errors[0], { code: "table-missing", table: "c1", where: "special.c1" }, "a special list that was not imported");
eq(dealSp({ c1: "1d4" }, [4], { c1: { ...SPECIAL.c1, die: "1d6" } }).errors[0].code, "band-short", "a special list tiling a d4 offered on a d6");
eq(dealSp({ c1: "1d4" }, [4], { c1: { ...SPECIAL.c1, bands: D20, die: "1d6" } }).errors[0].code, "band-over", "a d20 special list declared on a d6");
eq(dealSp({ c1: "1d4" }, [4], { c1: { ...SPECIAL.c1, die: undefined } }).errors[0].code, "die-unknown", "a special list with no die");
eq(dealSp({ c1: "1d4" }, [4], SPECIAL, { special: false }).cards.length, 1, "special substitution can be turned off");
eq(dealHoard({ type: "ZY1", tables: { type: withSpecial(undefined, { c1: "1d4" }).type, values: VALUES }, kinds: KINDS, roll: scripted(4), units: { coin: 37 } }).cards[0].coin.count, 148, "no special tables supplied, none thrown");

/* --- the production roller contract ---------------------------------------------- */
const real = rollerFrom(seededRng(7));
let inRange = true;
for (let i = 0; i < 200; i++) {
  const r = rollChecked(real, "2d4");
  if (r.error || r.total < 2 || r.total > 8 || r.sides !== 4) inRange = false;
}
ok(inRange, "a roller built on an rng throws its die and passes the checks");
eq(real("banana"), null, "an unreadable expression is no roll");
eq(deal.errors, [], "the last deal was clean");

console.log(`test-hoard-logic: ${n} checks passed`);
