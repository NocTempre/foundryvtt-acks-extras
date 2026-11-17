/**
 * Table recipes for the treasure tables of the Judges Journal (JJ ch. 4,
 * folios 125-129): the two treasure-type grids, the gem and jewelry value
 * bands, and the special-treasure lists. Geometry and patterns only. The band
 * edges, the dice, the names and every figure are read from the Judge's own
 * copy at import (docs/importer/RECIPES.md), and `treasure-binding.mjs`
 * assembles the engine-shaped tables from these raw reads.
 *
 * A page is found by a phrase the caption prints (`locate`), never by a
 * figure; a region of a shared page is bounded by its print column and its
 * vertical extent, which are geometry. A special-treasure list is set across
 * two print columns, or two pages, for three of its eleven tables, so each of
 * those is read as two segments that the binding joins.
 */

/**
 * A band label ("n", "a-b", "a-b" with an en or em dash), read into `min` and
 * `max` by the `rollBand` label pattern. The specs outnumber any table's rows
 * and are optional, so a table ends where its rows do and no row count ships.
 */
const BAND = "^\\d+(\\s*[-–—]\\s*\\d+)?$";
const bandRows = (n = 20) => Array.from({ length: n }, (_, i) => ({ key: `b${i}`, labelRe: BAND, labelPattern: "rollBand", optional: true }));

/** The treasure types are named by a letter, A to R: structure, not content. */
export const TYPE_LETTERS = Object.freeze("ABCDEFGHIJKLMNOPQR".split(""));
const TYPE_ROWS = TYPE_LETTERS.map((key) => ({ key, labelRe: `^${key}$` }));

/**
 * One treasure-type grid. The row's letter is set in the label column and is
 * the only run left of `labelMaxX`; the type's category and average value
 * stack in the first cell column, the five coin columns, gems, jewelry and the
 * magic items follow. Each row is two to four lines tall, the letter centred
 * on it, so `wrapRows` joins every line to the letter nearest it. `yMin` is
 * the page's own header's lower edge: the wrap reach would otherwise take the
 * header's last line for the first row's. `cells` is `[key, x, width]`.
 *
 * @param {object} grid
 * @param {number} grid.page the printed folio
 * @param {string} grid.locate the caption that names the page
 * @param {number} grid.yMin the first y of the first row's lines
 * @param {number} grid.labelMaxX the right edge of the letter column
 * @param {Array<[string, number, number]>} grid.cells the cell windows, left to right
 * @param {string} [grid.book] the book the page is read from
 */
export const typeGrid = ({ book = "jj", page, locate, yMin, labelMaxX, cells }) => ({
  shape: "gridRows",
  book,
  printedPage: page,
  locate,
  column: { xMin: 40, xMax: 590, yMin },
  labelMaxX,
  rowTol: 4,
  joinGap: 1,
  wrapRows: { tol: 22, centered: true },
  cellColumns: cells.map(([key, x, w]) => ({ key, x, w, pattern: "raw", row: true })),
  rows: TYPE_ROWS,
});

/**
 * A band list read from one region of a page: every row a label that parses to
 * a band, and the result in one or two windowed cells. A result printed over
 * several lines has its label on one of them, so `wrapRows` joins the rest.
 *
 * @param {object} grid
 * @param {number} grid.page the printed folio
 * @param {string} grid.locate a phrase the page prints
 * @param {{xMin: number, xMax: number, yMin: number, yMax?: number}} grid.column the region
 * @param {number} grid.labelMaxX the right edge of the label column
 * @param {Array<[string, number, number]>} grid.cells the cell windows, `[key, x, width]`
 * @param {string} [grid.book] the book the page is read from
 * @param {boolean} [grid.centered] whether a wrapped result's label sits on its middle line
 * @param {boolean} [grid.smallCaps] whether a small-capital initial is restored
 */
export const bandGrid = ({ book = "jj", page, locate, column, labelMaxX, cells, wrap = true, caption = false, centered = false, smallCaps = false }) => ({
  shape: "gridRows",
  book,
  printedPage: page,
  locate,
  column,
  labelMaxX,
  rowTol: 4,
  joinGap: 1,
  ...(smallCaps ? { smallCaps: 1.5 } : {}),
  ...(wrap ? { wrapRows: { tol: 12, ...(centered ? { centered: true } : {}), ...(caption ? { floorKey: "b0" } : {}) } } : {}),
  cellColumns: cells.map(([key, x, w]) => ({ key, x, w, pattern: "raw", row: true })),
  rows: [...(caption ? [{ key: "caption", labelRe: `^${SPECIAL}`, labelPattern: "labelText" }] : []), ...bandRows()],
});

