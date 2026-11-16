/**
 * The caster level a cast scales with, resolved and never defaulted: a figure
 * the caster typed, else the class tradition that cast the spell (its
 * caster-level ladder at the class level, or the class level itself where the
 * ladder is blank), else a monster's own spellcasting level. A level nothing
 * answers is null, and the dialog asks for one. FOUNDRY-FREE: the class and
 * the ladder are read by the caller and passed in.
 */

/** The duration shapes whose figure scales with caster level. */
const LEVEL_SHAPES = Object.freeze(["perLevel", "basePlusPerLevel"]);

/** Is a LevelValue anything but a flat figure? */
const scaled = (lv) => Boolean(lv) && typeof lv === "object" && (lv.kind ?? "flat") !== "flat";

/** A positive whole figure from a number or numeric text, else null. */
const positive = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
};

/** The ladder's value at `level`: the last rung at or below it, else null. */
function rungAt(ladder, level) {
  let found = null;
  for (const rung of [...(ladder?.values ?? [])].sort((a, b) => a.atLevel - b.atLevel)) {
    if (level >= rung.atLevel && Number.isFinite(Number(rung.value))) found = Number(rung.value);
  }
  return found;
}

/**
 * Resolve the caster level.
 *
 * @param {object} from
 * @param {number|string} [from.override]  a figure typed at the cast
 * @param {boolean} [from.matched]  a class tradition cast this spell
 * @param {number} [from.classLevel]
 * @param {{values: Array<{atLevel: number, value: number}>}|null} [from.ladder]  the tradition's caster-level ladder, null when it names none
 * @param {number|string} [from.monsterLevel]
 * @returns {{value: number|null, source: "hand"|"ladder"|"class"|"monster"|null, parts: Array<{key: string, value: number}>}}
 */
export function casterLevel({ override, matched = false, classLevel, ladder = null, monsterLevel } = {}) {
  const typed = positive(override);
  if (typed) return { value: typed, source: "hand", parts: [{ key: "hand", value: typed }] };
  const level = positive(classLevel);
  if (matched && level) {
    if (!ladder) return { value: level, source: "class", parts: [{ key: "classLevel", value: level }] };
    const rung = positive(rungAt(ladder, level));
    if (rung) return { value: rung, source: "ladder", parts: [{ key: "classLevel", value: level }, { key: "ladder", value: rung }] };
  }
  const monster = positive(monsterLevel);
  if (monster) return { value: monster, source: "monster", parts: [{ key: "monsterLevel", value: monster }] };
  return { value: null, source: null, parts: [] };
}

/**
 * Does this cast read a caster level at all? True when the duration scales with
 * one or any of the rows' figures is not flat. A cast that never reads it does
 * not ask for it.
 *
 * @param {{duration?: {shape?: string}}|null} extras  the spell's flag
 * @param {object[]} rows  the rows the cast keeps
 */
export function levelNeeded(extras, rows) {
  if (LEVEL_SHAPES.includes(extras?.duration?.shape)) return true;
  return (rows ?? []).some((row) => scaled(row?.value) || scaled(row?.max));
}
