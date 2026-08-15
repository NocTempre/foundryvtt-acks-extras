/* global game */
/**
 * Dividing an adventure's experience among the people who earned it.
 *
 * THE RULE (RR ch. 6): the sum of monster and treasure XP "is divided evenly
 * among all party members who returned to civilization (alive or dead), with
 * henchmen receiving a half share each." Two details in that sentence do real
 * work and are easy to lose:
 *
 *  - **alive or dead.** A character who died on the way out still returned,
 *    and still takes a share. Excluding the fallen is a common house error, so
 *    nothing here filters on being down;
 *  - **a half share for henchmen**, because they act under a player's command
 *    (RR ch. 4 says the same from the other side).
 *
 * AND WHO GETS NOTHING. Hired mercenaries and specialists "do not receive a
 * share" — they are paid in wages, not experience. Neither do the animals, the
 * wagons, or anything summoned: they are not party members, they are equipment
 * that happens to have a sheet.
 *
 * The share a henchman actually takes is on their own record
 * (`terms.xpShare`), which the hiring negotiation may have moved off the
 * default half — so the record is asked rather than the constant assumed.
 */
import { MODULE_ID } from "./constants.mjs";
import { getMemberActor, realMembers } from "./formation-model.mjs";

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
 * @param {Actor[]} actors
 * @param {number} total
 * @returns {{rows: object[], shares: number, perShare: number, awarded: number, excluded: object[]}}
 */
export function divideXp(actors = [], total = 0) {
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
  const rows = taking.map((r) => ({ ...r, xp: Math.floor(r.share * perShare) }));
  return {
    rows,
    shares,
    perShare,
    awarded: rows.reduce((sum, r) => sum + r.xp, 0),
    excluded,
  };
}

/**
 * Hand the experience over. Uses the system's own `getExperience` so whatever
 * core does with a gain — prime-requisite bonuses, level-up prompts — keeps
 * happening.
 */
export async function awardXp(division) {
  for (const row of division.rows ?? []) {
    if (!row.xp) continue;
    if (typeof row.actor.getExperience === "function") await row.actor.getExperience(row.xp);
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
