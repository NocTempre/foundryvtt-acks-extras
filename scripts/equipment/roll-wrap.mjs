/* global libWrapper, CONFIG, Hooks, foundry */
/**
 * Combat-roll integration (Phase 3).
 *
 * Always-on, loadout-level modifiers (fighting-style specialization, Combat
 * Reflexes, Swashbuckling) are already folded into core's own `system.*.mod`
 * fields by the managed loadout Active Effect — no patch needed. What CANNOT be
 * expressed as a static actor modifier is *per-weapon*, so it is injected here:
 *
 *   - RAW non-proficient use (RR p. 106 sidebar): 1st+ level characters attack
 *     as 0th-level fighters (attack throw 11+, i.e. bba −1) while equipped with
 *     any weapon/armour unusable by their class or an untrained fighting style;
 *     0th-level characters take an additional −1 instead; and regardless of
 *     level no attribute BONUS applies to the attack throw (the AC half of that
 *     clause lives in the loadout effect; class powers/XP are Judge-side and
 *     surfaced as a violation)
 *   - Weapon Finesse: DEX instead of STR on tiny/small/medium melee attacks
 *   - a damage-attribute substitution (Strength of Faith: WIS instead of STR on
 *     the damage rolls Strength would have modified)
 *   - two-handed damage upsize for medium weapons wielded in both hands (1d6→1d8)
 *
 * Technique (deliberately non-invasive): `AcksItem#rollWeapon` passes
 * `item: this.toObject()` — a plain throwaway object — and `AcksActor#rollAttack`
 * only reads `item.system.bonus` (pushed onto the attack parts) and
 * `item.system.damage` (pushed onto the damage parts). So we hand `wrapped()` a
 * copy of that plain object with those two fields adjusted. Nothing mutates the
 * real Item, and core's roll pipeline is untouched.
 *
 * HANDOFF: this wrap exists only because core builds its parts internally and
 * fires no pre-roll hook. If the system ever exposes
 * `acks.preRollAttack(actor, item, parts, ctx)`, this file can be deleted and
 * the same modifiers contributed through it. We fire our own
 * `acksEquipment.preRollAttack` with the computed breakdown in the meantime.
 */
import { MODULE_ID, HOOKS, EFFECT_DOMAINS } from "./constants.mjs";
import { SIZE } from "./config.mjs";
import { getLoadout } from "./loadout.mjs";
import { classifyWeapon } from "./profiles.mjs";
import { isWeaponProficient } from "./proficiency.mjs";
import { hasEffectFlag, collectStringFlags } from "./effects.mjs";
import { encumbranceDelta6 } from "./containers.mjs";
import { consumeForAttack } from "./ammo.mjs";

/** Sizes eligible for Weapon Finesse (RR p. 121). */
const FINESSE_SIZES = [SIZE.TINY, SIZE.SMALL, SIZE.MEDIUM];

/**
 * How much a damage-attribute substitution changes this attack's damage.
 *
 * The bladedancer's Strength of Faith applies Wisdom "to damage rolls Strength
 * would modify", so this returns the DIFFERENCE between the substitute
 * attribute and Strength — the two cancel to nothing when they are equal, and
 * the caller folds a non-zero result into the damage string exactly as it does
 * the two-handed upsize.
 *
 * Substituting for a bonus the character is not receiving would invent one, so
 * this is asked only where Strength genuinely reaches the damage roll: a melee
 * attack, or a thrown weapon at range. A weapon that takes no damage bonus at
 * all is not asked.
 *
 * @returns {{delta:number, attribute:string}|null} null when nothing applies.
 */
function damageAttributeDelta(actor) {
  const [attribute] = collectStringFlags(actor, EFFECT_DOMAINS.DAMAGE_ATTRIBUTE);
  if (!attribute) return null;
  const scores = actor.system?.scores ?? {};
  // An attribute the actor does not carry is not a substitution, it is a typo
  // in someone's ability: leave Strength alone rather than swap in a zero.
  if (scores[attribute]?.mod == null) return null;
  const delta = Number(scores[attribute].mod) - Number(scores.str?.mod ?? 0);
  return Number.isFinite(delta) && delta !== 0 ? { delta, attribute } : null;
}

