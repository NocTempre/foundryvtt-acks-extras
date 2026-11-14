import { MODULE_ID } from "../lib/constants.mjs";
export { MODULE_ID };
/** The root of the importer's lang keys (`ACKS-IMPORTER.*`). */
export const LANG_PREFIX = "ACKS-IMPORTER";

/**
 * Foundry Item document types this module compares against. Comparisons read
 * these constants, never raw string literals, so a system-side type rename
 * desyncs one named symbol instead of a scatter of untraceable strings.
 */
export const ITEM_TYPE = Object.freeze({
  WEAPON: "weapon",
  ABILITY: "ability",
});

/** Foundry Actor document types this module compares against (see ITEM_TYPE). */
export const ACTOR_TYPE = Object.freeze({
  MONSTER: "monster",
});

/**
 * The picture a GENERATED document gets by its kind — a monster's attack, a
 * spoil, a grid row, an ability with no register entry behind it. Never
 * `icons/svg/*`: those flat greys are Foundry's default, the state the icon
 * ledger (register/_icons.json) exists to clear. ATTACK is a slash, not a
 * sword, because one payload carries a wielded weapon and a claw.
 */
export const DEFAULT_IMG = Object.freeze({
  ATTACK: "icons/skills/melee/strike-slashes-orange.webp",
  WEAPON: "icons/weapons/swords/sword-guard-bronze.webp",
  ARMOR: "icons/equipment/chest/breastplate-layered-steel.webp",
  SHIELD: "icons/equipment/shield/heater-steel-worn.webp",
  ABILITY: "icons/sundries/books/book-worn-brown.webp",
  ITEM: "icons/containers/bags/sack-leather-tan.webp",
  TRAINING: "icons/skills/melee/weapons-crossed-swords-black.webp",
});
