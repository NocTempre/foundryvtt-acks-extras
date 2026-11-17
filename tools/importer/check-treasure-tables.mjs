/**
 * Treasure table gate: do the treasure tables of the Judges Journal and of the
 * Treasure Tome read WHOLE from the book — every row found, every cell carrying
 * its own text, every band list tiling its die with no gap and no overlap?
 *
 * The treasure-type grids are set four lines to a row with the letter centred
 * on it; the special-treasure lists wrap their results and, in the Journal,
 * three of them run across two print columns or two pages. A window or a
 * y-bound that misses by a few points does not throw: a wrapped line lands on
 * the neighbouring row, or a segment's rows go missing, and the table reads
 * plausibly short. The committed tests feed the assembler invented cells, so
 * nothing offline reads the real page.
 *
 * Reads every `treasure` recipe, from the Journal and, where the Treasure Tome
 * is local, from the Tome's own page (`recipe.over`, and the Tome-only
 * Gritty grid), and fails on:
 *   - a declared treasure-type letter the page did not yield, or an empty cell;
 *   - a type row whose cells are not shaped as the page sets them (a chance and
 *     its dice, a category and an average value, a magic cell that opens on a
 *     number and closes its bracket), which is how a wrapped line misjoined to
 *     the row above or below shows;
 *   - a band whose label did not parse, an empty value or result, a stranded
 *     single letter at either end of a cell, or an unbalanced bracket;
 *   - a band list that does not tile from 1 with no gap or overlap, one that
 *     ends on no die's face, or a value list that does not end where its dice
 *     legend says.
 * It also requires every coin column's unit on every type grid, a lot unit on
 * every special list's caption, and a whole dice legend above each value list.
 * The die each list is thrown on is read off its own bands, so no face is
 * written here. Where both books are local, the Tome's read must also match
 * the Journal's in shape: the same treasure-type letters and the same number of
 * legend rows and special lists.
 *
 * Requires the LOCAL Judges Journal, so it SKIPS (exit 0) where it is absent,
 * CI included; the Treasure Tome side is skipped where that book is absent.
 * Output names recipe keys, bands and columns, never a cell's text.
 *
 * Usage: node tools/importer/check-treasure-tables.mjs   (also via `npm run validate`)
 */
import fs from "node:fs";
import { openBook, pageItems } from "../../scripts/importer/extract.mjs";
import { extractTable } from "../../scripts/importer/table-extract.mjs";
import { TABLE_RECIPES } from "../../scripts/importer/table-recipes.mjs";
import { locatePageNumber } from "../../scripts/importer/tables-binding.mjs";
import { DICE_RAW_KEYS, SPECIAL_RAW_KEYS, TYPE_RAW_KEYS, UNIT_RAW_KEYS, VALUE_RAW_KEYS, assembleBands, assembleLegend, assembleSpecialPer, assembleTypeUnits } from "../../scripts/importer/treasure-binding.mjs";
import { TYPE_LETTERS } from "../../scripts/importer/table-recipes-treasure.mjs";
import { FILES } from "./reference-lib.mjs";

if (!fs.existsSync(FILES.jj)) {
  console.log("treasure tables: SKIPPED — the local Judges Journal is not on this machine.");
  process.exit(0);
}

/** The faces a special-treasure list may end on: the standard dice. */
const DICE = new Set([4, 6, 8, 10, 12, 20, 100]);

const faults = [];
const fail = (where, why) => faults.push(`${where}: ${why}`);

const recipes = TABLE_RECIPES.treasure.tables;
const books = { jj: (await openBook(fs.readFileSync(FILES.jj), { book: "jj" })).doc };
const sides = ["jj"];
if (fs.existsSync(FILES.tt)) {
  books.tt = (await openBook(fs.readFileSync(FILES.tt), { book: "tt" })).doc;
  sides.push("tt");
} else console.log("treasure tables: the local Treasure Tome is not on this machine; its side is skipped.");

/** The recipe a key is read with on one side: the Journal's own, the Tome's `over`, or the Tome-only table; null where the side has none. */
function recipeOn(key, side) {
  const recipe = recipes[key];
  if (side === "jj") return recipe.book === "jj" ? recipe : null;
  return recipe.over ?? (recipe.book === "tt" ? recipe : null);
}

/** A band list against its die: null when it tiles from 1 to `top`, else what is wrong. */
function tilingFault(bands) {
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
  return wrong.length ? wrong.join(", ") : null;
}

