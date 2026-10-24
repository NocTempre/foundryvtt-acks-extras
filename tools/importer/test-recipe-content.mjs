/**
 * LOCAL-ONLY: the table recipes the markets feature, the morale pages and the
 * domain month read, run against this machine's own books, must return the
 * SHAPE their consumers parse. Every recipe here is
 * built from anchor phrases and column geometry, so a printing whose layout
 * drifted from those anchors reads a row short, welds two cells, or drops a
 * value, and each of those degrades to a plausible number downstream. This
 * suite finds them before a Judge does.
 *
 * It asserts structure only: row counts against the recipe's declared row
 * list, no `__missing` placeholder, every declared key present, every cell
 * accepted by the parser that consumes it, ladders contiguous and open at both
 * ends. It never asserts, prints or embeds a value read from the page — a
 * failure names the document, table, key and the check that failed. Skips
 * without the reference books.
 */
import assert from "node:assert";
import fs from "node:fs";
import { openBook, pageItems } from "../../scripts/importer/extract.mjs";
import { extractTable } from "../../scripts/importer/table-extract.mjs";
import { locatePageNumber, recipeLocates } from "../../scripts/importer/tables-binding.mjs";
import { TABLE_RECIPES } from "../../scripts/importer/table-recipes.mjs";
import { isMissingRow, missingRowKeys } from "../../scripts/lib/tables.mjs";
import { parseCell } from "../../scripts/markets/rules/availability.mjs";
import { parseStones, parseTollCpPerSt, parseTariffPct, parseStayFee, diceRange } from "../../scripts/markets/rules/arbitrage.mjs";
import { parseMoneyCp } from "../../scripts/markets/rules/commissions.mjs";
import { FILES } from "./reference-lib.mjs";

/** The tables under test, by recipe document. Each is one entry of `TABLE_RECIPES`. */
const TABLES = {
  availability: ["equipmentAvailability", "marketRulesProse", "bargainingProse"],
  magicItems: ["transactionsByMarketClass", "priceProse", "identifyProse"],
  mercantile: [
    "marketCharacteristics", "merchandiseTypes", "impactProse",
    "assessmentProse", "priceShiftProse", "negotiationProse", "tariffProse",
    "moorageRates",
  ],
  construction: ["wageAndConstructionRates"],
  settlement: ["marketClassByFamilies"],
  // The influence roller's two morale pages: a result column and a modifier
  // list each, every modifier with the wording of its own row.
  morale: ["monsterMorale", "hirelingObedience"],
  // The hiring offer: a result column and the two penalties beside it.
  // The loyalty roll's figure per level of apparent difference.
  influence: ["hiringOffer", "apparentLevel"],
  // The henchman limit's base: one figure the roster counts every hire against.
  // The employer-level cap: the ladder a leveled henchman search is judged on.
  // The level-gain morale bonuses: two levels and the bonus each earns.
  wages: ["henchmanLimit", "employerLevelCap", "levelMorale"],
  // The domain month: every table its procedure runs on.
  domain: [
    "strongholdMinimum", "growth", "prestigeImmigration", "revenue", "expenses", "peace",
    "magistrateShare", "titles", "tribute", "tributeInefficiency", "baseMoraleModifiers",
    "personalAuthority", "moraleRoll", "moraleLevels", "moraleEffects",
    "settlementInvestment", "settlementRevenue", "settlementExpenses",
  ],
};

const NEEDED = [...new Set(
  Object.entries(TABLES).flatMap(([doc, ids]) => ids.map((id) => TABLE_RECIPES[doc]?.tables?.[id]?.book)),
)].filter(Boolean);
if (!NEEDED.length || NEEDED.some((b) => !FILES[b] || !fs.existsSync(FILES[b]))) {
  console.log("test-recipe-content: reference PDFs absent — skipped.");
  process.exit(0);
}

/* ------------------------------ shape checks ------------------------------ */

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isText = (v) => typeof v === "string" && v.trim() !== "";
/** A dash or "n/a" cell: a market class the row never trades in. */
const isNone = (t) => /^(?:-|—|–|n\/?a)$/i.test(String(t).trim());

/** `take` micro-patterns whose value is one finite number. */
const NUMERIC_TAKES = new Set(["int", "signedInt", "signed", "wordInt", "roman", "times", "pct", "sp", "gp", "num", "fractionWord"]);

