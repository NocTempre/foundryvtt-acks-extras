/* global game */
/**
 * Overlay: JJ shield variants (Judges Journal pp. 407–408; acks-rules/acks-equipment/RULES.md §4).
 * Gated by the `overlayShieldVariants` world setting; off → every shield is the
 * standard +1 AC shield core already models.
 *
 * Two RAW facts drive the automation, and core models neither:
 *
 *  1. A **strapped** shield (back/front) is not in a hand. It therefore costs no
 *     hand, cannot form the Weapon & Shield fighting style, and cannot take that
 *     style's Specialization. Its AC applies only situationally (a back shield
 *     protects against attacks from behind), so it must NOT raise ordinary AC.
 *  2. A **buckler** grants its +1 AC *only* to a character with Fighting Style
 *     Specialization (Weapon & Shield). Others gain nothing at all.
 *
 * Core's computeAC adds any equipped shield's `aac.value` unconditionally, so
 * where RAW says the shield gives nothing we contribute a negative correction to
 * `system.aac.mod` — cancelling core's bonus rather than fighting it.
 *
 * MOUNTED. A phalanx shield cannot be used from horseback, which is a flat RAW
 * fact rather than a situational one — so now that acks-lib records who is
 * riding what, it is enforced: mounted, that shield grants no ordinary AC.
 *
 * Still not automated, and deliberately:
 *  - "no benefit while vulnerable" — needs per-attack context the system has no
 *    model for;
 *  - the mounted self-or-mount choice (`mountAlternates`, `mountShares`) — that
 *    is a PLAYER'S choice each round, not a derivable fact, so automating it
 *    would be choosing for them;
 *  - `mountEnc` (a kite shield encumbers less mounted) — shield encumbrance is
 *    not implemented at all yet, so there is nothing for the mounted value to
 *    modify;
 *  - the phalanx shield counting for the Defend action.
 * Those are surfaced in the item descriptions for the Judge.
 */
import { MODULE_ID, SETTINGS, ITEM_FLAGS } from "../constants.mjs";
import { SHIELD_VARIANTS, STYLE } from "../config.mjs";

export function overlayEnabled() {
  return !!game.settings.get(MODULE_ID, SETTINGS.OVERLAY_SHIELD_VARIANTS);
}

/** The variant profile for a shield item ("standard" when unflagged/disabled). */
export function variantOf(item) {
  if (!overlayEnabled()) return SHIELD_VARIANTS.standard;
  const key = item?.getFlag?.(MODULE_ID, ITEM_FLAGS.SHIELD_VARIANT);
  return SHIELD_VARIANTS[key] ?? SHIELD_VARIANTS.standard;
}

/**
 * Where the shield is carried: "hand" (default), "back", or "front".
 *
 * A kite or phalanx shield cannot be slung on the back at all (`noBack`), so a
 * flag saying otherwise is corrected here rather than trusted — it is the one
 * place every other function asks, so a bad flag cannot leak past it into the
 * hand budget, the AC correction and the encumbrance sum separately.
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
 * strapped shield costs no hand (RR/JJ p407), so this is how a player frees a
 * hand for a torch while keeping the shield's situational cover. Only meaningful
 * with the overlay on — off, strapOf always reports "hand" and this is inert.
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
 * Is this actor on a mount? Answered by acks-lib, which owns the binding.
 * Absent the library the answer is "no", so every mounted rule below simply
 * does not fire — the same behaviour as before the binding existed.
 */
export function mounted(actor) {
  return !!globalThis.acksLib?.mount?.isMounted?.(actor);
}

/**
 * Does this shield raise ORDINARY armour class right now?
 * @param {Item} item
 * @param {boolean} hasShieldSpec Fighting Style Specialization (Weapon & Shield)
 * @param {Actor} [actor] the wielder, for the mounted rules
 */
export function grantsOrdinaryAC(item, hasShieldSpec, actor = null) {
  const v = variantOf(item);
  // A phalanx shield is unusable from horseback — not situationally reduced,
  // simply not usable — so it grants nothing while mounted.
  if (v.noMount && mounted(actor)) return false;
  if (strapOf(item) !== "hand") {
    // A front-strapped crescent still covers the front; a back-strapped shield
    // only protects the rear, which is situational rather than ordinary AC.
    return strapOf(item) === "front" && !!v.frontAC;
  }
  if (v.specOnly) return !!hasShieldSpec; // buckler
  return !!v.handAC;
}

/**
 * Correction for `system.aac.mod` that reconciles core's unconditional shield
 * bonus with RAW. Core adds the LAST equipped shield's aac.value; if RAW says
 * that shield grants nothing ordinary, cancel it.
 * @returns {number} 0 or a negative correction
 */
export function shieldACCorrection(loadout, hasShieldSpec, actor = null) {
  if (!overlayEnabled()) return 0;
  const shields = loadout?.shields ?? [];
  if (!shields.length) return 0;
  const counted = shields[shields.length - 1]; // matches core's last-wins pick
  if (grantsOrdinaryAC(counted, hasShieldSpec, actor)) return 0;
  return -Number(counted.system?.aac?.value ?? 0);
}

/**
 * A shield's RAW encumbrance in `weight6`, given how it is being carried.
 *
 * The variant table has carried `enc`, `encItem`, `frontEnc` and `mountEnc`
 * since it was written, with nothing reading them — so every shield weighed
 * whatever its item said, and a kite shield encumbered a rider exactly as much
 * as a man on foot. The table's values are in STONE; a buckler is instead rated
 * as a single ITEM (`encItem`), which is 1/6 stone.
 *
 * Front-strapping a crescent shield makes it HEAVIER (frontEnc 2 against enc 1)
 * — not a typo in the table: it is strapped across the body rather than slung.
 *
 * @returns {number|null} weight6, or null when the overlay is off and core's
 *                        own item weight should stand
 */
export function shieldEnc6(item, actor = null) {
  if (!overlayEnabled()) return null;
  const v = variantOf(item);
  if (v.encItem) return 1; // one item = 1/6 stone

  let stone = v.enc ?? 1;
  // Mounted wins over the strap: the kite shield's whole point is that it rides
  // lighter, whichever way it is being carried.
  if (v.mountEnc != null && mounted(actor)) stone = v.mountEnc;
  else if (v.frontEnc != null && strapOf(item) === "front") stone = v.frontEnc;
  return stone * 6;
}

/**
 * Correction to core's flat encumbrance sum for the shields an actor is
 * carrying, in `weight6`. Core adds each item's own `weight6`; RAW rates a
 * shield by variant and carry state instead, so the difference is contributed.
 *
 * Only EQUIPPED shields are re-rated. A shield in a pack is cargo and weighs
 * what the item says — the variant encumbrance describes how it rides on you.
 */
export function shieldEncumbranceDelta6(actor) {
  if (!overlayEnabled()) return 0;
  let delta = 0;
  for (const item of actor?.items ?? []) {
    if (item.type !== "armor" || item.system?.type !== "shield" || !item.system?.equipped) continue;
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

/** Does the loadout's shield count for the Defend action (phalanx)? RR p. 294. */
export function countsForDefend(loadout) {
  const shield = loadout?.shield;
  if (!shield) return false;
  if (!overlayEnabled()) return true;
  const v = variantOf(shield);
  return v.defendCounts === true || v.key === "standard" || v === SHIELD_VARIANTS.standard;
}

void STYLE;
