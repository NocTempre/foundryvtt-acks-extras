/**
 * The Revised Rulebook's table recipe for the `throws` document: the general
 * rule for the natural die of a throw, on the folio of the Introduction's
 * "Throwing the Dice" (RR p. 10). The page names the natural result that fails
 * whatever the modifiers and the one that succeeds for a proficient thrower,
 * each in one sentence. Anchors only: every figure is read
 * from the Judge's own copy at import (docs/importer/RECIPES.md), and
 * `scripts/lib/throws.mjs` reads the stored cells. A file here never imports
 * another book's folder or `table-recipes.mjs`.
 */

/**
 * The Revised Rulebook's contribution for `throws`, `{docId: {pages, tables}}`:
 * one prose table of two figures, each anchored on the words that lead into
 * it. The second sentence follows the first's parenthesis, so its anchor spans
 * the clause that closes the first.
 */
export const throwsRecipes = {
  throws: {
    pages: "RR 10",
    tables: {
      throwProse: {
        shape: "proseValues",
        book: "rr",
        printedPage: 10,
        locate: "Automatic Success and Failure",
        values: [
          { key: "autoFailMax", find: "unless otherwise noted, a roll of", take: "int", span: 8 },
          { key: "autoSucceedMin", findRe: "range\\s*of\\s*automatic\\s*failure\\.?\\)?\\s*a\\s*roll\\s*of", take: "int", span: 8 },
        ],
      },
    },
  },
};
