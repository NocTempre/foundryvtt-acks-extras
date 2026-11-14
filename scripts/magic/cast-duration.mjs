/**
 * What a cast's printed duration becomes on an Active Effect: the `{ value,
 * units }` pair Foundry's effect duration stores, read off the spell's own
 * duration object (`SpellExtras` `duration`, the imported shape). FOUNDRY-FREE:
 * the caster's level and the dice are passed in, so the figures here come from
 * the spell and the caster and nowhere else.
 *
 * Foundry's effect duration has no `weeks` unit and its `turns` unit is a
 * combat turn, so a week is seven days and an ACKS turn is `TURN_SECONDS` of
 * world time. A `rounds` duration maps onto Foundry's `rounds`, which the
 * engine ages only through a combat's own round counter; outside combat it
 * does not expire on the world clock, because the world's round length is
 * zero. The pair is right either way; the aging is Foundry's.
 *
 * A duration with no time to count (instantaneous, any concentration,
 * perpetual, indefinite, permanent, special) and one whose figures cannot be
 * read (a missing value, a unit mismatch, a level the shape needs but the
 * caller lacks) answer `{ none: <reason> }`, never a guess; the reasons are
 * the bare ids in `NONE`.
 */
import { TIME_UNITS } from "../lib/magic-vocab.mjs";
import { TURN_SECONDS } from "../lib/constants.mjs";

/** Why a duration yields no effect duration. Ids, not user-visible strings. */
export const NONE = Object.freeze({
  noShape: "noShape",
  untimed: "untimed",
  noFigure: "noFigure",
  noLevel: "noLevel",
  unitMismatch: "unitMismatch",
  noRoll: "noRoll",
  badRoll: "badRoll",
  fractional: "fractional",
  unknownUnit: "unknownUnit",
});

/** Foundry unit and the multiplier from an ACKS unit's count, one row per `TIME_UNITS` member. */
const UNIT_MAP = Object.freeze({
  rounds: { units: "rounds", factor: 1 },
  turns: { units: "seconds", factor: TURN_SECONDS },
  minutes: { units: "minutes", factor: 1 },
  hours: { units: "hours", factor: 1 },
  days: { units: "days", factor: 1 },
  weeks: { units: "days", factor: 7 },
  months: { units: "months", factor: 1 },
  years: { units: "years", factor: 1 },
});

/** Shapes that carry no time to count. */
const UNTIMED = new Set([
  "instantaneous",
  "concentration",
  "concentrationMax",
  "concentrationPlus",
  "perpetual",
  "indefinite",
  "permanent",
  "special",
]);

const none = (reason) => ({ none: reason });

/** `count` of an ACKS `unit` as an effect duration, or a `none`. */
function convert(count, unit) {
  if (!(unit in TIME_UNITS) || !(unit in UNIT_MAP)) return none(NONE.unknownUnit);
  if (!Number.isFinite(count) || count <= 0) return none(NONE.noFigure);
  const { units, factor } = UNIT_MAP[unit];
  const value = count * factor;
  // The effect's duration value is an integer; a fraction is refused, not rounded.
  if (!Number.isInteger(value)) return none(NONE.fractional);
  return { value, units };
}

/**
 * The effect duration for one cast.
 *
 * `roll(formula)` returns the formula's total synchronously (Foundry's
 * `new Roll(f).evaluateSync().total` serves); it is read only by the `dice`
 * shape. `casterLevel` is read only by the per-level shapes and has no
 * default: a caller without one gets `none`, never level one.
 *
 * @param {object} duration  The spell's duration object: `shape`, `value`,
 *   `unit`, `dice`, `plus: {value, unit}`.
 * @param {{casterLevel?: number, roll?: (formula: string) => number}} [context]
 * @returns {{value: number, units: string}|{none: string}}
 */
export function castDuration(duration, { casterLevel, roll } = {}) {
  const shape = duration?.shape;
  if (!shape) return none(NONE.noShape);
  if (UNTIMED.has(shape)) return none(NONE.untimed);
  const unit = duration.unit;
  const level = Number(casterLevel);
  switch (shape) {
    case "fixed":
      return convert(Number(duration.value), unit);
    case "perLevel":
      if (!Number.isFinite(level) || level <= 0) return none(NONE.noLevel);
      return convert(Number(duration.value) * level, unit);
    case "basePlusPerLevel": {
      if (!Number.isFinite(level) || level <= 0) return none(NONE.noLevel);
      const plus = duration.plus ?? {};
      // The two figures add only in one unit; a base in hours with a per-level
      // figure in turns has no single count to give Foundry.
      if (!unit || plus.unit !== unit) return none(NONE.unitMismatch);
      return convert(Number(duration.value) + Number(plus.value) * level, unit);
    }
    case "dice": {
      if (typeof roll !== "function") return none(NONE.noRoll);
      if (!duration.dice) return none(NONE.noFigure);
      let total;
      try {
        total = Number(roll(String(duration.dice)));
      } catch {
        return none(NONE.badRoll);
      }
      if (!Number.isFinite(total)) return none(NONE.badRoll);
      return convert(total, unit);
    }
    default:
      return none(NONE.noShape);
  }
}
