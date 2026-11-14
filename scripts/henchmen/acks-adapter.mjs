/* global game, ui, ChatMessage */
/**
 * THE ONLY file that reads or writes the acks system's actor schema
 * Everything degrades gracefully: a missing
 * field returns 0/null rather than throwing, so a system update breaks only
 * this file.
 *
 * Sanctioned writes: coin items (spendGold/grantGold), `system.retainer.*`
 * fields, and roster changes through the system's own addHenchman/delHenchman.
 */
import { MODULE_ID, FLAG_RETAIN_BONUS } from "./constants.mjs";
import { sumEffectModifiers } from "./effects.mjs";
import { henchmanLimitBase } from "./rules/wages.mjs";
import { clampScore, loyaltyBounds, moraleBounds } from "../lib/score-bounds.mjs";
// Generic actor reads (ability mod, class level, HD parse) live once in the
// lib subsystem — the influence feature reads the same schema. `monsterHd`'s
// union also covers the "1/2"-HD form. Henchman-specific reads (retainer,
// henchmenList, gold) stay here.
import { abilityMod, classLevel, monsterHd } from "../lib/actor-read.mjs";
import { ACTOR_TYPE } from "../lib/vocab.mjs";
// A bare `export … from` re-export creates no local binding — spendGold's
// receipt whisper needs the import itself.
import { gmIds } from "../lib/util.mjs";
import { gpText } from "../lib/money-logic.mjs";
import { acksExtras } from "../namespace.mjs";

/* ------------------------------ reads ------------------------------ */

/** The actor's Charisma modifier. */
export const getChaMod =(actor) => abilityMod(actor, "cha");

/** The Charisma modifier as the loyalty modifier; a core that still derives `cha.loyalty` is read first. */
export function getChaLoyalty(actor) {
  return Number(actor?.system?.scores?.cha?.loyalty ?? getChaMod(actor));
}

/** The Charisma score's modifier, or null where the actor has no Charisma score (a monster). */
function chaScoreMod(actor) {
  const mod = actor?.system?.scores?.cha?.mod;
  return typeof mod === "number" && Number.isFinite(mod) ? mod : null;
}

/**
 * The henchman allowance before powers: the imported base plus the actor's
 * Charisma modifier. Null where the actor has no Charisma score (a monster)
 * or the world has not imported the base; nothing stands in for either.
 */
export function getRetainBase(actor) {
  const mod = chaScoreMod(actor);
  if (mod === null) return null;
  const base = henchmanLimitBase();
  return base === null ? null : base + mod;
}

/**
 * Why `getRetainBase` is null for `actor`: "charisma" where it has no
 * Charisma score, "import" where the world has not imported the base, null
 * where it holds a figure. The actor's own gap is named first, since an
 * import never closes it.
 */
export function retainGap(actor) {
  if (chaScoreMod(actor) === null) return "charisma";
  return henchmanLimitBase() === null ? "import" : null;
}

/**
 * The most henchmen `actor` may lead: `getRetainBase` + the typed
 * `retainBonus` effects + the manual flag. Null where the base is, and an
 * unknown limit is never enforced.
 */
export function getRetainMax(actor) {
  const base = getRetainBase(actor);
  if (base === null) return null;
  const manual = Number(actor?.getFlag?.(MODULE_ID, FLAG_RETAIN_BONUS) ?? 0);
  return base + sumEffectModifiers(actor, "retainBonus") + (Number.isFinite(manual) ? manual : 0);
}

/** The actor's class level, as the lib subsystem reads it. */
export const getLevel = classLevel;

/** The actor's morale score, 0 where none is stored. */
export function getMorale(actor) {
  return Number(actor?.system?.details?.morale ?? 0);
}

/** The score ranges are `lib/score-bounds.mjs`'s; the adapter re-exports them for its callers. */
export { loyaltyBounds, moraleBounds };

/** The actor's core retainer block, each field coerced to its type with a default for a missing one. */
export function getRetainer(actor) {
  const r = actor?.system?.retainer ?? {};
  return {
    enabled: !!r.enabled,
    loyalty: Number(r.loyalty ?? 0),
    wage: Number(r.wage ?? 0) || 0, // core stores wage as a String
    managerid: r.managerid ?? "",
    category: r.category ?? "henchman",
    quantity: Number(r.quantity ?? 1),
  };
}

/** True where the actor's retainer block is enabled. */
export function isRetainer(actor) {
  return !!actor?.system?.retainer?.enabled;
}

/** The world actor named by the retainer's `managerid`, or null where none is set. */
export function getManager(actor) {
  const id = actor?.system?.retainer?.managerid;
  return id ? game.actors.get(id) : null;
}

/** Actor ids in the employer's core henchmen list. */
export function getHenchmenIds(actor) {
  return Array.isArray(actor?.system?.henchmenList) ? [...actor.system.henchmenList] : [];
}

/** A monster's HD rating from `system.hp.hd` (lib's union parser). */
export const getMonsterHd = monsterHd;

/**
 * "Level" for wage purposes: class level for characters, HD for monsters
 * (MM 351 — substitute Hit Dice for level). Monster extras win when
 * present (integrations/monsters.mjs passes them through here).
 */
