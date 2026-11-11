/* global game */
/**
 * Overlay: item loss from damage (JJ p. 398; acks-rules/acks-equipment/RULES.md §11).
 * Gated by the `overlayItemLoss` world setting.
 *
 * When an area attack drops a creature past the loss threshold (no save, or a
 * failed save), its equipment takes the loss by the stone, in a strict
 * positional ORDER through what the victim is wearing and carrying, filtered by
 * whether the damage type can even harm each item's material. A light item is
 * destroyed; a heavy one is damaged and loses the armour class it grants, per
 * full stone of damage.
 *
 * Every figure the procedure runs on is the Judge's import: the threshold and
 * its step, what a layer of clothing counts as, where light ends and heavy
 * begins, the armour class a full stone costs (the `itemLoss` table), and the
 * materials each damage type can harm (`itemLossMaterials`). They are passed
 * to the planner, which reads them from the registry when the caller gives
 * none. With any of them unread the plan does nothing and says what is
 * missing; nothing answers in its place.
 *
 * Pure planner — it decides what is at risk and what happens to each item. The
 * writes (`applyItemLoss`) and the Judge's dialog live in `item-loss-flow.mjs`;
 * magic items' saving throws, which the wielder rolls with their own
 * progression, are the Judge's.
 *
 * This needed containers first: two of the positions are container contents,
 * so without the container model the order could not be resolved.
 */
import { overlayGate } from "../settings.mjs";
import { MODULE_ID, SETTINGS, ITEM_FLAGS } from "../constants.mjs";
import { containedIn } from "../containers.mjs";
import { isClothing, isPhysical, slotsOf, declaresSlots, STONE } from "../../lib/item-model.mjs";
import { hasDoc, getDoc, citeOf } from "../../lib/tables.mjs";
import { SLOT, ITEM_TYPE } from "../../lib/vocab.mjs";
import { RULEDATA_DOC } from "./scavenged.mjs";

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
 * The two `equipment` tables this overlay reads: the figures the procedure
 * runs on, and the materials each damage type can harm, one row per
 * `DAMAGE_TYPES` key. The ids are written as literals in `module.mjs`
 * `expectTables`, because the producers gate reads that call from source.
 */
export const ITEM_LOSS_TABLES = Object.freeze({ figures: "itemLoss", materials: "itemLossMaterials" });

/** The figures the `itemLoss` table carries; the plan needs every one. */
export const ITEM_LOSS_FIGURE_KEYS = Object.freeze(["threshold", "step", "clothingStones", "lightMax", "heavyMin", "acPerStone"]);

export const overlayEnabled = overlayGate(SETTINGS.OVERLAY_ITEM_LOSS);

/** One table of the `equipment` document as the layers merge it, or null. */
function tableOf(id) {
  if (!hasDoc(RULEDATA_DOC)) return null;
  return getDoc(RULEDATA_DOC)?.tables?.[id] ?? null;
}

/** A stored figure as a finite number, or null for blank, absent or not a number. */
function figure(raw) {
  if (raw == null || raw === "") return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}

/**
 * The procedure's figures as the Judge's import holds them (the `itemLoss`
 * table), each null until imported. A step that is not above zero reads as
 * absent, since a loss counted in steps of nothing has no answer.
 * @returns {{threshold: number|null, step: number|null, clothingStones: number|null,
 *   lightMax: number|null, heavyMin: number|null, acPerStone: number|null}}
 */
export function itemLossFigures() {
  const row = tableOf(ITEM_LOSS_TABLES.figures) ?? {};
  const out = Object.fromEntries(ITEM_LOSS_FIGURE_KEYS.map((key) => [key, figure(row[key])]));
  if (!(out.step > 0)) out.step = null;
  return out;
}

/**
 * The materials each damage type can harm as the import holds them: a map of
 * `DAMAGE_TYPES` key to a list of material words. A type whose row did not read
 * has no entry, and an empty list is a row that was read and names none. Null
 * when the table is not imported at all.
 * @returns {Object<string, string[]>|null}
 */
export function itemLossMaterials() {
  const table = tableOf(ITEM_LOSS_TABLES.materials);
  if (!table || typeof table !== "object") return null;
  const out = {};
  for (const [type, row] of Object.entries(table)) {
    if (Array.isArray(row?.materials)) out[type] = row.materials.map((m) => String(m).toLowerCase());
  }
  return Object.keys(out).length ? out : null;
}

