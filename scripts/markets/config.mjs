/**
 * Module vocabulary for the markets feature: enum keys and their i18n labels.
 * Keys mirror the importer's recipe row keys so a table row and its label
 * always agree; the values behind them arrive per world via table import.
 * Pure module — importable from Node tooling and tests.
 */
import { LANG } from "./constants.mjs";

/**
 * The 29 merchandise types (19 common, 10 precious). Demand modifiers are
 * stored per key on a market; the item→category classifier maps trade goods
 * onto these keys for demand-step pricing.
 */
export const MERCHANDISE_TYPES = Object.freeze([
  { key: "grainVegetables", tier: "common" },
  { key: "salt", tier: "common" },
  { key: "beerAle", tier: "common" },
  { key: "pottery", tier: "common" },
  { key: "commonWood", tier: "common" },
  { key: "wineSpirits", tier: "common" },
  { key: "oilsSauces", tier: "common" },
  { key: "preservedFish", tier: "common" },
  { key: "preservedMeat", tier: "common" },
  { key: "glassware", tier: "common" },
  { key: "rareWood", tier: "common" },
  { key: "commonMetal", tier: "common" },
  { key: "commonFurs", tier: "common" },
  { key: "textiles", tier: "common" },
  { key: "dyesPigments", tier: "common" },
  { key: "botanicals", tier: "common" },
  { key: "clothing", tier: "common" },
  { key: "tools", tier: "common" },
  { key: "armorWeapons", tier: "common" },
  { key: "monsterParts", tier: "precious" },
  { key: "ivory", tier: "precious" },
  { key: "rareFurs", tier: "precious" },
  { key: "spices", tier: "precious" },
  { key: "finePorcelain", tier: "precious" },
  { key: "preciousMetals", tier: "precious" },
  { key: "silk", tier: "precious" },
  { key: "rareBooksArt", tier: "precious" },
  { key: "semipreciousStones", tier: "precious" },
  { key: "gems", tier: "precious" },
]);

/** i18n label key for a merchandise-type key. */
export const merchandiseLabel = (key) => `${LANG}.merch.${key}`;

/**
 * Magic-item rarity ladder. Magical Engineering identifies up to `rare`;
 * Loremastery identifies `veryRare` and `legendary`.
 */
export const RARITIES = Object.freeze(["common", "uncommon", "rare", "veryRare", "legendary"]);

/**
 * Magic-item kinds the identification ladder distinguishes: potions can be
 * sipped or Alchemy-examined; weapons/armor reveal their bonus in use; the
 * rest go through Arcane Dabbling, Magical Engineering, Loremastery, or
 * magic research.
 */
export const MAGIC_KINDS = Object.freeze(["potion", "scroll", "weapon", "armor", "misc"]);

/** Identification depth on an item's markets flag. */
export const ID_STATES = Object.freeze(["none", "partial", "full"]);
