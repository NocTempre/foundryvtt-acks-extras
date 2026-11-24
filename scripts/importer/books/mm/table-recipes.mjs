/**
 * The Monstrous Manual's table recipes for the `monsters` document: the
 * beastman organisation of MM pp. 47 and 54-57, the village makeup, leader,
 * special-troop and tribal-trait grids, the paragraphs and equipment under
 * them, and the split, speech and elite-wage blocks. Geometry and anchors only;
 * every figure, row and label is read from the Judge's own copy at import
 * (docs/importer/RECIPES.md), and `monsters/organisation.mjs` reads them.
 *
 * The document's other recipes wait in the shared `table-recipes.mjs`, whose
 * `source.pages` covers the pages they read, so this folder's `pages` adds the
 * pages only these read. A file here never imports another book's folder or
 * `table-recipes.mjs`.
 */

// The beastman organisation grids (MM pp. 55, 57), declared once because the
// paragraph recipes beneath them (`BEASTMAN_*_RULES`) read the same page: the
// rows a table prints are the rows a paragraph is bound to, so a key is the
// table's key and nothing is named twice. Nothing in this block is named by the
// recipe: row keys are minted from the printed labels (`keyByLabel`), column
// keys from the printed header words (`headerColumns`, which are the family
// template's Variant option keys), and the specs are a generic run longer than
// any table.
const BEASTMAN_TROOP_GRID = {
  shape: "gridRows",
  book: "mm",
  printedPage: 55,
  locate: "Beastman Special Troops",
  column: { xMin: 60, xMax: 590, yMin: 85, yMax: 190 },
  labelMaxX: 150,
  smallCaps: 1.5,
  labelGap: 1,
  keyByLabel: true,
  headerColumns: { labelRe: "^role$", cellPattern: "rollBand" },
  rows: Array.from({ length: 14 }, (_, i) => ({ key: `row${i + 1}`, labelRe: "^[a-z][a-z -]*$", optional: true })),
};
const BEASTMAN_TRAIT_GRID = {
  shape: "gridRows",
  book: "mm",
  printedPage: 57,
  locate: "Beastman Tribal Traits",
  column: { xMin: 60, xMax: 590, yMin: 92, yMax: 226 },
  labelMaxX: 150,
  smallCaps: 1.5,
  labelGap: 1,
  keyByLabel: true,
  headerColumns: { labelRe: "^trait$", cellPattern: "rollBand" },
  rows: Array.from({ length: 16 }, (_, i) => ({ key: `row${i + 1}`, labelRe: "^[a-z][a-z -]*$", optional: true })),
};

