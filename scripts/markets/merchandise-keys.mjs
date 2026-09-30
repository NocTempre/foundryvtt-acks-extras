/**
 * The vocabulary that names a trade good: the catalogue's keys, the words a
 * printed table or prose uses for each, and the demand columns a merchandise
 * item carries a modifier for.
 *
 * Module configuration, not book content: the keys are this module's own
 * identifiers and the patterns are English spellings of them. Every figure
 * arrives from the Judge's own copy through the importer. The importer's
 * binding and the legacy table recipe both read this one module, so a label
 * maps to the same key on every path. Pure — importable from Node tooling and
 * tests.
 */

/**
 * Every merchandise key, its tier, and the pattern (case-insensitive, matched
 * against a label normalised by `normalizeGoodLabel`) that recognises the
 * printed labels of that good across the merchandise table, the random table
 * and the demand grid. `gems` is the one unanchored pattern, and carries no word boundary: the
 * page's rotated chapter tab merges into the last row's label, welded to its
 * letters.
 */
export const MERCHANDISE_KEYS = Object.freeze([
  { key: "grainVegetables", tier: "common", labelRe: "^grain" },
  { key: "salt", tier: "common", labelRe: "^salt" },
  { key: "beerAle", tier: "common", labelRe: "^beer" },
  { key: "pottery", tier: "common", labelRe: "^pottery" },
  { key: "commonWood", tier: "common", labelRe: "^common woods?" },
  { key: "wineSpirits", tier: "common", labelRe: "^wines?" },
  { key: "oilsSauces", tier: "common", labelRe: "^oils?\\b" },
  { key: "preservedFish", tier: "common", labelRe: "^preserved fish" },
  { key: "preservedMeat", tier: "common", labelRe: "^preserved meats?" },
  { key: "glassware", tier: "common", labelRe: "^glassware" },
  { key: "rareWood", tier: "common", labelRe: "^rare woods?" },
  { key: "commonMetal", tier: "common", labelRe: "^common metals?" },
  { key: "commonFurs", tier: "common", labelRe: "^common furs?" },
  { key: "textiles", tier: "common", labelRe: "^textiles?" },
  { key: "dyesPigments", tier: "common", labelRe: "^dyes?\\b" },
  { key: "botanicals", tier: "common", labelRe: "^botanicals?" },
  { key: "clothing", tier: "common", labelRe: "^clothing" },
  { key: "tools", tier: "common", labelRe: "^tools?\\b" },
  { key: "armorWeapons", tier: "common", labelRe: "^armou?r" },
  { key: "monsterParts", tier: "precious", labelRe: "^monster parts?" },
  { key: "ivory", tier: "precious", labelRe: "^ivory" },
  { key: "rareFurs", tier: "precious", labelRe: "^rare furs?" },
  { key: "spices", tier: "precious", labelRe: "^spices?" },
  { key: "finePorcelain", tier: "precious", labelRe: "^(?:fine\\s+)?porcelain" },
  { key: "preciousMetals", tier: "precious", labelRe: "^precious metals?" },
  { key: "silk", tier: "precious", labelRe: "^silks?\\b" },
  { key: "rareBooksArt", tier: "precious", labelRe: "^rare books?" },
  { key: "semipreciousStones", tier: "precious", labelRe: "^semi[\\s-]*pr" },
  { key: "gems", tier: "precious", labelRe: "gems?" },
]);

/**
 * Other names a good goes by in prose. Kept apart from `MERCHANDISE_KEYS`
 * because the table recipe reads the keys' patterns as row anchors and must
 * not learn a name only prose uses.
 */
export const MERCHANDISE_ALIASES = Object.freeze([{ key: "preciousMetals", labelRe: "^rare metals?" }]);

/** The demand columns that stand for a settlement's age band, in printed order. */
export const DEMAND_AGE_KEYS = Object.freeze(["age1", "age2", "age3", "age4", "age5"]);

/** The demand columns that stand for a settlement's terrain or waterside, in printed order. */
export const DEMAND_TERRAIN_KEYS = Object.freeze([
  "seaCoast",
  "lakeShore",
  "riverBank",
  "rainforest",
  "savanna",
  "desert",
  "steppe",
  "scrub",
  "grasslands",
  "forest",
  "taiga",
  "tundra",
  "plains",
  "hills",
  "mountains",
]);

/** Every column a merchandise item's `environment` holds a modifier for. */
export const DEMAND_COLUMN_KEYS = Object.freeze([...DEMAND_AGE_KEYS, ...DEMAND_TERRAIN_KEYS]);

/** The market classes a merchandise item states a daily quantity for, lowest class first. */
export const MARKET_CLASS_COUNT = 6;

/** The two tiers a good belongs to. */
export const MERCHANDISE_TIERS = Object.freeze(["common", "precious"]);

/** The world setting that holds the age-band header text read from the book at import. */
export const DEMAND_AGE_HEADERS_SETTING = "marketsDemandAgeHeaders";

const COMPILED = [...MERCHANDISE_KEYS, ...MERCHANDISE_ALIASES].map((row) => ({ key: row.key, re: new RegExp(row.labelRe, "i") }));

/** A printed label with footnote marks dropped and whitespace collapsed. */
export const normalizeGoodLabel = (label) =>
  String(label ?? "")
    .replace(/[*†‡]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The merchandise key a printed label or prose name stands for, or null when
 * it names no known good. Keys are tried in table order before aliases.
 * @param {string} label
 * @returns {string|null}
 */
export function merchandiseKeyOf(label) {
  const text = normalizeGoodLabel(label);
  if (!text) return null;
  return COMPILED.find((row) => row.re.test(text))?.key ?? null;
}

/** The tier a key belongs to by the module's own list, or null for an unknown key. */
export const merchandiseTierOf = (key) => MERCHANDISE_KEYS.find((row) => row.key === key)?.tier ?? null;
