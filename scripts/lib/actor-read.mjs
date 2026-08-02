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
 * The number that stands in for "level" across actor types: class level for a
 * character, Hit Dice for a monster (ACKS substitutes HD for level, MM 351).
 * This is exactly acks-influence's getActorHD and the core of henchmen's
 * wage-level read.
 */
export const hitDiceOrLevel = (actor) =>
  actor?.type === "character" ? classLevel(actor) : monsterHd(actor);
