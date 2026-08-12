/**
 * The Silver quality (RR ch.4 Weapon Qualities).
 *
 * Silver is the only material in ACKS II that changes what a weapon can do, and
 * it changes nothing about the weapon itself: "apart from gaining the Silver
 * feature, the weapon's characteristics do not change." Its whole weight is what
 * the blade COUNTS AS when it lands —
 *
 *   - a monster whose immunity or resistance carries the silver flaw "treats
 *     weapons made of silver as if they were magic for purposes of its
 *     resistance" (RR ch.6), which the Monstrous Manual states per monster as
 *     "silver weapons deal extraordinary damage against it";
 *   - the spells that turn aside MUNDANE damage — deflection, protection from
 *     normal missiles, protection from evil, a banner of invincibility — do not
 *     turn silver aside: "attacks made with silver weapons are considered to
 *     deal extraordinary damage for purposes of this spell";
 *   - masterwork alone never grants the ability to hit a magical monster
 *     "unless forged of a material otherwise capable of doing so (e.g. silver)"
 *     (RR p159).
 *
 * All three reduce to one question — does this attack deal extraordinary damage
 * — which the monsters feature already asks of a weapon through its own
 * `extraordinary` flag. So silver ANSWERS that question rather than opening a
 * second one beside it, and everything here feeds `dealsExtraordinaryDamage`.
 *
 * What this does NOT do is decide the outcome. Whether a given monster's
 * resistance carries the flaw is the Judge's reading of its stat block, so the
 * module says what the weapon counts as and leaves the ruling where it belongs.
 */
import { MODULE_ID, ITEM_FLAGS } from "./constants.mjs";
import { SILVER, WEAPONS } from "./config.mjs";
import { weaponKey } from "./profiles.mjs";
import { silveredFlagOf, recomputeItemFields } from "./properties.mjs";
import { isAmmoItem } from "../lib/item-model.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";

/**
 * Silver is a WEAPON quality, so only a weapon — or a stack of ammunition, which
 * is fired from one — can carry it. Armour and ordinary gear may well be made of
 * silver without any of this meaning a thing.
 */
export function canBeSilvered(item) {
  return item?.type === ITEM_TYPE.weapon || (item?.type === ITEM_TYPE.item && isAmmoItem(item));
}

/**
 * Does this blade count as silver? An explicit answer wins; otherwise the RAW
 * weapon table decides (Silver Dagger carries the quality), and failing that the
 * name does — "Silver Arrow" and "Silvered Sword" are what a reader types when
 * they mean it, and both are RAW-purchasable at 10× the weapon's listed price.
 */
export function isSilvered(item) {
  if (!canBeSilvered(item)) return false;
  const explicit = silveredFlagOf(item);
  if (explicit !== null) return explicit;
  const key = weaponKey(item);
  if (key && (WEAPONS[key]?.special ?? []).includes(SILVER.quality)) return true;
  return /\bsilver(ed|-?coated|-?plated)?\b/i.test(item?.name ?? "");
}

/**
 * Does an attack with this weapon deal EXTRAORDINARY damage? True when the item
 * is already flagged so (the monsters feature's own annotation, which covers a
 * magical weapon and a powerful monster's natural attacks) or when it is silver.
 * This is the single question the three silver rulings collapse into.
 */
export function dealsExtraordinaryDamage(item) {
  return !!item?.getFlag?.(MODULE_ID, "extraordinary") || isSilvered(item);
}

/**
 * Plate an item in silver, or strip the plating. Writing `false` rather than
 * clearing is deliberate: it is how a reader overrules a name or a table entry
 * that says silver when the item in hand is not. Recomputing afterwards is what
 * applies (or unwinds) the 10× price through the property layers.
 */
export async function setSilvered(item, silvered) {
  if (silvered === null || silvered === "auto") {
    await item?.unsetFlag?.(MODULE_ID, ITEM_FLAGS.SILVERED);
  } else {
    await item?.setFlag?.(MODULE_ID, ITEM_FLAGS.SILVERED, !!silvered);
  }
  return recomputeItemFields(item);
}
