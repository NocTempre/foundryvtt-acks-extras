/**
 * Encounter grid gate: do the encounter tables read WHOLE from the book —
 * every row found, every cell carrying one name, every band tiling the die
 * the engine throws on it?
 *
 * A column window that misses a cell by a few points does not throw: the
 * run lands in the column beside it, where the join welds it onto that
 * column's own name, and the row's cell is empty or holds a torn piece. The
 * committed tests feed `assembleEncounterTables` invented cells, so nothing
 * offline reads the real page (docs/importer/DECISIONS.md, 2026-10-09, "A
 * monster grid binds its cells by their centres").
 *
 * Reads every `encounters` grid recipe — the territory and rarity throws,
 * the two civilized grids, the eighteen monster sub-tables — and fails on:
 *   - a declared row the page did not yield, or an empty cell;
 *   - a name cell carrying a stranded single letter at either end (a
 *     small-caps initial torn from the cell beside it), a bracket torn
 *     across cells, or a second name (a second comma seam);
 *   - an assembled band that does not tile its die from 1 to the last face,
 *     with no gap and no overlap.
 *
 * Requires the LOCAL reference PDFs, so it SKIPS (exit 0) where they are
 * absent — CI included. Output names recipe keys, bands and columns, never
 * a cell's text.
 *
 * Usage: node tools/importer/check-encounter-grids.mjs   (also via `npm run validate`)
 */
import fs from "node:fs";
import { openBook, pageItems } from "../../scripts/importer/extract.mjs";
import { findPage, extractTable } from "../../scripts/importer/table-extract.mjs";
import { TABLE_RECIPES } from "../../scripts/importer/table-recipes.mjs";
import { MONSTER_RAW_KEYS, assembleEncounterTables, repairName } from "../../scripts/importer/encounters-binding.mjs";
import { FILES, referenceComplete } from "./reference-lib.mjs";

if (!referenceComplete()) {
  console.log("encounter grids: SKIPPED — local reference PDFs not on this machine.");
  process.exit(0);
}

/** The die each assembled table is thrown on: the engine's own (`encounters.mjs`). */
const DIE = Object.freeze({ territory: 20, rarity: 20, civilized: 100, monsters: 100 });

/** The grids: the two throw tables (bands only) and the name grids (bands and names). */
const THROW_KEYS = ["territoryRaw", "rarityRaw"];
const NAME_KEYS = ["civilizedUpperRaw", "civilizedLowerRaw", ...Object.keys(MONSTER_RAW_KEYS)];

const faults = [];
const fail = (where, why) => faults.push(`${where}: ${why}`);

const books = new Map();
async function bookFor(id) {
  if (!books.has(id)) books.set(id, await openBook(fs.readFileSync(FILES[id])));
  return books.get(id);
}

/** Read one recipe off the book; null (and a fault) when no page answers. */
async function readGrid(key) {
  const recipe = TABLE_RECIPES.encounters.tables[key];
  if (!recipe) {
    fail(key, "no such recipe");
    return null;
  }
  const { doc: pdf } = await bookFor(recipe.book);
  const found = await findPage(recipe, pdf.numPages, (p) => pageItems(pdf, p));
  if (!found) {
    fail(key, "no page answers the recipe's locate");
    return null;
  }
  return extractTable(found.items, recipe);
}

/** A band list against its die: null when it tiles, else what is wrong. */
function tilingFault(bands, faces) {
  const sorted = [...bands].sort((a, b) => a.min - b.min);
  if (!sorted.length) return "no bands at all";
  const wrong = [];
  if (sorted[0].min !== 1) wrong.push(`starts at ${sorted[0].min}`);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (cur.min > prev.max + 1) wrong.push(`gap ${prev.max + 1}-${cur.min - 1}`);
    else if (cur.min <= prev.max) wrong.push(`overlap ${cur.min}-${Math.min(prev.max, cur.max)}`);
  }
  const last = sorted[sorted.length - 1];
  if (last.max !== faces) wrong.push(`ends at ${last.max}, not ${faces}`);
  return wrong.length ? wrong.join(", ") : null;
}

/** The row's band, as the gate names it: the parsed band, else the row key. */
const bandOf = (rowKey, row) => (Number.isFinite(row?.min) && Number.isFinite(row?.max) ? `${row.min}-${row.max}` : rowKey);

const raw = {};
let rowsRead = 0;
let cellsRead = 0;

for (const key of [...THROW_KEYS, ...NAME_KEYS]) {
  const rows = await readGrid(key);
  if (!rows) continue;
  raw[key] = rows;
  const names = NAME_KEYS.includes(key);
  for (const [rowKey, row] of Object.entries(rows)) {
    if (row?.__missing) {
      fail(`${key} ${rowKey}`, "row not found on the page");
      continue;
    }
    rowsRead++;
    if (!names) continue;
    for (const [col, value] of Object.entries(row)) {
      if (col === "min" || col === "max") continue;
      cellsRead++;
      const where = `${key} ${bandOf(rowKey, row)} ${col}`;
      const name = repairName(value);
      if (!name) {
        fail(where, "empty cell");
        continue;
      }
      if (/\s[A-Za-z]$/.test(name)) fail(where, "ends in a stranded letter (a neighbour's small-caps initial)");
      if (/^[A-Za-z]\s/.test(name)) fail(where, "begins with a stranded letter");
      if (!/^[A-Za-z0-9]/.test(name)) fail(where, "opens with punctuation (a neighbour's split bracket)");
      if ((name.match(/\(/g) ?? []).length !== (name.match(/\)/g) ?? []).length) fail(where, "unbalanced brackets (a bracket torn across cells)");
      if ((name.match(/,/g) ?? []).length >= 2) fail(where, "two comma seams (a second name welded in)");
    }
  }
}

const tables = assembleEncounterTables(raw);
let bandsChecked = 0;
const checkBands = (tableKey, die) => {
  const table = tables[tableKey];
  if (!table) {
    fail(tableKey, "assembled nothing");
    return;
  }
  for (const [column, bands] of Object.entries(table)) {
    bandsChecked++;
    const wrong = tilingFault(bands, die);
    if (wrong) fail(`${tableKey}.${column}`, wrong);
  }
};
checkBands("territory", DIE.territory);
checkBands("rarity", DIE.rarity);
checkBands("civilized", DIE.civilized);
for (const tableKey of Object.values(MONSTER_RAW_KEYS)) checkBands(`monsters.${tableKey}`, DIE.monsters);

if (faults.length) {
  for (const f of faults) console.error(`FAIL  ${f}`);
  console.error(`encounter grids: FAILED — ${faults.length} fault(s) over ${rowsRead} rows, ${cellsRead} name cells, ${bandsChecked} bands.`);
  process.exit(1);
}
console.log(`encounter grids: OK — ${rowsRead} rows, ${cellsRead} name cells, ${bandsChecked} bands tile their dice.`);
