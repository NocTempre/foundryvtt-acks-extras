import { MODULE_ID } from "../lib/constants.mjs";
export { MODULE_ID };
export const LANG_PREFIX = "ACKS-IMPORTER";

/**
 * Namespacing (see acks-module-template docs/TOOLCHAIN.md — enforced by
 * tools/validate.mjs): identifiers in shared registries carry the module key.
 * MODULE_KEY prefixes pack document _ids (declared in module.json
 * flags["acks-extras"].idPrefix). It stays "acksc" — _id IS identity, and
 * renaming it would duplicate every already-imported macro. `acksc…` still
 * starts with `acks`, the family-wide prefix namespacing checks for.
 */
export const MODULE_KEY = "acksc";

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
 * The picture a GENERATED document gets — a monster's attack, a spoil, a grid
 * row, an ability with no register entry behind it. These are minted from the
 * page at import, so no per-entry icon exists to hand them; they take the one
 * their kind deserves.
 *
 * Never `icons/svg/*`: those flat greys are Foundry's default for a document
 * nobody chose a picture for, so using one is indistinguishable from having
 * made no choice — the state the icon ledger (register/_icons.json) exists to
 * clear. Painted art from the same subject folders the register draws on keeps
 * a generated row legible next to the entries around it.
 *
 * ATTACK is deliberately a slash rather than a sword: the same payload carries
 * a wielded weapon and a claw.
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