/**
 * A legend row: the dice a kind of lot is rolled on, the average it comes to
 * and the kind, read from the three lines printed above a value list. The dice
 * are a label recognised by their shape (a die letter after an optional count),
 * never by a figure.
 *
 * @param {object} grid
 * @param {number} grid.page the printed folio
 * @param {string} grid.locate a phrase the page prints
 * @param {{xMin: number, xMax: number, yMin: number, yMax: number}} grid.column the region
 * @param {number} grid.labelMaxX the right edge of the dice column
 * @param {Array<[string, number, number]>} grid.cells the cell windows, `[key, x, width]`
 * @param {string} [grid.book] the book the page is read from
 */
const legendGrid = ({ book = "jj", page, locate, column, labelMaxX, cells }) => ({
  shape: "gridRows",
  book,
  printedPage: page,
  locate,
  column,
  labelMaxX,
  rowTol: 4,
  joinGap: 1,
  cellColumns: cells.map(([key, x, w]) => ({ key, x, w, pattern: "raw", row: true })),
  rows: Array.from({ length: 6 }, (_, i) => ({ key: `d${i}`, labelRe: "^\\d*d\\d", labelPattern: "labelText", optional: true })),
});

/**
 * The unit printed under the coin columns of a treasure-type grid, one cell per
 * coin column, on the header line that names the type column.
 *
 * @param {object} grid
 * @param {number} grid.page the printed folio
 * @param {string} grid.locate the caption that names the page
 * @param {number} grid.yMin the header line's upper edge
 * @param {number} grid.labelMaxX the right edge of the type-column header
 * @param {Array<[string, number, number]>} grid.cells the five coin cell windows
 * @param {string} [grid.book] the book the page is read from
 * @param {number} [grid.height] the header line's reach below `yMin`
 */
const unitGrid = ({ book = "jj", page, locate, yMin, labelMaxX, cells, height = 12 }) => ({
  shape: "gridRows",
  book,
  printedPage: page,
  locate,
  column: { xMin: 40, xMax: 340, yMin, yMax: yMin + height },
  labelMaxX,
  rowTol: 4,
  cellColumns: cells.map(([key, x, w]) => ({ key, x, w, pattern: "raw", row: true })),
  rows: [{ key: "units", labelRe: "^[A-Za-z]" }],
});

/** The caption every special-treasure list opens with. */
const SPECIAL = "Special Treasure per";

// The two print columns of the special-treasure pages, and where a label and its
// result sit in each. A left column's labels end before 95; a right column's on
// the first page before 330, on the second before 350.
const LEFT = { xMin: 40, xMax: 300 };
const RIGHT = { xMin: 300, xMax: 592 };

/** One special-treasure segment: a column of a page, from `yMin` down to `yMax`. */
const segment = ({ book, page, side, yMin, yMax, labelMaxX, x, w, caption = true, centered }) =>
  bandGrid({
    book,
    page,
    locate: SPECIAL,
    column: { ...side, yMin, ...(yMax ? { yMax } : {}) },
    labelMaxX,
    cells: [["text", x, w]],
    caption,
    centered,
    smallCaps: centered,
  });

// Page one of the specials (folio 128): a left column and a right column.
const P1_LEFT = { page: 128, side: LEFT, labelMaxX: 68, x: 76, w: 220 };
const P1_RIGHT = { page: 128, side: RIGHT, labelMaxX: 330, x: 333, w: 250 };
// Page two (folio 129).
const P2_LEFT = { page: 129, side: LEFT, labelMaxX: 95, x: 103, w: 190 };
const P2_RIGHT = { page: 129, side: RIGHT, labelMaxX: 350, x: 360, w: 225 };

/**
 * A Judges Journal recipe whose whole table the Treasure Tome replaces where
 * that book is open and the page locates: `over` is a complete recipe for the
 * Tome's own page, read into the same raw key (`tables-binding.mjs`,
 * `readPlainTable`).
 */
const layered = (recipe, over) => ({ ...recipe, over });

/**
 * The Tome's counterpart of a segment it does not need: it prints the list in
 * one piece where the Journal sets it across two columns or pages, so the
 * Journal's tail segment is stored empty, under the Tome's citation, whenever
 * the Tome is read.
 */
const emptied = (page) => ({ book: "tt", printedPage: page, locate: SPECIAL, empty: true });

// The Treasure Tome sets its treasure-type grids on a recto (Classic, Gritty)
// and a verso (Heroic). A verso is set 27 points further left, and its jewelry
// and magic columns less than that.
const TT_RECTO = { labelMaxX: 90, cells: [["head", 90, 48], ["cp", 140, 36], ["sp", 178, 36], ["ep", 216, 36], ["gp", 254, 33], ["pp", 289, 33], ["gems", 326, 66], ["jewelry", 394, 49], ["magic", 445, 147]] };
const TT_VERSO = { labelMaxX: 63, cells: [["head", 64, 48], ["cp", 114, 34], ["sp", 150, 36], ["ep", 190, 35], ["gp", 227, 36], ["pp", 264, 35], ["gems", 301, 68], ["jewelry", 373, 49], ["magic", 427, 165]] };

