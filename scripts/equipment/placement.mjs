/**
 * Putting a carried item at a place on the body — what a drop on one of the
 * character sheet's places means, and what an imported sheet's gear line
 * means. One answer, so the two never disagree about where a torch or a
 * shield ends up.
 */
import { ITEM_TYPE, SLOT } from "../lib/vocab.mjs";
import { isEquippable } from "../lib/item-model.mjs";
import { drawInto, prepareTorch, readiedWeaponData, wearItem } from "./actions.mjs";
import { containedIn, takeOut } from "./containers.mjs";

/** The places a thing is HELD at, where a torch stack readies one into hand. */
export const HAND_PLACES = Object.freeze([SLOT.mainHand, SLOT.offHand, SLOT.bothHands]);

/**
 * Put `item` at `slot`, taking it out of any container first. A weapon is
 * drawn into the hand it is put in (by name; any other place is a plain draw),
 * anything core can equip is equipped, a torch stack put in a hand readies one
 * torch there, and anything else is worn at the slot.
 * @param {Actor} actor the item's owner
 * @param {Item} item an item `actor` carries
 * @param {string} slot a WEAR_SLOTS key
 * @returns {Promise<boolean>} false when the item cannot be worn there (nothing
 *   is written); the caller says so
 */
export async function placeItem(actor, item, slot) {
  if (containedIn(item)) await takeOut(item);
  if (item.type === ITEM_TYPE.weapon) {
    await drawInto(item, slot === SLOT.offHand ? "off" : slot === SLOT.mainHand ? "main" : null);
    return true;
  }
  if (isEquippable(item)) {
    await item.update({ "system.equipped": true });
    return true;
  }
  if (readiedWeaponData(item) && HAND_PLACES.includes(slot)) {
    await prepareTorch(actor, item, { draw: true });
    return true;
  }
  return !!(await wearItem(item, slot));
}