/** Fold a signed modifier into a damage formula. */
const withDelta = (formula, delta) => (delta > 0 ? `${formula} + ${delta}` : `${formula} - ${Math.abs(delta)}`);

/**
 * Compute the per-weapon RAW modifiers for one attack.
 * @returns {{bonusDelta:number, damage:string|null, notes:string[]}|null}
 */
export function computeAttackMods(actor, attData, options = {}) {
  if (actor?.type !== "character") return null; // monster natural attacks are not proficiency-gated
  const itemId = attData?.item?._id;
  // KNOWN GAP: an item-less attack (the sheet's bare attack button) has no
  // `item.system.bonus` for the wrap to carry a delta through, so the
  // non-proficient-use degradation below cannot reach it. Judge-side.
  if (!itemId) return null;
  const item = actor.items.get(itemId);
  if (item?.type !== "weapon") return null; // non-weapon item rolls stay untouched

  const profile = item ? classifyWeapon(item) : null;
  const loadout = getLoadout(actor);
  const entry = item ? loadout.weapons.find((w) => w.item.id === itemId) : null;
  const notes = [];
  let bonusDelta = 0;
  let damage = null;

  // RAW "Non-Proficient Use of Weapons and Armor" (RR p. 106 sidebar): the
  // trigger is the equipped STATE — any unusable weapon, unusable worn armour,
  // or an untrained fighting style (weapon AND style proficiency are distinct
  // and BOTH required) — so it degrades EVERY attack while so equipped, even
  // one made with a weapon the character could otherwise use. Attacking with
  // an unequipped weapon counts too ("use any weapons ... desired").
  const usingNonProfWeapon = item && (entry ? !entry.proficient : !isWeaponProficient(actor, profile));
  if (loadout.nonProficientUse || usingNonProfWeapon) {
    const level = Number(actor.system?.details?.level ?? 1);
    const bba = Number(actor.system?.thac0?.bba ?? 0);
    if (level >= 1) {
      // 1st+ level: attacks as a 0th-level fighter — attack throw 11+, bba −1.
      // Core already pushed the actor's own bba, so contribute the difference.
      if (bba !== -1) {
        bonusDelta += -1 - bba;
        notes.push("non-proficient use: attacks as a 0th-level fighter (11+)");
      }
    } else {
      // 0th level: still fights as 0th level, but at an additional −1.
      bonusDelta -= 1;
      notes.push("non-proficient 0th-level character (additional −1)");
    }
    // Regardless of level: no attribute BONUS on the attack throw. Penalties
    // are not bonuses and still apply, so only a positive modifier is
    // cancelled. Core pushed str.mod (melee) or dex.mod (missile).
    if (options.type === "melee" || options.type === "missile") {
      const attr = Number(actor.system?.scores?.[options.type === "missile" ? "dex" : "str"]?.mod ?? 0);
      if (attr > 0) {
        bonusDelta -= attr;
        notes.push(`no attribute bonus on attack throws (−${attr})`);
      }
    }
    // Name the failed requirement(s) for the chat/console note.
    if (usingNonProfWeapon) notes.push(`${item.name}: weapon unusable by class`);
    if (!loadout.styleProficient) notes.push(`untrained ${loadout.activeStyle} fighting style`);
    if (loadout.armor && !loadout.armorProficient) notes.push(`${loadout.armor.name}: armour unusable by class`);
  }

  // Weapon Finesse — DEX replaces STR on the attack throw. Core pushed str.mod
  // for melee, so contribute the difference. Not while non-proficiently
  // equipped: no attribute grants any bonus then, so there is nothing to swap.
  if (item && !loadout.nonProficientUse && !usingNonProfWeapon &&
      options.type === "melee" && FINESSE_SIZES.includes(profile.size) && hasEffectFlag(actor, EFFECT_DOMAINS.FINESSE)) {
    const str = Number(actor.system?.scores?.str?.mod ?? 0);
    const dex = Number(actor.system?.scores?.dex?.mod ?? 0);
    if (dex !== str) {
      bonusDelta += dex - str;
      notes.push(`Weapon Finesse (DEX ${dex >= 0 ? "+" : ""}${dex} instead of STR ${str >= 0 ? "+" : ""}${str})`);
    }
  }

  // Medium weapon wielded two-handed deals its larger die (RR p. 299).
  if (item && options.type === "melee" && entry?.wieldTwoHanded && profile.damage2h) {
    damage = profile.damage2h;
    notes.push(`two-handed grip (${profile.damage2h})`);
  }

  // A damage-attribute substitution (Strength of Faith: Wisdom in place of
  // Strength). Core's melee branch pushes str.mod onto the damage parts, so
  // fold the difference into the damage string — the same technique the
  // two-handed upsize above uses, and it composes with it because the upsize
  // has already chosen the die by this point. Skipped for a weapon that takes
  // no damage bonus: the strip below is about to remove Strength entirely, and
  // there is no bonus left to substitute for.
  if (item && options.type === "melee" && !profile.special?.includes("noDamageBonus")) {
    const sub = damageAttributeDelta(actor);
    if (sub) {
      const base = damage ?? item.system?.damage ?? profile.damage ?? "1d6";
      damage = withDelta(base, sub.delta);
      notes.push(`${sub.attribute.toUpperCase()} instead of STR on damage (${sub.delta > 0 ? "+" : "−"}${Math.abs(sub.delta)})`);
    }
  }

  // No-damage-bonus weapons (a torch, RR p148/p300): it deals its bare die and
  // gains NO bonus from STR, class, or the like. Core's rollAttack pushes the
  // weapon's damage string, THEN str.mod (melee), THEN damage.mod.melee/missile
  // — so fold a cancelling negative into the damage string to strip only the
  // POSITIVE bonus (a STR/class PENALTY still applies — it is not a bonus).
  if (item && profile.special?.includes("noDamageBonus") && (options.type === "melee" || options.type === "missile")) {
    const base = damage ?? item.system?.damage ?? profile.damage ?? "1d4";
    const str = options.type === "melee" ? Math.max(0, Number(actor.system?.scores?.str?.mod ?? 0)) : 0;
    const classMod = Math.max(0, Number(actor.system?.damage?.mod?.[options.type] ?? 0));
    const strip = str + classMod;
    if (strip > 0) {
      damage = `${base} - ${strip}`;
      notes.push(`no damage bonus (torch): −${strip}`);
    } else if (damage == null) {
      damage = base; // ensure the (unchanged) die is carried so the note stands
    }
  }

  // Thrown weapons add STRENGTH to DAMAGE (RR p298: "Apply the attribute bonus
  // or penalty for Strength ... to damage rolls with thrown weapons"), but core's
  // missile branch pushes no str.mod (correct for bows, wrong for a hurled axe).
  // So when a thrown weapon is used at range, contribute str.mod to its damage.
  // Splash flasks (burning oil, holy water) are excluded by RAW and already carry
  // `noDamageBonus`, so the strip above owns them and this never doubles up.
  //
  // A damage-attribute substitution applies here too — this IS a damage roll
  // Strength modifies, which is the clause Strength of Faith is written
  // against. Unlike the melee branch it is applied to the attribute BEFORE the
  // contribution rather than as a correction after it, because core pushed
  // nothing here to correct.
  if (item && options.type === "missile" && profile.thrown &&
      !profile.special?.includes("splash") && !profile.special?.includes("noDamageBonus")) {
    const sub = damageAttributeDelta(actor);
    const str = Number(actor.system?.scores?.str?.mod ?? 0) + (sub?.delta ?? 0);
    if (str) {
      const base = damage ?? item.system?.damage ?? profile.damage ?? "1d6";
      damage = withDelta(base, str);
      const label = sub ? sub.attribute.toUpperCase() : "Strength";
      notes.push(`thrown weapon: ${label} ${str > 0 ? "+" : "−"}${Math.abs(str)} to damage`);
    }
  }

  if (!bonusDelta && !damage) return null;
  return { bonusDelta, damage, notes };
}

