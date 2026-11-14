/* global game */
/**
 * Overlay: JJ shield variants (Judges Journal pp. 407–408; equipment RULES.md §4).
 * Gated by the `overlayShieldVariants` world setting; off, every shield is the
 * standard +1 AC shield core already models.
 *
 * Two facts drive the automation, and core models neither:
 *
 *  1. A **strapped** shield (back/front) is not in a hand. It costs no hand,
 *     cannot form the Weapon & Shield fighting style or take its
 *     Specialization, and its AC applies only situationally, so it does not
 *     raise ordinary AC.
 *  2. A **buckler** grants its AC only to a character with Fighting Style
 *     Specialization (Weapon & Shield).
 *
 * Core adds any equipped shield's `ac.value` unconditionally, so where the
 * shield gives nothing the overlay contributes a negative correction to
 * `system.ac.mod`. See docs/equipment/DECISIONS.md, "Shields cancel rather than fight core (JJ variants)".
 *
 * Mounted, a phalanx shield grants no ordinary AC (the lib records who is
 * riding what), and a kite shield's mounted encumbrance (`mountEnc`) is read by
 * `shieldEnc6`.
 *
 * The variant table holds what the code reads: `handAC`, `frontAC`, `specOnly`,
 * `spec`, `noBack`, `noMount` and the encumbrance figures `enc`, `encItem`,
 * `frontEnc`, `mountEnc`.
 *
 * The loss of a shield's benefit while vulnerable and the mounted
 * self-or-mount protection choice are not automated; the item descriptions
 * surface them for the Judge.
 */
import { overlayGate } from "../settings.mjs";
import { MODULE_ID, SETTINGS, ITEM_FLAGS } from "../constants.mjs";
import { SHIELD_VARIANTS, STYLE } from "../config.mjs";
import { ITEM_TYPE } from "../../lib/vocab.mjs";

/** Whether the `overlayShieldVariants` world setting is on. */
export const overlayEnabled = overlayGate(SETTINGS.OVERLAY_SHIELD_VARIANTS);

/** The variant profile for a shield item ("standard" when unflagged/disabled). */
export function variantOf(item) {
  if (!overlayEnabled()) return SHIELD_VARIANTS.standard;
  const key = item?.getFlag?.(MODULE_ID, ITEM_FLAGS.SHIELD_VARIANT);
  return SHIELD_VARIANTS[key] ?? SHIELD_VARIANTS.standard;
}

/**
 * Where the shield is carried: "hand" (default), "back", or "front".
 *
 * A shield that cannot be slung on the back (`noBack`) reads "hand" whatever
 * its flag says; every other function asks here, so a bad flag reaches none of
 * the hand budget, the AC correction or the encumbrance sum.
 */
export function strapOf(item) {
  if (!overlayEnabled()) return "hand";
  const strap = item?.getFlag?.(MODULE_ID, ITEM_FLAGS.STRAP) ?? "hand";
  if (strap === "back" && variantOf(item).noBack) return "hand";
  return strap;
}

/** May this shield be carried this way? Used by the UI to offer valid options. */
export function canStrap(item, strap) {
  if (strap !== "back") return true;
  return !variantOf(item).noBack;
}

/**
 * Cycle a shield's carry position: hand → back → front → hand, skipping any
 * position this shield cannot take (a kite/phalanx shield has no back). A
 * strapped shield costs no hand (RR/JJ p407). Inert with the overlay off, when
 * `strapOf` always reports "hand".
 * @returns {Promise<string>} the new strap position.
 */
export async function cycleStrap(item) {
  const order = ["hand", "back", "front"];
  let i = (order.indexOf(strapOf(item)) + 1) % order.length;
  for (let guard = 0; guard < order.length && !canStrap(item, order[i]); guard++) {
    i = (i + 1) % order.length;
  }
  const next = order[i];
  if (next === "hand") await item.unsetFlag?.(MODULE_ID, ITEM_FLAGS.STRAP);
  else await item.setFlag?.(MODULE_ID, ITEM_FLAGS.STRAP, next);
  return next;
}

