/**
 * Table recipes for the Judges Journal's magic-item generation tables (JJ ch. 4,
 * folios 132-141) and its arms-and-armour tables (folios 147-165): the random
 * item type, the classic category lists, the heroic rarity lists, the scroll
 * sub-tables and the setting-appropriate arms grids. Geometry and patterns
 * only: every band edge, die, name and caption is read from the Judge's own
 * copy at import (docs/importer/RECIPES.md), and `magic-item-binding.mjs`
 * assembles the engine-shaped tables from these raw reads.
 *
 * A page is found by a phrase the page prints (`locate`), never by a figure,
 * and the folio is exact: the search tries it first. A table the page sets
 * across two print columns or two pages is read as segments the binding joins.
 * A list's caption is read as data (its first row, `label`), because a row of
 * one table names another by its words and the binding matches them.
 */

/**
 * A band label: "n", "a-b", or an outer face with an inner band ("n a-b"), read
 * into `min` and `max` (and `parent` and `sub`) by the `rollBandNested` label
 * pattern. The specs outnumber any table's rows and are optional, so a table
 * ends where its rows do and no row count ships; 100 is a d100's own capacity.
 */
const BAND = "^\\d+(\\s*[-–—]\\s*\\d+|\\s+\\d+\\s*[-–—]\\s*\\d+)?$";
const bandRows = (n = 100) => Array.from({ length: n }, (_, i) => ({ key: `b${i}`, labelRe: BAND, labelPattern: "rollBandNested", optional: true }));

/** The first label-bearing row of a region is the table's caption, read as data. */
const CAPTION = { key: "caption", labelRe: "^[A-Za-z]{3}", labelPattern: "labelText" };

/** The gap, in points, under which a lone lower-case letter is a small capital and a word space is not. */
const GLUE = 1.5;

/**
 * One band list, read from one region of a page. Every row is a label that
 * parses to a band and the result in windowed cells; a nested tail row carries
 * its outer face in the label (read gap-aware, so "100" and "34-66" stay two
 * numbers). `caption: true` on the segment that opens the table.
 *
 * @param {object} list
 * @param {number} list.page the printed folio
 * @param {string} list.locate a phrase the page prints
 * @param {{xMin: number, xMax: number, yMin: number, yMax?: number}} list.column the region
 * @param {number} list.labelMaxX the right edge of the label column
 * @param {Array<[string, number, number]>} list.cells the cell windows, `[key, x, width]`
 * @param {boolean} [list.caption] whether the region opens with the table's caption
 * @param {string} [list.book] the book the page is read from
 */
export const list = ({ book = "jj", page, locate, column, labelMaxX, cells, caption = false }) => ({
  shape: "gridRows",
  book,
  printedPage: page,
  locate,
  column,
  labelMaxX,
  labelGap: 4,
  smallCaps: GLUE,
  rowTol: 4,
  joinGap: GLUE,
  wrapRows: { tol: 12, centered: true, floorKey: "b0" },
  cellColumns: cells.map(([key, x, w]) => ({ key, x, w, pattern: "raw", row: true })),
  rows: [...(caption ? [CAPTION] : []), ...bandRows()],
});

/**
 * One of the spell-level grid's side-by-side lists: a band and the level it
 * gives, under a header cell that holds the column's remaining-levels figure
 * (read as the caption row's `level`). A list shorter than its neighbours ends
 * on dashes, which carry no label and are not rows.
 */
const spellLevelList = ({ xMin, xMax, labelMaxX }) => ({
  ...list({ page: 146, locate: "Spell Level by Total", column: { xMin, xMax, yMin: 660, yMax: 745 }, labelMaxX, cells: [["level", labelMaxX, 60]], caption: true }),
  wrapRows: undefined,
});

const LEFT = { xMin: 40, xMax: 300 };
const RIGHT = { xMin: 300, xMax: 592 };

