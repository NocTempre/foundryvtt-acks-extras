/**
 * Water too deep to stand in (RR ch. 6).
 *
 * It is derived here, beside the Spelunking table and not in it: the target is
 * the swimmer's encumbrance, the throw repeats every round at the start of
 * initiative while the water is deep, and failing starts a drowning.
 *
 * The file owns the procedure. Every magnitude (the Swimming bonus, what cold
 * and rough water cost, the speed share, the sink rate, the breath) arrives
 * registered through `formationValue`, and each reads as unknown until it does.
 * See docs/formation/DECISIONS.md, "Swimming's printed magnitudes move to the register".
 */

import { carriedBody, formationValue } from "./constants.mjs";

const LANG_PREFIX = "ACKS-FORMATION.swimming";

/**
 * The water conditions a Judge chooses between.
 *
 * The keys name the options a select offers; `calm` is structurally zero. What
 * cold and rough water cost is looked up per throw.
 */
export const WATER = Object.freeze({
  calm: { label: `${LANG_PREFIX}.water.calm` },
  cold: { label: `${LANG_PREFIX}.water.cold` },
  rough: { label: `${LANG_PREFIX}.water.rough` },
});

/**
 * What the named water condition does to the throw, or null when the figure
 * has not been imported. Calm water is structurally zero.
 */
export function waterModifier(water = "calm") {
  if (water === "calm" || !(water in WATER)) return 0;
  const table = formationValue("swimWaterModifiers");
  const value = table?.[water];
  return value == null ? null : Number(value);
}

/** What the Swimming proficiency is worth, or null until it is imported. */
export const swimmingBonus = () => formationValue("swimmingBonus");

/** The share of their speed a swimmer makes, or null until it is imported. */
export const swimSpeedShare = () => formationValue("swimSpeedShare");

/** Feet a drowning body sinks each round per stone, or null until imported. */
export const sinkFeetPerStone = () => formationValue("sinkFeetPerStone");

/** Rounds of breath before Constitution is applied, or null until imported. */
export const breathRounds = () => formationValue("breathRounds");

/**
 * The throw one swimmer needs this round.
 *
 * A target of zero or less is no throw (`needed` is false). A throw that needs
 * an imported figure it lacks returns a null target and names the missing
 * figure in `unknown`.
 *
 * @param {object} o
 * @param {number} o.encumbrance what they are carrying, in stone
 * @param {boolean} [o.proficient] has the Swimming proficiency
 * @param {string} [o.water] a key of WATER
 * @returns {{target: number|null, needed: boolean|null, parts: object[], unknown: string[]}}
 */
export function swimmingThrow({ encumbrance = 0, proficient = false, water = "calm" } = {}) {
  const stone = Math.max(0, Number(encumbrance) || 0);
  const parts = [{ key: "encumbrance", value: stone }];
  const unknown = [];

  const bonus = proficient ? swimmingBonus() : 0;
  if (proficient) {
    if (bonus == null) unknown.push("swimmingBonus");
    else parts.push({ key: "proficient", value: bonus });
  }

  const modifier = waterModifier(water);
  if (modifier == null) unknown.push("swimWaterModifiers");
  else if (modifier) parts.push({ key: `water.${water}`, value: modifier });

  if (unknown.length) return { target: null, needed: null, parts, unknown };

  // A water penalty is stored negative, so subtracting it raises the target.
  const target = stone - bonus - modifier;
  return { target, needed: target > 0, parts, unknown };
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
 * @param {object[]} members [{ name, encumbrance, proficient, conMod }]
 * @param {string} [water] a key of WATER
 */
export function partySwim(members = [], water = "calm") {
  return members.filter(Boolean).map((m) => {
    const throwFor = swimmingThrow({ encumbrance: m.encumbrance, proficient: m.proficient, water });
    return {
      name: m.name,
      ...throwFor,
      ifDrowning: drowning({ conMod: m.conMod, encumbrance: m.encumbrance }),
    };
  });
}
