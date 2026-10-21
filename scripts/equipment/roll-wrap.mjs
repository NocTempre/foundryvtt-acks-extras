/* global libWrapper, CONFIG, Hooks */
/**
 * Combat-roll integration: the equipment feature's seat at the system's attack
 * throw, and its correction of the system's encumbrance sum.
 *
 * Always-on, loadout-level modifiers (fighting-style specialization, Combat
 * Reflexes, Swashbuckling) are already folded into the system's own
 * `system.*.mod` fields by the managed loadout Active Effect — no patch
 * needed. What is per weapon and per kind of attack is answered through the
 * lib's attack seam (`lib/patches/attack-throw.mjs`): the contributor below
 * puts `attack-mods.mjs`'s rows on the throw and the damage roll, offers the
 * grip as a damage mode, and names the throw a weapon table knows of. Once an
 * attack has resolved, the post-attack hook spends its ammunition.
 */
import { MODULE_ID } from "./constants.mjs";
import { classifyWeapon } from "./profiles.mjs";
import { encumbranceDelta6 } from "./containers.mjs";
import { consumeForAttack } from "./ammo.mjs";
import { attackThrowRows, damageRows, attackTypesFor, damageModesFor, damageFormulaFor, ATTACK_TYPE } from "./attack-mods.mjs";
import { addAttackContributor, attackInFlight, POST_ATTACK_HOOK } from "../lib/patches/attack-throw.mjs";
import { ITEM_TYPE, ACTOR_TYPE } from "../lib/vocab.mjs";

/** The attack seam's contributor for this feature; each answer fails safe to the list it was given. */
export const equipmentContributor = Object.freeze({
  attack(ctx, attackType, modifiers) {
    return [...modifiers, ...attackThrowRows(ctx.actor, ctx.weapon, attackType, { maneuver: ctx.maneuver })];
  },
  damage(ctx, attackType, modifiers) {
    return damageRows(ctx.actor, ctx.weapon, attackType, modifiers);
  },
  attackTypes(item, types) {
    return attackTypesFor(item, types);
  },
  damageModes(item, attackType, modes) {
    const ctx = attackInFlight(item?.parent);
    return damageModesFor(item?.parent ?? null, item, attackType, modes, ctx?.damageMode ?? null);
  },
  damageFormula(item, mode, formula) {
    return damageFormulaFor(item, mode, formula);
  },
});

/**
 * Spend ammunition, or mark a thrown weapon thrown, once an attack has
 * RESOLVED. One attack is one shot: the system rolls one throw per call. A
 * cancelled dialog fires no post-attack hook, so it spends nothing. The spend
 * is fire-and-forget: a failed decrement never fails the attack.
 */
function onAttackResolved(actor, ctx, outcome) {
  try {
    const item = ctx?.weapon?.id ? actor.items?.get?.(ctx.weapon.id) : null;
    if (item?.type !== ITEM_TYPE.weapon) return;
    const kind = outcome?.result?.attackType ?? ctx.type;
    const type = kind === ATTACK_TYPE.melee ? "melee" : "missile";
    consumeForAttack(actor, item, classifyWeapon(item), { type }).catch((err) =>
      console.error(`${MODULE_ID} | ammunition consumption failed`, err),
    );
  } catch (err) {
    console.error(`${MODULE_ID} | ammunition consumption skipped`, err);
  }
}

/**
 * WRAPPER around AcksActor#computeEncumbrance.
 *
 * FLAGGED: this wraps a core method that acks-formation depends on (it reads the
 * resulting system.encumbrance / movementacks for party speed). It is an
 * ENHANCE, not a replacement — core's own sum runs untouched and we adjust the
 * total afterwards, so formation keeps reading one consistent number and the two
 * modules cannot disagree. Only what a flat sum gets wrong is corrected
 * (`encumbranceDelta6`: harness, bowquiver, bundles, and the part-stone of a
 * purse core rounds away); where none of it applies the delta is 0 and this
 * is a pass-through.
 *
 * Core calls _calculateMovement() at the END of computeEncumbrance, so any
 * adjustment must recompute movement or speed would reflect the pre-correction
 * weight.
 *
 * HANDOFF: a core `system.encumbrance.mod` field (the way `ac.mod` lets us
 * correct AC without a patch) would let this wrap be deleted entirely.
 */
function onComputeEncumbrance(wrapped, ...args) {
  const result = wrapped(...args);
  try {
    if (this.type !== ACTOR_TYPE.character) return result;
    const delta6 = encumbranceDelta6(this);
    if (!delta6) return result; // common case: nothing RAW-specific applies
    const enc = this.system.encumbrance;
    const value6 = Math.max(0, Number(enc.value6 ?? 0) + delta6);
    const stones = value6 / 6;
    const max = Number(enc.max ?? 0) || 1;
    this.system.encumbrance = {
      ...enc,
      value6,
      value: Math.round(stones),
      pct: Math.clamp ? Math.clamp((stones / max) * 100, 0, 100) : Math.min(100, Math.max(0, (stones / max) * 100)),
      encumbered: stones > max,
    };
    // Core computed movement from the pre-correction weight — redo it.
    if (this.system.config?.movementAuto) this._calculateMovement();
  } catch (err) {
    console.error(`${MODULE_ID} | encumbrance wrap failed; core's value stands`, err);
  }
  return result;
}

/**
 * Register the encumbrance wrapper. What a character carries is weighed the
 * same whether or not rolls are automated, so this is registered apart from
 * the attack contributor and answers to no setting.
 */
export function registerEncumbranceWrap() {
  libWrapper.register(MODULE_ID, "CONFIG.Actor.documentClass.prototype.computeEncumbrance", onComputeEncumbrance, "WRAPPER");
  console.debug(`${MODULE_ID} | encumbrance wrapper registered.`);
  void CONFIG;
}

/**
 * Take the feature's seat at the attack throw: the half the roll-automation
 * setting gates. Nothing is registered with libWrapper here; the lib's seam
 * holds the one wrapper per method and asks every contributor in turn.
 */
export function registerRollWrap() {
  addAttackContributor(equipmentContributor);
  Hooks.on(POST_ATTACK_HOOK, onAttackResolved);
  console.debug(`${MODULE_ID} | attack contributor registered.`);
}