// The beastman equipment paragraphs (MM pp. 55-57): one run-in titled
// paragraph per item, found on the page (`rowsFrom.runins`), its key minted from
// its heading and its words kept as the label. Each window is the part of a page
// the items stand in: the right column below the section heading, the lower text
// of the next page, and the left column above the traits table's own section.
// `ranks` and `troops` are who may carry an item, as the module's role keys and
// the troop table's keys; `carry` its chances. A paragraph that `hookedWeapon`
// already reads figures from points there (`figuresFrom`), so its maneuver
// figures are read once. The anchors are clauses naming a figure, never the
// figure or the item.
const BEASTMAN_EQUIPMENT_RULES = {
  shape: "proseValues",
  book: "mm",
  printedPage: 55,
  pageSpan: 3,
  locate: "Beastman Special Troops",
  rowsFrom: { runins: true },
  vocab: BEASTMAN_TROOP_GRID,
  defer: [{ table: "hookedWeapon", locate: "Hooked Weapons.", keep: ["ranks", "troops", "kinds", "carry"] }],
  windows: [
    { page: 0, column: { xMin: 300, xMax: 590 }, yMin: 200 },
    { page: 1, column: { xMin: 40, xMax: 590 }, yMin: 600 },
    { page: 2, column: { xMin: 40, xMax: 300 }, yMin: 232, yMax: 410 },
  ],
  values: [
    { key: "ranks", find: "", take: "ranks", span: 4000 },
    { key: "troops", find: "", take: "troops", span: 4000 },
    { key: "kinds", find: "", take: "kinds", kinds: ["archer", "warrior"], span: 4000 },
    { key: "carry", find: "", take: "chances", span: 4000 },
    { key: "riderDice", find: "an additional", take: "dice", span: 10 },
    { key: "wearerLevel", find: "unproficient", take: "int", span: 8 },
    { key: "sizes", find: "", take: "respectively", unit: "lb", span: 4000 },
    { key: "throw", find: "proficiency throw of", take: "int", span: 6 },
    { key: "fuseDice", find: "initiative in", take: "dice", span: 12 },
    { key: "fumble", find: "unmodified", take: "int", span: 4 },
    { key: "blast", find: "", take: "matches", re: "(\\d+)\\s*lb\\s+\\w+\\s+deals\\s+(\\d+d\\d+)[^.]*?within\\s+(\\d+)", fields: ["lb", "dice", "radius"], span: 4000 },
    { key: "saveKind", findRe: "(?:can|must) make an? ([a-z]+) saving throw", group: 1, take: "text" },
    { key: "saveKind", findRe: "make an? ([a-z]+) save\\b", group: 1, take: "text" },
    { key: "saveFraction", find: "saving throw to reduce the damage by", take: "fractionWord", span: 8 },
    { key: "saveMod", find: "saving throw at", take: "signed", span: 6 },
    { key: "radius", find: "subordinate beastmen within", take: "int", span: 6 },
    { key: "radius", find: "or moves within", take: "int", span: 8 },
    { key: "radius", find: "village within", take: "int", span: 6 },
    { key: "damage", find: "damage on their next attack", before: true, take: "signed", span: 8 },
    { key: "damage", find: "or suffer", take: "dice", span: 8 },
    { key: "immunityTurns", findRe: "battlefield for (\\d+) turn", group: 1, take: "int" },
    { key: "condition", findRe: "fails, the creature becomes ([a-z]+) until", group: 1, take: "text" },
    { key: "condition", findRe: "begins ([a-z]+) until", group: 1, take: "text" },
    { key: "penalty", find: "suffers a", take: "signed", span: 6 },
    { key: "healDice", findRe: "heals (?:\\w+ ){1,2}of (\\d+d\\d+)", group: 1, take: "text" },
    { key: "successHealDice", find: "the creature heals", take: "dice", span: 8 },
    { key: "swigs", find: "will contain", take: "dice", span: 8 },
    { key: "ac", find: "bonus to ac", before: true, take: "signed", span: 6 },
    { key: "reductionPerDie", findRe: "taken by (\\d+) points? per die", group: 1, take: "int" },
    { key: "delayTurns", find: "damage after", take: "int", span: 6 },
    { key: "bonus", find: "beastmen gain a", take: "signed", span: 6 },
  ],
};

