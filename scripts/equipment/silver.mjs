/**
 * The Silver quality (RR ch.4 Weapon Qualities).
 *
 * Silver changes nothing about the weapon itself (RR ch.4); what matters is
 * what the blade COUNTS AS when it lands, which the defence stage in lib
 * decides against a monster's silver flaw (RR ch.6, RR p. 159). A weapon is
 * silver when the system says so (`system.special.silver`, lib `silverOf`),
 * and nothing else answers for it: not its name, not its table row, not the
 * plating flag. Ammunition has no such field, so a stack answers from the
 * module's flag, then its table row, then its name.
 *
 * The module says what the weapon counts as and never decides the outcome:
 * whether a monster's resistance carries the silver flaw is the Judge's
 * reading of its stat block.
 * See docs/equipment/DECISIONS.md, "A weapon is silver when core says so
 * (2026-11-19)".
 */
import { MODULE_ID, ITEM_FLAGS } from "./constants.mjs";
import { SILVER } from "./config.mjs";
import { weaponKey } from "./profiles.mjs";
import { weaponRow } from "../lib/weapons.mjs";
import { silveredFlagOf, recomputeItemFields } from "./properties.mjs";
import { isAmmoItem } from "../lib/item-model.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";
import { silverOf } from "../lib/damage-type.mjs";

/**
 * Silver is a WEAPON quality, so only a weapon, or a stack of ammunition fired
 * from one, can carry it.
 */
export function canBeSilvered(item) {
  return item?.type === ITEM_TYPE.weapon || (item?.type === ITEM_TYPE.item && isAmmoItem(item));
}

/**
 * Does this item count as silver? A weapon is silver when the system's own
 * field says so. A stack of ammunition has no such field: an explicit answer
 * wins, otherwise the weapon table's row decides, and failing that the name.
 */
export function isSilvered(item) {
  if (!canBeSilvered(item)) return false;
  if (item.type === ITEM_TYPE.weapon) return silverOf(item);
  const explicit = silveredFlagOf(item);
  if (explicit !== null) return explicit;
  const key = weaponKey(item);
  if (key && (weaponRow(key)?.special ?? []).includes(SILVER.quality)) return true;
  return /\bsilver(ed|-?coated|-?plated)?\b/i.test(item?.name ?? "");
}

/**
 * Plate an item in silver, or strip the plating. Recomputes the item's
 * fields, which applies or unwinds the silvered price.
 *
 * The flag is "plating bought" and is what the price layer reads; it never
 * says whether a weapon is silver. On a weapon, `true` sets the flag and the
 * system's `special.silver`, `false` writes both false (the price layer keys
 * on `true` alone, so a stored no buys nothing and lets the picker keep the
 * pick), and `null` or "auto" unsets the flag and leaves the system's field as
 * it stands. On ammunition the flag is the answer: `false` is stored, an
 * explicit no that overrules a table row or a name.
 */
export async function setSilvered(item, silvered) {
  const auto = silvered === null || silvered === "auto";
  if (item?.type === ITEM_TYPE.weapon) {
    if (auto) await item.unsetFlag?.(MODULE_ID, ITEM_FLAGS.SILVERED);
    else await item.setFlag?.(MODULE_ID, ITEM_FLAGS.SILVERED, !!silvered);
    if (!auto) await item.update?.({ "system.special.silver": !!silvered });
  } else if (auto) {
    await item?.unsetFlag?.(MODULE_ID, ITEM_FLAGS.SILVERED);
  } else {
    await item?.setFlag?.(MODULE_ID, ITEM_FLAGS.SILVERED, !!silvered);
  }
  return recomputeItemFields(item);
}

/**
 * Which of the silver picker's options is selected: "auto", "true" or "false".
 * Ammunition shows its stored answer. A weapon shows a stored pick only while
 * the system's field still agrees with it, so a weapon whose silver was cleared
 * elsewhere never reads as Silvered; otherwise it shows "auto", whose label
 * reports the system's field.
 */
export function silverChoiceOf(item) {
  const flag = silveredFlagOf(item);
  if (flag === null) return "auto";
  if (item?.type === ITEM_TYPE.weapon && flag !== silverOf(item)) return "auto";
  return String(flag);
}
