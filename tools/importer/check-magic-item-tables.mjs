/**
 * Magic-item table gate: do the Judges Journal's item-generation and
 * arms-and-armour tables read WHOLE from the book — every row found, every cell
 * carrying its own text, every band list tiling its die, every hop resolving?
 *
 * The lists are set in two print columns or across two pages, three of them
 * end in a tail of inner bands under an outer face, a wrapped name is centred on
 * its label, and the small-capital initials arrive as lone lower-case runs. A
 * window or a y-bound that misses by a few points does not throw: a segment's
 * rows go missing, a wrapped line lands on the neighbouring row, and the table
 * reads plausibly short. The committed tests feed the assembler invented cells,
 * so nothing offline reads the real page.
 *
 * Reads every `magicItemTables` recipe, assembles them as the importer does
 * and fails on:
 *   - a list the assembler refuses (its bands do not tile from 1 with no gap or
 *     overlap, or a tail group's inner bands do not), or one that ends on no
 *     die's face;
 *   - a row with an empty cell, a name opening on a lower-case letter (a
 *     small-capital initial that was not restored) or ending on a stranded
 *     letter, or an unbalanced bracket;
 *   - a caption not read for a list, or a hop row of the Random Type list that
 *     does not resolve to exactly one list of the document;
 *   - an arms grid that does not read seven settings' columns each tiling the
 *     die, or whose setting names differ from another grid's.
 * The die each list is thrown on is read off its own bands, so no face is
 * written here.
 *
 * Requires the LOCAL Judges Journal, so it SKIPS (exit 0) where it is absent,
 * CI included. Output names recipe keys, bands and columns, never a cell's text.
 *
 * Usage: node tools/importer/check-magic-item-tables.mjs   (also via `npm run validate`)
 */
import fs from "node:fs";
import { openBook, pageItems } from "../../scripts/importer/extract.mjs";
import { extractTable } from "../../scripts/importer/table-extract.mjs";
import { TABLE_RECIPES } from "../../scripts/importer/table-recipes.mjs";
import { locatePageNumber } from "../../scripts/importer/tables-binding.mjs";
import { ARMS_RAW_KEYS, LISTS, SETTING_COLUMNS, assembleMagicItemTables, captionKeys } from "../../scripts/importer/magic-item-binding.mjs";
import { FILES } from "./reference-lib.mjs";

if (!fs.existsSync(FILES.jj)) {
  console.log("magic item tables: SKIPPED — the local Judges Journal is not on this machine.");
  process.exit(0);
}

/** The faces a list may end on: the standard dice. */
const DICE = new Set([4, 6, 8, 10, 12, 20, 100]);
/** The cells that hold a sentence rather than a name, where a lower-case opening and a closing letter are the book's. */
const PROSE = new Set(["text", "content", "cues"]);

const faults = [];
const fail = (where, why) => faults.push(`${where}: ${why}`);

const recipes = TABLE_RECIPES.magicItemTables.tables;
const { doc: pdf } = await openBook(fs.readFileSync(FILES.jj), { book: "jj" });
const pages = new Map();

/** Read every recipe off the book: raw rows by recipe key. */
const raw = {};
for (const [key, recipe] of Object.entries(recipes)) {
  const page = await locatePageNumber(pdf, recipe);
  if (page == null) {
    fail(key, "no page answers the recipe's locate");
    continue;
  }
  if (!pages.has(page)) pages.set(page, await pageItems(pdf, page));
  raw[key] = extractTable(pages.get(page).items, recipe);
}

/** What is wrong with a cell's text, by shape alone; null when nothing is. */
function cellFault(col, text) {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "empty cell";
  if ((s.match(/\(/g) ?? []).length !== (s.match(/\)/g) ?? []).length) return "unbalanced brackets";
  if ((s.match(/\[/g) ?? []).length !== (s.match(/\]/g) ?? []).length) return "unbalanced brackets";
  if (PROSE.has(col)) return null;
  if (/^[a-z]/.test(s)) return "opens on a lower-case letter (a small-capital initial not restored)";
  if (/\s[A-WYZa-z]$/.test(s)) return "ends in a stranded letter";
  if (/^[A-Za-z]\s/.test(s)) return "begins with a stranded letter";
  return null;
}

/** The rows of a raw list, the caption left out: `[key, row]`. */
const rowsOf = (table) => Object.entries(table ?? {}).filter(([k]) => k !== "caption");

const rowsRead = {};
let listsChecked = 0;

