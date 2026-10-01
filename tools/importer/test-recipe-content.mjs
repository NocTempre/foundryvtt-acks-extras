/**
 * LOCAL-ONLY: the table recipes the markets feature and the morale pages read,
 * run against this machine's own books, must return the SHAPE their consumers
 * parse. Every recipe here is
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
import { locatePageNumber } from "../../scripts/importer/tables-binding.mjs";
import { TABLE_RECIPES } from "../../scripts/importer/table-recipes.mjs";
import { isMissingRow, missingRowKeys } from "../../scripts/lib/tables.mjs";
import { parseCell } from "../../scripts/markets/rules/availability.mjs";
import { parseStones, parseTollCpPerSt } from "../../scripts/markets/rules/arbitrage.mjs";
import { parseMoneyCp } from "../../scripts/markets/rules/commissions.mjs";
import { FILES } from "./reference-lib.mjs";

/** The tables under test, by recipe document. Each is one entry of `TABLE_RECIPES`. */
const TABLES = {
  availability: ["equipmentAvailability", "marketRulesProse", "bargainingProse"],
  magicItems: ["transactionsByMarketClass", "priceProse", "identifyProse"],
  mercantile: [
    "marketCharacteristics", "merchandiseTypes", "impactProse",
    "assessmentProse", "priceShiftProse", "negotiationProse",
  ],
  construction: ["wageAndConstructionRates"],
  settlement: ["marketClassByFamilies"],
  // The influence roller's two morale pages: a result column and a modifier
  // list each, every modifier with the wording of its own row.
  morale: ["monsterMorale", "hirelingObedience"],
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
const NUMERIC_TAKES = new Set(["int", "signedInt", "signed", "wordInt", "roman", "times", "pct", "sp", "gp"]);

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
    }
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
// Prose tables with nothing beyond declared keys and finite numbers.
for (const id of [
  "availability.marketRulesProse", "availability.bargainingProse", "magicItems.priceProse",
  "mercantile.impactProse", "mercantile.priceShiftProse",
]) VERIFY[id] = (out, recipe, fail) => proseKeys(out, recipe, fail);

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
        const page = await locatePageNumber(doc, recipe);
        if (page == null) fail("page not found");
        else {
          const { items } = await pageItems(doc, page);
          VERIFY[name](extractTable(items, recipe), recipe, fail);
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