/** What is wrong with a cell's text, by shape alone; null when nothing is. */
function cellFault(text) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "empty cell";
  if (/\s[A-Za-z]$/.test(s)) return "ends in a stranded letter";
  if (/^[A-Za-z]\s/.test(s)) return "begins with a stranded letter";
  if ((s.match(/\(/g) ?? []).length !== (s.match(/\)/g) ?? []).length) return "unbalanced brackets";
  return null;
}

const COIN_COLUMNS = ["cp", "sp", "ep", "gp", "pp", "gems", "jewelry"];

/** Reads and checks every treasure table on one side; returns its counts. */
async function checkSide(side) {
  const pdf = books[side];
  const pages = new Map();
  const at = (key) => `${side === "jj" ? "" : "[tt] "}${key}`;

  /** Read one recipe off the book: its rows and the text of the page it found; null for an emptied segment. */
  async function readGrid(key) {
    const recipe = recipeOn(key, side);
    if (!recipe) return null;
    if (recipe.empty) return { rows: {}, text: "", empty: true };
    const page = await locatePageNumber(pdf, recipe);
    if (page == null) {
      fail(at(key), "no page answers the recipe's locate");
      return null;
    }
    if (!pages.has(page)) pages.set(page, await pageItems(pdf, page));
    const { items } = pages.get(page);
    return { rows: extractTable(items, recipe), text: items.map((i) => i.str).join(" ") };
  }

  const rowsRead = {};
  let bandsChecked = 0;
  const letters = {};

  /* --- the treasure-type grids ---------------------------------------------- */
  for (const key of Object.keys(TYPE_RAW_KEYS)) {
    const got = await readGrid(key);
    if (!got) continue;
    rowsRead[key] = 0;
    letters[key] = [];
    for (const letter of TYPE_LETTERS) {
      const row = got.rows[letter];
      if (!row || row.__missing) {
        fail(at(`${key} ${letter}`), "row not found on the page");
        continue;
      }
      rowsRead[key]++;
      letters[key].push(letter);
      const cells = { head: row.head, ...Object.fromEntries(COIN_COLUMNS.map((c) => [c, row[c]])), magic: row.magic };
      for (const [col, text] of Object.entries(cells)) {
        const bad = cellFault(text);
        if (bad) fail(at(`${key} ${letter} ${col}`), bad);
      }
      if (!/^[A-Za-z]+\s+\(?[\d,]+gp\)?$/.test(String(row.head ?? "").trim())) fail(at(`${key} ${letter} head`), "is not a category and an average value");
      for (const c of COIN_COLUMNS) if (!/^\d+%\s+\S/.test(String(row[c] ?? "").trim())) fail(at(`${key} ${letter} ${c}`), "does not open on a chance and its dice");
      const magic = String(row.magic ?? "").trim();
      if (!/^\d/.test(magic)) fail(at(`${key} ${letter} magic`), "does not open on a number (a line of the row below joined it, or its first line went to the row above)");
      if (!/\)$/.test(magic)) fail(at(`${key} ${letter} magic`), "does not close on its average value (its last line went to another row)");
    }
  }

  /* --- gem and jewelry value ------------------------------------------------ */
  for (const key of Object.keys(VALUE_RAW_KEYS)) {
    const got = await readGrid(key);
    if (!got) continue;
    const bands = [];
    for (const [rowKey, row] of Object.entries(got.rows)) {
      if (row?.__missing) {
        fail(at(`${key} ${rowKey}`), "row not found on the page");
        continue;
      }
      if (!Number.isFinite(row.min) || !Number.isFinite(row.max)) {
        fail(at(`${key} ${rowKey}`), "band label did not parse");
        continue;
      }
      for (const col of ["value", "type"]) {
        const bad = cellFault(row[col]);
        if (bad) fail(at(`${key} ${row.min}-${row.max} ${col}`), bad);
      }
      bands.push(row);
    }
    rowsRead[key] = bands.length;
    bandsChecked++;
    const wrong = tilingFault(bands);
    if (wrong) fail(at(key), wrong);
    // The dice legend over the bands names the d100 and the offset the top band reaches.
    const offset = /d100\s*\+\s*(\d+)/.exec(got.text);
    const top = Math.max(...bands.map((b) => b.max));
    if (!offset) fail(at(key), "no dice legend found on the page to take the top band's face from");
    else if (top !== 100 + Number(offset[1])) fail(at(key), `ends at ${top}, not where its dice legend says`);
  }

  /* --- special treasure ----------------------------------------------------- */
  const rawSpecial = {};
  const specialKinds = [];
  for (const rawKey of Object.values(SPECIAL_RAW_KEYS).flat()) {
    const got = await readGrid(rawKey);
    if (!got) continue;
    rawSpecial[rawKey] = got.rows;
    if (got.empty) continue;
    rowsRead[rawKey] = 0;
    for (const [rowKey, row] of Object.entries(got.rows)) {
      if (rowKey === "caption") continue;
      if (row?.__missing) {
        fail(at(`${rawKey} ${rowKey}`), "row not found on the page");
        continue;
      }
      rowsRead[rawKey]++;
      if (!Number.isFinite(row.min) || !Number.isFinite(row.max)) fail(at(`${rawKey} ${rowKey}`), "band label did not parse");
      const bad = cellFault(row.text);
      if (bad) fail(at(`${rawKey} ${row.min}-${row.max}`), bad);
    }
  }
  for (const [kind, rawKeys] of Object.entries(SPECIAL_RAW_KEYS)) {
    bandsChecked++;
    const bands = assembleBands(rawKeys.map((k) => rawSpecial[k]), (r) => ({ text: r.text }));
    const flat = rawKeys.flatMap((k) => Object.values(rawSpecial[k] ?? {})).filter((r) => Number.isFinite(r?.min) && Number.isFinite(r?.max));
    const wrong = tilingFault(flat);
    if (wrong) fail(at(`special.${kind}`), wrong);
    else if (!bands) fail(at(`special.${kind}`), "the binding refuses its bands");
    else if (!DICE.has(bands.at(-1).max)) fail(at(`special.${kind}`), `ends at ${bands.at(-1).max}, which is no die's face`);
    else specialKinds.push(kind);
  }

  /* --- caption units, the unit line and the dice legends ---------------------- */
  const rawAll = { ...rawSpecial };
  for (const rawKey of [...Object.keys(UNIT_RAW_KEYS), ...Object.keys(DICE_RAW_KEYS), ...Object.values(SPECIAL_RAW_KEYS).map((keys) => keys[0])]) {
    const got = await readGrid(rawKey);
    if (got) rawAll[rawKey] = got.rows;
  }
  const per = assembleSpecialPer(rawAll);
  for (const kind of Object.keys(SPECIAL_RAW_KEYS)) if (!per?.[kind]) fail(at(`specialPer.${kind}`), "no lot unit read off the list's caption");
  const units = assembleTypeUnits(rawAll);
  for (const [rawKey, grid] of Object.entries(UNIT_RAW_KEYS)) {
    if (!recipeOn(rawKey, side)) continue;
    for (const coin of ["cp", "sp", "ep", "gp", "pp"]) if (!units?.[grid]?.[coin]) fail(at(`typeUnits.${grid}.${coin}`), "no unit read under the coin column");
  }
  let legends = 0;
  for (const [rawKey, key] of Object.entries(DICE_RAW_KEYS)) {
    const legend = assembleLegend(rawAll[rawKey]);
    rowsRead[rawKey] = legend?.length ?? 0;
    if (!legend || legend.length !== 3) fail(at(key), `${legend?.length ?? 0} legend rows read, not one per kind of lot`);
    else {
      legends++;
      for (const [i, row] of legend.entries()) for (const col of ["dice", "avg", "kind"]) if (!row[col]) fail(at(`${key} ${i}`), `empty ${col}`);
    }
  }
  return { rowsRead, bandsChecked, letters, specialKinds, legends };
}

