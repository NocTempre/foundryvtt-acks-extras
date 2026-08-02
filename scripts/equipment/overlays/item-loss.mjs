/* global game */
/**
 * Overlay: item loss from damage (JJ p. 398; acks-rules/acks-equipment/RULES.md §11).
 * Gated by the `overlayItemLoss` world setting.
 *
 * When an area attack drops a creature to −6 hp or lower (no save, or a failed
 * save), one stone of its equipment is destroyed, plus another stone per further
 * 6 damage. The rule is a strict positional ORDER through what the victim is
 * wearing and carrying, filtered by whether the damage type can even harm each
 * item's material.
 *
 * This needed containers first: two of the eight positions are container
 * contents ("equipment in backpack", "equipment hanging from pack or back"), so
 * without the container model the order could not be resolved.
 *
 * Pure planner — it decides what is at risk and in what order. Applying the
 * destruction (and magic items' saving throws, which the wielder rolls with
 * their own progression) is left to the macro and the Judge.
 */
import { MODULE_ID, SETTINGS, ITEM_FLAGS } from "../constants.mjs";
import { containedIn, isContainer, STONE } from "../containers.mjs";

/** Positional order when damaged from the FRONT (JJ p. 398). */
export const LOSS_ORDER_FRONT = Object.freeze([
  "shieldInHand",
  "handsOrTorso",
  "clothingOverArmour",
  "armour",
  "clothingUnderArmour",
  "cloak",
  "inBackpack",
  "hangingFromPack",
]);

/** From the flank or rear the order is exactly reversed. */
export const LOSS_ORDER_REAR = Object.freeze([...LOSS_ORDER_FRONT].reverse());

/**
 * Materials each damage type can destroy (JJ p. 398). ACKS II has 12 damage
 * types: 6 physical, 6 energy. Poison destroys nothing.
 */
export const MATERIALS_BY_DAMAGE_TYPE = Object.freeze({
  acidic: ["ceramic", "cloth", "food", "fur", "horn", "leather", "metal", "paper", "wood"],
  arcane: ["ceramic", "cloth", "fur", "glass", "horn", "leather", "metal", "paper", "stone", "wood"],
  bludgeoning: ["ceramic", "glass", "metal", "stone", "wood"],
  piercing: ["ceramic", "glass"],
  poisonous: [],
  slashing: ["ceramic", "cloth", "fur", "horn", "leather", "paper", "wood"],
  cold: ["ceramic", "glass", "metal", "stone", "wood"],
  electric: ["ceramic", "combustible", "glass", "metal", "paper", "wood"],
  fire: ["ceramic", "cloth", "combustible", "food", "fur", "horn", "leather", "paper", "wood"],
  luminous: ["evil"], // e.g. unholy water
  necrotic: ["cloth", "food", "fur", "horn", "leather", "paper", "wood", "good"], // e.g. holy water
  seismic: ["ceramic", "glass", "metal", "stone", "wood"],
});

export function overlayEnabled() {
  return !!game.settings.get(MODULE_ID, SETTINGS.OVERLAY_ITEM_LOSS);
}

/**
 * Stones of equipment at risk: 1 at −6 hp, +1 per further 6 damage.
 * @param {number} hp the victim's hit points AFTER the attack
 */
export function stonesAtRisk(hp) {
  const v = Number(hp);
  if (!Number.isFinite(v) || v > -6) return 0;
  return 1 + Math.floor((Math.abs(v) - 6) / 6);
}

/** The material vocabulary (union of the damage-type tables), for the picker. */
export const MATERIALS = Object.freeze([...new Set(Object.values(MATERIALS_BY_DAMAGE_TYPE).flat())].sort());

/** Set an item's primary material ("auto"/empty clears the flag → the guess). */
export async function setMaterial(item, material) {
  if (!material || material === "auto") return item?.unsetFlag?.(MODULE_ID, ITEM_FLAGS.MATERIAL);
  return item?.setFlag?.(MODULE_ID, ITEM_FLAGS.MATERIAL, String(material).toLowerCase());
}

