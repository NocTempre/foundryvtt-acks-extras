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
 * the bare ids in `NONE`. A concentration answers `{ none: "untimed" }` with the
 * kind held (`held`) and, where the shape has them, its longest hold (`cap`) and
 * the time the effect outlasts it (`tail`), so a caller that tests `none` is
 * unchanged and the cast reads the rest.
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

/** The two kinds of concentration a spell prints. */
const HELD_KINDS = Object.freeze(["mobile", "stationary"]);

/**
 * What a concentration shape answers: `{none: "untimed", held}` with `held` the
 * kind the spell prints (mobile where blank), plus `cap`, the longest the
 * concentration may be held, for a maximum (times the caster level where the
 * maximum is per level), and `tail`, the time the effect runs on after
 * concentration ends, for a plus shape. A `cap` or a `tail` whose figures cannot
 * be read is itself a `{none}`.
 */
function concentration(duration, level) {
  const held = HELD_KINDS.includes(duration.concentration) ? duration.concentration : "mobile";
  const out = { none: NONE.untimed, held };
  if (duration.shape === "concentrationMax") {
    if (duration.maxPerLevel === true) {
      out.cap = Number.isFinite(level) && level > 0 ? convert(Number(duration.value) * level, duration.unit) : none(NONE.noLevel);
    } else out.cap = convert(Number(duration.value), duration.unit);
  } else if (duration.shape === "concentrationPlus") {
    const plus = duration.plus ?? {};
    out.tail = convert(Number(plus.value), plus.unit);
  }
  return out;
}

/**
 * A conjuration's duration as a held cast. A conjured creature serves while its
 * caster holds the cast, and the spell's printed duration is the longest the
 * hold lasts, so a timed duration (`{value, units}`) becomes a concentration
 * answer with that duration as its `cap`: `{none: "untimed", held: "mobile",
 * cap}`. A duration that is already a concentration, one that is not read, and
 * a cast that is not a conjuration come back as they were. The kind held is the
 * blank default, `mobile`.
 *
 * @param {{value: number, units: string}|{none: string}} duration  `castDuration`'s answer
 * @param {boolean} conjuration  whether the cast's creature is conjured (`summonIsConjuration`)
 * @returns {{value: number, units: string}|{none: string, held?: string, cap?: object, tail?: object}}
 */
export function heldByConjuration(duration, conjuration) {
  if (conjuration !== true || !duration || duration.none || !Number.isFinite(Number(duration.value)) || !duration.units) return duration;
  return { none: NONE.untimed, held: "mobile", cap: { value: duration.value, units: duration.units } };
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
  if (shape === "concentration" || shape === "concentrationMax" || shape === "concentrationPlus") return concentration(duration, level);
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
