/**
 * The range the acks system holds a loyalty or morale score to, read off its
 * data model, and the clamp that holds a computed score inside it.
 *
 * The bounds come from the system's schema field for an actor TYPE, not from
 * an actor, so they answer before a hireling exists. A side the field does
 * not bound, or a system that does not carry the field, is null, and the
 * score stays open on that side; no range is written here.
 */
/**
 * The `{min, max}` the system's data model for an actor `type` holds the field
 * at `path` (relative to `system`) to.
 * @param {string} type
 * @param {string} path
 * @returns {{min: number|null, max: number|null}}
 */
export function schemaBounds(type, path) {
  const field = globalThis.CONFIG?.Actor?.dataModels?.[type]?.schema?.getField?.(path);
  const bound = (n) => (Number.isFinite(n) ? n : null);
  return { min: bound(field?.min), max: bound(field?.max) };
}

/** The range the system holds a hireling's loyalty score to, for an actor `type`. */
export const loyaltyBounds = (type) => schemaBounds(type, "retainer.loyalty");

/** The range the system holds a morale score to, for an actor `type`; a monster's differs from a character's. */
export const moraleBounds = (type) => schemaBounds(type, "details.morale");

/**
 * Round a loyalty or morale score and hold it to `bounds` (`loyaltyBounds`,
 * `moraleBounds`). A side the bounds do not name stays open.
 * @param {number} v
 * @param {{min?: number|null, max?: number|null}} [bounds]
 * @returns {number}
 */
export function clampScore(v, bounds) {
  const { min, max } = bounds ?? {};
  let score = Math.round(v);
  if (Number.isFinite(min)) score = Math.max(min, score);
  if (Number.isFinite(max)) score = Math.min(max, score);
  return score;
}
