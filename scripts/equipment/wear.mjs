/**
 * Wear locations — resolving "where is this piece of gear?".
 *
 * The answer comes from the item's own DECLARATION where it has one
 * (`flags.acks-extras.gear`, read through the lib's `wornSlotOf`), and is
 * DERIVED where it does not: core's `system.equipped`, this module's flags
 * (helmet, worn hand, shield strap, containedIn) and the loadout's two-handed
 * inference. A declaration, once present, wins outright.
 *
 * @see lib/vocab.mjs WEAR_SLOTS for the canonical slot list; config.mjs
 *      WEAR adds the two buckets that are states rather than places.
 */
import { MODULE_ID, ITEM_FLAGS } from "./constants.mjs";
import { WEAR, WEAR_ORDER } from "./config.mjs";
import { getLoadout } from "./loadout.mjs";
import { containedIn } from "./containers.mjs";
import { occupiesHand } from "./overlays/shield-variants.mjs";
import { isHelmet, isShield } from "./profiles.mjs";
import { isWorn, wornSlotOf } from "../lib/item-model.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";

/**
 * Where does this item sit?
 * @param {Actor} actor
 * @param {Item} item
 * @param {Loadout} [loadout] pass one in when bucketing a whole sheet
 * @returns {string} a WEAR key
 */
export function wearLocation(actor, item, loadout = getLoadout(actor)) {
  // Inside a container beats everything.
  if (containedIn(item)) return WEAR.stowed;

  // The mapper's kit is held, not worn, so it is placed before the worn gate:
  // quill in the main hand, parchment in the off hand (the loadout's `mappingKit`).
  const kitAt = loadout.mappingKit?.findIndex((k) => k.id === item.id) ?? -1;
  if (kitAt === 0) return WEAR.mainHand;
  if (kitAt === 1) return WEAR.offHand;

  // Whether it is worn comes before where it goes: a declared slot cannot say
  // the item is on. See docs/equipment/DECISIONS.md, "Whether it is on comes
  // before where it goes".
  if (!isWorn(item)) return WEAR.carried;

  const declared = wornSlotOf(item);
  if (declared) return declared;

  if (item.type === ITEM_TYPE.armor) {
    if (isShield(item)) {
      // A strapped shield rides the back or front and leaves the hand free.
      if (!occupiesHand(item)) return WEAR.strapped;
      return WEAR.offHand;
    }
    return isHelmet(item) ? WEAR.head : WEAR.body;
  }

  if (item.type === ITEM_TYPE.weapon) {
    const entry = loadout.weapons.find((w) => w.item.id === item.id);
    if (entry?.wieldTwoHanded) return WEAR.bothHands;
    // `hand` names the hand a weapon was drawn into. An unnamed weapon takes the
    // main hand unless another one-hand weapon holds it (one named there, or an
    // earlier unnamed one), then the off hand; a shield in hand keeps the off
    // hand, so a second weapon beside one lists in the main hand as overflow.
    const hand = item.getFlag?.(MODULE_ID, ITEM_FLAGS.WORN_HAND);
    if (hand === "off") return WEAR.offHand;
    if (hand === "main") return WEAR.mainHand;
    const oneHanded = loadout.weapons.filter((w) => !w.wieldTwoHanded);
    const at = oneHanded.indexOf(entry);
    const mainTaken = oneHanded.some((w, i) => w !== entry && (w.wornHand === "main" || (w.wornHand !== "off" && at >= 0 && i < at)));
    if (mainTaken && !loadout.handShields?.length) return WEAR.offHand;
    return WEAR.mainHand;
  }

  // Worn non-armour, non-weapon gear (clothing, cloaks, boots) that declares no
  // slot; core's `item` type carries no `equipped`, so only the gear model puts one here.
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
