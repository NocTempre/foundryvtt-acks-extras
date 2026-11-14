/**
 * The Silver quality (RR ch.4 Weapon Qualities).
 *
 * Silver changes nothing about the weapon itself (RR ch.4); what matters is
 * what the blade COUNTS AS when it lands: extraordinary damage (RR ch.6,
 * RR p. 159). The monsters feature already asks that question of a weapon
 * through its own `extraordinary` flag, so silver answers it here through
 * `dealsExtraordinaryDamage` and opens no second question.
 *
 * The module says what the weapon counts as and never decides the outcome:
 * whether a monster's resistance carries the silver flaw is the Judge's
 * reading of its stat block.
 * See docs/equipment/DECISIONS.md, "Silver is a quality, not a material (2026-08-06)".
 */
import { MODULE_ID, ITEM_FLAGS } from "./constants.mjs";
import { SILVER } from "./config.mjs";
import { weaponKey } from "./profiles.mjs";
import { weaponRow } from "../lib/weapons.mjs";
import { silveredFlagOf, recomputeItemFields } from "./properties.mjs";
import { isAmmoItem } from "../lib/item-model.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";

/**
 * Silver is a WEAPON quality, so only a weapon, or a stack of ammunition fired
 * from one, can carry it.
 */
export function canBeSilvered(item) {
  return item?.type === ITEM_TYPE.weapon || (item?.type === ITEM_TYPE.item && isAmmoItem(item));
}

/**
 * Does this blade count as silver? An explicit answer wins; otherwise the
 * weapon table's row decides, and failing that the name does.
 */
export function isSilvered(item) {
  if (!canBeSilvered(item)) return false;
  const explicit = silveredFlagOf(item);
  if (explicit !== null) return explicit;
  const key = weaponKey(item);
  if (key && (weaponRow(key)?.special ?? []).includes(SILVER.quality)) return true;
  return /\bsilver(ed|-?coated|-?plated)?\b/i.test(item?.name ?? "");
}

/**
 * Does an attack with this weapon deal EXTRAORDINARY damage? True when the item
 * is already flagged so (the monsters feature's own annotation) or when it is
 * silver.
 */
export function dealsExtraordinaryDamage(item) {
  return !!item?.getFlag?.(MODULE_ID, "extraordinary") || isSilvered(item);
}

/**
 * Plate an item in silver, or strip the plating (`null` or "auto" clears the
 * flag; `false` stores an explicit no that overrules a name or table entry).
 * Recomputes the item's fields, which applies or unwinds the silvered price.
 */
export async function setSilvered(item, silvered) {
  if (silvered === null || silvered === "auto") {
    await item?.unsetFlag?.(MODULE_ID, ITEM_FLAGS.SILVERED);
  } else {
    await item?.setFlag?.(MODULE_ID, ITEM_FLAGS.SILVERED, !!silvered);
  }
  return recomputeItemFields(item);
}
