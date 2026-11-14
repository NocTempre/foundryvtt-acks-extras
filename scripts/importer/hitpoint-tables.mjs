/**
 * The printed hit-point numbers the engines take as arguments: the points a
 * hit die is read at when it comes up short, the level a custom class's hit
 * dice stop rising at, and the points each level past it is worth. They are
 * read off the reader's own page and never shipped; what they mean lives in the
 * classes feature's `hitpoints.mjs` and `builder-logic.mjs`.
 *
 * Owned here, like `weapon-tables.mjs` and `armor-tables.mjs` own theirs:
 * a recipe belongs with the subject it reads. table-recipes.mjs splices both
 * documents into the ones that publish them.
 */

/**
 * The floor under a 1st-level hit die (RR chargen chapter).
 *
 * The sentence opens on a superscript ordinal, so the anchor starts at the
 * floor clause: three lowercase words with no digit and no interleaved run,
 * which keeps a plain int read off the threshold in the clause before it.
 * Locate on body text unique to this page, never on the anchor: the clause is
 * restated earlier in the chapter and the radiating search reaches that first.
 */
export const HIT_POINTS_DOC = Object.freeze({
  source: { book: "ACKS II Revised Rulebook", pages: "RR 16" },
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
 * Hit points per level past the last die level, by saving-throw chassis (JJ
 * custom-class chapter).
 *
 * Printed in the saving-throw-progression section because the rate keys on the
 * chassis, and read as its own table so the number is found under its own name.
 *
 * Each label is one run ending in its colon and the rate opens the next run, so
 * the label is the whole anchor and the first int after it is the rate; the
 * superscript ordinal interleaves after the digit and disturbs neither. The
 * short span is defensive.
 *
 * `afterLevel` is the level those rates begin after, which is also the last
 * level a custom class's hit dice rise at. It is a value of its own, so a read
 * that misses it costs the dice cells and not the rates.
 */
export const HP_AFTER_NINE_TABLE = Object.freeze({
  shape: "proseValues",
  book: "jj",
  printedPage: 297,
  locate: "SAVING THROW",
  values: [
    { key: "afterLevel", find: "per level after", take: "int", span: 12 },
    { key: "crusaderMage", find: "crusader or mage:", take: "int", span: 30 },
    { key: "fighterThief", find: "fighter or thief:", take: "int", span: 30 },
  ],
});