/** Apply the modifiers to a COPY of the throwaway plain item object. */
function applyMods(attData, mods) {
  // attData.item is a plain object (Item#toObject); attData.roll may hold live
  // Documents (targets), so clone only the item — never the whole attData.
  const item = foundry.utils.deepClone(attData.item);
  item.system.bonus = Number(item.system.bonus ?? 0) + mods.bonusDelta;
  if (mods.damage) item.system.damage = mods.damage;
  return { ...attData, item };
}

/**
 * Shots that have already paid for themselves, keyed by the attack's own data
 * object.
 *
 * ONE SHOT, ONE ROUND. Core's `targetAttack` builds a single attData per user
 * action and reuses it — mutating only `roll.target` — across one `rollAttack`
 * call per persistent target, so firing with three tokens targeted is three
 * rolls of one shot and must cost one bolt. Object identity IS the shot: every
 * fresh action (`rollWeapon`, the sheet's attack header, the range selector)
 * builds a new literal, and nothing else reuses one. A WeakSet needs no expiry
 * window — the entry dies with the throwaway object it keys.
 */
const spentShots = new WeakSet();

/** WRAPPER around AcksActor#rollAttack. Fails safe: any error → core's roll. */
async function onRollAttack(wrapped, attData, options = {}) {
  // Captured before applyMods swaps in its copy: the ORIGINAL object is the
  // one core reuses per target, so it is the only valid shot key.
  const shot = attData;
  try {
    const mods = computeAttackMods(this, attData, options);
    if (mods) {
      Hooks.callAll(HOOKS.PRE_ROLL_ATTACK, this, attData.item, mods, { attData, options });
      console.debug(`${MODULE_ID} | attack mods for ${attData.item?.name}:`, mods.notes.join("; "));
      attData = applyMods(attData, mods);
    }
  } catch (err) {
    console.error(`${MODULE_ID} | attack-roll wrap failed; using the unmodified core roll`, err);
  }
  const result = await wrapped(attData, options);
  // Consume ammunition / mark a thrown weapon only once the roll RESOLVED, and
  // only once per shot. A cancelled roll spends nothing: both the remodeled roll
  // and core's own return nullish when the details dialog is dismissed. The shot
  // is marked BEFORE the async spend, so the next target in core's loop sees it
  // marked no matter how the write settles; fire-and-forget past that point, so
  // a failed decrement can never block or fail the attack.
  try {
    const realItem = attData?.item?._id ? this.items?.get?.(attData.item._id) : null;
    const keyable = !!shot && typeof shot === "object"; // WeakSet.add throws on a primitive
    if (result != null && realItem?.type === "weapon" && keyable && !spentShots.has(shot)) {
      spentShots.add(shot);
      consumeForAttack(this, realItem, classifyWeapon(realItem), options).catch((err) =>
        console.error(`${MODULE_ID} | ammunition consumption failed`, err),
      );
    }
  } catch (err) {
    console.error(`${MODULE_ID} | ammunition consumption skipped`, err);
  }
  return result;
}