/**
 * The setting-appropriate arms grids: a type name down the left and, for each
 * of seven settings, the band of the die that picks it. Two header lines name
 * the settings; the body rows carry their label as read, keyed by position.
 * `starts` are the x of each setting column's left edge; a cell is placed by
 * the centre of its run, because the grid centres its cells.
 *
 * @param {object} grid
 * @param {number} grid.page the printed folio
 * @param {string} grid.locate a phrase the page prints
 * @param {number} grid.yMin the first y of the grid's header
 * @param {number} grid.yMax the last y of the grid's last row
 * @param {number} grid.labelMaxX the right edge of the type-name column
 * @param {number[]} grid.starts the setting columns' left edges
 * @param {number} grid.end the right edge of the last column
 * @param {string} [grid.book] the book the page is read from
 * @param {string} [grid.headRoll] the pattern the second header line's label opens on
 */
export const settingGrid = ({ book = "jj", page, locate, yMin, yMax, labelMaxX, starts, end, headRoll = "^\\(roll" }) => ({
  shape: "gridRows",
  book,
  printedPage: page,
  locate,
  column: { xMin: 40, xMax: 590, yMin, yMax },
  labelMaxX,
  labelGap: GLUE,
  smallCaps: GLUE,
  anchor: "center",
  rowTol: 4,
  joinGap: GLUE,
  cellColumns: starts.map((s, i) => ({ key: `s${i + 1}`, x: s + 2, w: (starts[i + 1] ?? end) - s - 2, pattern: "raw", row: true })),
  rows: [
    { key: "head1", labelRe: "^[A-Za-z]", cellPattern: "raw" },
    { key: "head2", labelRe: headRoll, cellPattern: "raw" },
    ...Array.from({ length: 14 }, (_, i) => ({ key: `r${i}`, labelRe: "^[A-Za-z]", labelPattern: "labelText", cellPattern: "raw", optional: true })),
  ],
});

// The two pages of arms grids set their seven columns 27 points apart.
const P164 = { labelMaxX: 150, starts: [150, 194, 252, 309, 367, 424, 482], end: 545 };
const P165 = { labelMaxX: 170, starts: [153, 221, 279, 336, 394, 451, 508], end: 570 };
const P165_GRID = { page: 165, locate: "(roll", ...P165 };

/**
 * A Judges Journal recipe whose whole table the Treasure Tome replaces where
 * that book is open and the page locates (`tables-binding.mjs`,
 * `readPlainTable`): `over` is a complete recipe for the Tome's own page.
 */
const layered = (recipe, over) => ({ ...recipe, over });

// The Treasure Tome's arms grids sit on folios 52 and 53, their seven columns
// 60 points apart; the second header line may open on a word before "(roll".
const TT_P52 = { labelMaxX: 125, starts: [119, 179, 239, 299, 359, 419, 479], end: 540 };
const TT_P53 = { labelMaxX: 155, starts: [152, 211, 270, 330, 389, 448, 507], end: 567 };
const ttArms = (page, side, yMin, yMax) => settingGrid({ book: "tt", page, locate: "(roll", yMin, yMax, headRoll: "\\(roll", ...side });

/**
 * The raw tables of the `magicItemTables` document, and the pages they read. A
 * table whose id ends `More` is the next segment of a list the page sets across
 * two print columns or two pages.
 */
