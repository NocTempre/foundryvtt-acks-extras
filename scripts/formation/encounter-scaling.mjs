/* global game, ChatMessage, Roll */
/**
 * A wandering monster met on the wrong floor (JJ ch. 2).
 *
 * A random encounter table is written for a monster LEVEL, and the party is on
 * a dungeon LEVEL, and when those disagree two things change at once — in the
 * same direction, which is what makes going too deep doubly unkind:
 *
 *  - the NUMBER appearing shifts by half again per step deeper, or halves per
 *    step shallower, rounding up. The book's own worked case: 1d6 wights are
 *    Level 3 monsters and the roll is a 4 — met on Dungeon Level 1 that is
 *    4 × ½ × ½ = 1 wight, and on Dungeon Level 5 it is 4 × 1½ × 1½ = 9;
 *  - the REACTION roll shifts by the same difference the other way. Those
 *    wights take −2 on level 5 and +2 on level 1, because numbers deeper down
 *    make monsters bold, while something powerful wandering an upper floor is
 *    more inclined to see the party as tools than as threats.
 *
 * The two numbers are exact opposites of one another, so one subtraction
 * drives both.
 */
import { MODULE_ID } from "./constants.mjs";

const LANG_PREFIX = "ACKS-FORMATION.scaling";

/** A table's monster level lives on the table, put there by whoever wrote it. */
export const LEVEL_FLAG = "monsterLevel";

/** The monster level a table is written for; null when it does not say. */
export function tableLevel(table) {
  const n = Number(table?.getFlag?.(MODULE_ID, LEVEL_FLAG) ?? table?.flags?.[MODULE_ID]?.[LEVEL_FLAG]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * How the encounter bends, given where it was drawn and what it was drawn
 * from. Steps are counted from the MONSTER's level to the DUNGEON's, so a
 * positive number means the party has gone deeper than the table assumes.
 *
 * @returns {{steps: number, multiplier: number, reaction: number, matched: boolean}}
 */
export function encounterShift({ dungeonLevel = 0, monsterLevel = 0 } = {}) {
  const d = Number(dungeonLevel) || 0;
  const m = Number(monsterLevel) || 0;
  // Without both levels there is nothing to compare, and an encounter must
  // never be silently scaled by a missing number.
  if (!d || !m) return { steps: 0, multiplier: 1, reaction: 0, matched: false };
  const steps = d - m;
  const multiplier = steps >= 0 ? 1.5 ** steps : 0.5 ** -steps;
  // `-steps` on a level match is negative zero, which prints as "-0" on the
  // card and reads as a penalty nobody applied.
  return { steps, multiplier, reaction: steps === 0 ? 0 : -steps, matched: true };
}

/**
 * The number actually encountered. Rounded UP, as the book rounds it — which
 * is why a deeply unlucky party still meets one wight rather than none.
 */
export function scaleNumber(rolled, shift) {
  const n = Math.max(0, Number(rolled) || 0);
  if (!shift?.matched || !n) return n;
  return Math.max(1, Math.ceil(n * shift.multiplier));
}

/**
 * Announce what the difference did, to the Judge alone. This is deliberately a
 * SEPARATE card from the table's own draw rather than a rewrite of it: the
 * table said what it says, and the adjustment is the Judge's to apply to a
 * number only they can see (the table result names a die, not a count).
 */
export async function announceShift(table, { dungeonLevel, monsterLevel } = {}) {
  const shift = encounterShift({ dungeonLevel, monsterLevel });
  if (!shift.matched || !shift.steps) return shift;

  // The reaction roll is worth making here — it is a 2d6 the Judge would
  // otherwise roll by hand, and its modifier is the whole point of the rule.
  const reaction = await new Roll(`2d6 + ${shift.reaction}`).evaluate();

  await ChatMessage.create({
    speaker: { alias: table?.name ?? game.i18n.localize(`${LANG_PREFIX}.encounter`) },
    flavor: game.i18n.localize(`${LANG_PREFIX}.flavor`),
    content: `<p>${game.i18n.format(`${LANG_PREFIX}.line`, {
      monster: monsterLevel,
      dungeon: dungeonLevel,
      steps: Math.abs(shift.steps),
      direction: game.i18n.localize(`${LANG_PREFIX}.${shift.steps > 0 ? "deeper" : "shallower"}`),
      multiplier: fraction(shift.multiplier),
      reaction: shift.reaction > 0 ? `+${shift.reaction}` : shift.reaction,
    })}</p>`,
    rolls: [reaction],
    whisper: ChatMessage.getWhisperRecipients("GM").map((u) => u.id),
  });
  return { ...shift, reactionTotal: reaction.total };
}

/** 2.25 → "2 1/4"-ish; the book writes these as repeated halves, so show both. */
function fraction(m) {
  if (Math.abs(m - Math.round(m)) < 0.001) return String(Math.round(m));
  return m.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