/**
 * What stands between a plan and an answer: the figure keys not read, and
 * `itemLossMaterials` when the table is absent, or `itemLossMaterials.<type>`
 * when only that type's row did not read. Empty when the plan can run.
 * @returns {string[]}
 */
export function lossMissing({ figures, materials, damageType = null } = {}) {
  const missing = ITEM_LOSS_FIGURE_KEYS.filter((key) => figures?.[key] == null);
  if (!materials) missing.push(ITEM_LOSS_TABLES.materials);
  else if (damageType != null && !Array.isArray(materials[damageType])) missing.push(`${ITEM_LOSS_TABLES.materials}.${damageType}`);
  return missing;
}

/**
 * Stones of equipment at risk: one at the threshold, another per step of
 * further damage. Zero above the threshold; null when the figures are not read.
 * @param {number} hp the victim's hit points AFTER the attack
 * @param {{threshold: number|null, step: number|null}} figures
 */
export function stonesAtRisk(hp, { threshold = null, step = null } = {}) {
  if (threshold == null || !(step > 0)) return null;
  const v = Number(hp);
  if (!Number.isFinite(v) || v > threshold) return 0;
  return 1 + Math.floor((threshold - v) / step);
}

/** A material word with a plural "s" folded away, so "combustibles" and "combustible" are one word. */
const fold = (word) => String(word ?? "").toLowerCase().trim().replace(/s$/, "");

/**
 * The material words the imported table names, sorted, for the material
 * picker. Empty when the table is not imported.
 */
export function materialVocabulary(materials = itemLossMaterials()) {
  return [...new Set(Object.values(materials ?? {}).flat())].sort();
}

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
  if (item?.type === ITEM_TYPE.armor || item?.type === ITEM_TYPE.weapon) return "metal";
  return "metal";
}

/**
 * Can this damage type harm this material at all? True or false from the
 * table; null when the table holds no row for the type, which is not the same
 * as "nothing is vulnerable".
 * @param {string} material
 * @param {string} damageType a `DAMAGE_TYPES` key
 * @param {Object<string, string[]>|null} [materials] the imported table
 */
export function isVulnerable(material, damageType, materials = itemLossMaterials()) {
  const list = materials?.[damageType];
  if (!Array.isArray(list)) return null;
  return list.some((m) => fold(m) === fold(material));
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

  if (isCloak(item)) return "cloak";
  if (isClothing(item)) {
    const layer = item.getFlag?.(MODULE_ID, ITEM_FLAGS.LAYER);
    return layer === "under" ? "clothingUnderArmour" : "clothingOverArmour";
  }

  return "handsOrTorso";
}

/** Names that read as a cloak, for gear nobody has annotated. */
const CLOAK_NAME = /cloak|cape/i;

/**
 * Is this a cloak? Declaration first — a garment that says where it sits has
 * already answered, and consulting the name after would let "Cape of the
 * Magistrate" overrule a Judge who slotted it elsewhere.
 */
function isCloak(item) {
  if (declaresSlots(item)) return slotsOf(item).includes(SLOT.shoulders);
  return CLOAK_NAME.test(item.name ?? "");
}

/**
 * Where an item stands against the imported weights: `destroyed` (a light
 * item), `damaged` (a heavy one), or `unplaced` for a weight between the two
 * bounds, which the import's page states no case for. Null when the bounds are
 * not read.
 * @param {number} weight6 the item's weight in sixths of a stone
 * @param {{lightMax: number|null, heavyMin: number|null}} figures
 * @returns {"destroyed"|"damaged"|"unplaced"|null}
 */
export function lossClassOf(weight6, { lightMax = null, heavyMin = null } = {}) {
  if (lightMax == null || heavyMin == null) return null;
  const stones = weight6 / STONE;
  if (stones <= lightMax) return "destroyed";
  if (stones >= heavyMin) return "damaged";
  return "unplaced";
}