/** True when the shield occupies a hand (and so can form Weapon & Shield). */
export function occupiesHand(item) {
  return strapOf(item) === "hand";
}

/**
 * Is this actor on a mount? Answered by the lib, which owns the binding; with
 * no mount binding, "no".
 */
export function mounted(actor) {
  return !!globalThis.acksExtras?.lib?.mount?.isMounted?.(actor);
}

/**
 * Does this shield raise ORDINARY armour class right now?
 * @param {Item} item
 * @param {boolean} hasShieldSpec Fighting Style Specialization (Weapon & Shield)
 * @param {Actor} [actor] the wielder, for the mounted rules
 */
export function grantsOrdinaryAC(item, hasShieldSpec, actor = null) {
  const v = variantOf(item);
  // A `noMount` shield grants nothing while mounted.
  if (v.noMount && mounted(actor)) return false;
  if (strapOf(item) !== "hand") {
    // A front-strapped shield with `frontAC` still covers the front; a
    // back-strapped one protects only the rear, which is situational.
    return strapOf(item) === "front" && !!v.frontAC;
  }
  if (v.specOnly) return !!hasShieldSpec; // buckler
  return !!v.handAC;
}

/**
 * Correction for `system.ac.mod` that cancels core's unconditional shield
 * bonus where the shield grants no ordinary AC. Core adds the LAST equipped
 * shield's ac.value, so that is the shield tested.
 * @returns {number} 0 or a negative correction
 */
export function shieldACCorrection(loadout, hasShieldSpec, actor = null) {
  if (!overlayEnabled()) return 0;
  const shields = loadout?.shields ?? [];
  if (!shields.length) return 0;
  const counted = shields[shields.length - 1]; // matches core's last-wins pick
  if (grantsOrdinaryAC(counted, hasShieldSpec, actor)) return 0;
  return -Number(counted.system?.ac?.value ?? 0);
}

/**
 * A shield's encumbrance in `weight6`, given how it is being carried.
 *
 * The variant table's `enc`, `encItem`, `frontEnc` and `mountEnc` give the
 * rating. Its values are in STONE; an `encItem` shield is rated as a single
 * item, 1/6 stone. A `frontEnc` larger than `enc` is intended: a front strap
 * makes the shield heavier.
 *
 * @returns {number|null} weight6, or null when the overlay is off and core's
 *                        own item weight should stand
 */
export function shieldEnc6(item, actor = null) {
  if (!overlayEnabled()) return null;
  const v = variantOf(item);
  if (v.encItem) return 1; // one item = 1/6 stone

  let stone = v.enc ?? 1;
  // `mountEnc` wins over the strap.
  if (v.mountEnc != null && mounted(actor)) stone = v.mountEnc;
  else if (v.frontEnc != null && strapOf(item) === "front") stone = v.frontEnc;
  return stone * 6;
}

/**
 * Correction to core's flat encumbrance sum for the shields an actor is
 * carrying, in `weight6`. Core adds each item's own `weight6`; a shield is
 * rated by variant and carry state instead, so the difference is contributed.
 * Only EQUIPPED shields are re-rated; one in a pack weighs what the item says.
 */
export function shieldEncumbranceDelta6(actor) {
  if (!overlayEnabled()) return 0;
  let delta = 0;
  for (const item of actor?.items ?? []) {
    if (item.type !== ITEM_TYPE.armor || item.system?.type !== "shield" || !item.system?.equipped) continue;
    const want = shieldEnc6(item, actor);
    if (want == null) continue;
    delta += want - Number(item.system?.weight6 ?? 0);
  }
  return delta;
}

/** Is Weapon & Shield Specialization applicable to this loadout's shield? */
export function specApplies(loadout) {
  if (!overlayEnabled()) return true;
  const shield = loadout?.shield;
  if (!shield) return true;
  const v = variantOf(shield);
  return strapOf(shield) === "hand" && v.spec !== false;
}

void STYLE;
