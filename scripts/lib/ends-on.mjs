/**
 * The pure half of a record that ends when its bearer is hurt or attacks: which
 * records of an actor a cause ends. The tracker's half (`status-effects.mjs`,
 * `loseRecords`) deletes what this names.
 *
 * An `endsOn` flag is a list of causes. `damage` is the bearer losing hit
 * points; `attack` is the bearer making an attack throw of its own. A flag that
 * is not a list, and a word that is no cause, end nothing. Foundry-free.
 */
import { MODULE_ID, FLAG_ENDS_ON } from "./constants.mjs";

/** The things a record can end on. */
export const ENDS_ON_CAUSES = Object.freeze(["damage", "attack"]);

/**
 * A stored `endsOn` flag as its causes: each known word once, in the order
 * stored. Anything that is not a list gives none.
 *
 * @param {*} raw
 * @returns {string[]}
 */
export function readEndsOn(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((word) => ENDS_ON_CAUSES.includes(word)))];
}

/**
 * The ids of the effects that end on `cause`. An effect with no id, or one
 * whose flag does not name the cause, is left out; a disabled effect still
 * ends, since it is a record of the spell and not a state in force.
 *
 * @param {Iterable<object>} effects  Active Effects (or stand-ins carrying `id` and `flags`)
 * @param {string} cause  one of `ENDS_ON_CAUSES`
 * @returns {string[]}
 */
export function endedBy(effects, cause) {
  if (!ENDS_ON_CAUSES.includes(cause)) return [];
  const ids = [];
  for (const effect of effects ?? []) {
    if (!effect?.id) continue;
    if (readEndsOn(effect.flags?.[MODULE_ID]?.[FLAG_ENDS_ON]).includes(cause)) ids.push(effect.id);
  }
  return ids;
}