/**
 * Rows of a `{rows:[…]}` extraction against the recipe's declared row list:
 * the count matches, each row is the declared one in order, none is a
 * placeholder. Returns the rows only when they can be inspected further.
 */
function declaredRows(out, recipe, fail) {
  const rows = out?.rows;
  if (!Array.isArray(rows)) return fail("rows: not an array") ?? [];
  if (rows.length !== recipe.rows.length) fail(`rows: count differs from the ${recipe.rows.length} declared`);
  for (const key of missingRowKeys(out)) fail(`row ${key}: __missing placeholder`);
  const kf = recipe.emit?.keyField;
  recipe.rows.forEach((spec, i) => {
    const row = rows[i];
    if (!row || isMissingRow(row)) return;
    if (kf && row[kf] !== spec.key) fail(`row ${spec.key}: key field ${kf} does not carry the declared key`);
  });
  return rows.filter((r) => r && !isMissingRow(r));
}

/** The six-cell (or `marketCells`-cell) class grid of one row, each cell through `cellCheck`. */
function classCells(row, recipe, label, fail, cellCheck) {
  const cells = row.byMarketClass;
  if (!Array.isArray(cells)) return fail(`row ${label}: byMarketClass is not an array`);
  if (cells.length !== recipe.marketCells) fail(`row ${label}: byMarketClass has the wrong cell count`);
  cells.forEach((c, i) => cellCheck(c, `row ${label} cell ${i + 1}`));
}

/** An availability cell: text that `parseCell` reads as qty, pct, or a dash/NA none. */
function availabilityCell(cell, where, fail) {
  if (!isText(cell)) return fail(`${where}: empty or non-text`);
  const kind = parseCell(cell).kind;
  if (!["qty", "pct", "none"].includes(kind)) return fail(`${where}: parseCell kind is not qty/pct/none`);
  if (kind === "none" && !isNone(cell)) fail(`${where}: not a printed dash or NA, yet parseCell reads it as none`);
}

/** A cost-band ladder: every row bounded below, the last open above, each next band starting one past the prior. */
function costLadder(rows, fail) {
  rows.forEach((r, i) => {
    if (!isNum(r.minCost)) fail(`row ${r.band}: minCost is not a finite number`);
    const last = i === rows.length - 1;
    if (last && r.maxCost !== null) fail(`row ${r.band}: top band is not open above`);
    if (!last && !isNum(r.maxCost)) fail(`row ${r.band}: maxCost is not a finite number`);
    const next = rows[i + 1];
    if (next && isNum(r.maxCost) && next.minCost !== r.maxCost + 1) fail(`row ${next.band}: minCost does not follow the band above`);
  });
}

/** A result-column ladder: `count` bands, open below, open above, each contiguous with the last. */
function bandLadder(bands, key, fail, count) {
  if (!Array.isArray(bands)) return fail(`${key}: not an array`);
  if (bands.length !== count) return fail(`${key}: has ${bands.length} entries, expected ${count}`);
  if (bands[0]?.min !== null) fail(`${key}: first band is not open below`);
  if (bands[bands.length - 1]?.max !== null) fail(`${key}: last band is not open above`);
  bands.forEach((b, i) => {
    const prev = bands[i - 1];
    if (prev && !(isNum(b.min) && isNum(prev.max) && b.min === prev.max + 1)) fail(`${key}: band ${i + 1} does not follow band ${i}`);
  });
}

/** Every value a prose recipe declares is present, and a numeric `take` is a finite number. */
function proseKeys(out, recipe, fail) {
  for (const v of recipe.values) {
    const got = out?.[v.key];
    if (got === undefined) { fail(`${v.key}: absent`); continue; }
    if (NUMERIC_TAKES.has(v.take ?? "int") && !isNum(got)) fail(`${v.key}: not a finite number`);
  }
}

