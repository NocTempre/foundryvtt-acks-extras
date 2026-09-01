/**
 * Table extraction recipes — geometry + patterns only, NEVER values (docs/
 * COOKBOOK.md, docs/importer/RECIPES.md). Each entry says which book/page a ruledata
 * table lives on, where the row labels stop and the cells begin, which rows to
 * claim (by label regex), and how to parse each cell. The dice, numbers and
 * wages are read from the reader's own PDF at import time and persist only in
 * their world. Page numbers are cited (printed); the executor locates the PDF
 * page by header text, tolerating the front-matter offset.
 *
 * `docs` groups recipes by ruledata document id; the binding assembles each
 * document from its tables and imports it via the acks-lib ruledata-import
 * contract at world priority.
 */

import { HIT_POINTS_DOC, HP_AFTER_NINE_TABLE } from "./hitpoint-tables.mjs";

// Henchman/mercenary availability rows share the RR market-class grid: a label
// column, six market-class cells (dice strings kept raw), and — for henchmen —
// a trailing monthly wage the reference table also carries.
const HENCH_ROWS = [0, 1, 2, 3, 4].map((n) => ({ key: n, labelRe: `(^|\\D)${n}\\D*level` }));

const MERC_ROWS = [
  { key: "lightInfantry", labelRe: "light infantry" },
  { key: "heavyInfantry", labelRe: "heavy infantry" },
  { key: "slinger", labelRe: "slinger" },
  { key: "bowman", labelRe: "(^|[^s])bowman" },
  { key: "crossbowman", labelRe: "^e?crossbowman|[^d ]crossbowman" },
  { key: "compositeBowmanLongbowman", labelRe: "composite bowman", set: { eitherOr: true } },
  { key: "lightCavalry", labelRe: "light\\s*cavalry" },
  { key: "mountedCrossbowman", labelRe: "mounted\\s*crossbowman" },
  { key: "horseArcher", labelRe: "horse archer" },
  { key: "mediumCavalry", labelRe: "medium\\s*cavalry" },
  { key: "heavyCavalry", labelRe: "heavy\\s*cavalry" },
  { key: "cataphractCavalry", labelRe: "cataphract\\s*cavalry" },
  { key: "camelArcher", labelRe: "camel archer", set: { desert: true } },
  { key: "camelLancer", labelRe: "camel lancer", set: { desert: true } },
  { key: "warElephant", labelRe: "war elephant" },
  { key: "beastRider", labelRe: "beast\\s*rider" },
];

// Equipment Availability by Market Class (RR): six price-band rows, each a
// cost band label (parsed to {minCost,maxCost} by the costBand labelPattern)
// and six market-class cells kept raw ("2,750" | "25%" | "-").
const EQUIP_AVAIL_ROWS = [
  { key: "le1", labelRe: "gp or less", labelPattern: "costBand" },
  { key: "2to10", labelRe: "^2\\s*[–-]\\s*10gp", labelPattern: "costBand" },
  { key: "11to100", labelRe: "^11\\s*[–-]\\s*100gp", labelPattern: "costBand" },
  { key: "101to1000", labelRe: "^101\\s*[–-]", labelPattern: "costBand" },
  { key: "1001to10000", labelRe: "^1,?001\\s*[–-]", labelPattern: "costBand" },
  { key: "ge10001", labelRe: "gp or more", labelPattern: "costBand" },
];

// Common and Precious Merchandise (RR): 19 common + 10 precious rows sharing
// one page — label, container, price/st, price step, then the market-class
// grid. The Precious header sits mid-table; row order below skips past it
// because no spec matches a bare "Precious"/"Merchandise" label row.
const MERCH_ROWS = [
  { key: "grainVegetables", labelRe: "^grain", set: { tier: "common" } },
  { key: "salt", labelRe: "^salt", set: { tier: "common" } },
  { key: "beerAle", labelRe: "^beer", set: { tier: "common" } },
  { key: "pottery", labelRe: "^pottery", set: { tier: "common" } },
  { key: "commonWood", labelRe: "^common wood", set: { tier: "common" } },
  { key: "wineSpirits", labelRe: "^wine", set: { tier: "common" } },
  { key: "oilsSauces", labelRe: "^oils", set: { tier: "common" } },
  { key: "preservedFish", labelRe: "^preserved fish", set: { tier: "common" } },
  { key: "preservedMeat", labelRe: "^preserved meat", set: { tier: "common" } },
  { key: "glassware", labelRe: "^glassware", set: { tier: "common" } },
  { key: "rareWood", labelRe: "^rare wood", set: { tier: "common" } },
  { key: "commonMetal", labelRe: "^common metal", set: { tier: "common" } },
  { key: "commonFurs", labelRe: "^common furs", set: { tier: "common" } },
  { key: "textiles", labelRe: "^textiles", set: { tier: "common" } },
  { key: "dyesPigments", labelRe: "^dyes?\\s*&", set: { tier: "common" } },
  { key: "botanicals", labelRe: "^botanicals", set: { tier: "common" } },
  { key: "clothing", labelRe: "^clothing", set: { tier: "common" } },
  { key: "tools", labelRe: "^tools", set: { tier: "common" } },
  { key: "armorWeapons", labelRe: "^armor", set: { tier: "common" } },
  { key: "monsterParts", labelRe: "^monster parts", set: { tier: "precious" } },
  { key: "ivory", labelRe: "^ivory", set: { tier: "precious" } },
  { key: "rareFurs", labelRe: "^rare furs", set: { tier: "precious" } },
  { key: "spices", labelRe: "^spices", set: { tier: "precious" } },
  { key: "finePorcelain", labelRe: "^fine porcelain", set: { tier: "precious" } },
  { key: "preciousMetals", labelRe: "^precious metals", set: { tier: "precious" } },
  { key: "silk", labelRe: "^silk", set: { tier: "precious" } },
  { key: "rareBooksArt", labelRe: "^rare books", set: { tier: "precious" } },
  { key: "semipreciousStones", labelRe: "^semiprecious", set: { tier: "precious" } },
  // The page's rotated chapter tab y-merges into this last row and pollutes
  // the label's start — match anywhere in the label, never anchored.
  { key: "gems", labelRe: "gems", set: { tier: "precious" } },
];

// Class-trajectory percentages (JJ "Leveled NPCs by Percentage"): a level
// column and six class-weight columns. The reference collapses runs of equal
// levels into ranges; emitting one row per level (minLevel==maxLevel) resolves
// identically in henchmen's `.find(level in [min,max])` lookup.
const CLASS_PCT_ROWS = Array.from({ length: 15 }, (_, L) => ({
  key: L,
  labelRe: `^${L}$`,
  set: { minLevel: L, maxLevel: L },
}));

// Mercenary Troop Type (RR): label + five race wage columns (dash = the book
// prices no such troops) + morale. Reference keys mirror the availability
// grid's troop ids; wolf/boar riders are beastman entries priced per race.
const MERC_WAGE_ROWS = [
  { key: "peasant", labelRe: "^peasant" },
  { key: "lightInfantry", labelRe: "^light infantry" },
  { key: "heavyInfantry", labelRe: "^heavy infantry" },
  { key: "slinger", labelRe: "^slinger" },
  { key: "bowman", labelRe: "^bowmen|^bowman" },
  { key: "compositeBowman", labelRe: "^composite" },
  { key: "crossbowman", labelRe: "^crossbow" },
  { key: "longbowman", labelRe: "^longbow" },
  { key: "lightCavalry", labelRe: "^light\\s*cavalry" },
  { key: "mountedCrossbowman", labelRe: "^mounted\\s*crossbow" },
  { key: "horseArcher", labelRe: "^horse archer" },
  { key: "mediumCavalry", labelRe: "^medium\\s*cavalry" },
  { key: "heavyCavalry", labelRe: "^heavy\\s*cavalry" },
  { key: "cataphractCavalry", labelRe: "^cataphract" },
  { key: "camelArcher", labelRe: "^camel archer" },
  { key: "camelLancer", labelRe: "^camel lancer" },
  { key: "warElephant", labelRe: "^war elephant" },
  { key: "wolfRider", labelRe: "^wolf\\s*rider" },
  { key: "boarRider", labelRe: "^boar\\s*rider" },
];


// Specialist availability (RR): ~44 rows, drop-caps and en dashes throughout —
// every multi-word label uses \\s* and [–-] (the space between a drop-cap and
// its word vanishes when runs join).
const D = "\\s*[–-]\\s*";
const SPECIALIST_ROWS = [
  ["alchemist", "^alchemist"],
  ["animalTrainerCommon", `^animal\\s*trainer${D}common`],
  ["animalTrainerWild", `^animal\\s*trainer${D}wild`],
  ["animalTrainerGiant", `^animal\\s*trainer${D}giant`],
  ["animalTrainerFantastic", `^animal\\s*trainer${D}fantastic`],
  ["armorer", "^armorer"],
  ["artisanCommon", "^artisan \\(common\\)"],
  ["artisanUncommon", "^artisan \\(uncommon\\)"],
  ["artisanRare", "^artisan \\(rare\\)"],
  ["artillerist", "^artillerist"],
  ["copyist", "^copyist"],
  ["creatureHandlerDomestic", `^creature\\s*handler${D}`],
  ["creatureHandlerWild", `^creature\\s*handler${D}wild`],
  ["creatureHandlerGiant", `^creature\\s*handler${D}giant`],
  ["creatureHandlerFantastic", `^creature\\s*handler${D}fantastic`],
  ["engineer", "^engineer"],
  ["healer", "^healer$"],
  ["healerPhysicker", `^healer${D}physicker`],
  ["healerChirurgeon", `^healer${D}chirurgeon`],
  ["laborerSkilled", `^laborer${D}skilled`],
  ["laborerUnskilled", `^laborer${D}unskilled`],
  ["lawyer", "^lawyer"],
  ["marinerCaptain", `^mariner${D}captain`],
  ["marinerMaster", `^mariner${D}master`],
  ["marinerNavigator", `^mariner${D}navigator`],
  ["marinerSailor", `^mariner${D}sailor`],
  ["marinerRower", `^mariner${D}rower`],
  ["marshalLightInfantry", `^marshal${D}light`],
  ["marshalBowHeavyInfLightCav", `^marshal${D}bow`],
  ["marshalHeavyCavHorseArcher", `^marshal${D}heavy`],
  ["marshalCataphract", `^marshal${D}cataphract`],
  ["mercOfficerLieutenant", `^mercenary\\s*officer${D}lieutenant`],
  ["mercOfficerCaptain", `^mercenary\\s*officer${D}captain`],
  ["mercOfficerColonel", `^mercenary\\s*officer${D}colonel`],
  ["mercOfficerGeneral", `^mercenary\\s*officer${D}general`],
  ["quartermaster", "^quartermaster"],
  ["ruffianCarouser", `^ruffian${D}carouser`],
  ["ruffianFootpad", `^ruffian${D}footpad`],
  ["ruffianReciter", `^ruffian${D}reciter`],
  ["ruffianSlayer", `^ruffian${D}slayer`],
  ["ruffianSpy", `^ruffian${D}spy`],
  ["ruffianThug", `^ruffian${D}thug`],
  ["sage", "^sage"],
  ["scout", "^scout"],
  ["siegeEngineer", "^siege\\s*engineer"],
  ["translator", "^translator"],
  ["writerRank1", `^writer${D}rank\\s*1`],
  ["writerRank2", `^writer${D}rank\\s*2`],
  ["writerRank3", `^writer${D}rank\\s*3`],
  ["writerRank4", `^writer${D}rank\\s*4`],
].map(([key, labelRe]) => ({ key, labelRe }));

const RARITY_TIER_ROWS = [
  { key: "ubiquitous", labelRe: "^ubiquitous" },
  { key: "common", labelRe: "^common$" },
  { key: "uncommon", labelRe: "^uncommon" },
  { key: "rare", labelRe: "^rare$" },
  { key: "veryRare", labelRe: "^very\\s*rare" },
  { key: "extremelyRare", labelRe: "^extremely\\s*rare" },
  { key: "legendary", labelRe: "^legendary" },
];

// The Judge's Screen grid abbreviated demihuman classes ("Craftpriest") and
// needed a short-name → registry-key map. The JJ's own NPC Class table prints
// them in full ("dwarven craftpriest"), so reading the book instead of the
// cheatsheet retired the map along with the screen (0.38.0).

// Culture appearance blocks: [id, printed page, hair anchor, eyes anchor].
// An anchor is the sentence's own lead-in; `#N` picks the Nth occurrence in
// reading order where the book writes "Their …" instead of naming the
// culture (page structure, not a value).
const CULTURE_APPEARANCE = [
  ["auran", 502, "tirenean hair is", "tirenean eyes are"],
  ["celdorean", 495, "celdorean hair is", "celdorean eyes are"],
  ["dwarven", 496, "their hair is#1", "their eyes are#1"],
  ["elven", 496, "their hair is#2", "their eyes are#2"],
  ["jutlandic", 497, "jutlandic hair is", "their eyes are#1"],
  ["kemeshi", 497, "", "kemeshi eyes are"], // hair not stated in this printing
  ["krysean", 498, "krysean hair is", "kryseans eyes are"],
  ["kushtu", 498, "their hair is#1", "kushtu eyes are"],
  ["nicean", 499, "nicean hair is", "nicean eyes are"],
  ["opelenean", 499, "opelenean hair is", "opelenean eyes are"],
  ["rornish", 500, "rornish hair is", "rornish eyes are"],
  ["shebatean", 500, "shebatean hair is", "shebatean eyes are"],
  ["skysos", 501, "hair of the skysos is", ""], // eyes phrasing varies; hair only
  ["somirean", 501, "somirean hair is", "somirean eyes are"],
  ["zaharan", 503, "", "zaharan eyes are"], // hair phrasing varies; eyes only
];

const CULTURE_APPEARANCE_BLOCKS = CULTURE_APPEARANCE.map(([id, page, hair, eyes]) => {
  const val = (key, anchor) => {
    const [find, nth] = anchor.split("#");
    return { key, find, take: "colorList", span: 240, ...(nth ? { occurrence: Number(nth) } : {}) };
  };
  const anchors = [["hair", hair], ["eyes", eyes]].filter(([, a]) => a);
  // Locate on an anchor that NAMES the culture — a "Their …" sentence is
  // ambiguous on a page carrying several cultures.
  const locate = (anchors.find(([, a]) => !a.startsWith("their")) ?? anchors[0])[1].split("#")[0];
  return {
    id,
    printedPage: page,
    // Page-margin chapter tabs (x≈597) interleave into the flattened text
    // ("kemeshi tt i eyes are…") — bound the print columns.
    column: { xMin: 25, xMax: 590 },
    locate,
    values: anchors.map(([key, a]) => val(key, a)),
  };
});

