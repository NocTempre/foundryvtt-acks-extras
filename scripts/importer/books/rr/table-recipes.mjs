/**
 * The Revised Rulebook's table recipes for the `formation` document: the faster
 * paces a proficient climber moves at, read from the exploration chapter's
 * climbing, crawling and balancing paragraphs (RR pp. 269-270), and the door
 * figures of the chapter's Doors section (RR pp. 266-267): the door grid and
 * the bash paragraph. Geometry and anchors only; every size, share and row is
 * read from the Judge's own copy at import (docs/importer/RECIPES.md), and
 * `formation-binding.mjs` parses the windows into the engine figures.
 *
 * The document's other Revised Rulebook recipes wait in the shared
 * `table-recipes.mjs`, whose `source.pages` covers every page but the door
 * grid's, so this folder's `pages` adds that one. A file here never imports
 * another book's folder or `table-recipes.mjs`.
 */

/**
 * The Revised Rulebook's contribution, `{docId: {pages, tables}}`: three
 * prose-window recipes, one per way of crossing, each on its own page and
 * column, and the door grid with the bash paragraph's windows.
 */
export const tableRecipes = {
  formation: {
    pages: "RR 266",
    tables: {
      // The door grid (RR p. 266): one row per door or portal, the printed
      // label and the notes cell kept whole. The grid's armour class and
      // structural hit points columns are bound to nothing, since no reader
      // wants them. Rows are claimed in print order by generic specs and keyed
      // by their ordinal, never by their label (two doors share a name), so
      // the specs outnumber the rows and `optional` makes the surplus the end
      // of the table. `startAfter` skips the header row; `stopAt` ends the grid
      // above the next table's caption. formation-binding parses the notes
      // cell into each row's batter time and tool.
      doorGrid: {
        shape: "gridRows",
        book: "rr",
        printedPage: 266,
        locate: "Door and Portal Armor Class",
        locateBare: true,
        column: { xMin: 40, xMax: 592 },
        startAfter: "SHP",
        stopAt: "Opening Door Method",
        labelMaxX: 242,
        smallCaps: 2,
        labelGap: 1,
        joinGap: 1,
        rows: Array.from({ length: 12 }, (_, i) => ({ key: `door${i + 1}`, labelRe: ".", labelPattern: "labelText", optional: true })),
        cellColumns: [{ key: "notes", x: 289, w: 300, pattern: "raw", row: true }],
      },
      // The bash paragraph (RR p. 267), one window per figure, each opened by
      // the words right before it in the page's left column: what Strength is
      // worth per point (printed with a plus-or-minus sign), the pair's and the
      // crowbar's bonuses, the size category's bonus and penalty, the spike's
      // penalty and the most a door holds, the unmodified result that is a
      // botch and the damage the rebound deals. The target is the character's
      // own Adventuring throw and is not read here.
      bashProse: {
        shape: "proseValues",
        book: "rr",
        printedPage: 267,
        locate: "adventurers working together, can attempt to bash open",
        locateBare: true,
        column: { xMin: 40, xMax: 325 },
        values: [
          { key: "strength", find: "modify the result of the die roll by", take: "window", span: 10 },
          { key: "pair", find: "stronger character", take: "window", span: 40 },
          { key: "crowbar", find: "equipped with a crowbar gains", take: "window", span: 30 },
          { key: "sizeUp", find: "gain a further", take: "window", span: 12 },
          { key: "sizeDown", find: "category above", take: "window", span: 40 },
          { key: "spike", find: "dungeonbashing throw, at a", take: "window", span: 12 },
          { key: "spikeMax", find: "a maximum of", take: "window", span: 14 },
          { key: "botch", find: "fails on an unmodified", take: "window", span: 12 },
          { key: "rebound", find: "painful grunt, suffering", take: "window", span: 14 },
        ],
      },
      // The faster paces of a proficient climber (RR pp. 269-270): each way of
      // crossing prices its two paces in its own paragraph, so each is its own
      // recipe and its own page. The `pace` window holds both sizes, the words
      // that order them and the share of a speed each pace moves at;
      // formation-binding parses the pair and the shares. The `base` window is
      // the sentence before it, cut at the exploration-speed branch: its anchor
      // holds no value, the window begins at the figure's own words.
      climbPaceProse: {
        shape: "proseValues",
        book: "rr",
        printedPage: 269,
        locate: "Whether scaling an easy obstacle",
        locateBare: true,
        column: { xMin: 60, xMax: 320 },
        values: [
          { key: "pace", find: "climbing proficiency can take a", take: "window", span: 130 },
          { key: "base", find: "an adventurer can climb at", take: "window", span: 30 },
        ],
      },
      crawlPaceProse: {
        shape: "proseValues",
        book: "rr",
        printedPage: 269,
        locate: "proficient in Climbing can traverse at",
        locateBare: true,
        column: { xMin: 320, xMax: 592 },
        values: [
          { key: "pace", find: "proficient in climbing can traverse", take: "window", span: 170 },
          { key: "base", find: "adventurer can traverse at", take: "window", span: 30 },
        ],
      },
      balancePaceProse: {
        shape: "proseValues",
        book: "rr",
        printedPage: 270,
        locate: "Whether traversing a narrow or precarious",
        locateBare: true,
        column: { xMin: 40, xMax: 300 },
        values: [
          { key: "pace", find: "climbing proficiency can take a", take: "window", span: 130 },
          { key: "base", find: "an adventurer can move at", take: "window", span: 30 },
        ],
      },
    },
  },
};
