/**
 * A class's level cap, read through one door. The cap is the class's own
 * `maximumLevel`, printed on its page and read at import or typed on the class
 * sheet; a class holding none has no cap, and nothing here supplies one. See
 * docs/classes/MODEL.md, "Level cap".
 */

/**
 * The highest level a class reaches, or null where it sets none (a hand-made
 * class not yet given one, or an import that read none). Takes the class's
 * system data, so a mock with a bare `maximumLevel` reads the same way.
 */
export function levelCap(sys) {
  const cap = sys?.maximumLevel;
  return Number.isInteger(cap) && cap >= 1 ? cap : null;
}

/** A level held to the class's cap and to 1st; unbounded above where it has none. */
export function clampLevel(sys, level) {
  const cap = levelCap(sys);
  const held = Math.max(1, Number(level) || 1);
  return cap == null ? held : Math.min(held, cap);
}

/** Whether `level` is at or past the class's cap; false where it has none. */
export function atLevelCap(sys, level) {
  const cap = levelCap(sys);
  return cap != null && level >= cap;
}
