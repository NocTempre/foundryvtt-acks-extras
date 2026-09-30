/**
 * The one guard the pure market rules share: a printed value the caller was
 * meant to pass in. Every figure the rules use (a multiplier, a percentage, a
 * band edge) arrives from the imported tables through the engine, never from
 * this code, so a rule handed a value it cannot use throws instead of doing
 * arithmetic on NaN or on a guess. Pure module.
 */
import { numOrNull } from "../../lib/util.mjs";

/**
 * The value as a finite number.
 * @param {string} name - the argument's name, for the error
 * @param {*} value
 * @returns {number}
 * @throws {TypeError} when the value was not supplied as a finite number
 */
export function requireNumber(name, value) {
  const n = numOrNull(value);
  if (n === null) throw new TypeError(`markets rules: "${name}" is a printed value and must be passed in (got ${value})`);
  return n;
}