/** An item's primary material: explicit flag, else a name/type guess. */
export function materialOf(item) {
  const flagged = item?.getFlag?.(MODULE_ID, ITEM_FLAGS.MATERIAL);
  if (flagged) return String(flagged).toLowerCase();
  const n = (item?.name ?? "").toLowerCase();
  if (/oil|torch|candle|tallow/.test(n)) return "combustible";
  if (/holy water/.test(n)) return "good";
  if (/unholy water/.test(n)) return "evil";
  if (/rope|sack|cloak|cape|tunic|robe|clothing|blanket|tent/.test(n)) return "cloth";
  if (/leather|boots|belt|harness|pouch|backpack|scabbard|quiver/.test(n)) return "leather";
  if (/ration|food|bread/.test(n)) return "food";
  if (/paper|scroll|book|map|journal/.test(n)) return "paper";
  if (/glass|flask|vial|mirror|lens/.test(n)) return "glass";
  if (/pot|jug|amphora|ceramic/.test(n)) return "ceramic";
  if (/stone|rock/.test(n)) return "stone";
  if (/bow|staff|pole|spear|club|haft|wood/.test(n)) return "wood";
  if (item?.type === "armor" || item?.type === "weapon") return "metal";
  return "metal";
}

/** Can this damage type harm this material at all? */
export function isVulnerable(material, damageType) {
  const list = MATERIALS_BY_DAMAGE_TYPE[String(damageType ?? "").toLowerCase()];
  if (!list) return false;
  return list.includes(String(material ?? "").toLowerCase());
}

/**
 * Which position in the loss order an item occupies.
 * @param {Item} item
 * @param {import("../loadout.mjs").Loadout} loadout
 */
export function categoryOf(item, loadout) {
  const explicit = item.getFlag?.(MODULE_ID, ITEM_FLAGS.LOSS_CATEGORY);
  if (explicit) return String(explicit);

  if ((loadout.handShields ?? []).some((s) => s.id === item.id)) return "shieldInHand";
  if (loadout.armor?.id === item.id) return "armour";

  const holder = containedIn(item);
  if (holder) {
    const container = loadout.actorItems?.find?.((i) => i.id === holder) ?? null;
    const onBack = container?.getFlag?.(MODULE_ID, ITEM_FLAGS.STRAP) === "back";
    return onBack ? "hangingFromPack" : "inBackpack";
  }

  if (item.type === "item" && item.system?.subtype === "clothing") {
    if (/cloak|cape/i.test(item.name ?? "")) return "cloak";
    const layer = item.getFlag?.(MODULE_ID, ITEM_FLAGS.LAYER);
    return layer === "under" ? "clothingUnderArmour" : "clothingOverArmour";
  }
  if (/cloak|cape/i.test(item.name ?? "")) return "cloak";

  return "handsOrTorso";
}

/**
 * Plan which items are destroyed, in RAW order, for a given hit.
 *
 * Each clothing layer counts as 1 stone (JJ p. 398). Items the damage type
 * cannot harm are skipped rather than consuming the budget.
 *
 * @returns {{stones:number, destroyed:{item,material,weight6}[], survivors:number}}
 */
export function planItemLoss(actor, loadout, { hp, damageType, fromRear = false } = {}) {
  const stones = stonesAtRisk(hp);
  if (!stones) return { stones: 0, destroyed: [], survivors: 0 };

  const order = fromRear ? LOSS_ORDER_REAR : LOSS_ORDER_FRONT;
  const candidates = actor.items.filter((i) => ["item", "weapon", "armor"].includes(i.type));
  const lo = { ...loadout, actorItems: candidates };

  const buckets = new Map(order.map((k) => [k, []]));
  for (const item of candidates) {
    const cat = categoryOf(item, lo);
    if (buckets.has(cat)) buckets.get(cat).push(item);
  }

  let budget6 = stones * STONE;
  const destroyed = [];
  let skipped = 0;
  for (const cat of order) {
    for (const item of buckets.get(cat)) {
      if (budget6 <= 0) break;
      const material = materialOf(item);
      if (!isVulnerable(material, damageType)) {
        skipped++;
        continue; // immune material: skipped, does not consume the budget
      }
      // Clothing counts as one stone per layer regardless of its listed weight.
      const w6 = item.system?.subtype === "clothing" ? STONE : Math.max(1, Number(item.system?.weight6 ?? 1));
      destroyed.push({ item, material, weight6: w6 });
      budget6 -= w6;
    }
    if (budget6 <= 0) break;
  }
  return { stones, destroyed, survivors: skipped };
}
