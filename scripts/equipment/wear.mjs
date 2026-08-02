/**
 * Wear locations — resolving "where is this piece of gear?" from the data the
 * module already keeps.
 *
 * Nothing new is stored. The answer is derived from core's `system.equipped`
 * plus flags this module already sets (helmet, worn hand, shield strap,
 * containedIn) and the loadout's own two-handed inference, so the sheet, the
 * Paper Doll layout, and the loadout summary all describe the same reality.
 *
 * @see config.mjs WEAR for the canonical key list.
 */
import { MODULE_ID, ITEM_FLAGS } from "./constants.mjs";
import { WEAR, WEAR_ORDER } from "./config.mjs";
import { getLoadout } from "./loadout.mjs";
import { containedIn } from "./containers.mjs";
import { occupiesHand } from "./overlays/shield-variants.mjs";

/** Is an armour item a shield? (mirrors loadout.mjs) */
function isShield(item) {
  return item.system?.type === "shield";
}

/** Is an armour item a helmet? (flag, else the same name heuristic core uses) */
function isHelmet(item) {
  if (item.getFlag?.(MODULE_ID, ITEM_FLAGS.HELMET)) return true;
  return /helm/i.test(item.name ?? "");
}

/**
 * Where does this item sit?
 * @param {Actor} actor
 * @param {Item} item
 * @param {Loadout} [loadout] pass one in when bucketing a whole sheet
 * @returns {string} a WEAR key
 */
export function wearLocation(actor, item, loadout = getLoadout(actor)) {
  if (containedIn(item)) return WEAR.STOWED;
  if (!item.system?.equipped) return WEAR.CARRIED;

  if (item.type === "armor") {
    if (isShield(item)) {
      // A strapped shield rides the back or front and leaves the hand free.
      if (!occupiesHand(item)) return WEAR.STRAPPED;
      return WEAR.OFF_HAND;
    }
    return isHelmet(item) ? WEAR.HEAD : WEAR.BODY;
  }

  if (item.type === "weapon") {
    const entry = loadout.weapons.find((w) => w.item.id === item.id);
    if (entry?.wieldTwoHanded) return WEAR.BOTH_HANDS;
    // `hand` is set by the Paper Doll normalisation; without it a weapon is in
    // the main hand unless something else already claims it.
    const hand = item.getFlag?.(MODULE_ID, ITEM_FLAGS.WORN_HAND);
    if (hand === "off") return WEAR.OFF_HAND;
    return WEAR.MAIN_HAND;
  }

  // Equipped non-armour, non-weapon gear (clothing, cloaks, boots) is worn.
  return WEAR.WORN;
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
