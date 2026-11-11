/**
 * Whether a party is mapping, decided from facts handed in (RR ch. 6, "Marching
 * and Mapping"). No Foundry globals, no settings and no tables: the
 * world-reading half is `mapping.mjs`, and the offline suite runs this one.
 *
 * Mapping is two checks that never merge. LIGHT decides whether anyone maps at
 * all: a mapper the light does not reach draws nothing, so the scene's
 * measurements are unknown and the fog closes. PROFICIENCY decides how good the
 * record is: a party mapping with no proficient mapper gets vague
 * measurements. A mapper who cannot work (down, dead, left behind) maps nothing
 * whatever the light.
 */

import { MEASURE_MODES } from "./measure-fuzz.mjs";

/** How a mapper came to be lit: the day outside, a light that reaches them, a flame whose reach is not imported, or the Judge's switch having the module assume light. */
export const LIT_BY = Object.freeze({
  AMBIENT: "ambient",
  LIGHT: "light",
  UNIMPORTED: "unimported",
  ASSUMED: "assumed",
});

/** Why a party is not mapping, or null when it is. */
export const MAP_BLOCK = Object.freeze({
  NONE: "none",
  COMBAT: "combat",
  HURRIED: "hurried",
  DOWN: "down",
  DARK: "dark",
});

/**
 * Is one mapper lit?
 *
 * With the light requirement off the module assumes light and nothing else is
 * read. Otherwise the day outside lights them; so does a light whose bright
 * reach covers their place (`reach` > 0); and so does a lit, open flame whose
 * reach no table gives (`unimportedFlame`), because a world that has imported
 * no light figures has no way to say it does not reach, and the surface says
 * "not imported" instead of a figure.
 *
 * @param {object} facts
 * @param {boolean} facts.needsLight the light requirement is on
 * @param {boolean} [facts.ambient] the scene is bright around the party
 * @param {number} [facts.reach] the bright radius of the strongest light reaching them, 0 for none
 * @param {boolean} [facts.unimportedFlame] a lit, open flame has no imported reach
 * @returns {{lit: boolean, litBy: string|null}}
 */
export function mapperLit({ needsLight, ambient = false, reach = 0, unimportedFlame = false }) {
  if (!needsLight) return { lit: true, litBy: LIT_BY.ASSUMED };
  if (ambient) return { lit: true, litBy: LIT_BY.AMBIENT };
  if (reach > 0) return { lit: true, litBy: LIT_BY.LIGHT };
  if (unimportedFlame) return { lit: true, litBy: LIT_BY.UNIMPORTED };
  return { lit: false, litBy: null };
}

/**
 * What one formation's mappers amount to.
 *
 * `proficient` counts only the mappers who are mapping (working and lit): a
 * proficient mapper in the dark draws nothing, so the lit hand beside them is
 * the record. A mapper's `maps` is `working && lit`.
 *
 * @param {{working: boolean, lit: boolean, litBy?: string|null, proficient: boolean}[]} mappers
 * @param {object} [state]
 * @param {boolean} [state.combat] the party is in a fight
 * @param {boolean} [state.hurried] the party is exploring at combat speed
 * @returns {{mapping: boolean, proficient: boolean, block: string|null,
 *   mappers: object[], working: number, lit: number}}
 */
export function formationMapping(mappers, { combat = false, hurried = false } = {}) {
  const rows = (mappers ?? []).map((m) => ({ ...m, maps: !!m.working && !!m.lit }));
  const working = rows.filter((m) => m.working).length;
  const lit = rows.filter((m) => m.working && m.lit).length;
  let block = null;
  if (!rows.length) block = MAP_BLOCK.NONE;
  else if (combat) block = MAP_BLOCK.COMBAT;
  else if (hurried) block = MAP_BLOCK.HURRIED;
  else if (!working) block = MAP_BLOCK.DOWN;
  else if (!lit) block = MAP_BLOCK.DARK;
  const mapping = block === null;
  const proficient = mapping && rows.some((m) => m.maps && m.proficient);
  return { mapping, proficient, block, mappers: rows, working, lit };
}

/**
 * What the scene's measurement reads, given every formation on it: exact in a
 * fight, and with a proficient mapping mapper; vague with a mapping mapper who
 * is not proficient; unknown ("?") when no formation is mapping.
 *
 * @param {{mapping: boolean, proficient: boolean}[]} verdicts `formationMapping` results
 * @param {{combat?: boolean}} [state] any formation on the scene is in a fight
 * @returns {string} a `MEASURE_MODES` value
 */
export function measureModeFor(verdicts, { combat = false } = {}) {
  if (combat) return MEASURE_MODES.OFF;
  if (verdicts.some((v) => v.mapping && v.proficient)) return MEASURE_MODES.OFF;
  return verdicts.some((v) => v.mapping) ? MEASURE_MODES.FUZZY : MEASURE_MODES.UNKNOWN;
}
