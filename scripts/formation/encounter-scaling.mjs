/* global game, Roll */
/**
 * A wandering monster met on the wrong floor (JJ p. 36). A random encounter
 * table is written for a monster level; when the dungeon level it is drawn
 * on differs, the number appearing and the reaction roll both shift with
 * the difference, in exact opposite amounts, so one subtraction drives
 * both.
 */
import { postToJudges } from "../lib/roll-audience.mjs";
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
 * The tables a draw's results came from, each with the monster level it is
 * compared at. A result's `parent` is the table that produced it — the inner
 * one, when the named table's results are other tables — and a producing
 * table that states no level takes the named table's.
 *
 * @param {RollTable} named the table the zone or formation names
 * @param {TableResult[]} [results] what the draw produced
 * @returns {{table: RollTable, level: number}[]} one entry per producing
 *   table whose level resolves, in draw order
 */
export function shiftSources(named, results = []) {
  const sources = new Map();
  for (const result of results ?? []) {
    const table = result?.parent ?? named;
    const key = table?.uuid ?? table;
    if (!sources.has(key)) sources.set(key, { table, level: tableLevel(table) ?? tableLevel(named) });
  }
  return [...sources.values()].filter((source) => source.level);
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

/** The number actually encountered, rounded up as the book rounds it. */
export function scaleNumber(rolled, shift) {
  const n = Math.max(0, Number(rolled) || 0);
  if (!shift?.matched || !n) return n;
  return Math.max(1, Math.ceil(n * shift.multiplier));
}

/**
 * Announce what the difference did, to the Judge alone — a separate card
 * from the table's own draw, since the table result names a die, not a
 * count, and the adjustment is the Judge's to apply.
 */
export async function announceShift(table, { dungeonLevel, monsterLevel } = {}) {
  const shift = encounterShift({ dungeonLevel, monsterLevel });
  if (!shift.matched || !shift.steps) return shift;

  // The reaction roll is worth making here — it is a 2d6 the Judge would
  // otherwise roll by hand, and its modifier is the whole point of the rule.
  const reaction = await new Roll(`2d6 + ${shift.reaction}`).evaluate();

  // A card with markup of its own gets no roll box from Foundry, so the
  // reaction is drawn into the content under the line.
  await postToJudges({
    speaker: { alias: table?.name ?? game.i18n.localize(`${LANG_PREFIX}.encounter`) },
    flavor: game.i18n.localize(`${LANG_PREFIX}.flavor`),
    content: `<p>${game.i18n.format(`${LANG_PREFIX}.line`, {
      monster: monsterLevel,
      dungeon: dungeonLevel,
      steps: Math.abs(shift.steps),
      direction: game.i18n.localize(`${LANG_PREFIX}.${shift.steps > 0 ? "deeper" : "shallower"}`),
      multiplier: fraction(shift.multiplier),
      reaction: shift.reaction > 0 ? `+${shift.reaction}` : shift.reaction,
    })}</p>${await reaction.render()}`,
    rolls: [reaction],
  });
  return { ...shift, reactionTotal: reaction.total };
}

/** 2.25 → "2 1/4"-ish; the book writes these as repeated halves, so show both. */
function fraction(m) {
  if (Math.abs(m - Math.round(m)) < 0.001) return String(Math.round(m));
  return m.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
