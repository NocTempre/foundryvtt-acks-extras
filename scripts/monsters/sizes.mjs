/**
 * What a monster size category occupies on a battle grid, as the Judge's own
 * Monstrous Manual prints it (Monster Size, MM p. 11, the frontage in
 * battle-grid squares). The figures are imported into the `monsters` registry
 * document's `sizeFrontage` table, one printed cell per category, and read
 * here; nothing in source states one. What one of those squares is worth in
 * feet is the unit the same row's label prints, imported into `sizeSquare` and
 * read by `sizeSquareFeet`. Foundry-free.
 *
 * A cell is the page's own text. It prints a pair of squares, the first
 * arrangement being the one read, or a single figure for a body that fills at
 * most one square. A body never occupies less than one token square, so every
 * figure is held to one at the least.
 */
import { citeOf, expectTables, getDoc, hasDoc, isMissingRow } from "../lib/tables.mjs";

/** The registry document and table the frontage cells are read from, and the row they sit on. */
export const SIZE_DOC = "monsters";
export const SIZE_TABLE = "sizeFrontage";
export const SIZE_ROW = "squares";

/** The table holding what one battle-grid square is worth in feet, on the same row. */
export const SQUARE_TABLE = "sizeSquare";

// Declared where it is read, so the import names the tables as outstanding
// whichever feature loads first. The ids are SIZE_TABLE and SQUARE_TABLE,
// written as literals because the producers gate reads this call from source.
expectTables(SIZE_DOC, ["sizeFrontage", "sizeSquare"]);

const PAIR = /(\d+(?:\.\d+)?)\s*[×xX]\s*(\d+(?:\.\d+)?)/;
const FRACTION = /(\d+)\s*\/\s*(\d+)/;
const FIGURE = /\d+(?:\.\d+)?/;

/**
 * One printed frontage cell as `{w, h}` in squares, each held to one at the
 * least, or null for a cell holding no figure.
 */
export function parseFrontage(cell) {
  const text = String(cell ?? "");
  const floor = (n) => Math.max(1, n);
  const pair = PAIR.exec(text);
  if (pair) return { w: floor(Number(pair[1])), h: floor(Number(pair[2])) };
  const fraction = FRACTION.exec(text);
  if (fraction && Number(fraction[2]) > 0) {
    const v = floor(Number(fraction[1]) / Number(fraction[2]));
    return { w: v, h: v };
  }
  const figure = FIGURE.exec(text);
  if (figure) {
    const v = floor(Number(figure[0]));
    return { w: v, h: v };
  }
  return null;
}

/**
 * The squares a size category occupies, `{w, h}`, or null where the world
 * holds no frontage table, the table's row was not read, or the category's
 * cell holds no figure. Reads the layer a Judge's override sits on.
 */
export function sizeSquares(sizeKey) {
  if (!sizeKey || !hasDoc(SIZE_DOC)) return null;
  const row = getDoc(SIZE_DOC)?.tables?.[SIZE_TABLE]?.[SIZE_ROW];
  if (!row || typeof row !== "object" || isMissingRow(row)) return null;
  return Object.hasOwn(row, sizeKey) ? parseFrontage(row[sizeKey]) : null;
}

/**
 * What one battle-grid square is worth in feet, or null where the world holds
 * no `sizeSquare` table, its row was not read, or the row holds no positive
 * figure. Reads the layer a Judge's override sits on; nothing stands in for a
 * square that was not imported.
 */
export function sizeSquareFeet() {
  if (!hasDoc(SIZE_DOC)) return null;
  const row = getDoc(SIZE_DOC)?.tables?.[SQUARE_TABLE]?.[SIZE_ROW];
  if (!row || typeof row !== "object" || isMissingRow(row)) return null;
  const feet = Number(row.feet);
  return feet > 0 ? feet : null;
}

/** The page the frontage table was read from, or null where it was not read from one. */
export function sizeCite() {
  return hasDoc(SIZE_DOC) ? citeOf(SIZE_DOC, SIZE_TABLE) : null;
}