/* --- the band lists -------------------------------------------------------- */
const assembled = assembleMagicItemTables(raw);
const captions = captionKeys(raw);
for (const [table, columns] of Object.entries(LISTS)) {
  for (const [column, keys] of Object.entries(columns)) {
    const id = `${table}.${column}`;
    // Every row found: a missing placeholder or an unparsed band label is a row lost.
    let n = 0;
    for (const k of keys) {
      for (const [rowKey, row] of rowsOf(raw[k])) {
        if (row?.__missing) {
          fail(`${k} ${rowKey}`, "row not found on the page");
          continue;
        }
        if (!Number.isFinite(row.min) || !Number.isFinite(row.max)) fail(`${k} ${rowKey}`, "band label did not parse");
        for (const [col, text] of Object.entries(row)) {
          if (["min", "max", "parent", "sub", "label"].includes(col)) continue;
          const bad = cellFault(col, text);
          // A bare outer face has no cells at all, so an empty row is the face, not a hole.
          if (bad && !(Object.keys(row).length === 2 && bad === "empty cell")) fail(`${k} ${row.min}-${row.max} ${col}`, bad);
        }
        n++;
      }
    }
    const bands = assembled[table]?.[column];
    listsChecked++;
    if (!bands) {
      fail(id, "the binding refuses its bands (they do not tile from 1, or a tail group's inner bands do not)");
      continue;
    }
    const top = bands.at(-1).max;
    if (!DICE.has(top)) fail(id, `ends at ${top}, which is no die's face`);
    for (const b of bands) if (b.sub && !DICE.has(b.sub.at(-1).max)) fail(id, `a tail group ends at ${b.sub.at(-1).max}, which is no die's face`);
    const inner = bands.reduce((sum, b) => sum + (b.sub ? b.sub.length : 1), 0);
    rowsRead[id] = inner;
    if (table !== "scrollSpellLevels" && !captions[id]) fail(id, "no caption read for the list");
    if (table === "scrollSpellLevels" && !assembled.captions?.[id]) fail(id, "no header figure read for the list");
  }
}

/* --- hops ------------------------------------------------------------------ */
let hops = 0;
const typeBands = assembled.classicType?.bands ?? [];
if (!typeBands.length) fail("classicType.bands", "no rows to hop from");
for (const b of typeBands) {
  if (!b.hop) {
    fail(`classicType.bands ${b.min}-${b.max}`, "does not name exactly one list of the document");
    continue;
  }
  const [table, column] = b.hop.split(".");
  if (!assembled[table]?.[column]) fail(`classicType.bands ${b.min}-${b.max}`, `names ${b.hop}, which was not assembled`);
  else hops++;
}
// Two bands naming one list, or a classic list no band names, is a row misread as another.
const named = typeBands.map((b) => b.hop).filter(Boolean);
if (new Set(named).size !== named.length) fail("classicType.bands", "two rows name the same list");
for (const column of Object.keys(LISTS.classic)) if (typeBands.length && !named.includes(`classic.${column}`)) fail(`classic.${column}`, "no Random Type row names it");

/* --- arms grids ------------------------------------------------------------ */
const settings = assembled.armsSettings ?? {};
if (Object.keys(settings).length !== SETTING_COLUMNS) fail("armsSettings", `${Object.keys(settings).length} setting names read, not ${SETTING_COLUMNS}`);
for (const [table, rawKey] of Object.entries(ARMS_RAW_KEYS)) {
  listsChecked++;
  const grid = assembled[table];
  if (!grid) {
    fail(table, "an arms column does not tile the die from 1, or the grid was not read");
    continue;
  }
  let n = 0;
  for (const [col, bands] of Object.entries(grid)) {
    n += bands.length;
    if (bands.at(-1).max !== grid.s1.at(-1).max) fail(`${table} ${col}`, "ends on a different face from the first column");
    if (!DICE.has(bands.at(-1).max)) fail(`${table} ${col}`, `ends at ${bands.at(-1).max}, which is no die's face`);
  }
  rowsRead[table] = Object.keys(raw[rawKey] ?? {}).filter((k) => /^r\d+$/.test(k)).length;
  for (const h of ["head1", "head2"]) {
    const row = raw[rawKey]?.[h];
    if (!row || row.__missing) fail(`${rawKey} ${h}`, "header line not found");
    else for (let i = 1; i <= SETTING_COLUMNS; i++) if (!row[`s${i}`]) fail(`${rawKey} ${h} s${i}`, "empty header cell");
  }
  const own = [raw[rawKey]?.head1, raw[rawKey]?.head2].map((r) => Array.from({ length: SETTING_COLUMNS }, (_, i) => String(r?.[`s${i + 1}`] ?? "").replace(/\s+/g, " ").trim()).join("|")).join("|");
  const first = Object.values(ARMS_RAW_KEYS)[0];
  const ref = [raw[first]?.head1, raw[first]?.head2].map((r) => Array.from({ length: SETTING_COLUMNS }, (_, i) => String(r?.[`s${i + 1}`] ?? "").replace(/\s+/g, " ").trim()).join("|")).join("|");
  if (own !== ref) fail(`${rawKey}`, "setting names differ from the first grid's");
}

const counts = Object.entries(rowsRead).map(([k, n]) => `${k} ${n}`).join(", ");
if (faults.length) {
  for (const f of faults) console.error(`FAIL  ${f}`);
  console.error(`magic item tables: FAILED — ${faults.length} fault(s). Rows read: ${counts}.`);
  process.exit(1);
}
console.log(`magic item tables: OK — ${listsChecked} lists read and tiling their dice; ${hops} Random Type rows resolve to one list each. Rows read: ${counts}.`);
