import { CLOTHING_SLOT_PATTERNS, gearProfileFor } from "./config.mjs";
import { BASE_TYPE } from "./base-types.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";

/**
 * Guessing a base type from an item's NAME, for a world that predates the
 * `baseType` flag. See docs/equipment/MODEL.md, "Base types and variations".
 * Reads the SAME tables the rest of the feature reads, so nothing can drift
 * between the guess and what it stands in for.
 */

/**
 * The base type an item's name implies, or null when nothing does.
 *
 * Null is a real answer and not a failure: the caller falls back to what the
 * document already is, which for ordinary gear is the right answer anyway.
 */
export function inferBaseType(item) {
  const type = item?.type;
  const name = item?.name ?? "";

  if (type === ITEM_TYPE.weapon) return BASE_TYPE.weapon;
  if (type === ITEM_TYPE.money) return BASE_TYPE.coin;

  if (type === ITEM_TYPE.armor) {
    // Core's own field, not a heuristic: the armour ladder lives in
    // `system.type`, and a shield is the one entry that is not a suit.
    return item?.system?.type === "shield" ? BASE_TYPE.shield : BASE_TYPE.armour;
  }

  if (type !== ITEM_TYPE.item) return null;

  // A container or a piece of rigging — the profile table knows these by name.
  if (gearProfileFor(name)) return BASE_TYPE.gear;

  // A garment, if a pattern claims it AND places it somewhere on the body. The
  // slot check matters: the table's first row exists to say that cloth sold by
  // weight is goods rather than something you put on.
  for (const { re, slots } of CLOTHING_SLOT_PATTERNS) {
    if (re.test(name)) return slots?.length ? BASE_TYPE.clothing : null;
  }
  return null;
}