// The beastman troop paragraphs (MM p. 55) and tribal-trait paragraphs (MM
// p. 57), bound to the rows of the tables above them (`rowsFrom.grid`). A
// figure is a clause's own: the bonus or penalty it prints, read with its sign.
// `carry` is the share of a troop kind that bears an item, keyed by the item's
// own key (`itemsFrom`).
const BEASTMAN_TROOP_RULES = {
  shape: "proseValues",
  book: "mm",
  printedPage: 55,
  readPages: 3,
  locate: "Beastman Special Troops",
  rowsFrom: { grid: BEASTMAN_TROOP_GRID },
  vocab: BEASTMAN_TROOP_GRID,
  itemsFrom: BEASTMAN_EQUIPMENT_RULES,
  windows: [{ page: 0, column: { xMin: 60, xMax: 300 }, yMin: 193, yMax: 625 }],
  values: [
    { key: "attack", find: "to their attack throws", before: true, take: "signed", span: 6 },
    { key: "acReduction", find: "reduce their ac by", take: "int", span: 4 },
    { key: "armourBump", find: "heavier armor (", take: "signed", span: 5 },
    { key: "xpAbilities", find: "special ability", before: true, take: "wordInt", span: 8 },
    { key: "carry", find: "", take: "itemShares", span: 4000 },
    { key: "vulnerableAttack", find: "to attack throws and deal", before: true, take: "signed", span: 6 },
    { key: "damageDiceTimes", find: "the ordinary damage dice", before: true, take: "times", span: 14 },
    { key: "opponentSurprise", find: "penalty to surprise", before: true, take: "signed", span: 6 },
    { key: "initiative", find: "bonus to initiative", before: true, take: "signed", span: 6 },
    { key: "avoidSurprise", find: "bonus to avoid surprise", before: true, take: "signed", span: 6 },
    { key: "overrunPenaltyCut", find: "reduced by", take: "int", span: 4 },
    { key: "opponentSave", find: "penalty to his saving throw", before: true, take: "signed", span: 6 },
    { key: "proficiency", findRe: "([a-z]+(?: [a-z]+)?) equipment \\(as the proficiency\\)", group: 1, take: "text" },
    { key: "proficiency", findRe: "can ([a-z]+) \\(as the proficiency\\)", group: 1, take: "text" },
    { key: "mounts", find: "", take: "byBreed", verb: "ride", span: 4000 },
    { key: "alongside", find: "", take: "byBreed", verb: "alongside \\(but not on\\)", span: 4000 },
  ],
};
const BEASTMAN_TRAIT_RULES = {
  shape: "proseValues",
  book: "mm",
  printedPage: 57,
  locate: "Beastman Tribal Traits",
  rowsFrom: { grid: BEASTMAN_TRAIT_GRID },
  vocab: BEASTMAN_TRAIT_GRID,
  windows: [
    { page: 0, column: { xMin: 60, xMax: 300 }, yMin: 232 },
    { page: 0, column: { xMin: 300, xMax: 590 }, yMin: 232, yMax: 620 },
  ],
  values: [
    { key: "damage", find: "", take: "breedDice", verb: "deals?", span: 4000 },
    { key: "outnumber", find: "outnumber", take: "ratio", span: 40 },
    { key: "attack", find: "to all attack throws", before: true, take: "signed", span: 6 },
    { key: "damage", find: "damage rolls", before: true, take: "signed", span: 30 },
    { key: "morale", find: "penalty to morale", before: true, take: "signed", span: 6 },
    { key: "attack", find: "bonus to its attack throw", before: true, take: "signed", span: 6 },
    { key: "attack", find: "bonus to attack throws", before: true, take: "signed", span: 6 },
    { key: "round", findRe: "on the (first|second|third|fourth|fifth) round", group: 1, take: "ordinalWord" },
    { key: "damage", find: "bonus to damage", before: true, take: "signed", span: 6 },
    { key: "strategy", find: "bonus to their strategic ability", before: true, take: "signed", span: 6 },
    { key: "proficiencyRanks", find: "ranks of", before: true, take: "wordInt", span: 12 },
    { key: "proficiency", findRe: "ranks of ([a-z]+(?: [a-z]+)?)\\)", group: 1, take: "text" },
    { key: "treasurePct", find: "treasure rolled by", take: "pct", span: 8 },
    { key: "beastDice", find: "served by an additional", take: "dice", span: 10 },
    { key: "morale", find: "bonus to morale", before: true, take: "signed", span: 6 },
    { key: "armourBump", find: "granting", take: "signed", span: 6 },
    { key: "saveKind", findRe: "must make an? ([a-z]+) saving throw", group: 1, take: "text" },
    { key: "immunityTurns", findRe: "save again for (\\w+) turn", group: 1, take: "wordInt" },
    { key: "condition", findRe: "becomes ([a-z]+) for", group: 1, take: "text" },
    { key: "durationTurns", findRe: "becomes [a-z]+ for (\\w+) turn", group: 1, take: "wordInt" },
    { key: "durationMinutes", findRe: "\\((\\d+) minutes\\)", group: 1, take: "int" },
  ],
};

/**
 * The Monstrous Manual's contribution, `{docId: {pages, tables}}`: the
 * beastman organisation tables and the paragraph recipes bound to their rows.
 */
