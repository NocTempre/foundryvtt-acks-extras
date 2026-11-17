/**
 * The hoard's registry seam on invented rows: made-up kinds, a made-up coin
 * unit of 37, made-up coins and a made-up legend. No page is read and no figure
 * here is printed anywhere; these checks prove the MAPPING (which imported
 * table becomes which engine argument, which column is skipped and why, how an
 * engine card becomes a truth) and never the book.
 */
import assert from "node:assert/strict";
import { dealHoard, parseDice } from "../scripts/treasure/hoard-logic.mjs";
import { COIN_KEYS, GEM_LISTS, JEWELRY_LISTS, buildKinds, coinNamesIn, figureOf, formsOf, mapHoardArgs, truthsFromCards } from "../scripts/treasure/hoard-map.mjs";

let n = 0;
const ok = (cond, label) => { assert.ok(cond, label); n++; };
const eq = (got, want, label) => { assert.deepEqual(got, want, label); n++; };

/** A roller that returns each queued total on whatever die is asked, recording the asks. */
const scripted = (...totals) => {
  const q = [...totals];
  const roll = (expr) => ({ total: q.shift(), sides: parseDice(expr).sides });
  roll.left = () => q.length;
  return roll;
};

const band = (min, max, rest) => ({ min, max, ...rest });
const doc = () => ({
  typeClassic: {
    Z: { category: "Odds", avgValue: "5gp", cp: "2d4", sp: null, ep: null, gp: "40% 1d3", pp: null, gems: "1d2 sparks", jewelry: "20% 1 bangles", magic: "10% 1 wonders" },
    Y: { category: "Ends", avgValue: null, cp: "1d4 tokens", sp: null, ep: null, gp: null, pp: null, gems: null, jewelry: null, magic: null },
  },
  typeUnits: { classic: { cp: "37s", sp: "37s", ep: "37s", gp: "37s", pp: "37s" } },
  gemDice: { legend: [{ dice: "d4", avg: "2", kind: "Glint" }, { dice: "d6", avg: "3", kind: "Spark" }, { dice: "d8", avg: "4", kind: "Blaze" }] },
  jewelryDice: { legend: [{ dice: "d8", avg: "4", kind: "Bangles" }, { dice: "d6", avg: "3", kind: "Bauble" }, { dice: "d4", avg: "2", kind: "Crown" }] },
  gemValue: { bands: [band(1, 2, { value: "4", type: "dull pebble" }), band(3, 4, { value: "1,200", type: "glassy pebble" }), band(5, 6, { value: "9", type: "x" }), band(7, 8, { value: "9", type: "y" })] },
  jewelryValue: { bands: [band(1, 6, { value: "5", type: "wire loop" }), band(7, 8, { value: "30", type: "tin ring" })] },
  special: {
    cp: [band(1, 3, { result: "100 tin coins (1 st)" }), band(4, 6, { result: "Odd trinket" })],
    gp: [band(1, 4, { result: "100 tin coins" }), band(5, 6, { result: "20 brass coins" })],
    gem: [band(1, 5, { result: "1 spark" }), band(6, 6, { result: "Strange phial" })],
    trinket: [band(1, 2, { result: "1 bangle" }), band(3, 4, { result: "Odd trinket" })],
  },
  specialPer: { cp: "100 coins", gp: "50 coins", gem: "Spark (30 coins)" },
});
const citeFor = (id) => `INV ${id}`;
const COINS = { cp: { name: "Tin", cv: 1 }, gp: { name: "Brass", cv: 100, weight6: (count) => count / 10 } };
const coinOf = (key) => COINS[key] ?? null;

const COIN_NAMES = { cp: "Tin", gp: "Brass" };
const run = (tables, letter, rolls, { toggles, style = "classic", coins = coinOf, special = true } = {}) => {
  const mapped = mapHoardArgs({ tables, letter, style, toggles, special, coinNames: COIN_NAMES, cite: citeFor });
  if (mapped.error) return { mapped };
  const roll = scripted(...rolls);
  const dealt = dealHoard({ ...mapped.args, roll });
  return { mapped, dealt, roll, ...truthsFromCards(dealt.cards, { coinOf: coins, format: (c) => `#${c}` }) };
};