/** Per-table verifiers, keyed `doc.table`. Each reads the extraction and reports through `fail`. */
const VERIFY = {
  "availability.equipmentAvailability": (out, recipe, fail) => {
    const rows = declaredRows(out, recipe, fail);
    for (const r of rows) classCells(r, recipe, r.band, fail, (c, w) => availabilityCell(c, w, fail));
    costLadder(rows, fail);
  },
  "magicItems.transactionsByMarketClass": (out, recipe, fail) => {
    const rows = declaredRows(out, recipe, fail);
    for (const r of rows) classCells(r, recipe, r.band, fail, (c, w) => availabilityCell(c, w, fail));
    costLadder(rows, fail);
  },
  "mercantile.marketCharacteristics": (out, recipe, fail) => {
    for (const r of declaredRows(out, recipe, fail)) {
      const label = r.marketClass;
      for (const col of recipe.cellColumns) if (!isText(r[col.key])) fail(`row ${label}: ${col.key} empty or non-text`);
      if (!(parseStones(r.baselineCargo) > 0)) fail(`row ${label}: baselineCargo does not parse through parseStones to a positive number`);
      if (!(parseTollCpPerSt(r.toll) >= 0)) fail(`row ${label}: toll does not parse through parseTollCpPerSt`);
      if (!parseTariffPct(r.tariff)) fail(`row ${label}: tariff does not parse through parseTariffPct`);
    }
  },
  "mercantile.tariffProse": (out, recipe, fail) => {
    proseKeys(out, recipe, fail);
    for (const v of recipe.values) if (out?.[v.key] !== undefined && !diceRange(out[v.key])) fail(`${v.key}: not one die term diceRange reads`);
  },
  "mercantile.merchandiseTypes": (out, recipe, fail) => {
    for (const r of declaredRows(out, recipe, fail)) {
      if (!isText(r.container)) fail(`row ${r.type}: container empty or non-text`);
      if (!isNum(r.pricePerStone) || !(r.pricePerStone > 0)) fail(`row ${r.type}: pricePerStone is not a finite number above zero`);
      if (!isNum(r.priceStep) || !(r.priceStep > 0)) fail(`row ${r.type}: priceStep is not a finite number above zero`);
      else if (isNum(r.pricePerStone) && !(r.priceStep < r.pricePerStone)) fail(`row ${r.type}: priceStep is not below pricePerStone`);
      classCells(r, recipe, r.type, fail, (c, w) => {
        if (!isText(c)) return fail(`${w}: empty or non-text`);
        if (!isNone(c) && !Number.isFinite(Number(String(c).replace(/,/g, "")))) fail(`${w}: neither a dash nor a number the venture engine reads`);
      });
    }
  },
  "mercantile.moorageRates": (out, recipe, fail) => {
    for (const r of declaredRows(out, recipe, fail)) {
      for (const col of recipe.cellColumns) {
        const fee = parseStayFee(r[col.key]);
        if (!fee) fail(`row ${r.kind}: ${col.key} does not parse through parseStayFee`);
        // Only a ship's berth is priced by size; any other cell with a unit welded a neighbour in.
        else if ((fee.perShp !== null) !== (r.kind === "ship" && col.key === "berth")) fail(`row ${r.kind}: ${col.key} ${fee.perShp === null ? "lacks" : "carries"} a per-shp unit`);
      }
    }
  },
  "construction.wageAndConstructionRates": (out, recipe, fail) => {
    for (const r of declaredRows(out, recipe, fail)) {
      for (const col of recipe.cellColumns) if (!isText(r[col.key])) fail(`row ${r.worker}: ${col.key} empty or non-text`);
      if (!(parseMoneyCp(r.ratePerDay) > 0)) fail(`row ${r.worker}: ratePerDay does not parse through parseMoneyCp to a positive amount`);
      if (!(parseMoneyCp(r.wagePerMonth) > 0)) fail(`row ${r.worker}: wagePerMonth does not parse through parseMoneyCp to a positive amount`);
    }
  },
  "settlement.marketClassByFamilies": (out, recipe, fail) => {
    const rows = declaredRows(out, recipe, fail);
    for (const r of rows) {
      if (!isNum(r.min)) fail(`row ${r.label}: families band has no finite minimum`);
      if (r.max !== null && !isNum(r.max)) fail(`row ${r.label}: families band maximum is neither a number nor open`);
      if (!Number.isInteger(r.marketClass) || r.marketClass < 1 || r.marketClass > 6) fail(`row ${r.label}: marketClass is not a class numeral`);
    }
    if (rows.length && rows[rows.length - 1].max !== null) fail("rows: the largest settlement band is not open above");
  },
  "mercantile.assessmentProse": (out, recipe, fail) => {
    proseKeys(out, recipe, fail);
    bandLadder(out?.bands, "bands", fail, 5);
  },
  "mercantile.negotiationProse": (out, recipe, fail) => {
    proseKeys(out, recipe, fail);
    bandLadder(out?.bands, "bands", fail, 5);
  },
  "magicItems.identifyProse": (out, recipe, fail) => {
    proseKeys(out, recipe, fail);
    const back = out?.dabblingBackfire;
    if (back !== undefined) {
      if (!Array.isArray(back) || back.length !== 2 || !back.every(isNum)) fail("dabblingBackfire: not a two-number array");
      else if (back[0] > back[1]) fail("dabblingBackfire: minimum exceeds maximum");
    }
    const tiers = out?.engineeringTiers;
    if (tiers !== undefined && !(isText(tiers) && /\b(?:common|uncommon|rare)\b/i.test(tiers))) fail("engineeringTiers: names none of common/uncommon/rare");
  },
};
/** Every `label: true` value carries the wording of its row, and no two rows share one. */
function rowLabels(out, recipe, fail) {
  const seen = new Set();
  for (const v of recipe.values) {
    if (!v.label) continue;
    const label = out?.[`${v.key}Label`];
    if (!isText(label)) { fail(`${v.key}: no row wording read`); continue; }
    if (seen.has(label)) fail(`${v.key}: its wording is another row's`);
    seen.add(label);
  }
}
// A morale page: its modifiers, their wording, and a result column of the
// length the roller's page names results for.
for (const [id, count] of [["morale.monsterMorale", 5], ["morale.hirelingObedience", 3]]) {
  VERIFY[id] = (out, recipe, fail) => {
    proseKeys(out, recipe, fail);
    rowLabels(out, recipe, fail);
    bandLadder(out?.bands, "bands", fail, count);
  };
}
// The hiring offer: its two penalties, each read as the figure a count is
// multiplied by and so below zero, and a result column of the length the
// hiring page and the henchmen throw name results for.
VERIFY["influence.hiringOffer"] = (out, recipe, fail) => {
  proseKeys(out, recipe, fail);
  for (const key of ["slanderPenalty", "refusalPenalty"]) if (isNum(out?.[key]) && !(out[key] < 0)) fail(`${key}: not below zero`);
  bandLadder(out?.bands, "bands", fail, 5);
};
// The loyalty roll's apparent-level figure: multiplied by a count of levels,
// so a whole number below zero the reader accepts as it stands.
VERIFY["influence.apparentLevel"] = (out, recipe, fail) => {
  proseKeys(out, recipe, fail);
  if (isNum(out?.perLevel) && !(Number.isInteger(out.perLevel) && out.perLevel < 0)) fail("perLevel: not a whole number below zero");
};
// The level-gain morale bonuses: whole levels, the rung the first names (one
// above the level left) below the one the second reaches, and each bonus a
// positive whole number, so the reader keeps both rungs.
VERIFY["wages.levelMorale"] = (out, recipe, fail) => {
  proseKeys(out, recipe, fail);
  const whole = (v) => Number.isInteger(v) && v >= 0;
  for (const key of ["fromLevel", "reachLevel"]) if (isNum(out?.[key]) && !whole(out[key])) fail(`${key}: not a whole number`);
  for (const key of ["fromBonus", "reachBonus"]) if (isNum(out?.[key]) && !(Number.isInteger(out[key]) && out[key] > 0)) fail(`${key}: not a positive whole number`);
  if (whole(out?.fromLevel) && whole(out?.reachLevel) && !(out.fromLevel + 1 < out.reachLevel)) fail("reachLevel: not above the first rung");
};
// The henchman limit's base: a whole number the reader accepts as it stands.
VERIFY["wages.henchmanLimit"] = (out, recipe, fail) => {
  proseKeys(out, recipe, fail);
  if (isNum(out?.base) && !(Number.isInteger(out.base) && out.base > 0)) fail("base: not a positive whole number");
};
// The employer-level cap: rungs of whole levels, each starting one above the
// last, the allowances never falling, and only the last open, rising by a
// positive whole number per level.
VERIFY["wages.employerLevelCap"] = (out, recipe, fail) => {
  proseKeys(out, recipe, fail);
  const rungs = out?.rungs;
  if (!Array.isArray(rungs) || rungs.length < 2) return fail("rungs: fewer than two");
  const whole = (v) => Number.isInteger(v) && v >= 0;
  rungs.forEach((r, i) => {
    const last = i === rungs.length - 1;
    if (!whole(r.min) || !whole(r.cap)) fail(`rung ${i}: min or cap not a whole number`);
    if (last ? r.max !== null : !(whole(r.max) && r.max >= r.min)) fail(`rung ${i}: ${last ? "not open above" : "max not a whole number at or above min"}`);
    if (i && r.min !== rungs[i - 1].max + 1) fail(`rung ${i}: does not start one above the last`);
    if (i && r.cap < rungs[i - 1].cap) fail(`rung ${i}: allows less than the rung below`);
  });
  const top = rungs.at(-1);
  if (!(Number.isInteger(top?.perLevel) && top.perLevel > 0)) fail("open rung: perLevel not a positive whole number");
};
// Prose tables with nothing beyond declared keys and finite numbers.
for (const id of [
  "availability.marketRulesProse", "availability.bargainingProse", "magicItems.priceProse",
  "mercantile.impactProse", "mercantile.priceShiftProse",
]) VERIFY[id] = (out, recipe, fail) => proseKeys(out, recipe, fail);

