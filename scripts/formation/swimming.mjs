/**
 * Water too deep to stand in (RR ch. 6).
 *
 * It is derived here, beside the Spelunking table and not in it: the target is
 * the swimmer's encumbrance, the throw repeats every round at the start of
 * initiative while the water is deep, and failing starts a drowning.
 *
 * The file owns the procedure. Every magnitude (the Swimming bonus, the penalty
 * sizes a Judge may set, the speed share, the sink rate, the breath) arrives
 * registered through `formationValue`, and each reads as unknown until it does.
 * The throw's water penalty is the Judge's: a size picked from the imported
 * steps or typed larger, passed in with the conditions that are its reason.
 * See docs/formation/DECISIONS.md, "Swimming's printed magnitudes move to the register".
 */

import { hasCapability } from "../lib/capabilities.mjs";
import { carriedBody, formationValue } from "./constants.mjs";
import { hasAbility } from "./formation-model.mjs";

const LANG_PREFIX = "ACKS-FORMATION.swimming";
const SWIMMING = /\bswimming\b/i;

/**
 * The water conditions a Judge ticks as the reason for a penalty, one key per
 * condition the page names. Calm water is no key: nothing ticked is no penalty.
 * No condition carries a size of its own; the penalty is one figure the Judge
 * sets (`waterPenaltySteps`).
 */
export const WATER = Object.freeze({
  cold: { label: `${LANG_PREFIX}.water.cold` },
  rough: { label: `${LANG_PREFIX}.water.rough` },
  fast: { label: `${LANG_PREFIX}.water.fast` },
});

/**
 * The penalty sizes the page prints for a Judge to pick from, as positive sizes
 * in printed order, or null until they are imported. The page leaves the end
 * open, so a larger size typed by hand is as valid as a step.
 */
export function waterPenaltySteps() {
  const steps = formationValue("swimWaterPenaltySteps");
  if (!Array.isArray(steps)) return null;
  const sizes = steps.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  return sizes.length ? sizes : null;
}

/**
 * A penalty as a size: a non-negative number, whatever sign it was passed with.
 * Nothing passed, or something that is no number, is no penalty.
 */
const penaltySize = (penalty) => {
  const n = Math.abs(Number(penalty));
  return Number.isFinite(n) ? n : 0;
};

/** What the Swimming proficiency is worth, or null until it is imported. */
export const swimmingBonus = () => formationValue("swimmingBonus");

/** The share of their speed a swimmer makes, or null until it is imported. */
export const swimSpeedShare = () => formationValue("swimSpeedShare");

/** Feet a drowning body sinks each round per stone, or null until imported. */
export const sinkFeetPerStone = () => formationValue("sinkFeetPerStone");

/** Rounds of breath before Constitution is applied, or null until imported. */
export const breathRounds = () => formationValue("breathRounds");

/**
 * Does this actor hold the Swimming proficiency: by the capability an imported
 * entry answers to, or by a hand-made ability of that name. The same union
 * `rest.mjs` reads for Endurance.
 */
export const holdsSwimming = (actor) => !!actor && (hasCapability(actor, "kw:swimming") || hasAbility(actor, SWIMMING));

/**
 * The throw one swimmer needs this round.
 *
 * A target of zero or less is no throw (`needed` is false) for a holder of the
 * Swimming proficiency only; anyone else still throws. A throw that needs an
 * imported figure it lacks returns a null target and names the missing figure
 * in `unknown`. The water penalty needs no import: it is whatever size the
 * caller passes, so a larger figure typed by a Judge prices the throw with
 * nothing imported.
 *
 * @param {object} o
 * @param {number} o.encumbrance what they are carrying, in stone
 * @param {boolean} [o.proficient] holds the Swimming proficiency: it adds the
 *   bonus and is what lets a zero target skip the throw
 * @param {number} [o.penalty] the water penalty as a size: an imported step
 *   (`waterPenaltySteps`) or a larger figure; none is no penalty
 * @param {string[]} [o.conditions] keys of WATER ticked as the penalty's reason
 * @returns {{target: number|null, needed: boolean|null, parts: object[], unknown: string[], conditions: string[]}}
 *   `conditions` is the ticked keys that are WATER's, in the order given
 */
export function swimmingThrow({ encumbrance = 0, proficient = false, penalty = 0, conditions = [] } = {}) {
  const stone = Math.max(0, Number(encumbrance) || 0);
  const parts = [{ key: "encumbrance", value: stone }];
  const unknown = [];

  const bonus = proficient ? swimmingBonus() : 0;
  if (proficient) {
    if (bonus == null) unknown.push("swimmingBonus");
    else parts.push({ key: "proficient", value: bonus });
  }

  const reason = [...new Set(Array.isArray(conditions) ? conditions : [])].filter((key) => key in WATER);
  const size = penaltySize(penalty);
  if (size) parts.push({ key: "water", value: -size, conditions: reason });

  if (unknown.length) return { target: null, needed: null, parts, unknown, conditions: reason };

  // A penalty is a size, so adding it raises the target.
  const target = stone - bonus + size;
  return { target, needed: target > 0 || !proficient, parts, unknown, conditions: reason };
}

/**
 * A swimmer's pace: their share of whichever speed they are using, or null
 * while the share is unknown.
 */
export const swimSpeed = (feet) => {
  const share = swimSpeedShare();
  if (share == null) return null;
  return Math.max(0, (Number(feet) || 0) * share);
};

/**
 * How long a drowning character has, and how deep they are when it runs out.
 *
 * Breath follows Constitution and the sink rate follows encumbrance. Each
 * magnitude is null on its own until imported.
 *
 * @returns {{rounds: number|null, feetPerRound: number|null, depthAtDeath: number|null}}
 */
export function drowning({ conMod = 0, encumbrance = 0 } = {}) {
  const base = breathRounds();
  // Arithmetic floor: a breath lasts at least one round.
  const rounds = base == null ? null : Math.max(1, base + (Number(conMod) || 0));

  const perStone = sinkFeetPerStone();
  const feetPerRound = perStone == null ? null : Math.max(0, Number(encumbrance) || 0) * perStone;

  const depthAtDeath = rounds == null || feetPerRound == null ? null : rounds * feetPerRound;
  return { rounds, feetPerRound, depthAtDeath };
}

/**
 * What a rescuer is lifting: the whole body and a share of what it carries,
 * both read through `carriedBody()`. Null until both figures are imported.
 */
export const rescueStone = (gearStone = 0) => {
  const { stone, gearShare } = carriedBody();
  if (stone == null || gearShare == null) return null;
  return stone + Math.max(0, Number(gearStone) || 0) * gearShare;
};

/**
 * Everyone in a formation, and what the water asks of each, with each one's
 * drowning outcome stated whether or not their throw fails.
 *
 * A row holds the proficiency when its `proficient` says so; a row that leaves
 * `proficient` out is read from its `actor` (`holdsSwimming`).
 *
 * @param {object[]} members [{ name, encumbrance, proficient, actor, conMod }]
 * @param {object} [water] `{ penalty, conditions }`, as `swimmingThrow` takes
 *   them; the same water for every member
 */
export function partySwim(members = [], { penalty = 0, conditions = [] } = {}) {
  return members.filter(Boolean).map((m) => {
    const proficient = m.proficient ?? holdsSwimming(m.actor);
    const throwFor = swimmingThrow({ encumbrance: m.encumbrance, proficient, penalty, conditions });
    return {
      name: m.name,
      ...throwFor,
      ifDrowning: drowning({ conMod: m.conMod, encumbrance: m.encumbrance }),
    };
  });
}
