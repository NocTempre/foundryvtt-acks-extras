/**
 * The Revised Rulebook's table recipes for the `magicResearch` document: the
 * magic research, ritual casting, blood sacrifice and arcane-power passages.
 * They cover the research ladder, the penalty for substituted components, the
 * costs and facility rules the projects run on, the assistants' levels, the
 * sacrifice table, the divine and arcane power's lifetimes and the
 * demonologist's multiplier. Geometry and anchors only: every rate, minimum,
 * step, cap and multiplier is read from the Judge's own copy at import
 * (docs/importer/RECIPES.md), and `scripts/magic/research-tables.mjs` reads the
 * stored cells. A file here never imports another book's folder or
 * `table-recipes.mjs`.
 *
 * One table per passage, so a figure cites the folio that prints it. A prose
 * table keeps the page's wording of each figure as a raw window (`take:
 * "window"`) where the figure is a fraction or a list of level and cost pairs,
 * and the reader parses that; a figure that is one number is taken as one.
 * A facility passage is read once per kind of facility, because each kind
 * prints its own minimum, step and bonus.
 */

/** A level ladder's rows: generic and optional, so the table ends where the page's rows do and no count ships. */
const LEVEL_ROWS = Array.from({ length: 24 }, (_, i) => ({ key: `r${i}`, labelRe: "^\\d+$", labelPattern: "labelInt", optional: true }));

/** A sacrifice table's rows: each one a victim characteristic, read as a label. */
const VICTIM_ROWS = Array.from({ length: 12 }, (_, i) => ({ key: `r${i}`, labelRe: "^v\\s*ictim\\s*is", labelPattern: "labelText", optional: true }));

/** The recto pages put their right column further in than the verso pages, so a prose read splits at its own x. */
const RECTO = 320;
const VERSO = 300;

/**
 * The facility passage of one kind: the minimum for the first level of effect,
 * the step added for each level after it, and the bonus a surplus buys (its
 * step, its size and its cap). `at` picks which occurrence of a repeated
 * anchor the kind's own passage is, and `sizeFind` the words the kind's own
 * sentence opens its bonus with.
 */
const facilityValues = ({ baseFind, sizeFind = "receives a", at = 1 }) => [
  { key: "minimum", find: baseFind, take: "gp", span: 14 },
  { key: "step", find: "another", take: "gp", span: 14 },
  { key: "bonusStep", find: "for every", occurrence: at, take: "gp", span: 14 },
  { key: "bonusSize", find: sizeFind, take: "signed", span: 8 },
  { key: "bonusCap", find: "up to a maximum", occurrence: at, take: "signed", span: 10 },
];