/* ------------------------------- the domain ------------------------------- */

/** A dice expression `dice` and `diceFormula` return. */
const DICE = /^\d+d\d+$/;
/** A `gpRate` cell: a positive range in gp per a named unit. */
const isRate = (v) => isNum(v?.min) && isNum(v?.max) && v.min > 0 && v.max >= v.min && isText(v.per);
/** A `countBand` closed at both ends, or open on the side the options name. */
function isCountBand(b, { openAbove = false, openBelow = false } = {}) {
  if (!b || typeof b !== "object") return false;
  const lowOk = openBelow ? b.min === null : isNum(b.min) && b.min >= 0;
  const highOk = openAbove ? b.max === null : isNum(b.max) && (!isNum(b.min) || b.max >= b.min);
  return lowOk && highOk;
}

/** A keyed extraction (no `emit` container): every declared row present and not a placeholder. */
function keyedRows(out, recipe, fail) {
  return recipe.rows.flatMap((spec) => {
    const row = out?.[spec.key];
    if (row == null) return fail(`row ${spec.key}: absent`) ?? [];
    if (isMissingRow(row)) return fail(`row ${spec.key}: __missing placeholder`) ?? [];
    return [{ key: spec.key, row }];
  });
}

/** A `valueBlocks` extraction: every block read, and every value it declares present. */
function blockKeys(out, recipe, fail) {
  for (const block of recipe.valueBlocks) {
    const got = out?.[block.id];
    if (!got) { fail(`block ${block.id}: not read`); continue; }
    proseKeys(got, block, (msg) => fail(`block ${block.id}: ${msg}`));
  }
}

