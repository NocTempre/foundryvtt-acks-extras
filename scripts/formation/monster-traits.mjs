/**
 * The parts of a Full Monster Sheet stat block the FORMATION needs — currently
 * just exploration pace, so a monster party member marches at its own speed
 * rather than a human default.
 *
 * Senses moved to `lib/senses.mjs`: standalone actors and token vision ask the
 * same questions, and lib is the deepest level at which they are all true.
 */

import { getMonsterExtras } from "../lib/senses.mjs";

/**
 * A monster's dungeon exploration speed (feet/turn), read from its Speed table.
 * ACKS records speed as `[combat] / [exploration = running]`, so the RUN value
 * of the land row is the exploration rate; if the creature has no land row
 * (purely aquatic/aerial), its primary row's run is used. Returns a number, or
 * null when no speed table is present.
 */
export function monsterExplorationSpeed(actor) {
  const extras = getMonsterExtras(actor);
  const speeds = extras?.speeds;
  if (!Array.isArray(speeds) || !speeds.length) return null;
  const row = speeds.find((s) => s?.type === "land") ?? speeds[0];
  const run = Number(row?.run);
  return Number.isFinite(run) ? run : null;
}