/* --- figures ------------------------------------------------------------------ */
eq(figureOf("37s"), 37, "a unit text's first figure");
eq(figureOf("x 1,234 coins"), 1234, "a separated figure");
eq(figureOf("no figure"), null, "no figure is null, never zero");
eq(figureOf(null), null, "null");

/* --- the whole deal, every table mapped ---------------------------------------- */
{
  const r = run(doc(), "Z", [5, 30, 2, 1, 3, 10, 7, 5, 2, 6, 6, 1]);
  eq(r.dealt.errors, [], "no engine error");
  eq(r.errors, [], "no truth error");
  eq(r.roll.left(), 0, "every scripted throw was asked for");
  eq(r.mapped.cite, "INV typeClassic", "the type table's cite");
  eq(r.truths.map((t) => [t.pool, t.label]), [
    ["coins", "#185 Tin"],
    ["coins", "#44 Brass"],
    ["jewelry", "tin ring"],
    ["magic", "wonders"],
    ["special", "Strange phial"],
  ], "cards in the order dealt, a special result last: a coin lot swapped for coin joins the card, a gem becomes a special");
  eq(r.truths[0].coin, { name: "Tin", cv: 1, count: 185 }, "a coin truth carries the world's coin and the unit-multiplied count");
  eq(r.truths[1].coin.count, 44, "a special result counting a coin kind joins that coin card");
  eq(r.truths[1].weight6, 4.4, "a coin's weight is the world's, per stack");
  eq(r.truths[2].valueGp, 30, "jewelry carries its band's value");
  eq(r.truths[3].tableRef, "wonders", "a magic placeholder carries the ref T6 resolves");
  eq([r.truths[3].magical, r.truths[3].detected], [true, false], "a magic placeholder is undetected");
  ok(r.dealt.audit.some((a) => a.special && a.expr === "1d6" && a.where === "special.cp"), "a special list is thrown on the die its own bands span");
  ok(r.dealt.audit.some((a) => a.where === "Z.gems" && a.expr === "d6" && a.cite === "INV gemValue"), "a gem kind is thrown on its legend row's die");
  ok(r.dealt.audit.some((a) => a.where === "Z.jewelry" && a.expr === "d8"), "a jewelry kind is thrown on its legend row's die");
}

/* --- special treasure is asked for, and a lot of one's own kind stays ------------- */
{
  const off = run(doc(), "Z", [5, 30, 2, 1, 3, 10, 7, 5], { special: false });
  eq(off.mapped.args.special, false, "special treasure is off unless asked for");
  eq(off.mapped.args.tables.special, undefined, "no special list is read for it");
  eq(off.roll.left(), 0, "and none is thrown");
  eq(off.truths.map((t) => t.pool), ["coins", "coins", "gems", "jewelry", "magic"], "the hoard is the plain one");
  eq(off.mapped.errors, [], "nothing is missing that was not asked for");

  const kept = run(doc(), "Z", [5, 30, 2, 1, 3, 10, 7, 5, 2, 6, 2, 1]);
  ok(kept.truths.some((t) => t.pool === "gems" && t.label === "glassy pebble"), "a gem whose special result says one of its own kind stays a gem");
  ok(!kept.truths.some((t) => t.pool === "special"), "and no special card is made");
  eq(kept.mapped.args.tables.special.gem.keep, ["1 spark"], "the keep list is the list's own one-of-this-kind results");
  eq(kept.mapped.args.tables.special.trinket.keep, ["1 bangle"], "a plural legend kind keeps its singular result");
  eq(kept.mapped.args.tables.special.gp.per, 50, "a coin list's lot is the figure its caption gives");
  eq(kept.mapped.args.tables.special.gem.per, undefined, "and a gem list has none");
}