// Scavenged equipment (RR p160) prints FOUR d20 grids in a 2×2 block: the two
// weapon tables above, armour/equipment and vessels/vehicles below, left and
// right print columns. Every grid shares the same seven d20 bands, which is why
// each recipe needs `startAfter` — without it the upper grid in a column answers
// for the lower one. Bands only; no effect text or values live here.
const SCAVENGED_ROWS = [
  { key: "2", labelRe: "^1\\s*[–—-]\\s*2\\b", set: { min: 1, max: 2 } },
  { key: "6", labelRe: "^3\\s*[–—-]\\s*6\\b", set: { min: 3, max: 6 } },
  { key: "10", labelRe: "^7\\s*[–—-]\\s*10\\b", set: { min: 7, max: 10 } },
  { key: "14", labelRe: "^11\\s*[–—-]\\s*14\\b", set: { min: 11, max: 14 } },
  { key: "16", labelRe: "^15\\s*[–—-]\\s*16\\b", set: { min: 15, max: 16 } },
  { key: "18", labelRe: "^17\\s*[–—-]\\s*18\\b", set: { min: 17, max: 18 } },
  { key: "20", labelRe: "^19\\s*[–—-]\\s*20\\b", set: { min: 19, max: 20 } },
];

/** One scavenged grid: the print column, its header anchor, and its three cells. */
const scavengedGrid = ({ locate, column, labelMaxX, cells }) => ({
  shape: "gridRows",
  book: "rr",
  printedPage: 160,
  locate,
  startAfter: locate,
  column,
  labelMaxX,
  rowTol: 4,
  // The book sets these headings and several cells in SMALL CAPS, which reaches
  // the text layer as split runs ("o" + "ff balance"); windowed columns join
  // every run inside the band, so the cell reads whole.
  cellColumns: cells,
  rows: SCAVENGED_ROWS,
});

/* ------------------------------------------------------------------ */
/*  JJ custom-class builder (acks.classBuilder)                        */
/* ------------------------------------------------------------------ */

// Category value ladders print 4 → 0 top to bottom; row claims scan downward,
// so the spec order mirrors the page.
const VALUE_ROWS_4_TO_0 = ["4", "3", "2", "1", "0"].map((n) => ({ key: n, labelRe: `^${n}$` }));

const HD_VALUE_ROWS = VALUE_ROWS_4_TO_0;

// The Fighting Value summary table: the value alone is the row label; the
// style name beside it ("(Hero)", "Crusader") reads as the `style` cell.
const FIGHTING_VALUE_ROWS = [
  { key: "4", labelRe: "^4$" },
  { key: "3", labelRe: "^3$" },
  { key: "2", labelRe: "^2$" },
  { key: "1b", labelRe: "^1b$" },
  { key: "1a", labelRe: "^1a$" },
  { key: "0", labelRe: "^0$" },
];

// Fighting Value Trade Offs (JJ p293): drop-caps split the label's first
// letter, and small-caps armour grades join without spaces ("fromvery
// light tonone"), so the regexes never assume word boundaries.
const TRADEOFF_ROWS = [
  { key: "armor.heavyMedium", labelRe: "armor selection from\\s*heavy" },
  { key: "armor.mediumLight", labelRe: "armor selection from\\s*medium" },
  { key: "armor.lightVeryLight", labelRe: "armor selection from\\s*light" },
  { key: "armor.veryLightNone", labelRe: "armor selection from\\s*very" },
  { key: "weapons.unrestrictedBroad", labelRe: "weapon selection from\\s*u" },
  { key: "weapons.broadNarrow", labelRe: "weapon selection from\\s*broad" },
  { key: "weapons.narrowRestricted", labelRe: "weapon selection from\\s*n" },
  { key: "style.eliminateOne", labelRe: "one fighting style" },
  { key: "damage.eliminateOne", labelRe: "damage bonus \\(melee" },
  { key: "damage.eliminateBoth", labelRe: "damage bonus \\(both" },
];

// One printed per-value spell grid (JJ p295/297/298): class-level rows 1–14,
// six slot columns, a trailing caster-level column. Two grids share each
// print column, told apart by their own title rows. A verso page's whole
// layout sits ~26pt left of a recto's (p298 vs p295/297), hence `verso`.
const slotGrid = ({ page, startAfter, side, verso = false }) => {
  const d = verso ? -26 : 0;
  const xs = side === "L" ? [124, 151, 177, 203, 230, 256, 288] : [381, 408, 434, 460, 486, 512, 545];
  const keys = ["s1", "s2", "s3", "s4", "s5", "s6", "casterLevel"];
  return {
    shape: "gridRows",
    book: "jj",
    printedPage: page,
    locate: startAfter,
    startAfter,
    column: side === "L" ? { xMin: 40 + d, xMax: 300 + d } : { xMin: 320 + d, xMax: 590 + d },
    labelMaxX: (side === "L" ? 105 : 362) + d,
    rowTol: 4,
    minCells: 3,
    cellColumns: keys.map((key, i) => ({ key, x: xs[i] + d, row: true, pattern: "intDash" })),
    rows: Array.from({ length: 14 }, (_, i) => ({ key: String(i + 1), labelRe: `^${i + 1}$` })),
  };
};

// Ready-for-Play Class Builds (JJ p332–333): one prose paragraph per class.
// The window take hands the whole paragraph to builder-binding, which parses
// the allocation tokens mechanically; the class roster is the cookbook's own.
const buildBlock = (id, page, locate) => ({
  id,
  printedPage: page,
  locate,
  values: [{ key: "build", find: locate.toLowerCase(), take: "window", span: 560 }],
});
const BUILD_BLOCKS = [
  buildBlock("assassin", 332, "Assassin:"),
  buildBlock("bard", 332, "Bard:"),
  buildBlock("bladedancer", 332, "Bladedancer:"),
  buildBlock("crusader", 332, "Crusader:"),
  buildBlock("dwarvenCraftpriest", 332, "Dwarven Craftpriest:"),
  buildBlock("dwarvenVaultguard", 332, "Dwarven Vaultguard:"),
  buildBlock("elvenNightblade", 332, "Elven Nightblade:"),
  buildBlock("elvenSpellsword", 332, "Elven Spellsword:"),
  buildBlock("explorer", 332, "Explorer:"),
  buildBlock("fighter", 332, "Fighter:"),
  buildBlock("mage", 332, "Mage:"),
  buildBlock("thief", 333, "Thief:"),
];

/* ------------------------------------------------------------------ */
/*  Wilderness encounters (the `encounters` ruledata document)         */
/* ------------------------------------------------------------------ */

// One monster sub-table: d100 band rows × four rarity columns, located by
// its own heading suffix. The BAND WIDTHS vary per table (a sparse roster
// prints wider bands), so the row specs are generic — any "NN-NN" label
// claims the next band row and labelPattern hands its bounds to the
// binding. COLUMN GEOMETRY varies per page too (each table sets its own
// widths, versos sit left of rectos), so every table carries the x of its
// four rarity headers, measured off its printing; windows open 30pt ahead
// of each header (a small-caps first letter lands left of its word) and
// run to the next header's opening, and the label bound is the first
// window's own edge. KNOWN RESIDUE: a handful of two-line RARE names wrap
// under the neighbouring column and stay unread (dev-verified at five
// bands of 1800) — those rolls resolve as the engine's draw-from-your-book
// line, never a wrong name.
// The label matches UNANCHORED at its end: a long name's wrap line can
// tuck under the label zone ("69-70raptor, Medium…"), and the band still
// reads out of the front while labelPattern discards the rest.
const ENC_BAND_ROWS = Array.from({ length: 50 }, (_, i) => ({
  key: `b${i}`,
  labelRe: "^\\d+\\s*[-–]\\s*\\d+",
  labelPattern: "rollBand",
}));

const monsterGrid = (page, locate, [c, u, r, v]) => {
  // The label bound is the common window's own opening: wide enough that
  // every band label fits, tight enough that a name's stray small-cap
  // first letter — and a long name's wrap line, which tucks right against
  // the label — falls to the window. Verso labels end ~80, recto ~108.
  const lbl = c <= 145 ? 82 : 116;
  return {
    shape: "gridRows",
    book: "jj",
    printedPage: page,
    locate,
    column: { xMin: 40, xMax: 592 },
    labelMaxX: lbl,
    rowTol: 6,
    joinGap: 1,
    cellColumns: [
      { key: "common", x: lbl, w: u - 30 - lbl, pattern: "raw", row: true },
      { key: "uncommon", x: u - 30, w: r - u, pattern: "raw", row: true },
      { key: "rare", x: r - 30, w: v - r, pattern: "raw", row: true },
      { key: "veryRare", x: v - 30, w: 622 - v, pattern: "raw", row: true },
    ],
    rows: ENC_BAND_ROWS,
  };
};

// The 20-band civilized grids: two stacked full-width halves sharing one
// page, told apart by startAfter (the scavenged-grid precedent).
const CIV_BAND_ROWS = Array.from({ length: 20 }, (_, i) => {
  const lo = i * 5 + 1;
  const hi = i * 5 + 5;
  const label = `${String(lo).padStart(2, "0")}-${hi === 100 ? "100" : String(hi).padStart(2, "0")}`;
  return { key: label, labelRe: `^${label}$` };
});

const civilizedGrid = (startAfter) => ({
  shape: "gridRows",
  book: "jj",
  printedPage: 43,
  locate: "Grassland (farm, prairie,",
  ...(startAfter ? { startAfter } : {}),
  column: { xMin: 60, xMax: 592 },
  labelMaxX: 115,
  rowTol: 4,
  joinGap: 1,
  cellColumns: [
    { key: "g1", x: 117, w: 112, pattern: "raw", row: true },
    { key: "g2", x: 229, w: 114, pattern: "raw", row: true },
    { key: "g3", x: 343, w: 112, pattern: "raw", row: true },
    { key: "g4", x: 455, w: 137, pattern: "raw", row: true },
  ],
  rows: CIV_BAND_ROWS,
});

// The RR distance/evasion grids share one 17-row terrain roster; the
// small-caps splits make every label seam-tolerant.
const ENC_TERRAIN_ROWS = [
  ["barrens", "^barrens \\(any\\)$"],
  ["desertRocky", "^d\\s*esert \\(rocky\\)$"],
  ["desertSandy", "^d\\s*esert \\(sandy\\)$"],
  ["forestDeciduous", "^forest \\(deciduous\\)$"],
  ["forestTaiga", "^forest \\(taiga\\)$"],
  ["grassland", "^grassland \\(other\\)$"],
  ["grasslandSteppe", "^grassland \\(steppe\\)$"],
  ["hillsForested", "^hills \\(forested\\)$"],
  ["hillsRocky", "^hills \\(rocky(/terraced)?\\)$"],
  ["jungle", "^jungle \\(any\\)$"],
  ["mountainsForested", "^mountains \\(forested\\)$"],
  ["mountainsRocky", "^mountains \\(rocky(/snowy/terraced)?\\)$"],
  ["scrublandSparse", "^s\\s*crubland \\(low, sparse\\)$|^s\\s*crubland \\(sparse\\)$"],
  ["scrublandDense", "^s\\s*crubland \\(high, dense\\)$|^s\\s*crubland \\(dense\\)$"],
  ["swampMarshy", "^s\\s*wamp \\(marshy\\)$"],
  ["swampScrubby", "^s\\s*wamp \\(scrubby\\)$"],
  ["swampForested", "^s\\s*wamp \\(forested\\)$"],
].map(([key, labelRe]) => ({ key, labelRe }));

// A terrain-encounter d12 sidebar: twelve numbered rows, one name cell.
const terrainD12 = (locate, side) => ({
  shape: "gridRows",
  book: "jj",
  printedPage: locate.startsWith("Valuable") ? 63 : locate.startsWith("Dangerous") ? 65 : 67,
  locate,
  column: side === "R" ? { xMin: 450, xMax: 592 } : { xMin: 70, xMax: 200 },
  labelMaxX: side === "R" ? 480 : 108,
  rowTol: 4,
  joinGap: 1,
  cellColumns: [{ key: "name", x: side === "R" ? 487 : 112, w: side === "R" ? 100 : 85, pattern: "raw", row: true }],
  rows: Array.from({ length: 12 }, (_, i) => ({ key: String(i + 1), labelRe: `^${i + 1}$` })),
});

