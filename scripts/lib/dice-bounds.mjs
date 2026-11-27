/* global Roll */
/**
 * The extremes and the mean of a dice formula, by Foundry's own `Roll`
 * evaluated minimized and maximized, so every die and function the system
 * rolls is read as it rolls. `Roll` is read when a function runs, so Node
 * tooling imports this file.
 */

/**
 * The lowest and highest total a formula can roll, or null where the formula is
 * empty, one `Roll` cannot parse or evaluate, or either extreme is no finite
 * number.
 * @param {string} formula
 * @returns {{min: number, max: number}|null}
 */
export function formulaBounds(formula) {
  if (typeof formula !== "string" || !formula.trim()) return null;
  try {
    const min = new Roll(formula).evaluateSync({ minimize: true }).total;
    const max = new Roll(formula).evaluateSync({ maximize: true }).total;
    return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
  } catch {
    return null;
  }
}

/**
 * The average of a formula's lowest and highest totals, or null wherever
 * `formulaBounds` is.
 * @param {string} formula
 * @returns {number|null}
 */
export function formulaAverage(formula) {
  const bounds = formulaBounds(formula);
  return bounds ? (bounds.min + bounds.max) / 2 : null;
}