/** A ladder open above: every band bounded below, each next starting one past the last, the top one open. */
function openLadder(rows, fail) {
  rows.forEach((r, i) => {
    const label = r.key ?? i + 1;
    if (!isNum(r.min)) fail(`row ${label}: band has no finite minimum`);
    const next = rows[i + 1];
    if (!next) { if (r.max != null) fail(`row ${label}: top band is not open above`); return; }
    if (!isNum(r.max)) fail(`row ${label}: band has no finite maximum`);
    else if (next.min !== r.max + 1) fail(`row ${next.key ?? i + 2}: band does not follow the one before`);
  });
}

/** Strictly ascending finite numbers; a failure names the entry as `what` and its place. */
function ascending(values, what, fail) {
  values.forEach((v, i) => {
    if (!isNum(v)) fail(`${what} ${i + 1}: not a finite number`);
    else if (i && isNum(values[i - 1]) && !(v > values[i - 1])) fail(`${what} ${i + 1}: does not rise past the one before`);
  });
}

/**
 * Every declared rate row read: a rate, or null for a word in its cell. At
 * least one row is a rate, and every rate is per the same unit — a column
 * misbound to prose reads a null or a stray unit, never a full set of rates.
 */
function rateRows(out, recipe, fail) {
  const rates = [];
  for (const spec of recipe.rows) {
    const v = out?.[spec.key];
    if (v === undefined) fail(`${spec.key}: absent`);
    else if (v !== null && !isRate(v)) fail(`${spec.key}: neither a gp rate nor a word`);
    else if (v) rates.push(v);
  }
  if (!rates.length) fail("rows: no row reads a rate");
  if (new Set(rates.map((r) => r.per)).size > 1) fail("rows: the rates are per different units");
}

/**
 * A ladder largest first: the top band open above, the bottom one open below,
 * each band ending one below the floor of the band above it.
 */
function descendingLadder(rows, fail) {
  rows.forEach((r, i) => {
    const label = r.key ?? i + 1;
    const top = i === 0;
    const bottom = i === rows.length - 1;
    if (!isCountBand(r, { openAbove: top, openBelow: bottom })) fail(`row ${label}: not a band${top ? " open above" : bottom ? " open below" : ""}`);
    else if (!top && isNum(rows[i - 1].min) && r.max !== rows[i - 1].min - 1) fail(`row ${label}: band does not end below the one above`);
  });
}

