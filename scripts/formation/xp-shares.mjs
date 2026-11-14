/* global game */
/**
 * Dividing an adventure's experience among the people who earned it (RR ch. 6,
 * experience from adventuring; RR ch. 4 for henchmen's shares).
 *
 * The fallen still count: nothing here filters on a member being down. A
 * henchman's share is their own record's `terms.xpShare`, else the imported one
 * (`henchmen/rules/wages.mjs`, RR ch. 6); with neither, they take no computed
 * share and the division says why. Hired mercenaries and specialists are paid
 * in wages, and animals, wagons and anything summoned are not party members;
 * all take nothing.
 */
import { MODULE_ID } from "./constants.mjs";
import { getMemberActor, realMembers } from "./formation-model.mjs";
import { withXpBonus } from "../classes/xp-bonus.mjs";
import { earnsExperience, hirelingKind, UNSHARED_BASES } from "../lib/actor-read.mjs";
import { creditExperience, keepsExperienceOnFlag } from "../lib/experience.mjs";
import { importedShare, resolveShare } from "../henchmen/rules/wages.mjs";

export { hirelingKind, UNSHARED_BASES };

/** The source a Deal XP credit is recorded under; the Service panel's tooltip names it. */
export const DEAL_SOURCE = "deal";

/** No key-attribute adjustment: the default for a division with no reader. */
const NO_BONUS = Object.freeze({ bonus: 0, source: null });

const LANG_PREFIX = "ACKS-FORMATION.xp";

/** The henchman record, if this actor is a hireling of any kind. */
const recordOf = (actor) => actor?.getFlag?.(MODULE_ID, "record") ?? null;

/**
 * The system stores a character's share as a percentage (a full share is this
 * value) while a henchman's record stores a fraction of one full share.
 * Everything here is normalised to fractions of one full share.
 */
export const SYSTEM_FULL_SHARE = 100;

/**
 * Why a participant takes the share they take, so the dialog can show its
 * working.
 */
export const SHARE_REASON = Object.freeze({
  full: "full", // a player character
  henchman: "henchman", // the record's own share, else the imported one
  notImported: "notImported", // a henchman, with no share set or imported
  mercenary: "mercenary", // paid in wages
  notAPerson: "notAPerson", // a wagon, a mule, a summoned thing
  noShare: "noShare", // a share explicitly set to zero
  npc: "npc", // no player owns them and nobody hired them
});

/**
 * What one actor is owed, as a multiplier of one full share.
 *
 * @returns {{share: number, reason: string}}
 */
export function shareFor(actor) {
  if (!actor) return { share: 0, reason: SHARE_REASON.notAPerson };

  // A vehicle or anything else that is not a person takes no share.
  if (actor.type !== "character" && actor.type !== "monster") {
    return { share: 0, reason: SHARE_REASON.notAPerson };
  }

  const kind = hirelingKind(actor);
  // Paid in coin: no experience, however long they marched.
  if (kind && kind !== "henchman") return { share: 0, reason: SHARE_REASON.mercenary };
  if (kind) {
    // The record's own figure, else the imported one, else none; a missing
    // figure is tested before any `Number()`, which reads null as zero.
    const { value, from } = resolveShare(recordOf(actor)?.terms?.xpShare, importedShare("xp"));
    if (value == null) return { share: 0, reason: SHARE_REASON.notImported };
    return value > 0
      ? { share: value, reason: SHARE_REASON.henchman, from }
      : { share: 0, reason: SHARE_REASON.noShare };
  }

  // A monster nobody hired is not a party member.
  if (actor.type !== "character") return { share: 0, reason: SHARE_REASON.notAPerson };

  // Experience is tracked for player characters and henchmen only.
  if (!earnsExperience(actor)) return { share: 0, reason: SHARE_REASON.npc };

  // A player's character takes a full share scaled by the system's
  // `details.xp.share`, read as a percentage.
  const own = Number(actor.system?.details?.xp?.share);
  const value = Number.isFinite(own) && own > 0 ? own / SYSTEM_FULL_SHARE : 1;
  return { share: value, reason: SHARE_REASON.full };
}

/**
 * Divide `total` among these actors.
 *
 * Pure arithmetic over the shares, with no writes, so the dialog can preview it.
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

  // Nobody takes a share: no division.
  if (!shares) return { rows: [], shares: 0, perShare: 0, awarded: 0, excluded };

  const perShare = amount / shares;
  // Rounded down per character, as core does.
  const rows = taking.map((r) => {
    const base = Math.floor(r.share * perShare);
    const { bonus = 0, source = null } = bonusOf(r.actor) ?? NO_BONUS;
    return { ...r, base, bonus, bonusSource: source, xp: withXpBonus(base, bonus), onRecord: keepsExperienceOnFlag(r.actor) };
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
 * Credit every row through `creditExperience`: a character through the
 * system's own `getExperience`, so its chat line and whatever else core does
 * with a gain keep happening; a monster or an animal onto its own flag, since
 * the system keeps no experience for it (those rows are `onRecord`).
 *
 * Core applies only the Actor Tweaks percentage, and applies it itself: a
 * character row whose adjustment came from there hands core the unadjusted
 * base, any other row the adjusted gain. Each row carries what was credited
 * as `credited`, null where nothing was.
 */
export async function awardXp(division) {
  for (const row of division.rows ?? []) {
    if (!row.xp) continue;
    const handed = row.bonusSource === "tweaks" && !row.onRecord ? row.base : row.xp;
    row.credited = await creditExperience(row.actor, handed, { source: DEAL_SOURCE });
  }
  return division;
}

/**
 * Everyone a formation would divide XP among, the dead included.
 */
export function participantsOf(formation) {
  return realMembers(formation).map(getMemberActor).filter(Boolean);
}

/** A label for why someone was left out, for the card and the dialog. */
export const reasonLabel = (reason) => game.i18n.localize(`${LANG_PREFIX}.reason.${reason}`);
