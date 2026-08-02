/* global foundry */

/**
 * Reads the structured stat block published by the sibling **acks-monsters**
 * module (Full Monster Sheet) so the formation applies a creature's real
 * vision modes, senses, and movement instead of human defaults.
 *
 * The data lives in `actor.flags["acks-monsters"].extras` (typed there by a
 * `MonsterExtras` DataModel). We read the raw flag directly rather than through
 * that module's API, so this works whether or not acks-monsters is active — a
 * monster without the extended sheet simply reports nothing and the caller
 * falls back to the generic heuristics. Nothing here writes to the flag or the
 * core engine.
 */

const MONSTERS_ID = "acks-monsters";
const FLAG_EXTRAS = "extras";

/**
 * Vision modes that let a creature move in TOTAL darkness (ACKS Monstrous
 * Manual, Overview pp. 12–13):
 *   - lightless: sight in darkness to a range, counts as dim light;
 *   - blind: never relies on light (navigates by other senses).
 * Night Vision is deliberately excluded — it upgrades dim light but does
 * NOT function in total dark, so it must not be treated as dark sight.
 */
const DARK_VISION = new Set(["lightless", "blind"]);

/**
 * Non-visual senses that substitute for sight in darkness (their "sight"
 * counts as dim light, MM p. 13): echolocation and the mechanoreception
 * family. Acute hearing/olfaction only aid surprise, so they do NOT count.
 */
const DARK_SENSES = new Set(["echolocation", "mechAerial", "mechAquatic", "mechTerrestrial", "mechWebbed"]);

/** The monster's extended stat block, or null if it has no Full Monster Sheet. */
export function getMonsterExtras(actor) {
  const extras = actor?.getFlag?.(MONSTERS_ID, FLAG_EXTRAS);
  return extras && typeof extras === "object" && !foundry.utils.isEmpty(extras) ? extras : null;
}

/** True if the actor carries any structured senses/vision or speed data. */
function hasSenseData(extras) {
  return Array.from(extras.vision ?? []).length > 0 || (extras.otherSenses ?? []).length > 0;
}

/**
 * Whether a monster can operate in total darkness, read from its vision modes
 * and special senses. Returns:
 *   - true / false when the stat block records vision or senses (authoritative);
 *   - null when there is nothing to read, so the caller keeps its own heuristic.
 */
export function monsterSeesInDark(actor) {
  const extras = getMonsterExtras(actor);
  if (!extras || !hasSenseData(extras)) return null;
  for (const mode of Array.from(extras.vision ?? [])) {
    if (DARK_VISION.has(mode)) return true;
  }
  for (const sense of extras.otherSenses ?? []) {
    if (DARK_SENSES.has(sense?.type)) return true;
  }
  return false;
}

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
