/**
 * The two printed hit-point numbers the engines take as arguments.
 *
 * Both are VALUES read off the reader's own page, never shipped: how many
 * points a hit die is read at when it comes up short, and how many points a
 * level past 9th is worth. What those numbers MEAN — that the first floors the
 * die rather than the total, that Constitution lands after it, that the second
 * accumulates into the printed flat on each row past 9th — is structure, and
 * lives in acks-extras `classes/hitpoints.mjs` and `classes/builder-logic.mjs`.
 *
 * Owned here rather than inside table-recipes.mjs for the same reason
 * `weapon-tables.mjs` and `armor-tables.mjs` own theirs: a recipe belongs with
 * the subject it reads, and the registry composes. table-recipes.mjs splices
 * both of these into the documents that publish them.
 */

/**
 * The floor under a 1st-level hit die (RR chargen chapter).
 *
 * The sentence opens on a superscript ordinal, so the anchor starts at the
 * floor clause instead: three lowercase words carrying no digit and no
 * interleaved run. Nothing between the anchor and the number is a digit, so a
 * plain int read cannot take the threshold stated in the clause before it.
 *
 * The locate is body text unique to this page. Do NOT locate on the anchor
 * itself — the same clause is restated earlier in the chapter, and the
 * radiating search reaches that one first.
 */
export const HIT_POINTS_DOC = Object.freeze({
  source: { book: "ACKS II Revised Rulebook", pages: "16" },
  tables: {
    firstLevel: {
      shape: "proseValues",
      book: "rr",
      printedPage: 16,
      locate: "no longer gain Hit Dice",
      values: [{ key: "dieMinimum", find: "treat the result", take: "int" }],
    },
  },
});

/**
 * Hit points per level past 9th, by saving-throw chassis (JJ custom-class
 * chapter).
 *
 * Printed in the saving-throw-progression section because the rate keys on the
 * chassis, and read as its own table rather than as two more values on the
 * recipe that reads that section's prose: the subject is hit points, not saves,
 * and a reader looking for where this number comes from should find it under
 * its own name.
 *
 * Each label is one run ending in its colon and the rate opens the next run, so
 * the label is the whole anchor and the first int after it is the rate. The
 * superscript ordinal interleaves after the digit and disturbs neither. The
 * short span is defensive — an int take reads the first match, and each anchor
 * occurs once on the page.
 */
export const HP_AFTER_NINE_TABLE = Object.freeze({
  shape: "proseValues",
  book: "jj",
  printedPage: 299,
  locate: "SAVING THROW",
  values: [
    { key: "crusaderMage", find: "crusader or mage:", take: "int", span: 30 },
    { key: "fighterThief", find: "fighter or thief:", take: "int", span: 30 },
  ],
});