/* --- names and forms ----------------------------------------------------------------- */
{
  eq(formsOf("Spark"), ["spark", "sparks"], "a singular adds its plural");
  eq(formsOf("Trinkets"), ["trinkets", "trinket"], "a plural adds its singular");
  eq(formsOf("Berry"), ["berry", "berries"], "a y after a consonant");
  eq(formsOf(""), [], "nothing printed, no form");
  eq(coinNamesIn({ cp: [band(1, 3, { result: "100 tin coins (1 st)" }), band(4, 4, { result: "7 tin ingots of the deep" }), band(5, 5, { result: "1d4 tin coins" })] }, { cp: "Tin" }), { cp: ["tin coins"] }, "only a count of the coin and one more word names a coin");
  eq(coinNamesIn({ cp: [band(1, 3, { result: "100 tin coins" })] }, {}), {}, "no world name, no coin name");
  const rows = { A: { magic: "10% 1 wonders" }, B: { magic: "5% 1 Wonders" } };
  const magic = buildKinds({ rows }).kinds.filter((k) => k.pool === "magic");
  eq(magic.map((k) => k.names), [["wonders"]], "a noun spelled two ways by case is one kind, under its first spelling");
  eq(mapHoardArgs({ tables: doc(), letter: "Z", style: "classic" }).args.special, false, "a caller that does not ask gets no special treasure");
  const odd = doc();
  odd.typeClassic.Z.gems = "1d2 gizmos";
  ok(run(odd, "Z", [5, 30, 2, 1, 10, 7, 5, 2, 6, 6, 1]).dealt.errors.some((e) => e.code === "unknown-noun" && e.noun === "gizmos"), "a gem noun the legend does not name is the engine's typed error");
}

/* --- the legend row's place picks the special list ------------------------------ */
{
  const kinds = buildKinds({ rows: doc().typeClassic, gemLegend: doc().gemDice.legend, jewelryLegend: doc().jewelryDice.legend }).kinds;
  const k = (key) => kinds.find((x) => x.key === key);
  eq(GEM_LISTS.map((key) => k(key).die), ["d4", "d6", "d8"], "gem lists take the legend's dice in order");
  eq(JEWELRY_LISTS.map((key) => k(key).names), [["bangles", "bangle"], ["bauble", "baubles"], ["crown", "crowns"]], "jewelry lists take the legend's kinds in order, in either number");
  eq(COIN_KEYS.map((key) => k(key).column), COIN_KEYS, "a coin kind is its column's");
  ok(k("cp").names.includes("tokens"), "a noun a coin column prints names that column's kind");
}

/* --- a noun printed in a coin column resolves by that column --------------------- */
{
  const r = run(doc(), "Y", [3, 2]);
  eq(r.dealt.errors.map((e) => e.code), [], "a coin column's own noun reads");
  eq(r.truths.map((t) => t.coin.count), [111], "3 times the unit, one lot thrown on the special list and left as it was");
}

/* --- the deal toggles ------------------------------------------------------------- */
{
  const r = run(doc(), "Z", [5, 30, 2, 1, 3, 10, 7, 2, 6, 6, 1], { toggles: { noMagic: true, forceCursed: true } });
  ok(!r.truths.some((t) => t.pool === "magic"), "No magic leaves the magic column out");
  eq(r.roll.left(), 0, "and throws none of its dice");
  eq(r.mapped.args.tables.type.rows.Z.magic, undefined, "the row handed to the engine has no magic cell");
  eq(doc().typeClassic.Z.magic, "10% 1 wonders", "the imported row is not touched");
}

