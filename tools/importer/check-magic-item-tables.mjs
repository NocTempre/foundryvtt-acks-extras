/**
 * Magic-item table gate: do the Judges Journal's item-generation and
 * arms-and-armour tables read WHOLE from the book — every row found, every cell
 * carrying its own text, every band list tiling its die, every hop resolving?
 * And, where the Treasure Tome is local, do the tables it replaces them with
 * read as whole and with the same columns?
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
 * The Treasure Tome side assembles the document as an import with that book
 * open does: each recipe's `over` page from the Tome, every other table from
 * the Journal. It fails on the same faults and also where the Tome's arms
 * grids name other settings than the Journal's, end on another die, or its
 * Creature Type list ends on another die.
 *
 * Requires the LOCAL Judges Journal, so it SKIPS (exit 0) where it is absent,
 * CI included; the Treasure Tome side is skipped where that book is absent.
 * Output names recipe keys, bands and columns, never a cell's text.
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
const books = { jj: (await openBook(fs.readFileSync(FILES.jj), { book: "jj" })).doc };
const sides = ["jj"];
if (fs.existsSync(FILES.tt)) {
  books.tt = (await openBook(fs.readFileSync(FILES.tt), { book: "tt" })).doc;
  sides.push("tt");
} else console.log("magic item tables: the local Treasure Tome is not on this machine; its side is skipped.");

const pageCache = new Map();
/** A page's items, read once per book. */
async function itemsOf(book, page) {
  const key = `${book}:${page}`;
  if (!pageCache.has(key)) pageCache.set(key, await pageItems(books[book], page));
  return pageCache.get(key).items;
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

/** The setting names of an arms grid's two header lines, `a|b|…`. */
const settingNames = (raw, rawKey) =>
  [raw[rawKey]?.head1, raw[rawKey]?.head2].map((r) => Array.from({ length: SETTING_COLUMNS }, (_, i) => String(r?.[`s${i + 1}`] ?? "").replace(/\s+/g, " ").trim()).join("|")).join("|");

/**
 * Reads and checks the document on one side. The Journal side reads every
 * recipe from the Journal; the Tome side reads a recipe's `over` page from the
 * Tome and the rest from the Journal, as an import with both books open does.
 */
async function checkSide(side) {
  const at = (where) => `${side === "jj" ? "" : "[tt] "}${where}`;
  const raw = {};
  for (const [key, recipe] of Object.entries(recipes)) {
    const use = side === "tt" && recipe.over ? recipe.over : recipe;
    const page = await locatePageNumber(books[use.book], use);
    if (page == null) {
      fail(at(key), "no page answers the recipe's locate");
      continue;
    }
    raw[key] = extractTable(await itemsOf(use.book, page), use);
  }

  const rowsRead = {};
  let listsChecked = 0;

  /* --- the band lists -------------------------------------------------------- */
  const assembled = assembleMagicItemTables(raw);
  const captions = captionKeys(raw);
  for (const [table, columns] of Object.entries(LISTS)) {
    for (const [column, keys] of Object.entries(columns)) {
      const id = `${table}.${column}`;
      // Every row found: a missing placeholder or an unparsed band label is a row lost.
      for (const k of keys) {
        for (const [rowKey, row] of rowsOf(raw[k])) {
          if (row?.__missing) {
            fail(at(`${k} ${rowKey}`), "row not found on the page");
            continue;
          }
          if (!Number.isFinite(row.min) || !Number.isFinite(row.max)) fail(at(`${k} ${rowKey}`), "band label did not parse");
          for (const [col, text] of Object.entries(row)) {
            if (["min", "max", "parent", "sub", "label"].includes(col)) continue;
            const bad = cellFault(col, text);
            // A bare outer face has no cells at all, so an empty row is the face, not a hole.
            if (bad && !(Object.keys(row).length === 2 && bad === "empty cell")) fail(at(`${k} ${row.min}-${row.max} ${col}`), bad);
          }
        }
      }
      const bands = assembled[table]?.[column];
      listsChecked++;
      if (!bands) {
        fail(at(id), "the binding refuses its bands (they do not tile from 1, or a tail group's inner bands do not)");
        continue;
      }
      const top = bands.at(-1).max;
      if (!DICE.has(top)) fail(at(id), `ends at ${top}, which is no die's face`);
      for (const b of bands) if (b.sub && !DICE.has(b.sub.at(-1).max)) fail(at(id), `a tail group ends at ${b.sub.at(-1).max}, which is no die's face`);
      rowsRead[id] = bands.reduce((sum, b) => sum + (b.sub ? b.sub.length : 1), 0);
      if (table !== "scrollSpellLevels" && !captions[id]) fail(at(id), "no caption read for the list");
      if (table === "scrollSpellLevels" && !assembled.captions?.[id]) fail(at(id), "no header figure read for the list");
    }
  }

  /* --- hops ------------------------------------------------------------------ */
  let hops = 0;
  const typeBands = assembled.classicType?.bands ?? [];
  if (!typeBands.length) fail(at("classicType.bands"), "no rows to hop from");
  for (const b of typeBands) {
    if (!b.hop) {
      fail(at(`classicType.bands ${b.min}-${b.max}`), "does not name exactly one list of the document");
      continue;
    }
    const [table, column] = b.hop.split(".");
    if (!assembled[table]?.[column]) fail(at(`classicType.bands ${b.min}-${b.max}`), `names ${b.hop}, which was not assembled`);
    else hops++;
  }
  // Two bands naming one list, or a classic list no band names, is a row misread as another.
  const named = typeBands.map((b) => b.hop).filter(Boolean);
  if (new Set(named).size !== named.length) fail(at("classicType.bands"), "two rows name the same list");
  for (const column of Object.keys(LISTS.classic)) if (typeBands.length && !named.includes(`classic.${column}`)) fail(at(`classic.${column}`), "no Random Type row names it");

  /* --- arms grids ------------------------------------------------------------ */
  const settings = assembled.armsSettings ?? {};
  if (Object.keys(settings).length !== SETTING_COLUMNS) fail(at("armsSettings"), `${Object.keys(settings).length} setting names read, not ${SETTING_COLUMNS}`);
  const first = Object.values(ARMS_RAW_KEYS)[0];
  for (const [table, rawKey] of Object.entries(ARMS_RAW_KEYS)) {
    listsChecked++;
    const grid = assembled[table];
    if (!grid) {
      fail(at(table), "an arms column does not tile the die from 1, or the grid was not read");
      continue;
    }
    for (const [col, bands] of Object.entries(grid)) {
      if (bands.at(-1).max !== grid.s1.at(-1).max) fail(at(`${table} ${col}`), "ends on a different face from the first column");
      if (!DICE.has(bands.at(-1).max)) fail(at(`${table} ${col}`), `ends at ${bands.at(-1).max}, which is no die's face`);
    }
    rowsRead[table] = Object.keys(raw[rawKey] ?? {}).filter((k) => /^r\d+$/.test(k)).length;
    for (const h of ["head1", "head2"]) {
      const row = raw[rawKey]?.[h];
      if (!row || row.__missing) fail(at(`${rawKey} ${h}`), "header line not found");
      else for (let i = 1; i <= SETTING_COLUMNS; i++) if (!row[`s${i}`]) fail(at(`${rawKey} ${h} s${i}`), "empty header cell");
    }
    if (settingNames(raw, rawKey) !== settingNames(raw, first)) fail(at(rawKey), "setting names differ from the first grid's");
  }
  return { assembled, raw, rowsRead, listsChecked, hops };
}

const results = {};
for (const side of sides) results[side] = await checkSide(side);

/* --- the Tome's grids are the Journal's columns ----------------------------- */
if (results.tt) {
  const [jj, tt] = [results.jj, results.tt];
  const first = Object.values(ARMS_RAW_KEYS)[0];
  if (settingNames(jj.raw, first) !== settingNames(tt.raw, first)) fail("[tt] armsSettings", "the Tome's arms grids name other settings than the Journal's");
  for (const table of Object.keys(ARMS_RAW_KEYS)) {
    const [a, b] = [jj.assembled[table]?.s1?.at(-1)?.max, tt.assembled[table]?.s1?.at(-1)?.max];
    if (a !== b) fail(`[tt] ${table}`, "ends on another die than the Journal's");
  }
  if (jj.assembled.creatureType?.bands?.at(-1)?.max !== tt.assembled.creatureType?.bands?.at(-1)?.max) fail("[tt] creatureType.bands", "ends on another die than the Journal's");
}

const counts = (r) => Object.entries(r.rowsRead).map(([k, n]) => `${k} ${n}`).join(", ");
const OVERLAID = ["creatureType.bands", ...Object.keys(ARMS_RAW_KEYS)];
const summary = sides
  .map((s) => (s === "jj"
    ? `Journal: ${results.jj.listsChecked} lists read and tiling their dice; ${results.jj.hops} Random Type rows resolve to one list each. Rows read: ${counts(results.jj)}.`
    : `Tome: ${results.tt.listsChecked} lists read and tiling their dice; ${results.tt.hops} Random Type rows resolve to one list each. Rows read from the Tome: ${OVERLAID.map((k) => `${k} ${results.tt.rowsRead[k]}`).join(", ")}.`))
  .join(" ");
if (faults.length) {
  for (const f of faults) console.error(`FAIL  ${f}`);
  console.error(`magic item tables: FAILED — ${faults.length} fault(s). ${summary}`);
  process.exit(1);
}
console.log(`magic item tables: OK — ${summary}`);