/**
 * Plan what the loss does to each item, in the page's order, for a given hit.
 *
 * A layer of clothing counts as the imported number of stones whatever its
 * listed weight. An item the damage type cannot harm is skipped rather than
 * consuming the budget. A light item is destroyed and spends its weight; a
 * heavy one takes the remaining budget up to its own weight, and loses armour
 * class for each full stone of it (armour only: other items grant none, so
 * their damage changes nothing the module tracks). A weight between the bounds
 * is `unplaced`: it spends nothing and is the Judge's call.
 *
 * With any figure or the materials table unread, nothing is planned and
 * `missing` says what to import.
 *
 * @param {Actor} actor
 * @param {object} loadout the actor's `getLoadout` result
 * @param {object} options
 * @param {number} options.hp the victim's hit points after the attack
 * @param {string} options.damageType a `DAMAGE_TYPES` key
 * @param {boolean} [options.fromRear] the flank-or-rear order
 * @param {object} [options.figures] the `itemLossFigures` shape; the import's when omitted
 * @param {Object<string, string[]>|null} [options.materials] the `itemLossMaterials` shape; the import's when omitted
 * @returns {{ready: boolean, missing: string[], stones: number,
 *   destroyed: {item: Item, material: string, weight6: number}[],
 *   damaged: {item: Item, material: string, weight6: number, damage6: number, stones: number, acLost: number}[],
 *   unplaced: {item: Item, material: string, weight6: number}[],
 *   survivors: number}}
 */
export function planItemLoss(actor, loadout, { hp, damageType, fromRear = false, figures = itemLossFigures(), materials = itemLossMaterials() } = {}) {
  const plan = { ready: false, missing: lossMissing({ figures, materials, damageType }), stones: 0, destroyed: [], damaged: [], unplaced: [], survivors: 0 };
  if (plan.missing.length) return plan;
  plan.ready = true;
  plan.stones = stonesAtRisk(hp, figures);
  if (!plan.stones) return plan;

  const order = fromRear ? LOSS_ORDER_REAR : LOSS_ORDER_FRONT;
  const candidates = actor.items.filter(isPhysical);
  const lo = { ...loadout, actorItems: candidates };

  const buckets = new Map(order.map((k) => [k, []]));
  for (const item of candidates) {
    const cat = categoryOf(item, lo);
    if (buckets.has(cat)) buckets.get(cat).push(item);
  }

  let budget6 = plan.stones * STONE;
  for (const cat of order) {
    for (const item of buckets.get(cat)) {
      if (budget6 <= 0) break;
      const material = materialOf(item);
      if (!isVulnerable(material, damageType, materials)) {
        plan.survivors++;
        continue; // immune material: skipped, does not consume the budget
      }
      // A garment layer counts as the page's figure, whatever its listed weight;
      // a weightless item still spends the smallest unit so the budget ends.
      const weight6 = isClothing(item) ? figures.clothingStones * STONE : Math.max(1, Number(item.system?.weight6 ?? 1));
      const kind = lossClassOf(weight6, figures);
      if (kind === "destroyed") {
        plan.destroyed.push({ item, material, weight6 });
        budget6 -= weight6;
      } else if (kind === "damaged") {
        const damage6 = Math.min(budget6, weight6);
        const full = Math.floor(damage6 / STONE);
        plan.damaged.push({ item, material, weight6, damage6, stones: full, acLost: item.type === ITEM_TYPE.armor ? full * figures.acPerStone : 0 });
        budget6 -= damage6;
      } else {
        plan.unplaced.push({ item, material, weight6 });
      }
    }
    if (budget6 <= 0) break;
  }
  return plan;
}

/**
 * What the Durability tab says about item loss for one item, or null when the
 * overlay is off or the item is not a thing with a weight. `state` is the
 * item's class against the imported weights (`lossClassOf`) or `notImported`;
 * `tip` says where the answer came from: the weight and the bounds with their
 * page, or the tables still to import.
 *
 * @param {Item} item
 * @param {object} [figures] the `itemLossFigures` shape; the import's when omitted
 * @returns {{state: "notImported"|"destroyed"|"damaged"|"unplaced", tip: string}|null}
 */
export function itemLossFact(item, figures = itemLossFigures()) {
  if (!overlayEnabled() || !isPhysical(item)) return null;
  const missing = lossMissing({ figures, materials: itemLossMaterials() });
  if (missing.length) {
    return { state: "notImported", tip: game.i18n.format("ACKS-EQUIPMENT.itemLoss.notImportedTip", { tables: missing.join(", ") }) };
  }
  const weight6 = isClothing(item) ? figures.clothingStones * STONE : Number(item.system?.weight6 ?? 0);
  const state = lossClassOf(weight6, figures);
  const cite = citeOf(RULEDATA_DOC, ITEM_LOSS_TABLES.figures);
  const tip = game.i18n.format("ACKS-EQUIPMENT.itemLoss.factTip", {
    weight: weight6 / STONE, light: figures.lightMax, heavy: figures.heavyMin, cite: cite ?? game.i18n.localize("ACKS-EQUIPMENT.itemLoss.byHand"),
  });
  return { state, tip };
}