export const TABLE_RECIPES = {
  // The wilderness encounter chain's pages: the JJ's territory, rarity,
  // civilized and monster grids and the terrain-encounter sidebars, and the
  // RR's distance and evasion grids with their prose figures. Raw reads
  // only; encounters-binding.mjs assembles the engine-shaped `encounters`
  // document acks-extras declares.
  encounters: {
    source: { book: "ACKS II Judges Journal + Revised Rulebook", pages: "JJ 42-67; RR 281-285" },
    tables: {
      territoryRaw: {
        shape: "gridRows",
        book: "jj",
        printedPage: 42,
        locate: "Wilderness Encounter by Territory Classification",
        startAfter: "Wilderness Encounter by Territory Classification",
        column: { xMin: 40, xMax: 592 },
        labelMaxX: 162,
        rowTol: 4,
        rows: [
          { key: "columnShift", labelRe: "^c\\s*olumn\\s*s\\s*hift,\\s*r\\s*oll\\s*a\\s*gain$" },
          { key: "none", labelRe: "^n\\s*o\\s*e\\s*ncounter$" },
          { key: "civilized", labelRe: "^c\\s*ivilized\\s*e\\s*ncounter$" },
          { key: "monster", labelRe: "^monster\\s*e\\s*ncounter$" },
          { key: "dangerousTerrain", labelRe: "^d\\s*angerous\\s*t\\s*errain\\s*e\\s*ncounter$" },
          { key: "valuableTerrain", labelRe: "^v\\s*aluable\\s*t\\s*errain\\s*e\\s*ncounter$" },
          { key: "uniqueTerrain", labelRe: "^u\\s*nique\\s*t\\s*errain\\s*e\\s*ncounter$" },
        ],
        cellColumns: [
          { key: "civilizedRoad", x: 166, w: 74, pattern: "raw", row: true },
          { key: "civilizedOrBorderlandsRoad", x: 243, w: 76, pattern: "raw", row: true },
          { key: "borderlandsOrOutlandsRoad", x: 322, w: 73, pattern: "raw", row: true },
          { key: "outlandsOrUnsettledRoad", x: 398, w: 75, pattern: "raw", row: true },
          { key: "unsettled", x: 476, w: 86, pattern: "raw", row: true },
        ],
      },
      rarityRaw: {
        shape: "gridRows",
        book: "jj",
        printedPage: 44,
        locate: "Monster Rarity by Terrain Classification",
        column: { xMin: 40, xMax: 592 },
        labelMaxX: 172,
        rowTol: 4,
        rows: [
          { key: "common", labelRe: "^c\\s*ommon$" },
          { key: "uncommon", labelRe: "^u\\s*ncommon$" },
          { key: "rare", labelRe: "^r\\s*are$" },
          { key: "veryRare", labelRe: "^v\\s*ery\\s*r\\s*are$" },
        ],
        cellColumns: [
          { key: "civilized", x: 176, w: 85, pattern: "raw", row: true },
          { key: "borderlands", x: 266, w: 85, pattern: "raw", row: true },
          { key: "outlands", x: 371, w: 85, pattern: "raw", row: true },
          { key: "unsettled", x: 469, w: 85, pattern: "raw", row: true },
        ],
      },
      civilizedUpperRaw: civilizedGrid(null),
      civilizedLowerRaw: civilizedGrid("Forest (taiga)"),
      distanceRaw: {
        shape: "gridRows",
        book: "rr",
        printedPage: 281,
        locate: "Wilderness Encounter Distance Table",
        column: { xMin: 340, xMax: 592 },
        labelMaxX: 472,
        rowTol: 4,
        rows: ENC_TERRAIN_ROWS,
        cellColumns: [{ key: "cell", x: 474, w: 112, pattern: "raw", row: true }],
      },
      evasionRaw: {
        shape: "gridRows",
        book: "rr",
        printedPage: 284,
        locate: "Evasion Throw by Terrain Table",
        column: { xMin: 250, xMax: 560 },
        labelMaxX: 340,
        rowTol: 4,
        rows: ENC_TERRAIN_ROWS,
        cellColumns: [
          { key: "s1", x: 342, w: 40, pattern: "raw", row: true },
          { key: "s2", x: 384, w: 40, pattern: "raw", row: true },
          { key: "s3", x: 427, w: 40, pattern: "raw", row: true },
          { key: "s4", x: 469, w: 40, pattern: "raw", row: true },
          { key: "s5", x: 511, w: 45, pattern: "raw", row: true },
        ],
      },
      // The size-band header over the evasion grid — the edges are printed
      // and the binding reads them out of the captured window. The page's
      // LEFT prose column interleaves in the flat text, so the window is
      // bound to the grid's own column.
      evasionSizeProse: {
        shape: "proseValues",
        book: "rr",
        printedPage: 284,
        locate: "Evasion Throw by Terrain Table",
        // Opens at the TITLE's own x (236), which anchors the find — "party
        // size" alone also appears in the page's prose left of the grid —
        // and reads the whole column as ONE stream (colSplit past the edge)
        // so the header's edge cells stay beside their words.
        column: { xMin: 230, xMax: 592 },
        colSplit: 592,
        values: [{ key: "bands", find: "evasion throw by terrain table", take: "window", span: 120 }],
      },
      visibilityProse: {
        shape: "proseValues",
        book: "rr",
        printedPage: 281,
        locate: "Maximum Visibility Distance",
        values: [
          { key: "light", find: "can be in line of sight is", take: "window", span: 130 },
          { key: "party", find: "party-sized formations", take: "window", span: 70 },
          { key: "platoon", find: "platoon-sized formations", take: "window", span: 70 },
          { key: "company", find: "company-sized formations", take: "window", span: 70 },
          { key: "battalion", find: "battalion or larger formations", take: "window", span: 70 },
          { key: "heads", find: "count each mounted man", take: "window", span: 180 },
          { key: "altitude", find: "can start at an altitude of up to", take: "window", span: 30 },
        ],
      },
      // The evasion grid's page sets prose in two columns AROUND the grid,
      // and a full-page flatten interleaves grid rows into the sentences —
      // so each block binds to its own print column.
      evasionModsProse: {
        shape: "proseValues",
        book: "rr",
        valueBlocks: [
          {
            id: "left",
            printedPage: 284,
            locate: "explorer guides a party",
            column: { xMin: 40, xMax: 250 },
            values: [
              { key: "aerial", find: "can fly and the adventurers cannot, the adventurers suffer", take: "signedInt" },
              { key: "explorer", find: "explorer guides a party in familiar territory, the party gains", take: "signedInt" },
            ],
          },
          {
            id: "right",
            printedPage: 284,
            locate: "can evade using the reduced party size",
            column: { xMin: 295, xMax: 592 },
            values: [
              { key: "forlornHope", find: "can evade using the reduced party size with an additional", take: "signedInt" },
              { key: "movement", find: "the slowest adventurer, the adventurers suffer", take: "signedInt" },
            ],
          },
          {
            id: "aftermath",
            printedPage: 285,
            locate: "make a Navigation throw at",
            values: [
              { key: "aftermathNavigation", find: "make a navigation throw at", take: "signedInt" },
            ],
          },
        ],
      },
      valuableTerrainRaw: terrainD12("Valuable Terrain Encounters", "R"),
      dangerousTerrainRaw: terrainD12("Dangerous Terrain Encounters", "L"),
      uniqueTerrainRaw: terrainD12("Unique Terrain Encounters", "L"),
      monstersBarrensRockyRaw: monsterGrid(45, "Rarity - Barrens (Rocky/Sandy)", [156, 266, 393, 493]),
      monstersBarrensTundraRaw: monsterGrid(46, "Rarity - Barrens (Tundra)", [141, 264, 384, 472]),
      monstersDesertRaw: monsterGrid(47, "Rarity - Desert (Any)", [156, 266, 393, 493]),
      monstersForestDeciduousRaw: monsterGrid(48, "Rarity - Forest (Deciduous)", [134, 249, 369, 465]),
      monstersForestTaigaRaw: monsterGrid(49, "Rarity - Forest (Taiga)", [160, 271, 394, 492]),
      monstersGrasslandFarmRaw: monsterGrid(50, "Rarity - Grassland (Farmland/Prairie)", [129, 239, 366, 466]),
      monstersGrasslandSavannaRaw: monsterGrid(51, "Rarity - Grassland (Savannah)", [162, 276, 399, 495]),
      monstersGrasslandSteppeRaw: monsterGrid(52, "Rarity - Grassland (Steppe)", [133, 252, 374, 466]),
      monstersHillsRaw: monsterGrid(53, "Rarity - Hills (Any)", [159, 273, 397, 493]),
      monstersJungleRaw: monsterGrid(54, "Rarity - Jungle (Any)", [135, 252, 374, 468]),
      monstersMountainsForestedRaw: monsterGrid(55, "Rarity - Mountains (Forested/Rocky)", [158, 271, 395, 493]),
      monstersMountainsSnowyRaw: monsterGrid(56, "Rarity - Mountains (Snowy)", [129, 242, 368, 466]),
      monstersMountainsVolcanicRaw: monsterGrid(57, "Rarity - Mountains (Volcanic)", [158, 271, 395, 493]),
      monstersRiverLandRaw: monsterGrid(58, "Rarity - River (Any but Desert or Jungle)", [129, 240, 366, 465]),
      monstersRiverDesertJungleRaw: monsterGrid(59, "Rarity - River (Desert and Jungle)", [156, 273, 403, 497]),
      monstersScrublandSparseRaw: monsterGrid(60, "Rarity - Scrubland (Sparse)", [129, 239, 366, 466]),
      monstersScrublandDenseRaw: monsterGrid(61, "Rarity - Scrubland (Dense)", [156, 266, 393, 493]),
      monstersSwampRaw: monsterGrid(62, "Rarity - Swamp (Any)", [129, 239, 366, 466]),
    },
  },
  // The Auran Empire language taxonomy prints as one indented two-column table:
  // the Cybelean name on the left, its real-world counterpart on the right, and
  // descent carried entirely by how far each cell is indented.
  //
  // It is read rather than transcribed, and the difference matters. Every other
  // definition kind anchors on a printed name because it has a MECHANIC to bind
  // to; a language has none — its entry would be a name and nothing else, so
  // one entry per language is not a way of finding the list, it is the list.
  // This recipe carries the section heading, two x-bands and an indent step.
  // What the rows say comes from the reader's own book.
  languages: {
    source: { book: "ACKS II Revised Rulebook", pages: "507" },
    tables: {
      tree: {
        shape: "indentTree",
        book: "rr",
        printedPage: 507,
        locate: "LANGUAGES",
        // Below the two column headers; the section title and the vertical
        // page furniture are excluded by height, not by position.
        yMin: 130,
        bodyMaxH: 10,
        // The left column's outermost cells sit at x=72 and each level of
        // descent steps in by 36.
        baseX: 72,
        step: 36,
        columns: [
          { key: "name", xMin: 60, xMax: 320 },
          { key: "counterpart", xMin: 320, xMax: 590 },
        ],
      },
    },
  },
  // RR ch. 6 wilderness ground: the grouped Terrain Speed Multiplier table
  // (whose road row carries the Driving rate in its own cell) and the
  // Going without: hunger, thirst, the cold and the heat. RAW prints all of
  // it as PROSE rather than a table, so these are windows around the phrases
  // that carry the figures; survival-binding.mjs parses them into the engine
  // shape acks-extras declares via expectTables.
  flight: {
    source: { book: "ACKS II Revised Rulebook", pages: "RR 274" },
    tables: {
      // Air movement is three printed factors: what a full day aloft is worth,
      // what wind costs, and what a heavy load costs. The EXCEPTION — that
      // wind is the one weather condition air movement does not take normally
      // — is the rule's own shape and lives in the flight code, not here.
      airProse: {
        shape: "proseValues",
        book: "rr",
        printedPage: 274,
        locate: "fly all day",
        column: { xMin: 300, xMax: 592 },
        values: [
          { key: "aloft", find: "expedition speed is", take: "window", span: 120 },
          // The partial-flight sentence names the same factor a second time
          // and states the pro-rata rule; kept as the fallback read.
          { key: "partial", find: "spent in the air", take: "window", span: 120 },
          { key: "wind", find: "conditions also", take: "window", span: 45 },
        ],
      },
      loadProse: {
        shape: "proseValues",
        book: "rr",
        printedPage: 274,
        // "normal load" alone also matches the following page; the mount
        // run-in is unique to this one.
        locate: "large enough to serve as mounts",
        // The mount paragraph sits in the LEFT column of the following page,
        // not with the air-movement prose it continues.
        printedPage: 275,
        column: { xMin: 40, xMax: 300 },
        values: [
          // Anchored BEFORE both factors: a window opens after its anchor, so
          // finding "half speed" consumes the very words being read.
          { key: "heavy", find: "creatures can move at", take: "window", span: 130 },
        ],
      },
    },
  },

  survival: {
    source: { book: "ACKS II Revised Rulebook", pages: "RR 276-277" },
    tables: {
      starvationProse: {
        shape: "proseValues",
        book: "rr",
        printedPage: 278,
        locate: "Starvation",
        column: { xMin: 40, xMax: 300 },
        // ONE window, not one per rung. Every threshold in this paragraph is
        // stated BEFORE the condition it produces ("After two consecutive days
        // without any food… becomes underfed"), and a window opens after its
        // anchor — so an anchor on the condition consumes the figure being
        // read. The paragraph is taken whole and the binder reads the rungs
        // out of it.
        values: [
          { key: "paragraph", find: "Starvation", take: "window", span: 1250 },
        ],
      },
      dehydrationProse: {
        shape: "proseValues",
        book: "rr",
        printedPage: 278,
        locate: "Dehydration",
        // Starvation fills the left column and Dehydration wraps into the
        // right one — the section order is not the column order.
        column: { xMin: 300, xMax: 592 },
        // Taken whole for the same reason as starvation — and because "become
        // dehydrated" also appears in the camel run-in on this page.
        values: [
          { key: "paragraph", find: "Dehydration", take: "window", span: 1100 },
        ],
      },
      exposureProse: {
        shape: "proseValues",
        book: "rr",
        printedPage: 279,
        locate: "Frigid Temperatures",
        column: { xMin: 300, xMax: 592 },
        values: [
          { key: "frigid", find: "without protective clothing for more than", take: "window", span: 200 },
          { key: "cold", find: "for more than four hours", take: "window", span: 200 },
        ],
      },
      heatProse: {
        shape: "proseValues",
        book: "rr",
        printedPage: 279,
        locate: "Sweltering Temperatures",
        column: { xMin: 300, xMax: 592 },
        // Whole, like the other two: the armour threshold is stated before the
        // saving throw it triggers, so any anchor on the throw eats it.
        values: [
          { key: "paragraph", find: "Sweltering", take: "window", span: 900 },
        ],
      },
      simplifiedProse: {
        shape: "proseValues",
        book: "rr",
        printedPage: 279,
        locate: "Survival, Simplified",
        column: { xMin: 40, xMax: 300 },
        values: [
          { key: "food", find: "can forage about", take: "window", span: 200 },
          // Long enough to reach the confidence the recommendation carries —
          // the figure is the last clause of the sentence, well past the days.
          { key: "carry", find: "carries enough food for", take: "window", span: 430 },
        ],
      },
    },
  },

  // Living off the country. All prose again: the forage targets, what Survival
  // is worth, the hunting target and its territory modifiers, the dog pack's
  // help and cap, and what a success yields. foraging-binding.mjs parses the
  // windows into the engine shape.
  foraging: {
    source: { book: "ACKS II Revised Rulebook", pages: "RR 276-277" },
    tables: {
      firewoodProse: {
        shape: "proseValues",
        book: "rr",
        printedPage: 278,
        locate: "Foraging for firewood",
        column: { xMin: 40, xMax: 592 },
        values: [
          { key: "targets", find: "target value is", take: "window", span: 150 },
          { key: "yield", find: "gathers", take: "window", span: 150 },
          { key: "survival", find: "Survival proficiency gains", take: "window", span: 130 },
        ],
      },
      waterProse: {
        shape: "proseValues",
        book: "rr",
        printedPage: 278,
        locate: "Foraging for water",
        column: { xMin: 40, xMax: 592 },
        values: [
          { key: "targets", find: "throw to find water", take: "window", span: 240 },
          { key: "yield", find: "the party finds enough water", take: "window", span: 160 },
          { key: "group", find: "Parties larger than", take: "window", span: 180 },
        ],
      },
      foodProse: {
        shape: "proseValues",
        book: "rr",
        printedPage: 278,
        locate: "Foraging for food",
        column: { xMin: 40, xMax: 592 },
        // Taken generously: the terrain and territory penalties are the tail of
        // this paragraph, well past the yield they follow.
        values: [
          { key: "target", find: "Foraging proficiency throw of", take: "window", span: 140 },
          { key: "yield", find: "stone of food", take: "window", span: 170 },
          { key: "modifiers", find: "doesn", take: "window", span: 460 },
        ],
      },
      huntProse: {
        shape: "proseValues",
        book: "rr",
        printedPage: 278,
        locate: "Hunting for food",
        column: { xMin: 40, xMax: 592 },
        values: [
          { key: "throw", find: "Hunting for food", take: "window", span: 300 },
        ],
      },
      dogsProse: {
        shape: "proseValues",
        book: "rr",
        printedPage: 278,
        locate: "hunting dog can attempt",
        column: { xMin: 40, xMax: 592 },
        values: [
          { key: "pack", find: "hunting dog can attempt", take: "window", span: 300 },
        ],
      },
      grazingProse: {
        shape: "proseValues",
        book: "rr",
        printedPage: 278,
        locate: "Surviving the Wild",
        column: { xMin: 40, xMax: 300 },
        values: [
          { key: "dromedaries", find: "Desert Dromedaries", take: "window", span: 220 },
          { key: "grazers", find: "Efficient Grazers", take: "window", span: 220 },
        ],
      },
      // The grazing MECHANIC, which draws a different list from the one above:
      // three kinds feed themselves, but only two can do it on ancillary hours
      // and still travel. Reading the first list for the second rule would let
      // an ox march and graze at once.
      grazingRules: {
        shape: "proseValues",
        book: "rr",
        printedPage: 279,
        // Kept short: a long locate spans run seams the extraction welds shut.
        locate: "gather food by grazing",
        column: { xMin: 40, xMax: 592 },
        values: [
          // Anchored on the sentence BEFORE: the kinds are named first, and a
          // window opening on the clause itself would drop them.
          { key: "ancillary", find: "half-speed if desired", take: "window", span: 200 },
          { key: "barren", find: "animals in", take: "window", span: 140 },
        ],
      },
      huntingProse: {
        shape: "proseValues",
        book: "rr",
        printedPage: 279,
        locate: "Game is scarce",
        column: { xMin: 40, xMax: 592 },
        values: [
          { key: "territory", find: "Game is scarce", take: "window", span: 320 },
        ],
      },
    },
  },

  // Searching the wild: the one table in this family that IS a grid — a ladder
  // of daily distances to targets — plus the prose modifiers around it.
  // searching-binding.mjs brackets the ladder and parses the windows.
  searching: {
    source: { book: "ACKS II Revised Rulebook", pages: "RR 274-275" },
    tables: {
      searchLadder: {
        shape: "gridRows",
        book: "rr",
        printedPage: 276,
        locate: "Wilderness Search",
        column: { xMin: 40, xMax: 300 },
        labelMaxX: 210,
        // The ladder's rows are distance BANDS, so each label carries its own
        // bounds and the binder brackets them; the recipe only reads them.
        rows: [
          { key: "b01", labelRe: "miles or less", labelPattern: "milesBand" },
          { key: "b02", labelRe: "^12", labelPattern: "milesBand" }, { key: "b03", labelRe: "^24", labelPattern: "milesBand" },
          { key: "b04", labelRe: "^36", labelPattern: "milesBand" }, { key: "b05", labelRe: "^48", labelPattern: "milesBand" },
          { key: "b06", labelRe: "^60", labelPattern: "milesBand" }, { key: "b07", labelRe: "^72", labelPattern: "milesBand" },
          { key: "b08", labelRe: "^84", labelPattern: "milesBand" }, { key: "b09", labelRe: "^96", labelPattern: "milesBand" },
          { key: "b10", labelRe: "^108", labelPattern: "milesBand" }, { key: "b11", labelRe: "^120", labelPattern: "milesBand" },
          { key: "b12", labelRe: "^132", labelPattern: "milesBand" }, { key: "b13", labelRe: "^144", labelPattern: "milesBand" },
          { key: "b14", labelRe: "^156", labelPattern: "milesBand" }, { key: "b15", labelRe: "^168", labelPattern: "milesBand" },
          { key: "b16", labelRe: "^180", labelPattern: "milesBand" }, { key: "b17", labelRe: "miles or more", labelPattern: "milesBand" },
        ],
        cellColumns: [
          { key: "band", x: 40, w: 168, pattern: "raw", row: true },
          { key: "target", x: 210, w: 80, pattern: "raw", row: true },
        ],
      },
      searchProse: {
        shape: "proseValues",
        book: "rr",
        printedPage: 276,
        locate: "particular point of interest",
        column: { xMin: 40, xMax: 592 },
        values: [
          { key: "specific", find: "particular point of interest imposes", take: "window", span: 140 },
          // Read from before the aerial clause: it names the OPEN terrains
          // ahead of its cadence, so an anchor on the cadence loses them.
          { key: "cadence", find: "in addition, when searching", take: "window", span: 340 },
          // Anchored one clause earlier than the terrains it lists — "when
          // searching forest" would eat the first of the three.
          { key: "canopy", find: "however", take: "window", span: 200 },
          { key: "wandering", find: "trigger one random encounter", take: "window", span: 160 },
        ],
      },
      // Searching for a LOST GROUP rather than a place. Printed with the
      // rendezvous rules, chapters away from the search table it modifies.
      lostSearchProse: {
        shape: "proseValues",
        book: "rr",
        printedPage: 287,
        locate: "lost party is moving or searching",
        column: { xMin: 40, xMax: 592 },
        values: [
          { key: "moving", find: "lost party is moving or searching", take: "window", span: 120 },
        ],
      },
      // What an hour of searching costs, stated where the system is introduced
      // rather than with the aerial exception that changes it.
      cadenceProse: {
        shape: "proseValues",
        book: "rr",
        printedPage: 276,
        locate: "abstract system can be used",
        column: { xMin: 40, xMax: 592 },
        values: [
          { key: "hour", find: "abstract system can be used", take: "window", span: 160 },
        ],
      },
      surveyProse: {
        shape: "proseValues",
        book: "rr",
        printedPage: 277,
        locate: "Land Surveying",
        column: { xMin: 40, xMax: 592 },
        values: [
          { key: "target", find: "target value for the proficiency throw", take: "window", span: 220 },
          { key: "misread", find: "fails with an unmodified", take: "window", span: 200 },
        ],
      },
    },
  },

  // City travel (JJ, Settlement Adventures). The paces and the straggling
  // ladder are prose; the street's encounter cadence IS a grid.
  //
  // `cityTravel`, not `settlement`: this file already registers a `settlement`
  // document for market class by families, and the two are unrelated.
  cityTravel: {
    source: { book: "ACKS II Judges Journal", pages: "JJ 79-80" },
    tables: {
      pacesProse: {
        shape: "proseValues",
        book: "jj",
        printedPage: 81,
        locate: "Movement in Settlements",
        column: { xMin: 300, xMax: 592 },
        values: [
          { key: "commuting", find: "At commuter speed, it takes", take: "window", span: 200 },
          { key: "navigation", find: "must make a Navigation throw", take: "window", span: 240 },
          { key: "stray", find: "Characters who get lost end up", take: "window", span: 160 },
          { key: "meandering", find: "At meandering speed, it takes", take: "window", span: 180 },
        ],
      },
      stragglingProse: {
        shape: "proseValues",
        book: "jj",
        printedPage: 81,
        locate: "Straggling Groups",
        column: { xMin: 40, xMax: 592 },
        values: [
          { key: "tiers", find: "If the party is", take: "window", span: 300 },
        ],
      },
      // Looking for trouble, and the shift the dark puts on the incident roll.
      // Two figures, two sentences, two pages apart.
      intentProse: {
        shape: "proseValues",
        book: "jj",
        printedPage: 82,
        locate: "looking for trouble",
        column: { xMin: 40, xMax: 592 },
        values: [
          { key: "trouble", find: "they can increase the chance", take: "window", span: 140 },
        ],
      },
      afterDarkProse: {
        shape: "proseValues",
        book: "jj",
        printedPage: 83,
        locate: "after dark",
        column: { xMin: 40, xMax: 592 },
        values: [
          { key: "shift", find: "roll 1d100", take: "window", span: 90 },
        ],
      },
      streetCadence: {
        shape: "gridRows",
        book: "jj",
        printedPage: 82,
        locate: "Encounters in the Settlement",
        column: { xMin: 40, xMax: 592 },
        // Measured, not guessed: the label band ends at 130, the frequency
        // cell runs 132-247 and the throw sits at 251.
        labelMaxX: 130,
        // The small-caps face splits each cell's initial glyph into its own
        // run ("e" + "very hour"); a gap this small is a glyph boundary, not a
        // column gutter.
        joinCellGap: 12,
        rows: [
          { key: "avenueDay", labelRe: "^avenue.*day" },
          { key: "avenueNight", labelRe: "^avenue.*night" },
          { key: "alleyDay", labelRe: "^alley.*day" },
          { key: "alleyNight", labelRe: "^alley.*night" },
          { key: "holedUp", labelRe: "^holed\s*up" },
        ],
        cellColumns: [
          { key: "frequency", x: 132, w: 115, pattern: "raw", row: true },
          { key: "throw", x: 249, w: 60, pattern: "raw", row: true },
        ],
      },
    },
  },

  // Navigating the Wild targets. Raw page reads only; travel-binding.mjs
  // assembles the engine-shaped `terrainMultipliers`/`roads`/`gettingLost`
  // tables acks-extras declares via expectTables.
  travel: {
    source: { book: "ACKS II Revised Rulebook + Judges Journal", pages: "RR 272, 275; JJ 41" },
    tables: {
      terrainGroups: {
        shape: "gridRows",
        book: "rr",
        printedPage: 272,
        locate: "Road multipliers are applied after",
        column: { xMin: 300, xMax: 590 },
        labelMaxX: 440,
        rows: [
          { key: "grasslandScrubland", labelRe: "^grassland" },
          { key: "barrensDesertHillsForest", labelRe: "^barrens" },
          { key: "jungleMountainSwamp", labelRe: "^jungle" },
          { key: "road", labelRe: "^road$" },
          { key: "mudSnow", labelRe: "^mud" },
        ],
        cellColumns: [{ key: "multiplier", x: 442, w: 148, pattern: "raw", row: true }],
      },
      gettingLostRaw: {
        shape: "gridRows",
        book: "rr",
        printedPage: 275,
        locate: "Navigating the Wild",
        column: { xMin: 325, xMax: 590 },
        labelMaxX: 480,
        rows: [
          { key: "barrens", labelRe: "^barrens" },
          { key: "desert", labelRe: "^desert" },
          { key: "forest", labelRe: "^forest" },
          { key: "grassland", labelRe: "^grassland" },
          { key: "hills", labelRe: "^hills" },
          { key: "jungle", labelRe: "^jungle" },
          { key: "mountains", labelRe: "^mountains" },
          { key: "scrublandSparse", labelRe: "^scrubland \\(low" },
          { key: "scrublandDense", labelRe: "^scrubland \\(high" },
          { key: "swampMarshy", labelRe: "^swamp \\(marshy" },
          { key: "swampForested", labelRe: "^swamp \\(forested" },
        ],
        cellColumns: [{ key: "navigation", x: 499, w: 48, pattern: "raw", row: true }],
      },
      // The draft substitutions the vehicle entries state in prose ("One ox,
      // two mules, or two medium horses can be substituted for 1 heavy
      // horse") — the rates a team's pull is counted at. The heavy horse is
      // the unit and needs no import; travel-binding turns each printed count
      // into the share one animal of that kind pulls.
      draftSubstitutionProse: {
        shape: "proseValues",
        book: "rr",
        printedPage: 151,
        locate: "substituted for 1 heavy horse",
        locateBare: true,
        values: [
          { key: "substitutions", find: "can be substituted for 1 heavy horse", before: true, span: 90, take: "window" },
        ],
      },
      // Wilderness Frequency of Encounters (JJ ~41): activity rows × the four
      // territory classifications, cells raw ("once per attempt", "none");
      // travel-binding parses them onto the engine's frequency kinds. Labels
      // arrive as split small-caps runs, hence the \s* seams.
      encounterFrequencyRaw: {
        shape: "gridRows",
        book: "jj",
        printedPage: 41,
        locate: "Wilderness Frequency of Encounters",
        column: { xMin: 70, xMax: 580 },
        labelMaxX: 173,
        rows: [
          { key: "hunting", labelRe: "^hunting$" },
          { key: "managingTraps", labelRe: "^managing\\s*t\\s*raps$" },
          { key: "restingDay", labelRe: "^r\\s*esting/\\s*s\\s*tationary\\s*\\(day\\)$" },
          { key: "restingNight", labelRe: "^r\\s*esting/\\s*s\\s*tationary\\s*\\(night\\)$" },
          { key: "searching", labelRe: "^s\\s*earching$" },
          { key: "traveling", labelRe: "^t\\s*raveling$" },
        ],
        cellColumns: [
          { key: "civilized", x: 175, w: 95, pattern: "raw", row: true },
          { key: "borderlands", x: 274, w: 95, pattern: "raw", row: true },
          { key: "outlands", x: 373, w: 95, pattern: "raw", row: true },
          { key: "unsettled", x: 471, w: 105, pattern: "raw", row: true },
        ],
      },
    },
  },
  // The sea's own numbers (RR ch. 7): the Wind Strength grid, the tacking
  // rate, the Navigation targets and their proficiency bonuses, the hazard
  // throw and every hazard's effects, the hull damage shares and the
  // sinking die. Raw reads only; voyages-binding.mjs assembles the
  // engine-shaped tables acks-extras' sea derivations declare on the
  // `voyages` document.
  voyages: {
    source: { book: "ACKS II Revised Rulebook", pages: "316-320" },
    tables: {
      // Six band rows: the 2d6 spread and the band name share the label
      // zone — the name claims the row, labelPattern reads the spread's
      // edges out of the same label — then sail ×, oar ×, next-day modifier
      // and the special-effect text.
      windStrengthRaw: {
        shape: "gridRows",
        book: "rr",
        printedPage: 319,
        locate: "Special Effect",
        column: { xMin: 60, xMax: 592 },
        labelMaxX: 199,
        rowTol: 5,
        rows: [
          { key: "still", labelRe: "still$", labelPattern: "spreadBand" },
          { key: "gentle", labelRe: "gentle$", labelPattern: "spreadBand" },
          { key: "moderate", labelRe: "moderate$", labelPattern: "spreadBand" },
          { key: "strong", labelRe: "strong$", labelPattern: "spreadBand" },
          { key: "veryStrong", labelRe: "very\\s*strong$", labelPattern: "spreadBand" },
          { key: "gale", labelRe: "gale$", labelPattern: "spreadBand" },
        ],
        cellColumns: [
          { key: "sail", x: 200, w: 62, pattern: "raw", row: true },
          { key: "oar", x: 264, w: 62, pattern: "raw", row: true },
          { key: "nextDay", x: 328, w: 60, pattern: "raw", row: true },
          { key: "special", x: 392, w: 200, pattern: "raw", row: true },
        ],
      },
      // The Navigation targets: a three-row sidebar grid beside the prose.
      navigationRaw: {
        shape: "gridRows",
        book: "rr",
        printedPage: 320,
        locate: "Staying on Course",
        column: { xMin: 130, xMax: 300 },
        labelMaxX: 218,
        rowTol: 5,
        rows: [
          { key: "lakeOrRiver", labelRe: "^lake" },
          { key: "coast", labelRe: "^c\\s*oast$" },
          { key: "openSea", labelRe: "^o\\s*pen\\s*s\\s*ea$" },
        ],
        cellColumns: [{ key: "target", x: 219, w: 45, pattern: "raw", row: true }],
      },
      voyagesProse: {
        shape: "proseValues",
        book: "rr",
        valueBlocks: [
          {
            id: "shares",
            printedPage: 316,
            locate: "cannot deal damage to vessels",
            column: { xMin: 295, xMax: 592 },
            values: [
              { key: "sinkDice", find: "rounds. attacks by man-sized", before: true, span: 22, take: "window" },
              { key: "lightBallista", find: "light and medium ballistae deal", take: "window", span: 16 },
              { key: "heavyThird", find: "catapults deal", take: "window", span: 16 },
              { key: "spells", find: "spells deal", take: "window", span: 16 },
              { key: "aoeDivisor", find: "square footage /", take: "int" },
              { key: "berthStone", find: "passengers can be carried as cargo at a weight of", take: "int" },
            ],
          },
          {
            id: "tacking",
            printedPage: 318,
            locate: "tacking vessels are moving at",
            column: { xMin: 295, xMax: 592 },
            values: [
              { key: "tackRate", find: "tacking vessels are moving at", take: "window", span: 14 },
            ],
          },
          {
            id: "navigation",
            printedPage: 320,
            locate: "Staying on Course",
            column: { xMin: 40, xMax: 300 },
            values: [
              // One sentence prices both arts; the binding reads the two
              // bonuses out of the one window.
              { key: "oneArt", find: "or the navigation proficiency, the vessel", take: "window", span: 80 },
            ],
          },
          {
            id: "hazardThrow",
            printedPage: 320,
            locate: "Avoiding Nautical Hazards",
            column: { xMin: 40, xMax: 300 },
            values: [
              // The sentence carries the captain's target and the master
              // mariner's parenthetical together; both parse from it.
              { key: "captain", find: "seafaring proficiency throw", take: "window", span: 40 },
              { key: "halfSpeed", find: "moving at half speed", take: "window", span: 60 },
              { key: "shallowDraft", find: "galley or longship", take: "window", span: 60 },
            ],
          },
          {
            id: "repairRounding",
            printedPage: 322,
            locate: "cannot be healed, but they can be repaired",
            values: [
              { key: "repairCrew", find: "when a vessel is damaged, it takes", take: "window", span: 40 },
              { key: "seaHalf", find: "the crew can only repair", take: "window", span: 60 },
              { key: "roundVoyage", find: "round speed to the nearest", take: "window", span: 16 },
              { key: "roundCombat", find: "they reduce voyage speed, rounded to the nearest", take: "window", span: 14 },
            ],
          },
          {
            id: "hazardEffects",
            printedPage: 320,
            locate: "Avoiding Nautical Hazards",
            values: [
              { key: "kelpFree", find: "disentangling the vessel requires", take: "window", span: 60 },
              { key: "rockDamage", find: "strikes the hazard below the waterline and suffers", take: "window", span: 20 },
              { key: "shoalDamage", find: "runs aground and suffers", take: "window", span: 16 },
              { key: "refloat", find: "refloated by high tide in", take: "window", span: 16 },
              { key: "lighten", find: "lightening the load grants a", take: "window", span: 30 },
              { key: "lightenStone", find: "vessel escapes for every", take: "window", span: 30 },
              { key: "unloadStone", find: "crew member can unload", take: "window", span: 30 },
            ],
          },
        ],
      },
    },
  },
  // The daily weather generator's pages: the JJ's Daily Weather bands and
  // climate/season modifier grid, and the RR's condition factors and mud/snow
  // thresholds (prose). Raw reads only; weather-binding.mjs assembles the
  // engine-shaped tables acks-extras declares on the `weather` document.
  weather: {
    source: { book: "ACKS II Judges Journal + Revised Rulebook", pages: "JJ 39-41; RR 277-279" },
    tables: {
      // 27 modifier rows × four axis cells; a dash means the column does not
      // reach that modifier. Band words parse to keys in the binding.
      dailyWeatherRaw: {
        shape: "gridRows",
        book: "jj",
        printedPage: 39,
        locate: "Daily Weather Table",
        column: { xMin: 60, xMax: 590 },
        labelMaxX: 145,
        rows: [
          { key: "-7", labelRe: "^-7\\s*or\\s*less$" },
          ...[-6, -5, -4, -3, -2, -1].map((n) => ({ key: String(n), labelRe: `^${n}$` })),
          ...Array.from({ length: 19 }, (_, n) => ({ key: String(n), labelRe: `^${n}$` })),
          { key: "19", labelRe: "^19\\s*or\\s*more$" },
        ],
        cellColumns: [
          { key: "tempLow", x: 152, w: 120, pattern: "raw", row: true },
          { key: "tempHigh", x: 276, w: 128, pattern: "raw", row: true },
          { key: "precipitation", x: 408, w: 70, pattern: "raw", row: true },
          { key: "wind", x: 481, w: 95, pattern: "raw", row: true },
        ],
      },
      // 30 Köppen rows × four season cells, each a compound
      // "T +3 (day), +0 (night), P -3, W +2" kept raw for the binding.
      // The table's own TITLE also appears in the facing page's prose ("…
      // table, opposite") over the Climate by Terrain grid, whose rows carry
      // the same codes — so the anchor is the polar rows' "(day and night)"
      // phrasing, which only the modifier table prints.
      climateModifiersRaw: {
        shape: "gridRows",
        book: "jj",
        printedPage: 41,
        locate: "(day and night)",
        column: { xMin: 70, xMax: 580 },
        labelMaxX: 112,
        rows: [
          "Af", "Am", "Aw", "As", "BWh", "BWk", "BSh", "BSk",
          "Csa", "Csb", "Csc", "Cwa", "Cwb", "Cwc", "Cfa", "Cfb", "Cfc",
          "Dsa", "Dsb", "Dsc", "Dwa", "Dwb", "Dwc", "Dwd", "Dfa", "Dfb", "Dfc", "Dfd",
          "ET", "EF",
        ].map((code) => ({ key: code, labelRe: `^${code.toLowerCase()}$` })),
        cellColumns: [
          { key: "winter", x: 117, w: 110, pattern: "raw", row: true },
          { key: "spring", x: 230, w: 110, pattern: "raw", row: true },
          { key: "summer", x: 344, w: 110, pattern: "raw", row: true },
          { key: "fall", x: 457, w: 115, pattern: "raw", row: true },
        ],
      },
      // Each condition's speed sentence, captured as a short window; the
      // binding maps the printed word to a factor. Anchors carry no values.
      conditionProse: {
        shape: "proseValues",
        book: "rr",
        valueBlocks: [
          {
            id: "p277",
            printedPage: 277,
            locate: "in frigid temperature have their expedition speed",
            values: [
              { key: "frigid", find: "in frigid temperature have their expedition speed", take: "window", span: 30 },
              { key: "sweltering", find: "in sweltering weather have their expedition speed", take: "window", span: 30 },
            ],
          },
          {
            id: "p278",
            printedPage: 278,
            locate: "in foggy conditions have their speeds",
            values: [
              { key: "foggy", find: "in foggy conditions have their speeds", take: "window", span: 30 },
              { key: "snowy", find: "in snowy weather have their speed", take: "window", span: 30 },
            ],
          },
          {
            id: "p279",
            printedPage: 279,
            locate: "in stormy conditions have their expedition speed",
            values: [
              { key: "stormy", find: "in stormy conditions have their expedition speed", take: "window", span: 30 },
              { key: "windy", find: "in windy conditions have their expedition speed", take: "window", span: 30 },
              { key: "mud", find: "once mud forms, adventurers have their speeds", take: "window", span: 30 },
              { key: "snowGround", find: "once snow accumulates, adventurers have their speeds", take: "window", span: 30 },
            ],
          },
        ],
      },
      // The Mud and Snow paragraph's thresholds, one window per clause; the
      // binding reads the day counts out of each.
      accumulationProse: {
        shape: "proseValues",
        book: "rr",
        printedPage: 279,
        locate: "Mud accumulates after",
        values: [
          { key: "mudForm", find: "mud accumulates after", take: "window", span: 150 },
          { key: "mudDry", find: "mud dries in", take: "window", span: 170 },
          { key: "snowForm", find: "snow accumulates after", take: "window", span: 120 },
          { key: "snowMelt", find: "snow melts in", take: "window", span: 120 },
        ],
      },
    },
  },
  equipment: {
    source: { book: "ACKS II Revised Rulebook", pages: "160" },
    tables: {
      scavengedPiercingSlashing: scavengedGrid({
        locate: "Piercing/Slashing Weapons",
        column: { xMin: 40, xMax: 300 },
        labelMaxX: 78,
        cells: [
          { key: "category", x: 83, w: 80, row: true },
          { key: "effect", x: 165, w: 80, row: true },
          { key: "value", x: 245, w: 50, row: true },
        ],
      }),
      scavengedBludgeoning: scavengedGrid({
        locate: "Bludgeoning Weapons",
        column: { xMin: 300, xMax: 620 },
        labelMaxX: 334,
        cells: [
          { key: "category", x: 339, w: 80, row: true },
          { key: "effect", x: 420, w: 80, row: true },
          { key: "value", x: 500, w: 50, row: true },
        ],
      }),
      scavengedArmorEquipment: scavengedGrid({
        locate: "Armor and Equipment",
        column: { xMin: 40, xMax: 300 },
        labelMaxX: 78,
        cells: [
          { key: "category", x: 83, w: 70, row: true },
          { key: "effect", x: 155, w: 88, row: true },
          { key: "value", x: 245, w: 50, row: true },
        ],
      }),
      scavengedVesselsVehicles: scavengedGrid({
        locate: "Vessels and Vehicles",
        column: { xMin: 300, xMax: 620 },
        labelMaxX: 334,
        cells: [
          { key: "category", x: 339, w: 80, row: true },
          { key: "effect", x: 420, w: 80, row: true },
          { key: "value", x: 500, w: 50, row: true },
        ],
      }),
    },
  },
  rarity: {
    source: { book: "ACKS II Judges Journal", pages: "118-119, 259" },
    tables: {
      // JJ ~118 prints TWO rarity tables: "Class Rarity" (left column) and
      // "Henchmen Rarity by Class" (right column), which assign different
      // tiers. This is the former — the one the Judge's Screen reprinted and
      // the one that has always shipped as `variants.default`. The other is a
      // candidate second variant, and would need its own recipe.
      classRarityTables: {
        shape: "pairs",
        book: "jj",
        printedPage: 118,
        locate: "Class Rarity",
        column: { xMin: 40, xMax: 300 },
        // The JJ sets its table headers in small caps, so "Classes" reaches the
        // text layer as "c" + "lasses"; the marker has to be the second run.
        startAfter: "lasses",
        labelMaxX: 120,
        cellPattern: "refListLower",
        // Same small caps inside the cells: without a gap-aware join the class
        // list reads "dwarvencraftpriest" (see joinRuns).
        joinGap: 1,
        rows: RARITY_TIER_ROWS,
        emit: {
          path: ["variants", "default", "tiers"],
          merge: { variants: { default: { label: "ACKS-HENCHMEN.rarityTable.default" } } },
        },
      },
      rarityAvailability: {
        shape: "gridRows",
        book: "jj",
        printedPage: 118,
        locate: "2d8",
        labelMaxX: 135,
        minCells: 4,
        marketCells: 6,
        cellPattern: "raw",
        rows: RARITY_TIER_ROWS,
        emit: { container: "rows", keyField: "rarity" },
      },
      // Directed-search rarity modifiers (JJ ~119, all prose): the general-
      // proficiency ranks ladder, its 1d4 level die, the class-proficiency
      // per-rank rule, and the per-level shift. Anchors carry no values.
      specificQualificationMods: {
        shape: "proseValues",
        book: "jj",
        printedPage: 119,
        locate: "a single rank in a specific general proficiency",
        locateBare: true,
        values: [
          { key: "gpRank1", find: "a single rank in a specific general proficiency are", take: "rarityTier" },
          { key: "gpRank2", find: "with two ranks are", take: "rarityTier" },
          { key: "gpRank3", find: "with three ranks are", take: "rarityTier" },
          { key: "gpLevelDie", find: "ranks are uncommon. roll", take: "dice" },
          { key: "gpZeroBand", find: "for each such henchman; on a", take: "band" },
          { key: "gpRollLevelOn", find: "level. on a", take: "int" },
          { key: "gpClassVIPenalty", find: "class vi market, apply a", take: "signedInt" },
          { key: "cpPerRank", find: "is equal to the base class, plus", take: "wordInt" },
          { key: "levelPerAbove1", find: "shift the rarity by", take: "wordInt" },
        ],
      },
      randomHenchmanLevel: {
        shape: "pairs",
        book: "jj",
        printedPage: 118,
        locate: "Random Henchman Level",
        // Right print column of the same spread. The rarity variant table above
        // it reaches into this window, but none of its rows can match a roll
        // band, so the label patterns are the only bound needed.
        column: { xMin: 440, xMax: 620 },
        labelMaxX: 510,
        cellPattern: "int",
        valueKey: "level",
        rows: [
          { key: 0, labelRe: "lower", labelPattern: "rollBand" },
          { key: 1, labelRe: "^11", labelPattern: "rollBand" },
          { key: 2, labelRe: "^17", labelPattern: "rollBand" },
          { key: 3, labelRe: "^19", labelPattern: "rollBand" },
        ],
        emit: { container: "rows", merge: { formula: "1d20" } },
      },
      // The screen called this "Leveled Henchman Class"; the JJ prints the same
      // double-d100 grid as "NPC Class" in its people chapter (~259).
      classDistribution: {
        shape: "bandGrid",
        book: "jj",
        printedPage: 259,
        locate: "NPC Class",
        column: { xMin: 60, xMax: 600 },
        labelMaxX: 130,
        // Cells run wide here (a full "dwarven vaultguard" spans ~40pt), so the
        // column anchors sit at each cell's CENTRE with a tolerance to match.
        columnTol: 25,
        // "1d100" alone would match the prose above the table that tells the
        // reader to roll it; the header's own run is the whole "1d100×100".
        headerMark: "1d100×100",
        joinGap: 1,
        cellColumns: [
          { key: "arcane", x: 156 },
          { key: "thief", x: 251 },
          { key: "divine", x: 331 },
          { key: "fighter", x: 416 },
          { key: "explorer", x: 487 },
          { key: "venturer", x: 531 },
        ],
        rows: [
          { key: 0, labelRe: "^1\\s*[-–]\\s*40" },
          { key: 1, labelRe: "^41" },
          { key: 2, labelRe: "^61" },
          { key: 3, labelRe: "^81" },
          { key: 4, labelRe: "^91\\s*[-–]\\s*94" },
          { key: 5, labelRe: "^95" },
          { key: 6, labelRe: "^97" },
          { key: 7, labelRe: "^99" },
        ],
      },
    },
  },
  wages: {
    source: { book: "ACKS II Revised Rulebook", pages: "108, 162-171" },
    tables: {
      henchmanWageByLevel: {
        shape: "pairs",
        book: "rr",
        printedPage: 168,
        locate: "Henchmen Monthly Wage",
        cellPattern: "int",
        // Two side-by-side ladder halves; the facing column's prose sits
        // right of x~300 and is excluded by the part bounds.
        parts: [
          { column: { xMin: 50, xMax: 168 }, labelMaxX: 100, rows: [0,1,2,3,4,5,6,7].map((L) => ({ key: String(L), labelRe: `^${L}$` })) },
          { column: { xMin: 170, xMax: 300 }, labelMaxX: 215, rows: [8,9,10,11,12,13,14].map((L) => ({ key: String(L), labelRe: `^${L}$` })) },
        ],
        emit: { wrap: "byLevel" },
      },
      // Signing bonus ladders: which span of pay buys +1/+2/+3 on the hiring
      // reaction roll. The Judge's Screen tabulated both in one grid; the books
      // print them as PROSE, in two different places — the base ladder with the
      // hiring rules (RR ~162) and the cheaper Bribing-proficient one in that
      // proficiency's own entry (RR ~108) — so each ladder locates its own page
      // and the two are reassembled into the shape the reference already had.
      signingBonus: {
        shape: "proseValues",
        book: "rr",
        valueBlocks: [
          {
            id: "proficient",
            printedPage: 108,
            locate: "bonus to reaction rolls if he offers one",
            values: [
              { key: "1", find: "reaction rolls if he offers one", take: "wagePeriod" },
              { key: "2", find: "pay for the target; a +2 bonus for a", take: "wagePeriod" },
              { key: "3", find: "pay; and a +3 bonus for a", take: "wagePeriod" },
            ],
          },
          {
            id: "nonProficient",
            printedPage: 162,
            locate: "signing bonus worth one",
            values: [
              { key: "1", find: "signing bonus worth one", take: "wagePeriod" },
              { key: "2", find: "grants a +1 bonus; a", take: "wagePeriod" },
              { key: "3", find: "provides a +2 bonus, and a", take: "wagePeriod" },
            ],
          },
        ],
      },
      // Hireling base morale by role (RR ~166, all prose): specialists
      // default, the named exception groups, spellcaster minimum, the
      // first-level permanent bonus, and the crusader/bladedancer follower
      // score. Which specialist TYPE keys map to which group is consumer
      // code (type-key glue), not page data.
      baseMorale: {
        shape: "proseValues",
        book: "rr",
        printedPage: 166,
        locate: "but rowers and sailors have morale",
        locateBare: true,
        values: [
          { key: "specialistDefault", find: "most specialists have a morale score of", take: "signedInt" },
          { key: "rowersSailors", find: "rowers and sailors have morale of", take: "signedInt" },
          { key: "navigatorsCaptainsScouts", find: "captains, and scouts have morale", take: "signedInt" },
          { key: "marshalsMastersOfficers", find: "mercenary officers have morale", take: "signedInt" },
          { key: "spellcasterMinimum", find: "their minimum morale score is", take: "signedInt" },
          { key: "firstLevelBonus", find: "bonus to morale score when a 0", before: true, span: 24, take: "signedInt" },
          { key: "followerCrusaderBladedancer", find: "followers have a morale score of", take: "signedInt" },
        ],
      },
      // Mercenary-officer base loyalty (RR ~171 prose).
      baseLoyalty: {
        shape: "proseValues",
        book: "rr",
        printedPage: 171,
        locate: "inherent disloyalty",
        locateBare: true,
        values: [{ key: "mercenaryOfficers", find: "officers have a base loyalty of", take: "signedInt" }],
      },
      mercenaryWages: {
        shape: "gridRows",
        book: "rr",
        printedPage: 169,
        locate: "Gp Wage per Month",
        labelMaxX: 385,
        cellColumns: [
          { key: "man", x: 393 },
          { key: "dwarf", x: 422 },
          { key: "elf", x: 450 },
          { key: "goblin", x: 480 },
          { key: "orc", x: 510 },
          { key: "morale", x: 542, row: true },
        ],
        cellsKey: "wages",
        cellPattern: "intDash",
        omitNullCells: true,
        rows: MERC_WAGE_ROWS,
        emit: { container: "rows", keyField: "type" },
      },
    },
  },
  people: {
    source: { book: "ACKS II Judges Journal", pages: "245-257" },
    tables: {
      classPercentages: {
        shape: "gridRows",
        book: "jj",
        printedPage: 247,
        locate: "Leveled NPCs by Percentage",
        labelMaxX: 160,
        cellKeys: ["fighter", "crusader", "thief", "mage", "explorer", "venturer"],
        cellsKey: "weights",
        cellPattern: "int",
        rows: CLASS_PCT_ROWS,
        emit: { container: "rows" },
      },
      // The RAW occupant system (JJ ~229): WHICH occupant a d100 finds, per
      // building type, with routing to the occupation sub-tables — bands and
      // routing text all read from the page.
      occupationTypes: {
        shape: "gridRows",
        book: "jj",
        printedPage: 229,
        locate: "01-48",
        labelMaxX: 160,
        cellPattern: "rollBand",
        omitNullCells: true,
        cellColumns: [
          { key: "smallCot", x: 168, pattern: "rollBand" },
          { key: "mediumCot", x: 205, pattern: "rollBand" },
          { key: "mediumTownhouse", x: 251, pattern: "rollBand" },
          { key: "largeTownhouse", x: 304, pattern: "rollBand" },
          { key: "generalStreet", x: 352, pattern: "rollBand" },
          { key: "resolve", x: 382, w: 110, pattern: "raw", row: true },
          { key: "special", x: 495, w: 90, pattern: "dashNull", row: true },
        ],
        cellsKey: "bands",
        rows: [
          { key: "laborer", labelRe: "^laborer$" },
          { key: "apprenticeCrafter", labelRe: "^apprentice\\s*crafter" },
          { key: "journeymanCrafter", labelRe: "^journeyman" },
          { key: "masterCrafter", labelRe: "^master\\s*crafter" },
          { key: "apprenticeMerchant", labelRe: "^apprentice\\s*merchant" },
          { key: "licensedMerchant", labelRe: "^licensed" },
          { key: "masterMerchant", labelRe: "^master\\s*merchant" },
          { key: "specialist", labelRe: "^specialist" },
          { key: "hosteller", labelRe: "^hosteller" },
          { key: "entertainer", labelRe: "^entertainer" },
          { key: "thief", labelRe: "^thief" },
          { key: "legionary", labelRe: "^legionary" },
          { key: "mercenary", labelRe: "^mercenary" },
          { key: "fighter", labelRe: "^fighter$" },
          { key: "minorEcclesiastic", labelRe: "^minor\\s*ecclesiastic" },
          { key: "crusader", labelRe: "^crusader" },
          { key: "minorMagician", labelRe: "^minor\\s*magician" },
        ],
        emit: { container: "rows", keyField: "type" },
      },
      // Per-category occupation sub-tables (d100 band → occupation, with the
      // book's own special notes like "25% are mages"). Self-locating like
      // culture blocks; each stitches reading order for long lists (artisan).
      // Every window below is page geometry read off the printings: the JJ
      // mixes half-page pairs (p~229), four quarter tables, and full-width
      // tables whose Mercantile Interest notes wrap (merchant, artisan).
      occupationSubTables: {
        shape: "bandList",
        book: "jj",
        subTables: [
          { id: "laborer", printedPage: 229, anchor: "Laborer Occupation", window: [60, 300], bandWindow: [75, 115], occWindow: [115, 232], specialWindow: [232, 300] },
          { id: "specialist", printedPage: 229, locate: "animal trainer (Wild)", anchor: "Specialist Occupation", window: [300, 585], bandWindow: [330, 365], occWindow: [365, 460], specialWindow: [460, 585] },
          { id: "mercenary", printedPage: 230, locate: "Bowman/slinger", anchor: "Mercenary Occupation", window: [30, 156], bandWindow: [40, 80], occWindow: [80, 156], specialWindow: [156, 157] },
          { id: "entertainer", printedPage: 230, locate: "actor (Journeyman)", anchor: "Entertainer Occupation", window: [156, 289], bandWindow: [163, 204], occWindow: [204, 289], specialWindow: [289, 290] },
          { id: "ecclesiastic", printedPage: 230, locate: "Almsgiver", anchor: "Ecclesiastic Occupation", window: [289, 425], bandWindow: [296, 337], occWindow: [337, 425], specialWindow: [425, 426] },
          { id: "magician", printedPage: 230, anchor: "Magician Occupation", window: [425, 565], bandWindow: [432, 473], occWindow: [473, 565], specialWindow: [565, 566] },
          { id: "merchant", printedPage: 230, locate: "Mercantile Interest", anchor: "Merchant Occupation", window: [40, 585], bandWindow: [50, 97], occWindow: [97, 196], specialWindow: [196, 585] },
          { id: "artisan", printedPage: 231, locate: "Wheelwright", anchor: "Artisan Occupation", window: [40, 585], bandWindow: [75, 122], occWindow: [122, 224], specialWindow: [224, 585] },
          // No hosteller d100 sub-table exists in the printing — hosteller
          // occupants resolve by establishment ("inns are always owned by
          // innkeepers"); street draws reroll them like class-routed rows.
        ],
      },
      // 0th-level occupation → proficiency packages (JJ "Occupations and
      // Proficiencies", four consecutive pages). Row keys are page content
      // (occupation names, lowercased); values are comma token lists like
      // "Profession (merchant), Craft (scribe), Bargaining, Folkways".
      occupationPackages: {
        shape: "harvestPairs",
        book: "jj",
        printedPage: 254,
        locate: "Blacksmith",
        pageSpan: 5,
        column: { xMin: 40, xMax: 545 },
        labelMaxX: 130,
        minTokens: 2,
      },
      // Culture APPEARANCE palettes (RR "People of Aurëpos"): each culture's
      // description states its hair and eye colours in a formulaic sentence
      // ("Tirenean hair is straight or wavy, and colored …"). Blocks locate
      // their own page; the anchor phrase names the culture, so a page
      // carrying several cultures cannot cross-match. Where the book writes
      // "Their hair is…", the block disambiguates by reading-order
      // occurrence — page structure, never a value.
      cultureAppearance: {
        shape: "proseValues",
        book: "rr",
        valueBlocks: CULTURE_APPEARANCE_BLOCKS,
        emit: { path: ["cultures"] },
      },
      // Per-class RESTRICTIONS from the class descriptions' opening lines
      // ("Bladedancers are human women who…"). Each block self-locates its
      // class page; the capture reads the restriction word, never a list of
      // classes. bucket/rarity/race are DERIVED by consumers from the
      // already-imported distribution/rarity tables + class-key adjectives,
      // so they need no recipe here.
      classRestrictions: {
        shape: "proseValues",
        book: "rr",
        valueBlocks: [
          { id: "bladedancer", printedPage: 56, locate: "Bladedancers are", values: [{ key: "sex", find: "bladedancers are human", take: "sexWord" }] },
          { id: "priestess", printedPage: 64, locate: "Priestesses are", values: [{ key: "sex", find: "priestesses are", take: "sexWord" }] },
          { id: "witch", printedPage: 76, locate: "witches, however, are", values: [{ key: "sex", find: "witches, however, are", take: "sexWord" }] },
          // NO warlock alignment: the RR states it CONDITIONALLY ("If
          // chaotic, the warlock can create necromantic servants") — the
          // class is not alignment-bound in this printing, so nothing is
          // extracted and the alignment-openness shift stays inert.
        ],
        emit: { path: ["classes"] },
      },
      // Culture name lists (RR "People of Aurëpos" + BTA for dwarves). Each
      // block is SELF-LOCATING: its anchor (the list's first male name — a
      // short-label page anchor) finds the page, the print column, and the
      // start row, so stacked two-column culture blocks never cross-match.
      // NAMES are extracted data; label/patronym-template/race are
      // structural assists; appearance PROSE is never touched.
      cultures: {
        shape: "nameList",
        book: "rr",
        fields: [
          { key: "male", label: "Male Names:" },
          { key: "female", label: "Female Names:" },
          { key: "surnames", label: "Surnames:" },
        ],
        blocks: [
          { cultureId: "auran", printedPage: 502, anchor: "Aurëus", meta: { label: "Tirenean (Auran)", surnameStyle: "hereditary" } },
          { cultureId: "celdorean", printedPage: 496, anchor: "Ardumanish", meta: { label: "Celdorean", patronym: { male: "{parent}apur", female: "{parent}adar" } } },
          { cultureId: "dwarven", book: "bta", printedPage: 21, anchor: "Arsic", meta: { label: "Dwarven (Meniri/Jutting)", surnameStyle: "hereditary", race: "dwarf" } },
          { cultureId: "elven", printedPage: 496, anchor: "Aodan", meta: { label: "Elven (Argollëan)", patronym: { male: "Mag {parent}", female: "Ni {parent}" }, race: "elf" } },
          { cultureId: "jutlandic", printedPage: 497, anchor: "Asmund", meta: { label: "Jutlandic", patronym: { male: "{parent}sson", female: "{parent}dottir" } } },
          { cultureId: "kemeshi", printedPage: 498, anchor: "Ankhopten", meta: { label: "Kemeshi" } },
          { cultureId: "krysean", printedPage: 498, anchor: "Aibekeres", meta: { label: "Krysean", patronym: { male: "{parent}", female: "{parent}" } } },
          { cultureId: "kushtu", printedPage: 498, anchor: "Abimbola", meta: { label: "Kushtu" } },
          { cultureId: "nicean", printedPage: 499, anchor: "Apollonis", meta: { label: "Nicean", patronym: { male: "{parent}ides", female: "{parent}ides" } } },
          { cultureId: "opelenean", printedPage: 499, anchor: "Abedsh", meta: { label: "Opelenean", patronym: { male: "Bar {parent}", female: "Bat {parent}" } } },
          { cultureId: "rornish", printedPage: 500, anchor: "Aeron", meta: { label: "Rornish", patronym: { male: "{parent}", female: "{parent}" } } },
          { cultureId: "shebatean", printedPage: 500, anchor: "Abaddon", meta: { label: "Shebatean", patronym: { male: "Ibn {parent}", female: "Bint {parent}" } } },
          { cultureId: "skysos", printedPage: 501, anchor: "Attila", meta: { label: "Skysos" } },
          { cultureId: "somirean", printedPage: 501, anchor: "Artashumara", meta: { label: "Somirean" } },
          { cultureId: "zaharan", printedPage: 503, anchor: "Ashurdan", meta: { label: "Zaharan", patronym: { male: "Bet-{parent}", female: "Bet-{parent}" }, race: "zaharan" } },
          { cultureId: "thrassian", printedPage: 502, anchor: "Akalamdug", meta: { label: "Thrassian", race: "thrassian" } },
        ],
      },
      // NPC minimum age by class group (JJ ~248): level rows × six labeled
      // trajectory columns. "44+" caps a column; "-" means the trajectory
      // never reaches that level. Which class keys map to which column is
      // consumer interpretation (henchmen), not page data.
      ageByClass: {
        shape: "gridRows",
        book: "jj",
        printedPage: 248,
        locate: "(carouser)",
        locateBare: true,
        labelMaxX: 90,
        minCells: 4,
        cellColumns: [
          { key: "noble", x: 117, pattern: "agePlus" , row: true },
          { key: "magistrate", x: 193, pattern: "agePlus" , row: true },
          { key: "commoner", x: 270, pattern: "agePlus" , row: true },
          { key: "crusader", x: 345, pattern: "agePlus" , row: true },
          { key: "mage", x: 421, pattern: "agePlus" , row: true },
          { key: "thief", x: 498, pattern: "agePlus" , row: true },
        ],
        rows: Array.from({ length: 15 }, (_, i) => ({ key: String(i), labelRe: `^${i}$`, set: { level: i } })),
        emit: { container: "rows", keyField: "level" },
      },
      // 0th-level general proficiency count by race and age band (JJ ~253).
      proficienciesByAge: {
        shape: "gridRows",
        book: "jj",
        printedPage: 253,
        locate: "121+",
        locateBare: true,
        column: { xMin: 40, xMax: 570 }, // page-margin tab letters live at ~x597
        labelMaxX: 125,
        minCells: 4,
        cellColumns: [
          { key: "human", x: 189, pattern: "ageBand" , row: true },
          { key: "dwarf", x: 270, pattern: "ageBand" , row: true },
          { key: "elf", x: 352, pattern: "ageBand" , row: true },
          { key: "nobiran", x: 434, pattern: "ageBand" , row: true },
          { key: "zaharan", x: 517, pattern: "ageBand" , row: true },
        ],
        rows: Array.from({ length: 8 }, (_, i) => ({ key: String(i + 1), labelRe: `^${i + 1}$`, set: { count: i + 1 } })),
        emit: { container: "rows", keyField: "count" },
      },
      // 0th-level NPC hit dice by race × station (JJ ~252).
      hd0: {
        shape: "gridRows",
        book: "jj",
        printedPage: 252,
        locate: "(1 hp)",
        locateBare: true,
        labelMaxX: 140,
        minCells: 3,
        cellColumns: [
          { key: "noncombatant", x: 140, w: 100, pattern: "hdCell" , row: true },
          { key: "commoner", x: 240, w: 90, pattern: "hdCell" , row: true },
          { key: "militia", x: 330, w: 115, pattern: "hdCell" , row: true },
          { key: "fighter1", x: 445, w: 115, pattern: "hdCell" , row: true },
        ],
        rows: [
          { key: "dwarf", labelRe: "^dwarf$" },
          { key: "elf", labelRe: "^elf$" },
          { key: "human", labelRe: "^human$" },
        ],
        emit: { container: "rows", keyField: "race" },
      },
      // BTA dwarven castes — the book states the caste split in prose, not a
      // grid. Anchors carry no values; percentages are read from the page.
      // The Oathsworn share is the book's own remainder (no printed figure).
      dwarvenCastes: {
        shape: "proseValues",
        book: "bta",
        printedPage: 21,
        locate: "of dwarves are Craftborn",
        locateBare: true,
        values: [
          { key: "highbornPct", find: "making up about", take: "pct" },
          { key: "craftbornPct", find: "of dwarves are craftborn", before: true, take: "pct", span: 30 },
          { key: "workbornPct", find: "largest caste", take: "pct" },
        ],
        emit: {
          path: [],
          merge: {
            oathswornPct: null, // remainder of 100 — computed by consumers, never printed
            order: ["highborn", "craftborn", "workborn", "oathsworn"],
            labels: { highborn: "Highborn", craftborn: "Craftborn", workborn: "Workborn", oathsworn: "Oathsworn" },
          },
        },
      },
    },
  },
  // Slavery (JJ ~409-410) — RAW values behind the henchmen `enableSlavery`
  // toggle. Import always materializes the doc; consumers gate USE by the
  // world setting. Common-slave economics are prose; troop prices are a grid.
  slavery: {
    source: { book: "ACKS II Judges Journal", pages: "409-410" },
    gatedBy: "enableSlavery",
    tables: {
      commonSlaves: {
        shape: "proseValues",
        book: "jj",
        printedPage: 409,
        locate: "laborers can be bought in markets",
        locateBare: true,
        values: [
          { key: "laborerCost", find: "slave laborers can be bought in markets at a cost of", take: "gp" },
          { key: "laborerUpkeep", find: "tasks. they cost", take: "gp" },
          { key: "laborerLoyalty", find: "base loyalty scores of", occurrence: 1, take: "signedInt" },
          { key: "laborerConstructionSp", find: "construction rate of", take: "sp" },
          { key: "laborersPerFamily", find: "treat every", take: "int" },
          { key: "domainMoralePct1", find: "population consists of", occurrence: 1, take: "pct" },
          { key: "domainMoralePenalty1", find: "morale is decreased by", occurrence: 1, take: "int" },
          { key: "domainMoralePct2", find: "population consists of", occurrence: 2, take: "pct" },
          { key: "domainMoralePenalty2", find: "morale is decreased by", occurrence: 2, take: "int" },
          { key: "domainMoralePct3", find: "if the domain is", take: "pct" },
          { key: "domainMoralePenalty3", find: "morale is decreased by", occurrence: 3, take: "int" },
          { key: "householdCost", find: "household slaves can be bought in markets at a cost of", take: "gp" },
          { key: "householdUpkeep", find: "each, and cost", take: "gp" },
          { key: "householdLoyalty", find: "base loyalty scores of", occurrence: 2, take: "signedInt" },
          { key: "pleasureCost", find: "pleasure slaves can be bought in markets at a cost of", take: "gpRange" },
          { key: "pleasureUpkeep", find: "pleasure slaves cost", take: "gp" },
          { key: "pleasureMorale", find: "base morale scores of", take: "signedInt" },
          { key: "professionalWageMult", find: "cost of a professional slave is equal to", take: "int" },
          { key: "professionalLess", find: "wages per month, less", take: "gp" },
          { key: "professionalUpkeep", find: "all professional slaves cost", take: "gp" },
          { key: "professionalLoyalty", find: "base loyalty scores of", occurrence: 3, take: "signedInt" },
          { key: "hirelingDisplacement", find: "slaves will replace", occurrence: 1, take: "pct2" },
        ],
      },
      // Slave troop purchase prices by race (JJ ~410) — sparse grid, dashes
      // where a race fields no such troops.
      slaveTroopCosts: {
        shape: "gridRows",
        book: "jj",
        printedPage: 410,
        locate: "19,750",
        locateBare: true,
        labelMaxX: 140,
        minCells: 6,
        cellPattern: "intDash",
        omitNullCells: true,
        cellsKey: "costs",
        cellColumns: [
          { key: "man", x: 152 },
          { key: "dwarf", x: 185 },
          { key: "elf", x: 217 },
          { key: "kobold", x: 253 },
          { key: "goblin", x: 287 },
          { key: "orc", x: 318 },
          { key: "hobgoblin", x: 356 },
          { key: "gnoll", x: 397 },
          { key: "lizardman", x: 438 },
          { key: "bugbear", x: 481 },
          { key: "ogre", x: 518 },
        ],
        rows: [
          { key: "militia", labelRe: "^militia$" },
          { key: "lightInfantry", labelRe: "^light\\s*infantry$" },
          { key: "heavyInfantry", labelRe: "^heavy\\s*infantry$" },
          { key: "slinger", labelRe: "^slinger$" },
          { key: "bowman", labelRe: "^bowman$" },
          { key: "crossbowman", labelRe: "^crossbowman$" },
          { key: "compositeLongbowman", labelRe: "^composite/?\\s*longbowman$" },
          { key: "lightCavalry", labelRe: "^light\\s*cavalry$" },
          { key: "horseArcher", labelRe: "^horse\\s*archers?$" },
          { key: "mediumCavalry", labelRe: "^medium\\s*cavalry$" },
          { key: "heavyCavalry", labelRe: "^heavy\\s*cavalry$" },
          { key: "cataphractCavalry", labelRe: "^cataphract\\s*cavalry$" },
          { key: "camelArcher", labelRe: "^camel\\s*archers?$" },
          { key: "camelLancer", labelRe: "^camel\\s*lancers?$" },
          { key: "warElephant", labelRe: "^war\\s*elephants?$" },
          { key: "mountedCrossbowman", labelRe: "^mounted\\s*crossbowman$" },
          { key: "beastRider", labelRe: "^beast\\s*riders?$" },
        ],
        emit: { container: "rows", keyField: "type" },
      },
      // Slave MORALE/LOYALTY (JJ ~410 prose, one page): how the slave came
      // into servitude sets loyalty, and the liberation rule.
      slaveLoyalty: {
        shape: "proseValues",
        book: "jj",
        printedPage: 410,
        locate: "enslaved as adults have loyalty scores",
        locateBare: true,
        column: { xMin: 25, xMax: 590 },
        values: [
          { key: "enslavedAsAdult", find: "enslaved as adults have loyalty scores of", take: "signedInt" },
          { key: "trainerBonus", find: "they receive a permanent", take: "signedInt" },
          { key: "liberatedFanaticLoyalty", find: "have a base loyalty of", take: "signedInt" },
          { key: "liberatedUpkeep", find: "paid their basic upkeep", take: "gp" },
        ],
      },
      // Slave-soldier upkeep and indoctrination costs (JJ ~410 prose).
      // Acquisition pipelines (own-realm levies, war captives) are realm play
      // and stay book-gated prose.
      soldierRules: {
        shape: "proseValues",
        book: "jj",
        printedPage: 409,
        locate: "Availability of Slave Soldiers",
        locateBare: true,
        pageSpan: 2, // displacement is stated beside common slaves; upkeep/indoctrination overleaf
        values: [
          { key: "upkeep", find: "slave soldiers cost", take: "gp" },
          { key: "ogreUpkeep", find: "(ogres cost", take: "gp" },
          { key: "mercenaryDisplacement", find: "slave soldiers will replace", take: "pct2" },
          { key: "indoctrinationYears", find: "require a", take: "wordInt" },
          { key: "indoctrinationUpkeep", find: "in upkeep per candidate", before: true, take: "gp" },
          { key: "marshalWage", find: "one marshal (", take: "gp" },
          { key: "marshalPer", find: "is required per", take: "int" },
        ],
      },
    },
  },
  // Settlement market class by urban families (RR "Villages, Towns, and
  // Cities", ~352): the label carries the families band, the class column
  // the market class. Monthly-income column is domain revenue — not
  // extracted here (domain-module scope).
  settlement: {
    source: { book: "ACKS II Revised Rulebook", pages: "352" },
    tables: {
      marketClassByFamilies: {
        shape: "pairs",
        book: "rr",
        printedPage: 352,
        locate: "Metropolis (40,000+)",
        locateBare: true,
        column: { xMin: 300, xMax: 585 },
        labelMaxX: 415,
        cellPattern: "romanClass",
        valueKey: "marketClass",
        rows: [
          { key: "smallVillage", labelRe: "^small\\s*village", labelPattern: "familiesBand" },
          { key: "village1", labelRe: "^village\\s*\\(100", labelPattern: "familiesBand" },
          { key: "village2", labelRe: "^village\\s*\\(160", labelPattern: "familiesBand" },
          { key: "largeVillage", labelRe: "^large\\s*village", labelPattern: "familiesBand" },
          { key: "smallTown", labelRe: "^small\\s*town", labelPattern: "familiesBand" },
          { key: "largeTown", labelRe: "^large\\s*town", labelPattern: "familiesBand" },
          { key: "smallCity", labelRe: "^small\\s*city", labelPattern: "familiesBand" },
          { key: "city", labelRe: "^city\\s*\\(", labelPattern: "familiesBand" },
          { key: "largeCity1", labelRe: "^large\\s*city\\s*\\(5,000", labelPattern: "familiesBand" },
          { key: "largeCity2", labelRe: "^large\\s*city\\s*\\(10,000", labelPattern: "familiesBand" },
          { key: "largeCity3", labelRe: "^large\\s*city\\s*\\(15,000", labelPattern: "familiesBand" },
          { key: "metropolis1", labelRe: "^metropolis\\s*\\(20,000", labelPattern: "familiesBand" },
          { key: "metropolis2", labelRe: "^metropolis\\s*\\(40,000", labelPattern: "familiesBand" },
        ],
        emit: { container: "rows", keyField: "label" },
      },
    },
  },
  availability: {
    source: { book: "ACKS II Revised Rulebook", pages: "124, 162-165, 172" },
    tables: {
      equipmentAvailability: {
        shape: "gridRows",
        book: "rr",
        printedPage: 124,
        locate: "1gp or less",
        labelMaxX: 140,
        marketCells: 6,
        cellPattern: "raw",
        rows: EQUIP_AVAIL_ROWS,
        emit: { container: "rows", keyField: "band" },
      },
      searchFees: {
        shape: "pairs",
        book: "rr",
        printedPage: 162,
        locate: "1d6+15gp",
        column: { xMin: 50, xMax: 290 },
        labelMaxX: 95,
        cellPattern: "diceFormula",
        rows: [
          { key: "1", labelRe: "^I$" },
          { key: "2", labelRe: "^II$" },
          { key: "3", labelRe: "^III$" },
          { key: "4", labelRe: "^IV$" },
          { key: "5", labelRe: "^V$" },
          { key: "6", labelRe: "^VI$" },
        ],
        emit: { wrap: "byMarketClass" },
      },
      specialistAvailability: {
        shape: "gridRows",
        book: "rr",
        printedPage: 165,
        locate: "Artisan (common)",
        labelMaxX: 235,
        marketCells: 6,
        cellPattern: "raw",
        trailing: [{ key: "wage", pattern: "gpPerUnit", expand: true }],
        rows: SPECIALIST_ROWS,
        emit: { container: "rows", keyField: "type" },
      },
      henchmanAvailability: {
        shape: "gridRows",
        book: "rr",
        printedPage: 164,
        locate: "Hireling (Henchmen) Availability by Market Class",
        labelMaxX: 120,
        marketCells: 6,
        cellPattern: "raw",
        trailing: [{ key: "wage", pattern: "int" }],
        rows: HENCH_ROWS,
        emit: { container: "rows", keyField: "level" },
      },
      mercenaryAvailability: {
        shape: "gridRows",
        book: "rr",
        printedPage: 164,
        locate: "Hireling (Mercenary) Availability by Market Class",
        labelMaxX: 150,
        marketCells: 6,
        cellPattern: "raw",
        rows: MERC_ROWS,
        emit: { container: "rows", keyField: "type" },
      },
    },
  },
  // Construction projects (RR §IV.11): worker construction and wage rates —
  // what an item commission costs and how fast it builds. Money cells stay
  // raw ("10gp / 15gp†"); the consumer parses the primary variant. The
  // small-caps face fuses label words ("Mastercraftsman"), so labels match
  // with optional whitespace.
  construction: {
    source: { book: "ACKS II Revised Rulebook", pages: "174" },
    tables: {
      wageAndConstructionRates: {
        shape: "gridRows",
        book: "rr",
        printedPage: 174,
        locate: "Wage and Construction Rates",
        startAfter: "Worker",
        labelMaxX: 240,
        cellColumns: [
          { key: "ratePerMonth", x: 249, w: 55, row: true, pattern: "raw" },
          { key: "ratePerDay", x: 348, w: 60, row: true, pattern: "raw" },
          { key: "wagePerMonth", x: 445, w: 40, row: true, pattern: "raw" },
        ],
        rows: [
          { key: "unskilledLaborer", labelRe: "^unskilled\\s*laborer" },
          { key: "skilledLaborer", labelRe: "^skilled\\s*laborer" },
          { key: "apprenticeCraftsman", labelRe: "^apprentice\\s*c?raftsman|^apprenticec" },
          { key: "journeymanCraftsman", labelRe: "^journeyman\\s*c?raftsman|^journeymanc" },
          { key: "masterCraftsman", labelRe: "^master\\s*c?raftsman|^masterc" },
          { key: "masterCrew", labelRe: "^master,\\s*2" },
          { key: "siegeEngineer", labelRe: "^siege\\s*engineer" },
          { key: "engineer", labelRe: "^engineer" },
        ],
        emit: { container: "rows", keyField: "worker" },
      },
    },
  },
  // Magic-item market (JJ ch. 4): monthly buyers/sellers by item price and
  // market class — the same six cost bands as the RR equipment grid, so the
  // row list is shared. acks-extras markets prices magic trades on it.
  magicItems: {
    source: { book: "ACKS II Judges Journal", pages: "131" },
    tables: {
      transactionsByMarketClass: {
        shape: "gridRows",
        book: "jj",
        printedPage: 131,
        locate: "Magic Item Price",
        labelMaxX: 200,
        marketCells: 6,
        cellPattern: "raw",
        rows: EQUIP_AVAIL_ROWS,
        emit: { container: "rows", keyField: "band" },
      },
    },
  },
  // Mercantile-venture merchandise (RR ch. 8): the 29-type Common and
  // Precious Merchandise grid. acks-extras markets reads pricePerStone /
  // priceStep for demand-step pricing; the daily-stones grid rides along for
  // the future arbitrage loop.
  mercantile: {
    source: { book: "ACKS II Revised Rulebook", pages: "370, 374-375" },
    tables: {
      // Market Characteristics (RR ch. 8): per-class baselines — cargo,
      // toll, tariff, consignments, passengers. Money/dice cells stay raw
      // ("0.2cp/st", "2d6+1 × 10", "none"); the consumer parses.
      marketCharacteristics: {
        shape: "gridRows",
        book: "rr",
        printedPage: 370,
        locate: "Baseline Passengers",
        startAfter: "Baseline Passengers",
        labelMaxX: 110,
        cellColumns: [
          { key: "baselineCargo", x: 131, w: 42, row: true, pattern: "raw" },
          { key: "toll", x: 200, w: 42, row: true, pattern: "raw" },
          { key: "tariff", x: 272, w: 50, row: true, pattern: "raw" },
          { key: "consignments", x: 378, w: 32, row: true, pattern: "raw" },
          { key: "passengers", x: 470, w: 48, row: true, pattern: "raw" },
        ],
        rows: [
          { key: 1, labelRe: "^i$" },
          { key: 2, labelRe: "^ii$" },
          { key: 3, labelRe: "^iii$" },
          { key: 4, labelRe: "^iv$" },
          { key: 5, labelRe: "^v$" },
          { key: 6, labelRe: "^vi$" },
        ],
        emit: { container: "rows", keyField: "marketClass" },
      },
      merchandiseTypes: {
        shape: "gridRows",
        book: "rr",
        printedPage: 374,
        // "Common and Precious Merchandise" appears in the preceding prose;
        // the monster-parts container run only exists on the table's page.
        locate: "Metamphorae",
        labelMaxX: 138,
        joinCellGap: 12,
        marketCells: 6,
        cellPattern: "raw",
        leading: [
          { key: "container", pattern: "raw" },
          { key: "pricePerStone", pattern: "num" },
          { key: "priceStep", pattern: "num" },
        ],
        rows: MERCH_ROWS,
        emit: { container: "rows", keyField: "type" },
      },
    },
  },
  // The printed hit-point numbers, owned by hitpoint-tables.mjs.
  hitPoints: HIT_POINTS_DOC,
  // The JJ custom-class builder. Raw per-table extractions — scripts/
  // builder-binding.mjs assembles them into the shape the acks-extras
  // builder engine consumes and re-imports the assembled doc, then
  // materializes race items and stamps the Ready-for-Play builds onto the
  // matching class documents.
  "acks.classBuilder": {
    source: { book: "ACKS II Judges Journal", pages: "291-303, 332-333" },
    tables: {
      basePoints: {
        shape: "proseValues",
        book: "jj",
        printedPage: 291,
        locate: "build points",
        values: [{ key: "basePoints", find: "allocating a total of", take: "int" }],
      },
      hdRaw: {
        shape: "gridRows",
        book: "jj",
        printedPage: 292,
        locate: "Mortal",
        column: { xMin: 40, xMax: 295 },
        labelMaxX: 80,
        rowTol: 4,
        minCells: 2,
        cellColumns: [
          { key: "die", x: 105, w: 45, row: true, pattern: "raw" },
          { key: "mortalWounds", x: 170, w: 40, row: true, pattern: "intDash" },
          { key: "cost", x: 230, w: 40, row: true, pattern: "int" },
        ],
        rows: HD_VALUE_ROWS,
      },
      fightingRaw: {
        shape: "gridRows",
        book: "jj",
        printedPage: 292,
        locate: "The table below summarizes",
        column: { xMin: 40, xMax: 590 },
        startAfter: "apability",
        labelMaxX: 80,
        rowTol: 4,
        minCells: 4,
        cellColumns: [
          { key: "style", x: 82, w: 53, row: true, pattern: "raw" },
          { key: "attack", x: 137, w: 66, row: true, pattern: "raw" },
          { key: "weapons", x: 205, w: 70, row: true, pattern: "raw" },
          { key: "armor", x: 276, w: 66, row: true, pattern: "raw" },
          { key: "styles", x: 348, row: true, pattern: "int" },
          { key: "damage", x: 381, w: 64, row: true, pattern: "raw" },
          { key: "cleaves", x: 445, w: 61, row: true, pattern: "raw" },
          { key: "cost", x: 508, w: 30, row: true, pattern: "int" },
        ],
        rows: FIGHTING_VALUE_ROWS,
      },
      thieveryRaw: {
        shape: "gridRows",
        book: "jj",
        printedPage: 294,
        locate: "The explorer traded all of its thief skills",
        column: { xMin: 300, xMax: 590 },
        labelMaxX: 345,
        rowTol: 4,
        minCells: 2,
        cellColumns: [
          { key: "skills", x: 388, w: 50, row: true, pattern: "raw" },
          { key: "cost", x: 468, w: 47, row: true, pattern: "int" },
        ],
        rows: VALUE_ROWS_4_TO_0,
      },
      divineRaw: {
        shape: "gridRows",
        book: "jj",
        printedPage: 294,
        locate: "noting down the appropriate powers",
        column: { xMin: 300, xMax: 590 },
        startAfter: "noting down the appropriate powers",
        labelMaxX: 345,
        rowTol: 4,
        minCells: 2,
        cellColumns: [
          { key: "power", x: 358, w: 75, row: true, pattern: "raw" },
          { key: "cost", x: 468, w: 47, row: true, pattern: "int" },
        ],
        rows: VALUE_ROWS_4_TO_0,
      },
      arcaneRaw: {
        shape: "gridRows",
        book: "jj",
        printedPage: 296,
        locate: "Arcane Value determines the extent",
        column: { xMin: 295, xMax: 590 },
        labelMaxX: 345,
        rowTol: 4,
        minCells: 2,
        cellColumns: [
          { key: "power", x: 358, w: 75, row: true, pattern: "raw" },
          { key: "cost", x: 478, w: 40, row: true, pattern: "int" },
        ],
        rows: VALUE_ROWS_4_TO_0,
      },
      divineSlots1: slotGrid({ page: 295, startAfter: "Divine 1 Power", side: "L" }),
      divineSlots2: slotGrid({ page: 295, startAfter: "Divine 2 Power", side: "R" }),
      divineSlots3: slotGrid({ page: 295, startAfter: "Divine 3 Power", side: "L" }),
      divineSlots4: slotGrid({ page: 295, startAfter: "Divine 4 Power", side: "R" }),
      arcaneSlots1: slotGrid({ page: 297, startAfter: "Arcane 1 Power", side: "L" }),
      arcaneSlots2: slotGrid({ page: 297, startAfter: "Arcane 2 Power", side: "R" }),
      arcaneSlots3: slotGrid({ page: 297, startAfter: "Arcane 3 Power", side: "L" }),
      arcaneSlots4: slotGrid({ page: 297, startAfter: "Arcane 4 Power", side: "R" }),
      arcaneDelayed1: slotGrid({ page: 298, startAfter: "Arcane 1 – Delayed", side: "L", verso: true }),
      arcaneDelayed2: slotGrid({ page: 298, startAfter: "Arcane 2 – Delayed", side: "R", verso: true }),
      arcaneDelayed3: slotGrid({ page: 298, startAfter: "Arcane 3 – Delayed", side: "L", verso: true }),
      savesRule: {
        shape: "proseValues",
        book: "jj",
        printedPage: 299,
        locate: "SAVING THROW",
        values: [
          { key: "precedence", find: "to appear in order on this list:", take: "phrase", span: 90 },
          { key: "mapping", find: "the core class which is associated with that category", take: "phrase", span: 130 },
        ],
      },
      // Printed in the saves section, because the rate keys on the chassis —
      // but its subject is hit points, so it is read under its own name
      // (hitpoint-tables.mjs) rather than as two more values on savesRule.
      hpAfterNine: HP_AFTER_NINE_TABLE,
      xpRules: {
        shape: "proseValues",
        book: "jj",
        printedPage: 300,
        locate: "PER LEVEL",
        values: [
          { key: "crusaderThief", find: "crusader or thief: additional", take: "int" },
          { key: "fighter", find: "fighter: an additional", take: "int" },
          { key: "mage", find: "mage: an additional", take: "int" },
        ],
      },
      smoothing: {
        shape: "proseValues",
        book: "jj",
        printedPage: 301,
        locate: "Smoothing",
        values: [
          // A superscript "th" run interleaves into "…experience point [th]
          // requirement for 7 level…", so the anchor is the surviving half.
          { key: "level", find: "requirement for", take: "int" },
          { key: "nearest", find: "level to the nearest", take: "int" },
        ],
      },
      racialCaps: {
        shape: "gridRows",
        book: "jj",
        printedPage: 301,
        locate: "accompanying table",
        column: { xMin: 180, xMax: 300 },
        labelMaxX: 240,
        rowTol: 4,
        minCells: 1,
        cellColumns: [{ key: "maxLevel", x: 273, w: 20, row: true, pattern: "int" }],
        rows: [
          { key: "8", labelRe: "^8$" },
          { key: "7", labelRe: "^7$" },
          { key: "6", labelRe: "^6$" },
          { key: "5", labelRe: "^5$" },
          { key: "4", labelRe: "^4$" },
        ],
      },
      tradeoffPenalty: {
        shape: "proseValues",
        book: "jj",
        printedPage: 294,
        locate: "Experience Point Penalty",
        values: [{ key: "perPower", find: "cost of its fighting value by", take: "int" }],
      },
      tradeoffsRaw: {
        shape: "gridRows",
        book: "jj",
        printedPage: 293,
        locate: "Fighting Value Trade Offs",
        column: { xMin: 325, xMax: 600 },
        startAfter: "Benefit",
        labelMaxX: 505,
        rowTol: 4,
        minCells: 1,
        cellColumns: [{ key: "benefit", x: 505, w: 92, row: true, pattern: "raw" }],
        rows: TRADEOFF_ROWS,
      },
      dwarfRaw: {
        shape: "gridRows",
        book: "jj",
        printedPage: 302,
        locate: "Dwarf Value",
        column: { xMin: 295, xMax: 600 },
        labelMaxX: 340,
        rowTol: 4,
        minCells: 2,
        cellColumns: [
          { key: "label", x: 370, w: 90, row: true, pattern: "raw" },
          { key: "cost", x: 493, w: 32, row: true, pattern: "int" },
        ],
        rows: VALUE_ROWS_4_TO_0,
      },
      dwarfRules: {
        shape: "proseValues",
        book: "jj",
        printedPage: 302,
        locate: "DWARVEN CUSTOM",
        // Verso page: the right print column starts at x≈299, so the default
        // 300 split tears its sentences apart.
        colSplit: 295,
        values: [
          { key: "con", find: "require a minimum constitution", take: "int" },
          { key: "hpAfter9", find: "receive an extra", take: "int" },
          // Superscript "th" runs interleave into "…after 8 [th] by 10,000XP",
          // so the anchor stops at the printed 8; the two sentences (fighter,
          // then crusader/thief) disambiguate by occurrence.
          { key: "post8Fighter", find: "each level after 8", take: "int", span: 40 },
          { key: "post8CrusaderThief", find: "each level after 8", take: "int", span: 40, occurrence: 2 },
          { key: "sensitivityToRockAndStone", find: "sensitivity to rock and stone:", take: "window", span: 24 },
          { key: "dwarfTongues", find: "dwarf tongues:", take: "window", span: 24 },
          { key: "hardy", find: "hardy:", take: "window", span: 24 },
        ],
      },
      elfRaw: {
        shape: "gridRows",
        book: "jj",
        printedPage: 303,
        locate: "stack with points",
        column: { xMin: 320, xMax: 600 },
        labelMaxX: 365,
        rowTol: 4,
        minCells: 2,
        cellColumns: [
          { key: "label", x: 403, w: 92, row: true, pattern: "raw" },
          { key: "cost", x: 513, w: 35, row: true, pattern: "int" },
        ],
        rows: VALUE_ROWS_4_TO_0,
      },
      elfRules: {
        shape: "proseValues",
        book: "jj",
        printedPage: 303,
        locate: "stack with points",
        values: [
          { key: "stacksWithArcane", find: "stack with points allocated to the arcane value", take: "window", span: 24 },
          { key: "arcaneDiscount", find: "the xp cost for the arcane value is reduced by", take: "int" },
          // The superscript "th" splits "each level [th] after 8"; the first
          // "after 8" on the page is the section heading, so occurrence 2.
          { key: "post8", find: "after 8", take: "int", span: 40, occurrence: 2 },
          { key: "animalFriendship", find: "animal friendship:", take: "window", span: 24 },
          { key: "attunementToNature", find: "attunement to nature:", take: "window", span: 24 },
          { key: "connectionToNature", find: "connection to nature:", take: "window", span: 24 },
          { key: "elfTongues", find: "elf tongues:", take: "window", span: 24 },
        ],
      },
      raceRequirements: {
        shape: "proseValues",
        book: "jj",
        printedPage: 301,
        locate: "additional requirements",
        values: [
          { key: "dwarfCon", find: "dwarven classes require constitution", take: "int" },
          { key: "elfInt", find: "elven classes require intellect", take: "int" },
        ],
      },
      builds: {
        shape: "proseValues",
        book: "jj",
        emit: { path: ["classes"] },
        valueBlocks: BUILD_BLOCKS,
      },
    },
  },
};
