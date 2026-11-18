/**
 * The caster level a cast scales with, resolved and never defaulted: a figure
 * the caster typed, else the class tradition that cast the spell (its
 * caster-level ladder at the class level, or the class level itself where the
 * ladder is blank), else a monster's own spellcasting level. A level nothing
 * answers is null, and the dialog asks for one. The invocation level a cast
 * reads its rows at is resolved here too (`invocationLevel`), apart from the
 * caster level and never defaulted from it. FOUNDRY-FREE: the class and
 * the ladder are read by the caller and passed in.
 */

/** The duration shapes whose figure scales with caster level. */
const LEVEL_SHAPES = Object.freeze(["perLevel", "basePlusPerLevel"]);

/** Is a LevelValue anything but a flat figure? A figure keyed on the invocation level is not read from the caster level, so it does not count. */
const scaled = (lv) => Boolean(lv) && typeof lv === "object" && (lv.kind ?? "flat") !== "flat" && !(lv.kind === "conditional" && lv.on === "invocationLevel");

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
 * one (a per-level shape, or a concentration maximum that is per level), the
 * range is a distance per level, the target count, the area's size, the Hit
 * Dice cap, the strict Hit Dice bound or the Hit Dice below which a target makes
 * no save is not flat, or
 * any of the rows' figures is not flat. A cast that never reads it does not ask for
 * it.
 *
 * @param {{duration?: {shape?: string}}|null} extras  the spell's flag
 * @param {object[]} rows  the rows the cast keeps
 */
export function levelNeeded(extras, rows) {
  for (const duration of [extras?.duration, extras?.reversedDuration]) {
    if (LEVEL_SHAPES.includes(duration?.shape)) return true;
    if (duration?.shape === "concentrationMax" && duration.maxPerLevel === true) return true;
  }
  if (extras?.range?.shape === "distancePerLevel") return true;
  const target = extras?.target;
  if (scaled(target?.count) || scaled(target?.area?.size) || scaled(target?.area?.width)) return true;
  if (scaled(target?.hdCap) || scaled(target?.hdBelow) || scaled(extras?.save?.exemptBelowHd)) return true;
  return (rows ?? []).some((row) => scaled(row?.value) || scaled(row?.max));
}

/**
 * A chosen invocation level as the cast reads it: a whole number from one up,
 * given as a number or as the digits of one, else null. Nothing is defaulted, so
 * a blank or a figure that is no level leaves it unset.
 * @param {*} v
 * @returns {number|null}
 */
export function invocationFigure(v) {
  const n = typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : v;
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/**
 * Is the invocation level asked of the caster: the tradition has a cap, or a kept
 * row or figure reads the scale (`reads`, judged over the raw rows and figures by
 * `readsInvocation`, before a gate or a flatten leaves no sign of it).
 * @param {{cap?: number|null, reads?: boolean}} ctx
 */
export const invocationOffered = ({ cap = null, reads = false } = {}) => invocationFigure(cap) !== null || reads === true;

/**
 * The invocation level of a cast. The caster chooses it between one and the
 * tradition's cap (`ctx.cap`), and with no cap types it by hand; a chosen level
 * above the cap is returned as chosen and judged by `overCap`. It is never taken
 * from the caster level or defaulted to the cap: a level nothing answers is null.
 *
 * @param {{cap?: number|null, reads?: boolean}} ctx  the cap the tradition gives (null where it has none) and whether a kept row or figure reads the scale
 * @param {{invocationLevel?: number|string|null}} [answer]  the dialog's answer
 * @returns {{value: number|null, source: "chosen"|"hand"|null, cap: number|null}}
 */
export function invocationLevel(ctx = {}, answer = {}) {
  const cap = invocationFigure(ctx?.cap);
  const value = invocationOffered(ctx) ? invocationFigure(answer?.invocationLevel) : null;
  return { value, source: value === null ? null : cap === null ? "hand" : "chosen", cap };
}

/**
 * The verdicts an invocation level draws, as plain findings the plan gives their
 * severity (`castVerdicts`): `overCap` where the level is above the tradition's cap,
 * and `invocationUnset` where a row or figure reads the scale and no level is set.
 * A level asked only because a tradition has a cap, with nothing reading it, is
 * never missing.
 *
 * @param {{value: number|null, cap: number|null, reads?: boolean}} level  `invocationLevel`'s answer with `reads`
 * @returns {Array<{key: "overCap"|"invocationUnset", max?: number, over?: number}>}
 */
export function invocationFindings(level) {
  if (!level) return [];
  const { value, cap } = level;
  if (value === null || value === undefined) return level.reads === true ? [{ key: "invocationUnset" }] : [];
  return cap !== null && cap !== undefined && value > cap ? [{ key: "overCap", max: cap, over: value - cap }] : [];
}
