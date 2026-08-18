/**
 * Shared identifiers for the classes subsystem. The Item sub-type key, the
 * actor flag that binds a character to a class document, and the ruledata
 * document ids the registry publishes are each named once, here.
 */
import { MODULE_ID } from "../lib/constants.mjs";
export { MODULE_ID };
export const LANG_PREFIX = "ACKS-CLASSES";

/** The class Item sub-type (declared in module.json `documentTypes.Item`). */
export const CLASS_TYPE = `${MODULE_ID}.class`;

/** The race Item sub-type — the racial-value ladder the builder spends and
 *  simple-mode classes bind by ref (declared in module.json alongside class). */
export const RACE_TYPE = `${MODULE_ID}.race`;

/**
 * Actor flag key under `flags["acks-extras"]`: `{ uuid, key, appliedLevel,
 * applied }` — which class document the character is bound to and the exact
 * field values the last apply wrote (the ledger the diff/confirm compares
 * against, so hand edits are recognized instead of silently clobbered).
 */
export const FLAG_CLASSES = "classes";

/**
 * Ruledata document id of the shared chassis progressions (the four printed
 * attack/save progressions every human class borrows). Published at WORLD
 * priority by registry.mjs from the world's class documents — the resolution
 * source for `levelValueField()`'s `progression` kind.
 */
export const PROGRESSIONS_DOC_ID = "acks.classProgressions";

/** Per-class ruledata doc id prefix: `acks.class.<key>`. */
export const CLASS_DOC_PREFIX = "acks.class.";

/**
 * The four chassis whose printed attack/save progressions other classes
 * borrow. Keys mirror `PROGRESSION_CLASSES` in lib/vocab.mjs — the roll
 * editor's `as` picker and this registry must speak the same tokens.
 */
export const CHASSIS_KEYS = ["fighter", "crusader", "mage", "thief"];

/**
 * How a casting tradition's capacity is modeled. `vancian` is the RR slot
 * grid; the rest are carried by the schema now so By This Axe gnosis,
 * Heroic Fantasy ceremonial magic and point-based variants materialize into
 * the same field instead of forcing a schema break later.
 */
export const CASTING_KINDS = {
  vancian: { label: "Spell Slots" },
  points: { label: "Spell Points" },
  ritual: { label: "Rituals" },
  ceremonial: { label: "Ceremonial" },
  gnosis: { label: "Gnosis" },
};

/**
 * Where a caster's repertoire comes from (RR prose, three shapes): an order's
 * fixed repertoire (crusader-style divine), a studious spell book (mage-style,
 * also the witch/craftpriest divine variant), or slots + Intellect bonus
 * (arcane casters).
 */
export const REPERTOIRE_KINDS = {
  order: { label: "Order Repertoire" },
  studious: { label: "Spell Book (Studious)" },
  arcaneInt: { label: "Slots + Intellect Bonus" },
};
