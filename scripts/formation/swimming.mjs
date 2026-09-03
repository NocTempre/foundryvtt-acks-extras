/**
 * Water too deep to stand in (RR ch. 6).
 *
 * Swimming looks like the other obstacles and is not one. The Spelunking
 * throws are a fixed target rolled once per hundred feet, and failure costs a
 * round or a fall. This is none of those:
 *
 *  - the target IS the swimmer's encumbrance, so a naked man swims freely and
 *    a mailed one is trying to make a throw he has no business making;
 *  - it is rolled EVERY ROUND, at the start of initiative, for as long as the
 *    water is deep;
 *  - failing does not cost progress, it starts a drowning — no actions, no
 *    further throws, and a sink rate measured in the same encumbrance that
 *    caused it.
 *
 * So it is derived here rather than added as two rows to the obstacle table,
 * where every one of those differences would have had to be a special case.
 *
 * What this file knows is the whole procedure above. What it does NOT know is
 * how much any of it is worth: the bonus for knowing how to swim, what cold
 * and rough water cost, the share of speed a swimmer makes, how fast a body
 * sinks, and how long a breath lasts are all read off a page. They arrive
 * registered, and until they do each is reported as unknown rather than
 * guessed — an invented default here would have a Judge drowning a character
 * on a number nobody printed.
 */

import { carriedBody, formationValue } from "./constants.mjs";

const LANG_PREFIX = "ACKS-FORMATION.swimming";

/**
 * The water conditions a Judge chooses between.
 *
 * The keys are this module's own vocabulary — something has to name the
 * options a select offers — and `calm` is zero because that is what calm
 * MEANS, not because a page says so. What cold and rough water cost is
 * printed, and is looked up per throw rather than frozen here.
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

/*
 * A drowning swimmer being hauled up counts as their own weight plus a share of
 * what their kit weighs — a rescuer takes the body whole and only some of its
 * baggage, because the rest is what is pulling them both down. That IS the
 * procedure and it stays; the two figures it needs are printed, and used to sit
 * here as a second copy of the same numbers `constants.mjs` already held. One
 * owner now: `carriedBody()`.
 */

/**
 * The throw one swimmer needs this round.
 *
 * A target of zero or less is not a throw at all: the rule says so outright,
 * and reporting it as "0+" would have a Judge rolling for a naked swimmer in
 * calm water every round of a crossing.
 *
 * The unencumbered case in calm water needs no imported figure at all — the
 * target is the encumbrance, which is the character's own. A throw that DOES
 * need one it has not got returns a null target and names what is missing, so
 * a caller can say which book is wanted instead of showing a wrong number.
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

  // The water's penalty makes the throw HARDER, so it raises the target the
  // same way the proficiency lowers it.
  const target = stone - bonus - modifier;
  return { target, needed: target > 0, parts, unknown };
}

/**
 * A swimmer's pace: their share of whichever speed they are using, or null
 * while the share is unknown — a swimmer of unknown pace is not a still one.
 */
export const swimSpeed = (feet) => {
  const share = swimSpeedShare();
  if (share == null) return null;
  return Math.max(0, (Number(feet) || 0) * share);
};

/**
 * How long a drowning character has, and how deep they are when it runs out.
 *
 * Breath is Constitution's, and the sink rate is encumbrance's — so the heavy
 * swimmer both drowns sooner and ends up further down, which is why a rescue
 * that starts late may not be able to reach them at all. Both magnitudes are
 * printed; each is null on its own until imported, so a caller may know the
 * depth while still not knowing the time.
 *
 * @returns {{rounds: number|null, feetPerRound: number|null, depthAtDeath: number|null}}
 */
export function drowning({ conMod = 0, encumbrance = 0 } = {}) {
  const base = breathRounds();
  // The floor is arithmetic, not a printed rule: a breath cannot last no
  // rounds, however bad the Constitution.
  const rounds = base == null ? null : Math.max(1, base + (Number(conMod) || 0));

  const perStone = sinkFeetPerStone();
  const feetPerRound = perStone == null ? null : Math.max(0, Number(encumbrance) || 0) * perStone;

  const depthAtDeath = rounds == null || feetPerRound == null ? null : rounds * feetPerRound;
  return { rounds, feetPerRound, depthAtDeath };
}

/** What a rescuer is lifting: the whole body, and a share of what it carries.
 *  Null until both printed figures have been imported — an unknown load is
 *  reported as unknown, never as nothing. */
export const rescueStone = (gearStone = 0) => {
  const { stone, gearShare } = carriedBody();
  if (stone == null || gearShare == null) return null;
  return stone + Math.max(0, Number(gearStone) || 0) * gearShare;
};

/**
 * Everyone in a formation, and what the water asks of each — so a Judge can
 * see before anyone enters that the mailed fighter is the one who will drown.
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
      // Stated for everyone, not only for those who fail: what a crossing
      // COULD cost is the thing worth knowing before it is attempted.
      ifDrowning: drowning({ conMod: m.conMod, encumbrance: m.encumbrance }),
    };
  });
}