/* --- nothing imported deals nothing ------------------------------------------------ */
{
  eq(mapHoardArgs({ tables: {}, letter: "Z", style: "classic" }).error, { code: "not-imported", table: "typeClassic" }, "no type table is a typed error");
  eq(mapHoardArgs({ tables: undefined, letter: "Z", style: "classic" }).error.code, "not-imported", "no tables at all");
  eq(mapHoardArgs({ tables: doc(), letter: "Z", style: "gritty" }).error, { code: "not-imported", table: "typeGritty" }, "a style the books did not print");
  eq(mapHoardArgs({ tables: doc(), letter: "Q", style: "classic" }).error.code, "unknown-type", "a letter the table lacks");
  eq(mapHoardArgs({ tables: doc(), letter: "Z", style: "mild" }).error, { code: "unknown-style", style: "mild" }, "an unknown style");
}

/* --- a gap is named, and the rest is still dealt -------------------------------------- */
{
  const noLegend = doc();
  delete noLegend.gemDice;
  const r = run(noLegend, "Z", [5, 30, 2, 10, 7, 5, 2, 6, 1]);
  eq(r.mapped.errors, [{ code: "column-skipped", column: "gems", reason: "legend-missing" }], "a missing legend skips its column and says why");
  ok(!r.truths.some((t) => t.pool === "gems"), "no gem is dealt without its dice");
  ok(r.truths.some((t) => t.pool === "jewelry"), "the other columns are dealt");

  eq(run(noLegend, "Y", [3, 2]).mapped.errors, [], "a skipped column the dealt type leaves empty is not reported");

  const short = doc();
  short.jewelryDice.legend.pop();
  eq(run(short, "Z", [5, 30, 2, 1, 3, 10, 5, 2, 6, 6]).mapped.errors[0], { code: "column-skipped", column: "jewelry", reason: "legend-shape" }, "a legend short of a row is not paired by guess");

  const wide = doc();
  wide.gemDice.legend[1].dice = "d12";
  const w = run(wide, "Z", [5, 30, 2, 1, 3, 10, 7, 5, 2, 6, 6, 1]);
  ok(w.dealt.errors.some((e) => e.code === "band-short" && e.where === "Z.gems"), "a die the value list does not cover is the engine's error, not a smaller die");

  const noUnits = doc();
  delete noUnits.typeUnits;
  ok(run(noUnits, "Y", [3]).dealt.errors.some((e) => e.code === "unit-missing" && e.key === "cp"), "a coin column with no unit read deals no coin");
  eq(run(noUnits, "Y", [3]).truths, [], "and no truth");

  const noSpecial = doc();
  delete noSpecial.special;
  const s = run(noSpecial, "Y", [3]);
  eq(s.mapped.errors, [{ code: "special-missing" }], "no special list is named once");
  eq(s.truths.map((t) => t.coin.count), [111], "the coin is still dealt, unswapped");

  const noPer = doc();
  delete noPer.specialPer;
  ok(run(noPer, "Y", [3, 1]).dealt.errors.some((e) => e.code === "lot-unit-missing"), "a coin list with no lot unit swaps nothing");

  const noValues = doc();
  delete noValues.gemValue;
  ok(run(noValues, "Z", [5, 30, 2, 1, 10, 7, 5, 2, 6]).dealt.errors.some((e) => e.code === "table-missing"), "a missing value list is the engine's typed error");
}

/* --- the world's coin ------------------------------------------------------------------- */
{
  const r = run(doc(), "Z", [5, 30, 2, 1, 3, 10, 7, 5, 2, 6, 6, 1], { coins: (key) => (key === "cp" ? COINS.cp : null) });
  eq(r.errors, [{ code: "coin-missing", key: "gp" }], "a coin the world has none of is named");
  ok(!r.truths.some((t) => t.coin?.name === "Brass"), "and its card is left out, valued at nothing");
  eq(truthsFromCards([{ pool: "coins", coin: { key: "cp", count: 3 } }], { coinOf: () => ({ name: "Tin", cv: 0 }) }).errors.length, 1, "a coin with no rate is not a coin");
  eq(truthsFromCards([{ pool: "odd" }], { coinOf }).errors, [{ code: "unknown-pool", pool: "odd" }], "an unknown pool is typed");
}

console.log(`test-hoard-map: ${n} checks passed`);