/**
 * WRAPPER around AcksActor#computeEncumbrance.
 *
 * FLAGGED: this wraps a core method that acks-formation depends on (it reads the
 * resulting system.encumbrance / movementacks for party speed). It is an
 * ENHANCE, not a replacement — core's own sum runs untouched and we adjust the
 * total afterwards, so formation keeps reading one consistent number and the two
 * modules cannot disagree. Only RAW rules a flat sum gets wrong are corrected
 * (adventurer's harness, bowquiver); with no containers in play the delta is 0
 * and this is a pass-through.
 *
 * Core calls _calculateMovement() at the END of computeEncumbrance, so any
 * adjustment must recompute movement or speed would reflect the pre-correction
 * weight.
 *
 * HANDOFF: a core `system.encumbrance.mod` field (the way `aac.mod` lets us
 * correct AC without a patch) would let this wrap be deleted entirely.
 */
function onComputeEncumbrance(wrapped, ...args) {
  const result = wrapped(...args);
  try {
    if (this.type !== "character") return result;
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

export function registerRollWrap() {
  // rollAttack is OWNED by the lib feature's patch, which registers the single
  // libWrapper OVERRIDE for it and composes this wrapper around itself. As two
  // separate modules these were two libWrapper registrations and composed for
  // free; as one module the second registration throws ("a wrapper for ... has
  // already been registered by module acks-extras") and takes the whole `ready`
  // hook down with it. Same order, same semantics, one registration.
  globalThis.acksExtras?.lib?.wrapRollAttack?.(onRollAttack);
  libWrapper.register(MODULE_ID, "CONFIG.Actor.documentClass.prototype.computeEncumbrance", onComputeEncumbrance, "WRAPPER");
  console.debug(`${MODULE_ID} | attack-roll and encumbrance wrappers registered.`);
  void CONFIG;
}
