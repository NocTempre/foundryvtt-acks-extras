/**
 * The Revised Rulebook's table recipes for the `formation` document: the faster
 * paces a proficient climber moves at, read from the exploration chapter's
 * climbing, crawling and balancing paragraphs (RR pp. 269-270). Geometry and
 * anchors only; every size and share is read from the Judge's own copy at
 * import (docs/importer/RECIPES.md), and `formation-binding.mjs` parses the
 * windows into the engine figures.
 *
 * The document's other Revised Rulebook recipes wait in the shared
 * `table-recipes.mjs`. The doc's `source.pages` already covers these pages, so
 * this folder gives no `pages` of its own. A file here never imports another
 * book's folder or `table-recipes.mjs`.
 */

/**
 * The Revised Rulebook's contribution, `{docId: {tables}}`: three prose-window
 * recipes, one per way of crossing, each on its own page and column.
 */
export const tableRecipes = {
  formation: {
    tables: {
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