/** A Treasure Tome treasure-type grid and the unit line printed above its coin columns. */
const ttType = (page, locate, side) => typeGrid({ book: "tt", page, locate, yMin: 124, ...side });
const ttUnits = (page, locate, side) =>
  unitGrid({ book: "tt", page, locate, yMin: 100, height: 8, labelMaxX: side.labelMaxX + 45, cells: side.cells.slice(1, 6).map(([key, x, w]) => [key, x, w]) });

// The Tome's special-treasure pages (folios 24 and 25). A list sits whole in one
// column, its label centred on a result that wraps.
const TT_P24_LEFT = { ...P1_LEFT, book: "tt", page: 24, centered: true };
const TT_P24_RIGHT = { ...P1_RIGHT, book: "tt", page: 24, centered: true };
const TT_P25_LEFT = { ...P2_LEFT, book: "tt", page: 25, w: 195, centered: true };
const TT_P25_RIGHT = { book: "tt", page: 25, side: RIGHT, labelMaxX: 355, x: 360, w: 230, centered: true };

/**
 * The raw tables of the `treasure` document, and the pages they read. A table
 * whose id ends `Rest` or `More` is the second segment of a list the page sets
 * across two columns or pages.
 */
export const TREASURE_RECIPES = {
  source: { book: "ACKS II Judges Journal", pages: "JJ 125-129; TT 19-25" },
  tables: {
    // Treasure Type (Classic): the caption names the page.
    typeClassicRaw: layered(
      typeGrid({
        page: 125,
        locate: "Treasure Type Table (Classic)",
        yMin: 190,
        labelMaxX: 90,
        cells: [["head", 90, 48], ["cp", 138, 36], ["sp", 176, 36], ["ep", 214, 37], ["gp", 253, 36], ["pp", 291, 31], ["gems", 327, 63], ["jewelry", 394, 47], ["magic", 443, 140]],
      }),
      ttType(19, "Treasure Type Table (Classic)", TT_RECTO),
    ),
    // Treasure Type (Heroic): the same columns, set 27 points further left.
    typeHeroicRaw: layered(
      typeGrid({
        page: 126,
        locate: "Treasure Type Table (Heroic)",
        yMin: 106,
        labelMaxX: 62,
        cells: [["head", 64, 48], ["cp", 114, 36], ["sp", 151, 36], ["ep", 189, 37], ["gp", 226, 37], ["pp", 263, 36], ["gems", 300, 63], ["jewelry", 367, 47], ["magic", 414, 170]],
      }),
      ttType(20, "Treasure Type Table (Heroic)", TT_VERSO),
    ),
    // Treasure Type (Gritty): printed by the Treasure Tome only, so it is read
    // only where that book is open.
    typeGrittyRaw: { ...ttType(21, "Treasure Type Table (Gritty)", TT_RECTO), optional: true },
    // The unit printed under the five coin columns of each treasure-type grid.
    typeClassicUnitsRaw: layered(
      unitGrid({ page: 125, locate: "Treasure Type Table (Classic)", yMin: 172, labelMaxX: 130, cells: [["cp", 138, 36], ["sp", 176, 36], ["ep", 214, 37], ["gp", 253, 36], ["pp", 291, 31]] }),
      ttUnits(19, "Treasure Type Table (Classic)", TT_RECTO),
    ),
    typeHeroicUnitsRaw: layered(
      unitGrid({ page: 126, locate: "Treasure Type Table (Heroic)", yMin: 88, labelMaxX: 112, cells: [["cp", 114, 36], ["sp", 151, 36], ["ep", 189, 37], ["gp", 226, 37], ["pp", 263, 36]] }),
      ttUnits(20, "Treasure Type Table (Heroic)", TT_VERSO),
    ),
    typeGrittyUnitsRaw: { ...ttUnits(21, "Treasure Type Table (Gritty)", TT_RECTO), optional: true },
    // The dice legend printed above each value list: the dice a kind of lot is
    // rolled on, its average and the kind. The Tome sets the two value lists
    // side by side on one page, gems left and jewelry right.
    gemDiceRaw: layered(
      legendGrid({ page: 127, locate: "Gem Value", column: { xMin: 250, xMax: 590, yMin: 120, yMax: 156 }, labelMaxX: 296, cells: [["avg", 296, 42], ["type", 340, 240]] }),
      legendGrid({ book: "tt", page: 22, locate: "Gem Value", column: { xMin: 40, xMax: 295, yMin: 288, yMax: 318 }, labelMaxX: 92, cells: [["avg", 94, 44], ["type", 140, 150]] }),
    ),
    jewelryDiceRaw: layered(
      legendGrid({ page: 127, locate: "Jewelry Value", column: { xMin: 60, xMax: 400, yMin: 560, yMax: 595 }, labelMaxX: 125, cells: [["avg", 127, 86], ["type", 214, 190]] }),
      legendGrid({ book: "tt", page: 22, locate: "Jewelry Value", column: { xMin: 300, xMax: 592, yMin: 258, yMax: 290 }, labelMaxX: 340, cells: [["avg", 344, 52], ["type", 398, 190]] }),
    ),
    // Gem Value and Jewelry Value: a band, a value, a type. The three rows above
    // the bands name the dice each kind is rolled on and are not bands.
    gemValueRaw: layered(
      bandGrid({
        page: 127,
        locate: "Gem Value",
        column: { xMin: 250, xMax: 590, yMin: 155, yMax: 330 },
        labelMaxX: 295,
        cells: [["value", 296, 42], ["type", 340, 240]],
        wrap: false,
      }),
      bandGrid({
        book: "tt",
        page: 22,
        locate: "Gem Value",
        column: { xMin: 40, xMax: 295, yMin: 322, yMax: 575 },
        labelMaxX: 92,
        cells: [["value", 94, 44], ["type", 140, 150]],
        centered: true,
        smallCaps: true,
      }),
    ),
    jewelryValueRaw: layered(
      bandGrid({
        page: 127,
        locate: "Jewelry Value",
        column: { xMin: 60, xMax: 400, yMin: 540 },
        labelMaxX: 125,
        cells: [["value", 127, 86], ["type", 214, 190]],
        wrap: false,
      }),
      bandGrid({
        book: "tt",
        page: 22,
        locate: "Jewelry Value",
        column: { xMin: 300, xMax: 592, yMin: 292, yMax: 515 },
        labelMaxX: 340,
        cells: [["value", 344, 52], ["type", 398, 190]],
        centered: true,
        smallCaps: true,
      }),
    ),
    // Special treasure per 1,000 coins: copper runs from the left column's foot
    // to the right column's head, gold from the right column's foot to the next
    // page's left column.
    // The Tome sets each list whole in one column, so a Journal segment that
    // continues another is stored empty when the Tome is read.
    specialCpRaw: layered(segment({ ...P1_LEFT, yMin: 515 }), segment({ ...TT_P24_LEFT, yMin: 78, yMax: 355 })),
    specialCpMoreRaw: layered(segment({ ...P1_RIGHT, yMin: 80, yMax: 150, caption: false }), emptied(24)),
    specialSpRaw: layered(segment({ ...P1_RIGHT, yMin: 150, yMax: 380 }), segment({ ...TT_P24_LEFT, yMin: 355, yMax: 700 })),
    specialEpRaw: layered(segment({ ...P1_RIGHT, yMin: 380, yMax: 636 }), segment({ ...TT_P24_RIGHT, yMin: 78, yMax: 355 })),
    specialGpRaw: layered(segment({ ...P1_RIGHT, yMin: 636 }), segment({ ...TT_P24_RIGHT, yMin: 355, yMax: 700 })),
    specialGpMoreRaw: layered(segment({ ...P2_LEFT, yMin: 80, yMax: 300, caption: false }), emptied(24)),
    specialPpRaw: layered(segment({ ...P2_LEFT, yMin: 300, yMax: 496 }), segment({ ...TT_P25_LEFT, yMin: 78, yMax: 288 })),
    // Special treasure per ornamental, gem, brilliant, trinket, jewelry and
    // regalia: the gem list runs from the left column's foot to the right
    // column's head.
    specialOrnamentalRaw: layered(segment({ ...P2_LEFT, yMin: 496, yMax: 634 }), segment({ ...TT_P25_LEFT, yMin: 288, yMax: 438 })),
    specialGemRaw: layered(segment({ ...P2_LEFT, yMin: 634 }), segment({ ...TT_P25_LEFT, yMin: 438, yMax: 558 })),
    specialGemMoreRaw: layered(segment({ ...P2_RIGHT, yMin: 80, yMax: 126, caption: false }), emptied(25)),
    specialBrilliantRaw: layered(segment({ ...P2_RIGHT, yMin: 126, yMax: 248 }), segment({ ...TT_P25_LEFT, yMin: 558, yMax: 745 })),
    specialTrinketRaw: layered(segment({ ...P2_RIGHT, yMin: 248, yMax: 373 }), segment({ ...TT_P25_RIGHT, yMin: 255, yMax: 388 })),
    specialJewelryRaw: layered(segment({ ...P2_RIGHT, yMin: 373, yMax: 508 }), segment({ ...TT_P25_RIGHT, yMin: 388, yMax: 528 })),
    specialRegaliaRaw: layered(segment({ ...P2_RIGHT, yMin: 508 }), segment({ ...TT_P25_RIGHT, yMin: 528, yMax: 745 })),
  },
};
