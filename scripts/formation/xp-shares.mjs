/* global game */
/**
 * Dividing an adventure's experience among the people who earned it (RR ch. 6,
 * experience from adventuring; RR ch. 4 for henchmen's shares).
 *
 * Two points of the division do real work and are easy to lose:
 *
 *  - **the fallen still count.** Nothing here filters on a member being down:
 *    a character who died on the way out takes a share like the rest;
 *  - **a henchman's share is their own record's**, `terms.xpShare`, which the
 *    hiring negotiation may have moved — so the record is asked rather than a
 *    constant assumed.
 *
 * WHO GETS NOTHING. Hired mercenaries and specialists are paid in wages, not
 * experience. Neither do the animals, the wagons, or anything summoned: they
 * are not party members, they are equipment that happens to have a sheet.
 */
import { MODULE_ID } from "./constants.mjs";
import { getMemberActor, realMembers } from "./formation-model.mjs";
import { withXpBonus } from "../classes/xp-bonus.mjs";

/** No key-attribute adjustment: the default for a division with no reader. */
const NO_BONUS = Object.freeze({ bonus: 0, source: null });

const LANG_PREFIX = "ACKS-FORMATION.xp";

/** The henchman record, if this actor is a hireling of any kind. */
const recordOf = (actor) => actor?.getFlag?.(MODULE_ID, "record") ?? null;

/**
 * The system stores a character's share as a PERCENTAGE — a full share is 100,
 * not 1 — while a henchman's record stores a fraction (half a share is 0.5).
 * Everything here is normalised to fractions of one full share, or the two
 * scales silently mix and a henchman standing beside two players takes about a
 * two-hundredth of the loot instead of a fifth.
 */
export const SYSTEM_FULL_SHARE = 100;

/** Wage bases that mean "paid in coin, not in experience" (RR ch. 8). */
export const UNSHARED_BASES = Object.freeze(["mercenary", "specialist"]);

/**
 * Why a participant takes the share they take. Returned rather than assumed so
 * the dialog can show its working — a Judge dividing 4,000 XP should be able
 * to see that the wagon and the mercenaries were left out on purpose.
 */
export const SHARE_REASON = Object.freeze({
  full: "full", // a player character
  henchman: "henchman", // half, or whatever their terms say
  mercenary: "mercenary", // paid in wages
  notAPerson: "notAPerson", // a wagon, a mule, a summoned thing
  noShare: "noShare", // a share explicitly set to zero
});

/**
 * What one actor is owed, as a multiplier of one full share.
 *
 * @returns {{share: number, reason: string}}
 */
export function shareFor(actor) {
  if (!actor) return { share: 0, reason: SHARE_REASON.notAPerson };

  // Anything that is not a person does not adventure — it is carried, driven
  // or conjured. A vehicle is the clearest case and the reason this exists.
  if (actor.type !== "character" && actor.type !== "monster") {
    return { share: 0, reason: SHARE_REASON.notAPerson };
  }

  const record = recordOf(actor);
  if (record) {
    // Paid in coin: no experience, however long they marched.
    if (UNSHARED_BASES.includes(record.terms?.wageBasis)) {
      return { share: 0, reason: SHARE_REASON.mercenary };
    }
    const share = Number(record.terms?.xpShare);
    const value = Number.isFinite(share) ? share : 0.5;
    return value > 0
      ? { share: value, reason: SHARE_REASON.henchman }
      : { share: 0, reason: SHARE_REASON.noShare };
  }

  // A monster with no hireling record is not a party member — a summoned bear
  // and a charmed ogre both land here.
  if (actor.type !== "character") return { share: 0, reason: SHARE_REASON.notAPerson };

  // A player character takes a full share, scaled by whatever their own sheet
  // says — the system's `details.xp.share`, read as the percentage it is.
  const own = Number(actor.system?.details?.xp?.share);
  const value = Number.isFinite(own) && own > 0 ? own / SYSTEM_FULL_SHARE : 1;
  return { share: value, reason: SHARE_REASON.full };
}

/**
 * Divide `total` among these actors.
 *
 * Pure arithmetic over the shares — no writes — so the dialog can show the
 * whole division before a single point is awarded, and so the rule is
 * testable without a world.
 *
 * Each row carries its `base` share of the total and, after the key-attribute
 * adjustment `bonusOf` reports for that actor, the `xp` it actually gains.
 *
 * @param {Actor[]} actors
 * @param {number} total
 * @param {{bonusOf?: (actor: Actor) => {bonus: number, source: string|null}}} [opts]
 * @returns {{rows: object[], shares: number, perShare: number, awarded: number, excluded: object[]}}
 */
export function divideXp(actors = [], total = 0, { bonusOf = () => NO_BONUS } = {}) {
  const amount = Math.max(0, Number(total) || 0);
  const scored = actors.filter(Boolean).map((actor) => ({ actor, name: actor.name, ...shareFor(actor) }));
  const taking = scored.filter((r) => r.share > 0);
  const excluded = scored.filter((r) => r.share <= 0);
  const shares = taking.reduce((sum, r) => sum + r.share, 0);

  // Nobody to pay: say so rather than dividing by zero.
  if (!shares) return { rows: [], shares: 0, perShare: 0, awarded: 0, excluded };

  const perShare = amount / shares;
  // Rounded DOWN per character, as core does — the remainder is the Judge's
  // rounding, not a debt to anybody.
  const rows = taking.map((r) => {
    const base = Math.floor(r.share * perShare);
    const { bonus = 0, source = null } = bonusOf(r.actor) ?? NO_BONUS;
    return { ...r, base, bonus, bonusSource: source, xp: withXpBonus(base, bonus), unrecorded: r.actor.type !== "character" };
  });
  return {
    rows,
    shares,
    perShare,
    awarded: rows.reduce((sum, r) => sum + r.xp, 0),
    excluded,
  };
}

/**
 * Hand the experience over through the system's own `getExperience`, so its
 * chat line and whatever else core does with a gain keep happening.
 *
 * Core applies only the Actor Tweaks percentage, and applies it itself: a row
 * whose adjustment came from there hands core the unadjusted base, any other
 * row the adjusted gain. A row that is not a `character` is skipped — core's
 * call does nothing for it and the system gives it no experience field to
 * write — and stays `unrecorded` for the card to name.
 */
export async function awardXp(division) {
  for (const row of division.rows ?? []) {
    if (!row.xp || row.unrecorded) continue;
    const handed = row.bonusSource === "tweaks" ? row.base : row.xp;
    if (typeof row.actor.getExperience === "function") await row.actor.getExperience(handed);
    else {
      const now = Number(row.actor.system?.details?.xp?.value) || 0;
      await row.actor.update({ "system.details.xp.value": now + row.xp });
    }
  }
  return division;
}

/**
 * Everyone a formation would divide XP among — including the dead, who
 * returned alive or dead and are owed their share either way.
 */
export function participantsOf(formation) {
  return realMembers(formation).map(getMemberActor).filter(Boolean);
}

/** A label for why someone was left out, for the card and the dialog. */
export const reasonLabel = (reason) => game.i18n.localize(`${LANG_PREFIX}.reason.${reason}`);