export const researchRecipes = {
  magicResearch: {
    pages: "RR 73, 388-393, 397-398, 422",
    tables: {
      // The ladder of research rate and research throw by caster level (RR 388).
      // The throw column rides along. A footnote mark on the upper rungs is a lone
      // glyph that the grid drops from its cells; `researchLadderNote` reads the
      // rate the unmarked projects use, which the reader applies as a cap.
      researchLadder: {
        shape: "gridRows",
        book: "rr",
        printedPage: 388,
        locate: "MAGIC RESEARCH",
        column: { xMin: 318, xMax: 592, yMin: 262, yMax: 446 },
        labelMaxX: 345,
        rowTol: 4,
        rows: LEVEL_ROWS,
        cellColumns: [
          { key: "rate", x: 365, w: 95, pattern: "raw", row: true },
          { key: "throw", x: 470, w: 60, pattern: "raw", row: true },
        ],
      },
      researchLadderNote: {
        shape: "proseValues",
        book: "rr",
        printedPage: 388,
        locate: "MAGIC RESEARCH",
        colSplit: VERSO,
        values: [{ key: "otherProjectsRate", find: "for other projects", before: true, span: 14, take: "gp" }],
      },
      // How long arcane power keeps (RR 388): the span's unit, which the page names without a count.
      arcaneLifetime: {
        shape: "proseValues",
        book: "rr",
        printedPage: 388,
        locate: "MAGIC RESEARCH",
        colSplit: VERSO,
        values: [{ key: "unit", find: "must be spent within", take: "wagePeriod", span: 14 }],
      },
      // The research rate's ancillary share, the automatic-failure band and the
      // substitution penalty (RR 389).
      researchProse: {
        shape: "proseValues",
        book: "rr",
        printedPage: 389,
        locate: "as an ancillary activity but only applies",
        colSplit: RECTO,
        values: [
          { key: "ancillaryFraction", find: "ancillary activity but only applies", take: "window", span: 14 },
          { key: "autoFailBand", find: "an unmodified die roll of", take: "band", span: 12 },
          { key: "penalty", find: "suffers a", take: "signed", span: 6 },
          { key: "penaltyMinimum", find: "with a minimum", take: "signed", span: 10 },
        ],
      },
      // Who may manage assistants and the level each way of working needs (RR 390).
      assistantProse: {
        shape: "proseValues",
        book: "rr",
        printedPage: 390,
        locate: "can manage one research assistant",
        colSplit: VERSO,
        values: [
          { key: "managerLevel", find: "spellcaster of at least", take: "int", span: 6 },
          { key: "managerBase", find: "can manage", take: "wordInt", span: 8 },
          { key: "aidLevel", find: "must be at least", occurrence: 1, take: "int", span: 6 },
          { key: "spellLevel", find: "must be at least", occurrence: 2, take: "int", span: 6 },
          { key: "itemLevel", find: "must be at least", occurrence: 3, take: "int", span: 6 },
        ],
      },
      // The spell library's minimum, step, bonus and the share of a research's spend
      // that is added to it (RR 391).
      libraryProse: {
        shape: "proseValues",
        book: "rr",
        printedPage: 391,
        locate: "wishes to compile his own library",
        colSplit: RECTO,
        values: [
          ...facilityValues({ baseFind: "minimum of" }),
          { key: "share", find: "researches a spell,", take: "pct", span: 10 },
        ],
      },
      // The sample's bonus on a magic item's research throw (RR 392).
      sampleProse: {
        shape: "proseValues",
        book: "rr",
        printedPage: 392,
        locate: "If the researcher is working from a sample",
        colSplit: VERSO,
        values: [{ key: "sampleBonus", find: "working from a sample, he gains", take: "signed", span: 8 }],
      },
      // The workshop's minimum, step and bonus, and the figures Identifying Magic Items
      // prints beside its own library (RR 393). The identification passage repeats the
      // bonus step and cap, so it takes the second occurrence of each.
      workshopProse: {
        shape: "proseValues",
        book: "rr",
        printedPage: 393,
        locate: "wishes to build his own workshop",
        colSplit: RECTO,
        values: [
          ...facilityValues({ baseFind: "minimum of", sizeFind: "required for the item, the spellcaster gains a" }),
          { key: "identifyLevel", find: "can be undertaken by a spellcaster of", take: "int", span: 6 },
          { key: "identifyMaterial", find: "material cost:", take: "gp", span: 14 },
          { key: "identifyResearch", find: "research cost:", take: "gp", span: 14 },
          { key: "identifyBonusStep", find: "for every", occurrence: 2, take: "gp", span: 14 },
          { key: "identifyBonusSize", find: "receives a", occurrence: 1, take: "signed", span: 8 },
          { key: "identifyBonusCap", find: "up to a maximum", occurrence: 2, take: "signed", span: 10 },
        ],
      },
      // Learning and casting a ritual spell: the three costs by ritual level, as the
      // page's own lists of cost and level pairs, and the library's minimums (RR 397).
      ritualCostProse: {
        shape: "proseValues",
        book: "rr",
        printedPage: 397,
        locate: "minimum library value",
        colSplit: RECTO,
        values: [
          { key: "learnMaterial", find: "material cost:", occurrence: 2, take: "window", span: 95 },
          { key: "learnResearch", find: "research cost:", occurrence: 2, take: "window", span: 95 },
          { key: "castComponent", find: "component cost:", occurrence: 3, take: "window", span: 95 },
          { key: "castMaterial", find: "material cost:", occurrence: 3, take: "window", span: 95 },
          { key: "castResearch", find: "research cost:", occurrence: 3, take: "window", span: 95 },
          { key: "libraryMinimums", find: "minimum library value is", take: "window", span: 95 },
          { key: "libraryBonusStep", find: "for every", occurrence: 4, take: "gp", span: 14 },
          { key: "libraryBonusSize", find: "receives a", occurrence: 2, take: "signed", span: 8 },
          { key: "libraryBonusCap", find: "up to a max", occurrence: 2, take: "signed", span: 10 },
        ],
      },
      // The casting workshop's minimums by ritual level, with its bonus step and cap (RR 398).
      ritualWorkshopProse: {
        shape: "proseValues",
        book: "rr",
        printedPage: 398,
        locate: "minimum workshop value",
        colSplit: VERSO,
        values: [
          { key: "workshopMinimums", find: "minimum workshop value is", take: "window", span: 95 },
          { key: "bonusStep", find: "for every", take: "gp", span: 14 },
          { key: "bonusSize", find: "receives a", take: "signed", span: 8 },
          { key: "bonusCap", find: "up to a max", take: "signed", span: 10 },
        ],
      },
      // The blood sacrifice's victim traits and what each adds to the component value (RR 422).
      sacrificeTraits: {
        shape: "gridRows",
        book: "rr",
        printedPage: 422,
        locate: "Sacrifice Victim Multipliers",
        column: { xMin: 40, xMax: 400, yMin: 95, yMax: 200 },
        labelMaxX: 288,
        rowTol: 4,
        rows: VICTIM_ROWS,
        cellColumns: [{ key: "multiplier", x: 290, w: 110, pattern: "raw", row: true }],
      },
      // How long divine power keeps (RR 422): a count and its unit.
      divineLifetime: {
        shape: "proseValues",
        book: "rr",
        printedPage: 422,
        locate: "must be spent within one month",
        colSplit: VERSO,
        values: [
          { key: "count", find: "must be spent within", take: "wordInt", span: 10 },
          { key: "unit", find: "must be spent within", take: "wagePeriod", span: 14 },
        ],
      },
      // The demonologist's power of sacrifice: the multiple arcane power counts for (RR 73).
      powerOfSacrifice: {
        shape: "proseValues",
        book: "rr",
        printedPage: 73,
        locate: "Power of Sacrifice",
        colSplit: RECTO,
        values: [{ key: "multiplier", find: "from blood sacrifice as", take: "times", span: 14 }],
      },
    },
  },
};