Object.assign(VERIFY, {
  "domain.strongholdMinimum": (out, recipe, fail) => {
    for (const { key, row } of keyedRows(out, recipe, fail)) {
      const cells = recipe.cellColumns.map((c) => row[c.key]);
      // The header row is each column's hex across, in miles; the body rows are gp.
      const whole = key !== "hexMiles";
      if (!cells.every((c) => isNum(c) && c > 0 && (!whole || Number.isInteger(c)))) fail(`row ${key}: a hex cell is not a positive ${whole ? "whole " : ""}number`);
      else ascending(cells, `row ${key} hex`, fail);
    }
  },
  "domain.growth": (out, recipe, fail) => {
    blockKeys(out, recipe, fail);
    for (const id of ["landValue", "investment"]) if (out?.[id]?.die != null && !DICE.test(out[id].die)) fail(`block ${id}: die is not a dice expression`);
    const die = out?.limits?.die;
    if (die != null && !/^\d+d\d+x?$/.test(die)) fail("block limits: die is not a roll formula");
    for (const [id, block] of Object.entries(out ?? {})) {
      for (const [k, v] of Object.entries(block ?? {})) if (isNum(v) && !(v > 0)) fail(`block ${id}: ${k} is not above zero`);
    }
  },
  "domain.prestigeImmigration": (out, recipe, fail) => {
    const rows = declaredRows(out, recipe, fail);
    for (const r of rows) if (!DICE.test(r.dice ?? "")) fail(`row ${r.key}: dice is not a dice expression`);
    openLadder(rows, fail);
  },
  "domain.revenue": rateRows,
  "domain.expenses": rateRows,
  "domain.settlementExpenses": rateRows,
  "domain.peace": (out, recipe, fail) => {
    blockKeys(out, recipe, fail);
    const s = out?.stronghold ?? {};
    for (const n of [1, 2, 3]) {
      if (isNum(s[`band${n}`]) && !(s[`band${n}`] < 0)) fail(`block stronghold: band${n} is not below zero`);
      const f = s[`band${n}Fraction`];
      if (f !== undefined && !(isNum(f) && f > 0 && f < 1)) fail(`block stronghold: band${n}Fraction is not a share between none and all`);
    }
    ascending([s.band3, s.band2, s.band1], "block stronghold band (worst first)", fail);
    if ([1, 2, 3].every((n) => isNum(s[`band${n}Fraction`])) && !(s.band1Fraction > s.band2Fraction && s.band2Fraction >= s.band3Fraction)) {
      fail("block stronghold: the fractions do not fall as the band worsens");
    }
    for (const k of ["borderlandsTroops", "outlandsTroops1", "outlandsTroops2"]) {
      if (isNum(s[k]) && !(s[k] > 0)) fail(`block stronghold: ${k} is not above zero`);
      if (isNum(s[`${k}Gp`]) && !(s[`${k}Gp`] > 0)) fail(`block stronghold: ${k}Gp is not above zero`);
    }
    const o = out?.occupation ?? {};
    if (isNum(o.perMonth) && isNum(o.max) && !(o.max <= o.perMonth && o.perMonth < 0)) fail("block occupation: the cap is not at or below a monthly penalty below zero");
  },
  "domain.magistrateShare": (out, recipe, fail) => {
    proseKeys(out, recipe, fail);
    if (out?.share !== undefined && !(isNum(out.share) && out.share > 0 && out.share < 100)) fail("share: not a percentage between none and all");
  },
  "domain.titles": (out, recipe, fail) => {
    const rows = keyedRows(out, recipe, fail);
    for (const { key, row } of rows) {
      if (!(Number.isInteger(row.personalFamilies) && row.personalFamilies > 0)) fail(`row ${key}: personalFamilies is not a positive whole number`);
      for (const col of ["domains", "realmFamilies"]) {
        if (!(isCountBand(row[col]) || isCountBand(row[col], { openAbove: true })) || !(row[col].min > 0)) fail(`row ${key}: ${col} is not a band of counts`);
      }
      if (!(isText(row.title) && /^[a-z][a-z' -]*$/i.test(row.title))) fail(`row ${key}: title is not a word`);
    }
    rows.forEach(({ key, row }, i) => {
      const prev = rows[i - 1]?.row;
      if (!prev) return;
      if (isNum(prev.personalFamilies) && isNum(row.personalFamilies) && row.personalFamilies > prev.personalFamilies) fail(`row ${key}: personalFamilies rises below a higher rank`);
      for (const col of ["domains", "realmFamilies"]) {
        if (isNum(prev[col]?.min) && isNum(row[col]?.min) && !(row[col].min < prev[col].min)) fail(`row ${key}: ${col} does not fall below a higher rank`);
      }
    });
  },
  "domain.tribute": (out, recipe, fail) => {
    proseKeys(out, recipe, fail);
    if (out?.exponent !== undefined && !(isNum(out.exponent) && out.exponent > 0 && out.exponent <= 1)) fail("exponent: not a power between none and one");
    for (const k of ["coefficientGp", "roundingGp"]) if (isNum(out?.[k]) && !(out[k] > 0)) fail(`${k}: not above zero`);
  },
  "domain.tributeInefficiency": (out, recipe, fail) => {
    const rows = declaredRows(out, recipe, fail);
    descendingLadder(rows, fail);
    const shares = rows.map((r) => r.sharePct);
    if (shares.some((v) => isNum(v) && !(v > 0 && v <= 100))) fail("share: a share is not a percentage");
    ascending(shares, "share (largest band first)", fail);
  },
  "domain.baseMoraleModifiers": (out, recipe, fail) => {
    for (const spec of recipe.rows) {
      const list = out?.[spec.key];
      if (!(Array.isArray(list) && list.length && list.every(Number.isInteger))) fail(`${spec.key}: not a list of whole-number modifiers`);
      else if (new Set(list.map(Math.sign)).size > 1) fail(`${spec.key}: a list mixes bonuses and penalties`);
    }
  },
  "domain.personalAuthority": (out, recipe, fail) => {
    const rows = Object.fromEntries(keyedRows(out, recipe, fail).map(({ key, row }) => [key, row.byIncome]));
    const low = rows.incomeLow ?? [];
    const high = rows.incomeHigh ?? [];
    if (low.length !== recipe.marketCells) fail("incomeLow: not one figure per income band");
    if (high.length !== recipe.marketCells - 2) fail("incomeHigh: not one ceiling per closed band");
    if (![...low, ...high].every(Number.isInteger)) fail("income header: a band edge is not a whole number");
    else {
      if (low[1] !== low[0] + 1) fail("income header: the second band does not follow the first band's ceiling");
      high.forEach((h, j) => { if (low[j + 2] !== h + 1) fail(`income header: band ${j + 3} does not follow band ${j + 2}`); });
    }
    for (const spec of recipe.rows.slice(2)) {
      const cells = rows[spec.key];
      if (cells && !(cells.length === recipe.marketCells && cells.every(Number.isInteger))) fail(`row ${spec.key}: not one whole-number modifier per income band`);
    }
  },
  "domain.moraleRoll": (out, recipe, fail) => {
    blockKeys(out, recipe, fail);
    const r = out?.result ?? {};
    bandLadder(r.bands, "block result: bands", fail, 5);
    if (isNum(r.floor) && isNum(r.ceiling) && !(r.floor < 0 && r.ceiling > 0)) fail("block result: the bounds do not straddle zero");
    if (isNum(r.naturalLow) && isNum(r.naturalHigh) && !(r.naturalLow < r.naturalHigh)) fail("block result: the natural extremes are out of order");
    for (const k of ["shift1", "shift2", "shift3", "shift4", "shift5", "naturalLowShift", "naturalHighShift"]) if (isNum(r[k]) && !(r[k] > 0)) fail(`block result: ${k} is not above zero`);
    for (const [k, v] of Object.entries(out?.monthly ?? {})) if (k.endsWith("Gp") && !(v > 0)) fail(`block monthly: ${k} is not above zero`);
  },
  "domain.moraleLevels": (out, recipe, fail) => {
    const rows = keyedRows(out, recipe, fail);
    for (const { key, row } of rows) if (!(isText(row.level) && /^[a-z]+$/i.test(row.level))) fail(`row ${key}: level is not one word`);
    rows.forEach(({ key, row }, i) => {
      if (!Number.isInteger(row.score)) fail(`row ${key}: score is not a whole number`);
      else if (i && Number.isInteger(rows[i - 1].row.score) && row.score !== rows[i - 1].row.score + 1) fail(`row ${key}: score does not follow the rung below`);
    });
    if (new Set(rows.map(({ row }) => String(row.level).toLowerCase())).size !== rows.length) fail("rows: two rungs share a level");
  },
  "domain.moraleEffects": (out, recipe, fail) => {
    blockKeys(out, recipe, fail);
    for (const block of recipe.valueBlocks) {
      for (const v of block.values) {
        const got = out?.[block.id]?.[v.key];
        if (got === undefined) continue;
        if (v.take === "dice" && !DICE.test(got)) fail(`block ${block.id}: ${v.key} is not a dice expression`);
        if (v.take === "pct" && !(got > 0 && got <= 100)) fail(`block ${block.id}: ${v.key} is not a percentage`);
        if (v.take === "wordInt" && !(got > 0)) fail(`block ${block.id}: ${v.key} is not a count`);
      }
    }
  },
  "domain.settlementInvestment": (out, recipe, fail) => {
    const rows = keyedRows(out, recipe, fail).map(({ row }) => row);
    if (!rows.every((r) => Number.isInteger(r.investmentGp) && Number.isInteger(r.maxFamilies))) fail("rows: a step is not two whole numbers");
    ascending(rows.map((r) => r.investmentGp), "step investmentGp", fail);
    ascending(rows.map((r) => r.maxFamilies), "step maxFamilies", fail);
  },
  "domain.settlementRevenue": (out, recipe, fail) => {
    const rows = keyedRows(out, recipe, fail).map(({ key, row }) => ({ key, ...row, ...(row.families ?? {}) }));
    for (const r of rows) {
      if (!isCountBand(r.families)) fail(`row ${r.key}: families is not a closed band`);
      if (!(isNum(r.tradeGp) && r.tradeGp > 0)) fail(`row ${r.key}: tradeGp is not above zero`);
      if (!Number.isInteger(r.marketClass) || r.marketClass < 1 || r.marketClass > 6) fail(`row ${r.key}: marketClass is not a class numeral`);
    }
    rows.forEach((r, i) => {
      const next = rows[i + 1];
      if (next && isNum(r.max) && isNum(next.min) && next.min !== r.max + 1) fail(`row ${next.key}: band does not follow the one before`);
    });
  },
});

/* --------------------------------- the run -------------------------------- */

const docs = {};
const open = async (book) => (docs[book] ??= (await openBook(fs.readFileSync(FILES[book]))).doc);

const failures = [];
let checkedTables = 0;

for (const [docId, ids] of Object.entries(TABLES)) {
  for (const tableId of ids) {
    const name = `${docId}.${tableId}`;
    const mine = [];
    const fail = (msg) => { mine.push(`${name}: ${msg}`); };
    const recipe = TABLE_RECIPES[docId]?.tables?.[tableId];
    if (!recipe) { fail("no such recipe"); }
    else if (!VERIFY[name]) { fail("no verifier registered for this table"); }
    else {
      try {
        const doc = await open(recipe.book);
        if (recipe.valueBlocks) {
          // Each block searches its own page (`recipeLocates`) and is read
          // with the recipe's settings over its own values and column, as the
          // import reads a block.
          const out = {};
          for (const { id, args } of recipeLocates(recipe)) {
            const page = await locatePageNumber(doc, args);
            if (page == null) { fail(`block ${id}: page not found`); continue; }
            const block = recipe.valueBlocks.find((b) => b.id === id);
            const { items } = await pageItems(doc, page);
            out[id] = extractTable(items, { ...recipe, valueBlocks: null, emit: null, values: block.values, column: block.column ?? recipe.column });
          }
          VERIFY[name](out, recipe, fail);
        } else {
          const page = await locatePageNumber(doc, recipe);
          if (page == null) fail("page not found");
          else {
            const { items } = await pageItems(doc, page);
            VERIFY[name](extractTable(items, recipe), recipe, fail);
          }
        }
      } catch (err) {
        fail(`extraction threw (${err?.constructor?.name ?? "Error"})`);
      }
    }
    checkedTables++;
    console.log(`  ${mine.length ? "FAIL" : "ok  "} ${name}${mine.length ? ` (${mine.length})` : ""}`);
    failures.push(...mine);
  }
}

assert.deepStrictEqual(failures, [], `test-recipe-content: ${failures.length} failed:\n  ${failures.join("\n  ")}`);
console.log(`test-recipe-content: ${checkedTables} tables read the expected shape.`);