export const tableRecipes = {
  monsters: {
    pages: "MM 47, 54, 55, 56, 57",
    tables: {
      // The beastman organisation tables (MM pp. 54-55, 57). Each is a grid of
      // option rows by breed columns, and nothing in it is named here: the row
      // keys are minted from the printed labels (`keyByLabel`), the column keys
      // from the printed header words (`headerColumns`, which are the family
      // template's Variant option keys), and the specs are a generic run longer
      // than any table. A cell the page prints as a dash reads null.
      // `monsters/organisation.mjs` reads them.
      //
      // The village makeup: what a village holds, one row per kind of
      // inhabitant, a cell per breed, kept as printed text. The page stacks the
      // breeds in two blocks of three, each under its own header.
      beastmanVillage: {
        shape: "gridRows",
        book: "mm",
        printedPage: 54,
        locate: "Beastman Village Makeup",
        column: { xMin: 40, xMax: 600, yMin: 322, yMax: 518 },
        labelMaxX: 115,
        smallCaps: 1.5,
        labelGap: 1,
        keyByLabel: true,
        headerColumns: { labelRe: "^inhabitants$", cellPattern: "raw" },
        rows: Array.from({ length: 14 }, (_, i) => ({ key: `row${i + 1}`, labelRe: "^[a-z][a-z -]*$", optional: true })),
      },
      // The leader table: a rank per row, and per breed its armour class with
      // the armour in brackets, its Hit Dice and hit points, and its damage die
      // and modifier (`leaderStats`). Each cell prints over three lines with
      // the rank on the middle one, and the page stacks the breeds in two
      // blocks of three. These leaders are a grade apart from the breed pages'
      // own: a separate table, never a replacement.
      beastmanLeaders: {
        shape: "gridRows",
        book: "mm",
        printedPage: 54,
        locate: "Beastman Champion and Chieftain Characteristics",
        column: { xMin: 40, xMax: 600, yMin: 535, yMax: 748 },
        labelMaxX: 115,
        smallCaps: 1.5,
        labelGap: 1,
        wrapRows: { centered: true, tol: 12 },
        keyByLabel: true,
        headerColumns: { labelRe: "^leader\\s*type$", cellPattern: "leaderStats" },
        rows: Array.from({ length: 8 }, (_, i) => ({ key: `row${i + 1}`, labelRe: "^[a-z][a-z -]*$", optional: true })),
      },
      // The special-troop table: a troop role per row, and per breed the band of
      // the roll that picks it (`rollBand`: `{min, max}`, a lone figure both).
      beastmanSpecialTroops: BEASTMAN_TROOP_GRID,
      // The tribal-trait table: a trait per row, read as the special troops are.
      beastmanTraits: BEASTMAN_TRAIT_GRID,
      // The paragraphs under those tables and the optional equipment between them
      // (MM pp. 55-57), read figure by figure by `importer/prose-rows.mjs`: a row per
      // troop kind, per item and per trait, each holding only what its paragraph
      // prints, keyed as the tables above are. `monsters/organisation.mjs` reads them.
      beastmanTroopRules: BEASTMAN_TROOP_RULES,
      beastmanEquipment: BEASTMAN_EQUIPMENT_RULES,
      beastmanTraitRules: BEASTMAN_TRAIT_RULES,
      // The shares and rounding of the optional three-way split and the chieftain's
      // morale bonus (MM p. 54), the chance of speaking Common (MM p. 47), and the
      // elite-troop sidebar's wage and battle-turn bonus (MM p. 55, which cites the
      // Revised Rulebook page for the bonus: read as a citation). One block per
      // page, its id the module's own name for what it holds.
      beastmanOrganisation: {
        shape: "proseValues",
        book: "mm",
        valueBlocks: [
          {
            id: "split",
            printedPage: 54,
            locate: "Special Troops (Optional)",
            column: { xMin: 40, xMax: 590 },
            yMax: 315,
            values: [
              { key: "archerShare", find: "will be archers", before: true, take: "pct", span: 40 },
              { key: "archerRound", find: "will be archers", take: "roundWord", span: 20 },
              { key: "warriorShare", find: "will be warriors", before: true, take: "pct", span: 30 },
              { key: "warriorRound", find: "will be warriors", take: "roundWord", span: 20 },
              { key: "specialShare", find: "will be special troops", before: true, take: "pct", span: 30 },
              { key: "specialRound", find: "will be special troops", before: true, take: "roundWord", span: 30 },
              { key: "moraleWhileChieftain", find: "bonus to morale rolls", before: true, take: "signed", span: 6 },
            ],
          },
          {
            id: "speech",
            printedPage: 47,
            locate: "of speaking Common",
            column: { xMin: 40, xMax: 590 },
            values: [
              { key: "commonWarrior", findRe: "warrior has a (\\d+)%", group: 1, take: "int" },
              { key: "commonLeaderPerHd", findRe: "(\\d+)% chance per hd of speaking", group: 1, take: "int" },
            ],
          },
          {
            id: "elite",
            printedPage: 55,
            locate: "elite troops",
            column: { xMin: 60, xMax: 300 },
            yMin: 630,
            values: [
              { key: "wageExtra", find: "an additional", take: "gp", span: 8 },
              { key: "wageEvery", find: "for every", take: "gp", span: 8 },
              { key: "wageMin", find: "minimum additional monthly wage of", take: "gp", span: 8 },
              { key: "battleAttack", find: "bonus to their attack throws during", before: true, take: "signed", span: 6 },
              { key: "battleCite", findRe: "rr p\\.\\s*\\d+", group: 0, take: "cite" },
            ],
          },
        ],
      },
    },
  },
};
