/**
 * Reading the acks SYSTEM's actor sheet — the small graceful-degradation
 * accessors that several modules each reimplemented.
 *
 * These read the system's character/monster schema and fall back to 0 when a
 * field is absent, so a module can ask "what is this actor's level / CHA mod /
 * hit dice" without every consumer re-deriving the path (and the edge cases).
 * Pure reads, no writes; Foundry-free (they touch only the plain `system`
 * object), so offline tooling can import them too.
 *
 * NOTE the ONE genuinely non-trivial bit is `monsterHd`: acks-henchmen and
 * acks-influence each parsed `system.hp.hd` slightly differently — henchmen
 * read a leading DECIMAL ("0.5d4" → 0.5) but missed the "1/2" fraction form,
 * influence read the FRACTION ("1/2" → 0.5) but mis-read a decimal and matched
 * a digit anywhere ("d8" → 8, grabbing the die size). This is the union: it
 * handles a plain number, the "a/b" fraction, and a leading integer-or-decimal,
 * anchored to the start so a die size can't be mistaken for a rating.
 */

/** An ability-score modifier ("cha", "wis", …), 0 when absent. */
import { ACTOR_TYPE } from "./vocab.mjs";
export const abilityMod = (actor, key) => Number(actor?.system?.scores?.[key]?.mod ?? 0);

/** A character's class level, 0 when absent. */
export const classLevel = (actor) => Number(actor?.system?.details?.level ?? 0);

/**
 * A monster's Hit Dice rating parsed from `system.hp.hd`. Handles a raw number,
 * an "a/b" fraction (½-HD monsters → 0.5), and a leading integer or decimal
 * ("3d8+1" → 3, "0.5d4" → 0.5). Anchored so "d8" (no leading rating) → 0, not 8.
 */
export function monsterHd(actor) {
  const hd = actor?.system?.hp?.hd;
  if (typeof hd === "number") return hd;
  const s = String(hd ?? "").trim();
  const frac = s.match(/^(\d+)\s*\/\s*(\d+)/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const m = s.match(/^\s*(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
}

/**
 * The roll formula a Hit Dice rating stands for — the inverse of `monsterHd`,
 * written to `system.hp.hd` so the header, the follower card and core's own
 * HP roll all read the rating the sheet was given. A whole count rolls that
 * many dice; a fraction of one die rolls one die scaled to the fraction (a ½
 * rating on a d8 is 1d4), never below d2; a bonus rides as a flat term. Null
 * when the count is absent or not positive, so a blank rating never writes.
 * @param {{count?:number, dieType?:number, bonus?:number}} hd
 * @returns {string|null}
 */
export function hdFormula({ count, dieType, bonus } = {}) {
  const c = Number(count);
  if (!(c > 0)) return null;
  const die = Number(dieType) > 0 ? Math.round(Number(dieType)) : 8;
  const dice = c >= 1 ? Math.round(c) : 1;
  const sides = c >= 1 ? die : Math.max(2, Math.round(die * c));
  const flat = Math.round(Number(bonus) || 0);
  const term = flat > 0 ? `+${flat}` : flat < 0 ? `${flat}` : "";
  return `${dice}d${sides}${term}`;
}

/**
 * The number that stands in for "level" across actor types: class level for a
 * character, Hit Dice for a monster (ACKS substitutes HD for level, MM 351).
 * This is exactly acks-influence's getActorHD and the core of henchmen's
 * wage-level read.
 */
export const hitDiceOrLevel = (actor) =>
  actor?.type === ACTOR_TYPE.character ? classLevel(actor) : monsterHd(actor);