const results = {};
for (const side of sides) results[side] = await checkSide(side);

/* --- the Tome's read has the Journal's shape -------------------------------- */
if (results.tt) {
  const [jj, tt] = [results.jj, results.tt];
  for (const key of ["typeClassicRaw", "typeHeroicRaw"]) {
    if (jj.letters[key]?.join("") !== tt.letters[key]?.join("")) fail(`[tt] ${key}`, "does not yield the Journal's treasure-type letters");
  }
  if (jj.specialKinds.join() !== tt.specialKinds.join()) fail("[tt] special", "does not yield the Journal's special-treasure lists");
  if (jj.legends !== tt.legends) fail("[tt] legends", "does not yield the Journal's dice legends");
}

const counts = (r) => Object.entries(r.rowsRead).map(([k, n]) => `${k} ${n}`).join(", ");
const summary = sides.map((s) => `${s === "jj" ? "Journal" : "Tome"}: ${Object.keys(results[s].rowsRead).length} tables read, ${results[s].bandsChecked} band lists tile their dice. Rows read: ${counts(results[s])}.`).join(" ");
if (faults.length) {
  for (const f of faults) console.error(`FAIL  ${f}`);
  console.error(`treasure tables: FAILED — ${faults.length} fault(s). ${summary}`);
  process.exit(1);
}
console.log(`treasure tables: OK — ${summary}`);