export const MAGIC_ITEM_RECIPES = {
  source: { book: "ACKS II Judges Journal", pages: "JJ 132-141, 146-148, 164-165; TT 51-53" },
  tables: {
    // Random Magic Item Type: the caption names the page.
    randomTypeRaw: list({ page: 132, locate: "Random Magic Item Type", column: { ...RIGHT, yMin: 100, yMax: 230 }, labelMaxX: 350, cells: [["item", 358, 200]], caption: true }),
    // The classic category lists. Potions carry a second cell, the physical cues.
    potionsRaw: list({ page: 133, locate: "Potions", column: { xMin: 40, xMax: 592, yMin: 80 }, labelMaxX: 125, cells: [["item", 128, 183], ["cues", 314, 280]], caption: true }),
    potionsMoreRaw: list({ page: 134, locate: "Physical", column: { xMin: 40, xMax: 592, yMin: 78, yMax: 430 }, labelMaxX: 98, cells: [["item", 101, 183], ["cues", 287, 300]] }),
    ringsRaw: list({ page: 134, locate: "Physical", column: { xMin: 40, xMax: 190, yMin: 450 }, labelMaxX: 84, cells: [["item", 86, 104]], caption: true }),
    scrollsRaw: list({ page: 134, locate: "Physical", column: { xMin: 190, xMax: 370, yMin: 450, yMax: 650 }, labelMaxX: 232, cells: [["item", 236, 132]], caption: true }),
    scrollsMoreRaw: list({ page: 134, locate: "Physical", column: { xMin: 370, xMax: 592, yMin: 470, yMax: 650 }, labelMaxX: 400, cells: [["item", 405, 185]] }),
    implementsRaw: list({ page: 135, locate: "Implements", column: { xMin: 40, xMax: 592, yMin: 80, yMax: 382 }, labelMaxX: 138, cells: [["item", 142, 200]], caption: true }),
    miscRaw: list({ page: 136, locate: "Miscellaneous Magic Items", column: { ...LEFT, yMin: 80 }, labelMaxX: 112, cells: [["item", 115, 182]], caption: true }),
    miscMoreRaw: list({ page: 136, locate: "Miscellaneous Magic Items", column: { ...RIGHT, yMin: 100 }, labelMaxX: 358, cells: [["item", 362, 220]] }),
    swordsRaw: list({ page: 137, locate: "Swords", column: { ...LEFT, yMin: 80, yMax: 322 }, labelMaxX: 130, cells: [["item", 134, 160]], caption: true }),
    armorsRaw: list({ page: 137, locate: "Swords", column: { ...RIGHT, yMin: 80, yMax: 225 }, labelMaxX: 386, cells: [["item", 390, 195]], caption: true }),
    weaponsRaw: list({ page: 137, locate: "Swords", column: { ...LEFT, yMin: 318 }, labelMaxX: 138, cells: [["item", 142, 156]], caption: true }),
    weaponsMoreRaw: list({ page: 137, locate: "Swords", column: { ...RIGHT, yMin: 335 }, labelMaxX: 386, cells: [["item", 389, 200]] }),
    // The heroic rarity lists, one per rarity. Uncommon, rare and very rare run
    // across two columns or two pages.
    heroicCommonRaw: list({ page: 138, locate: "Common Items", column: { ...LEFT, yMin: 140, yMax: 545 }, labelMaxX: 112, cells: [["item", 115, 182]], caption: true }),
    heroicUncommonRaw: list({ page: 138, locate: "Common Items", column: { ...RIGHT, yMin: 70 }, labelMaxX: 366, cells: [["item", 371, 215]], caption: true }),
    heroicUncommonMoreRaw: list({ page: 139, locate: "Rare Items", column: { ...LEFT, yMin: 90, yMax: 345 }, labelMaxX: 138, cells: [["item", 142, 152]] }),
    heroicRareRaw: list({ page: 139, locate: "Rare Items", column: { ...LEFT, yMin: 350 }, labelMaxX: 138, cells: [["item", 142, 152]], caption: true }),
    heroicRareMoreRaw: list({ page: 139, locate: "Rare Items", column: { ...RIGHT, yMin: 90 }, labelMaxX: 394, cells: [["item", 398, 190]] }),
    heroicVeryRareRaw: list({ page: 140, locate: "Very Rare Items", column: { ...LEFT, yMin: 70 }, labelMaxX: 112, cells: [["item", 115, 182]], caption: true }),
    heroicVeryRareMoreRaw: list({ page: 140, locate: "Very Rare Items", column: { ...RIGHT, yMin: 90 }, labelMaxX: 366, cells: [["item", 371, 215]] }),
    heroicLegendaryRaw: list({ page: 141, locate: "Legendary Items", column: { xMin: 40, xMax: 592, yMin: 70, yMax: 700 }, labelMaxX: 138, cells: [["item", 142, 300]], caption: true }),
    // The scroll sub-tables. The spell-level grid is six side-by-side lists, one
    // per remaining-levels column, each headed by that column's own figure.
    scrollLanguagesRaw: list({ page: 146, locate: "Scroll Languages", column: { ...LEFT, yMin: 225, yMax: 350 }, labelMaxX: 84, cells: [["item", 87, 205]], caption: true }),
    ...Object.fromEntries(
      [[40, 125, 100], [125, 208, 183], [208, 291, 265], [291, 374, 345], [374, 457, 430], [457, 592, 510]].map(([xMin, xMax, labelMaxX], i) => [
        `spellLevel${i + 1}Raw`,
        spellLevelList({ xMin, xMax, labelMaxX }),
      ]),
    ),
    mapContentsRaw: list({ page: 147, locate: "Treasure Map Contents", column: { xMin: 60, xMax: 330, yMin: 295, yMax: 400 }, labelMaxX: 130, cells: [["place", 150, 100], ["clues", 255, 60]], caption: true }),
    clueSpecificsRaw: list({ page: 147, locate: "Clue Specifics", column: { xMin: 60, xMax: 590, yMin: 640, yMax: 745 }, labelMaxX: 130, cells: [["detail", 130, 110], ["content", 240, 230], ["obscurity", 470, 120]], caption: true }),
    clueConcealmentRaw: list({ page: 148, locate: "Clue Concealment", column: { xMin: 40, xMax: 590, yMin: 60, yMax: 420 }, labelMaxX: 76, cells: [["type", 79, 76], ["text", 159, 430]], caption: true }),
    clueCodeRaw: list({ page: 148, locate: "Clue Code", column: { xMin: 40, xMax: 590, yMin: 420, yMax: 760 }, labelMaxX: 76, cells: [["type", 79, 102], ["text", 183, 400]], caption: true }),
    // Arms and armour: the creature types, printed in two halves, and the seven
    // setting grids.
    creatureTypeRaw: layered(
      list({ page: 164, locate: "Creature Type", column: { ...LEFT, yMin: 70, yMax: 215 }, labelMaxX: 105, cells: [["item", 110, 185]], caption: true }),
      list({ book: "tt", page: 51, locate: "Creature Type", column: { ...LEFT, yMin: 78, yMax: 220 }, labelMaxX: 105, cells: [["item", 110, 185]], caption: true }),
    ),
    creatureTypeMoreRaw: layered(
      list({ page: 164, locate: "Creature Type", column: { ...RIGHT, yMin: 90, yMax: 215 }, labelMaxX: 350, cells: [["item", 357, 225]] }),
      list({ book: "tt", page: 51, locate: "Creature Type", column: { ...RIGHT, yMin: 90, yMax: 220 }, labelMaxX: 350, cells: [["item", 357, 225]] }),
    ),
    armorTypeRaw: layered(settingGrid({ page: 164, locate: "Appropriate Arms and Armor", yMin: 570, yMax: 745, ...P164 }), ttArms(52, TT_P52, 80, 245)),
    ammoTypeRaw: layered(settingGrid({ ...P165_GRID, yMin: 78, yMax: 140 }), ttArms(52, TT_P52, 254, 310)),
    axeTypeRaw: layered(settingGrid({ ...P165_GRID, yMin: 148, yMax: 212 }), ttArms(52, TT_P52, 334, 390)),
    bludgeonTypeRaw: layered(settingGrid({ ...P165_GRID, yMin: 217, yMax: 300 }), ttArms(52, TT_P52, 488, 570)),
    bowTypeRaw: layered(settingGrid({ ...P165_GRID, yMin: 309, yMax: 395 }), ttArms(52, TT_P52, 581, 663)),
    spearTypeRaw: layered(settingGrid({ ...P165_GRID, yMin: 401, yMax: 470 }), ttArms(52, TT_P52, 675, 745)),
    swordTypeRaw: layered(settingGrid({ ...P165_GRID, yMin: 482, yMax: 555 }), ttArms(53, TT_P53, 80, 150)),
    otherTypeRaw: layered(settingGrid({ ...P165_GRID, yMin: 562, yMax: 690 }), ttArms(53, TT_P53, 168, 285)),
  },
};
