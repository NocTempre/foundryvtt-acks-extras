/**
 * What a monster size category occupies on a battle grid, as the Judge's own
 * Monstrous Manual prints it (Monster Size, MM p. 11, the frontage in
 * battle-grid squares). The figures are imported into the `monsters` registry
 * document's `sizeFrontage` table, one printed cell per category, and read
 * here; nothing in source states one. What one of those squares is worth in
 * feet is the unit the frontage is counted in: it is stated in
 * `lib/distance-units.mjs` as `SQUARE_FEET`, re-exported here, and
 * `sizeSquareFeet` answers it unless the world's `sizeSquare` table, left by an
 * import made while the figure was imported and overridable by a Judge in the
 * Ruledata Browser, stands in for it. Foundry-free.
 *
 * A cell is the page's own text. It prints a pair of squares, the first
 * arrangement being the one read, or a single figure for a body that fills at
 * most one square. A body never occupies less than one token square, so every
 * figure is held to one at the least.
 */
import { SQUARE_FEET } from "../lib/distance-units.mjs";
import { citeOf, expectTables, getDoc, hasDoc, isMissingRow } from "../lib/tables.mjs";
import { positiveFigure } from "../lib/util.mjs";

/** The registry document the frontage cells are read from. */
export const SIZE_DOC = "monsters";

/** The table of `SIZE_DOC` holding the frontage cells. */
export const SIZE_TABLE = "sizeFrontage";

/** The row of the frontage and square tables the cells sit on. */
export const SIZE_ROW = "squares";

/** What one battle-grid square is worth in feet (MM p. 11): the constant lives in `lib/distance-units.mjs`, and this module keeps exporting it for its readers. */
export { SQUARE_FEET };

/** The table of `SIZE_DOC` a world may hold the square's feet in, on the `SIZE_ROW` row, as `feet`. */
export const SQUARE_TABLE = "sizeSquare";

// Declared where it is read, so the import names the table as outstanding
// whichever feature loads first. The id is SIZE_TABLE, written as a literal
// because the producers gate reads this call from source.
expectTables(SIZE_DOC, ["sizeFrontage"]);

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
 * What one battle-grid square is worth in feet, and never null: the `feet` of
 * the world's `sizeSquare` table where it holds one with a positive figure,
 * else `SQUARE_FEET`. Reads the layer a Judge's override sits on. The table is
 * not declared with `expectTables`: nothing produces it, so a world holds one
 * only from an earlier import, and a Judge's override sits on that table.
 */
export function sizeSquareFeet() {
  if (!hasDoc(SIZE_DOC)) return SQUARE_FEET;
  const row = getDoc(SIZE_DOC)?.tables?.[SQUARE_TABLE]?.[SIZE_ROW];
  if (!row || typeof row !== "object" || isMissingRow(row)) return SQUARE_FEET;
  return positiveFigure(row.feet) ?? SQUARE_FEET;
}

/** The page the frontage table was read from, or null where it was not read from one. */
export function sizeCite() {
  return hasDoc(SIZE_DOC) ? citeOf(SIZE_DOC, SIZE_TABLE) : null;
}