export function getWageLevel(actor) {
  if (actor?.type === ACTOR_TYPE.monster) {
    const extras = game.modules.get("acks-extras")?.api?.monsters?.getExtras?.(actor);
    const hd = Number(extras?.hd?.count);
    return Number.isFinite(hd) && hd > 0 ? hd : getMonsterHd(actor);
  }
  return getLevel(actor);
}

/* ------------------------------ coins ------------------------------ */

/**
 * What the actor can pay with, in gp — the lib's one reading of the coin a
 * payment may draw on (`spendableGp`), every store inside `within`.
 */
export const getGold = (actor, { within = null } = {}) => acksExtras.lib.money.spendableGp(actor, { within });

/**
 * Spend gp from an actor's coin. With `to` (an actor or a location) the coins
 * move there through the lib's location-gated transfer; without one the payee
 * is off-stage and the coin leaves the world through the lib's sink. Both
 * plan the spend the same way. Returns false (and warns) when funds are
 * insufficient or the transfer is refused.
 * @param {Actor} actor
 * @param {number} gp
 * @param {string} reason - for the chat receipt and any refusal warning
 * @param {object} [opts]
 * @param {boolean} [opts.chat=true] - post a receipt to chat
 * @param {Actor}  [opts.to]   - the payee (actor or location); coin lands there
 * @param {Actor}  [opts.at]   - the place whose exchange terms govern change
 * @param {boolean} [opts.gate=true] - apply the reach gate
 * @param {"all"|"hand"|Actor|Scene|null} [opts.within] - how far the payment
 *   reaches into coin kept away from the actor (the lib's `transferCoin`)
 * @param {boolean} [opts.judge=false] - the Judge declares the payment (the
 *   lib's `judgeDeclares`): a reach refusal does not stop it
 */
export async function spendGold(actor, gp, reason, { chat = true, to = null, at = null, gate = true, within = null, judge = false } = {}) {
  const money = acksExtras.lib.money;
  if (to) {
    const r = await money.transferCoin({ from: actor, to, at, gp, reason, gate, within, judge });
    if (!r.ok) return false;
  } else {
    // The sink reports a short purse and leaves the telling to its caller.
    const r = await money.sinkCoin(actor, gp, { within });
    if (!r.ok) {
      ui?.notifications?.warn(
        game.i18n.format("ACKS-HENCHMEN.gold.insufficient", { name: actor.name, gp: gpText(gp), reason })
      );
      return false;
    }
  }
  if (chat) {
    ChatMessage.create({
      content: game.i18n.format("ACKS-HENCHMEN.gold.spent", { name: actor.name, gp: gpText(gp), reason }),
      speaker: ChatMessage.getSpeaker({ actor }),
      whisper: gmIds(),
    });
  }
  return true;
}

/**
 * Credit gp to an actor's coin. With `from` (a market's till, an employer) it
 * is a transfer out of that payer's coin; without one it is the Judge's mint,
 * in standard denominations, each landing as the actor's own coin of that rate
 * (the lib's `mintCoin`). Either way it lands where the actor keeps arriving
 * coin, as far as `within` reaches. `judge` is `spendGold`'s.
 * @returns {Promise<number>} the gp credited — 0 when a transfer was refused
 */
export async function grantGold(actor, gp, { from = null, at = null, allowMint = false, gate = true, within = null, judge = false } = {}) {
  if (!(Math.round(gp * 100) > 0)) return 0;
  const money = acksExtras.lib.money;
  if (from) {
    const r = await money.transferCoin({ from, to: actor, gp, at, allowMint, gate, within, judge });
    return r.ok ? gp : 0;
  }
  await money.mintCoin(actor, gp, { within });
  return gp;
}

/* ------------------------------ writes ------------------------------ */

/** Set retainer fields on a hireling actor (sanctioned core write). */
export async function setRetainer(actor, fields) {
  const update = {};
  for (const [k, v] of Object.entries(fields)) update[`system.retainer.${k}`] = v;
  return actor.update(update);
}

/** Write the effective loyalty score so core's own loyalty button agrees, held to the range the actor's type allows. */
export async function setLoyalty(actor, loyalty) {
  return actor.update({ "system.retainer.loyalty": clampScore(loyalty, loyaltyBounds(actor.type)) });
}

/** Roster changes go through the system's own methods (character hirelings). */
export async function addHenchman(employer, hirelingId) {
  if (typeof employer?.addHenchman === "function") return employer.addHenchman(hirelingId);
  throw new Error(`${MODULE_ID}: employer.addHenchman missing — incompatible acks version?`);
}

/** Removes a hireling from the employer's roster through the system's own `delHenchman`; throws where the system lacks it. */
export async function delHenchman(employer, hirelingId) {
  if (typeof employer?.delHenchman === "function") return employer.delHenchman(hirelingId);
  throw new Error(`${MODULE_ID}: employer.delHenchman missing — incompatible acks version?`);
}

/* ------------------------------ misc ------------------------------ */

export { gmIds };
