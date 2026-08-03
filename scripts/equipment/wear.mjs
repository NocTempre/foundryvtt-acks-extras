/**
 * Wear locations — resolving "where is this piece of gear?".
 *
 * The answer comes from the item's own DECLARATION where it has one
 * (`flags.acks-extras.gear`, read through acks-lib's `wornSlotOf`), and is
 * DERIVED where it does not: core's `system.equipped` plus flags this module
 * already sets (helmet, worn hand, shield strap, containedIn) and the loadout's
 * two-handed inference. So the sheet, the loadout summary and the container UI
 * describe the same reality whether or not a world has been annotated.
 *
 * A declaration, once present, wins outright — deriving afterwards would let a
 * name heuristic overrule a Judge who set the slot deliberately.
 *
 * @see acks-lib vocab.mjs WEAR_SLOTS for the canonical slot list; config.mjs
 *      WEAR adds the two buckets that are states rather than places.
 */
import { MODULE_ID, ITEM_FLAGS } from "./constants.mjs";
import { WEAR, WEAR_ORDER } from "./config.mjs";
import { getLoadout } from "./loadout.mjs";
import { containedIn } from "./containers.mjs";
import { occupiesHand } from "./overlays/shield-variants.mjs";
import { isHelmet, isShield } from "./profiles.mjs";
import { isWorn, wornSlotOf } from "../lib/item-model.mjs";

/**
 * Where does this item sit?
 * @param {Actor} actor
 * @param {Item} item
 * @param {Loadout} [loadout] pass one in when bucketing a whole sheet
 * @returns {string} a WEAR key
 */
export function wearLocation(actor, item, loadout = getLoadout(actor)) {
  // Inside a container beats everything: a stowed cloak is stowed, whatever
  // slot it would occupy if you put it on.
  if (containedIn(item)) return WEAR.stowed;

  const declared = wornSlotOf(item);
  if (declared) return declared;

  if (!isWorn(item)) return WEAR.carried;

  if (item.type === "armor") {
    if (isShield(item)) {
      // A strapped shield rides the back or front and leaves the hand free.
      if (!occupiesHand(item)) return WEAR.strapped;
      return WEAR.offHand;
    }
    return isHelmet(item) ? WEAR.head : WEAR.body;
  }

  if (item.type === "weapon") {
    const entry = loadout.weapons.find((w) => w.item.id === item.id);
    if (entry?.wieldTwoHanded) return WEAR.bothHands;
    // `hand` is set when a weapon is drawn into a specific hand; without it a
    // weapon is in the main hand unless something else already claims it.
    const hand = item.getFlag?.(MODULE_ID, ITEM_FLAGS.WORN_HAND);
    if (hand === "off") return WEAR.offHand;
    return WEAR.mainHand;
  }

  // Worn non-armour, non-weapon gear (clothing, cloaks, boots) that declares no
  // slot. Reachable only through the gear model — core's `item` type carries no
  // `equipped` field, so nothing else can put one here.
  return WEAR.worn;
}

/**
 * Group an actor's gear into ordered wear buckets.
 * @returns {{key:string, items:Item[]}[]} only the non-empty worn buckets
 */
export function wearBuckets(actor, loadout = getLoadout(actor)) {
  const byKey = new Map(WEAR_ORDER.map((k) => [k, []]));
  for (const item of actor.items) {
    const where = wearLocation(actor, item, loadout);
    if (byKey.has(where)) byKey.get(where).push(item);
  }
  return WEAR_ORDER.filter((k) => byKey.get(k).length).map((key) => ({ key, items: byKey.get(key) }));
}

/** Localised label for a wear key, falling back to the key itself. */
export function wearLabel(key) {
  const full = `ACKS-EQUIPMENT.wear.${key}`;
  return globalThis.game?.i18n?.has?.(full) ? globalThis.game.i18n.localize(full) : key;
}
