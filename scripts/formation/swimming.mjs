/**
 * Water too deep to stand in (RR ch. 6).
 *
 * Swimming looks like the other obstacles and is not one. The Spelunking
 * throws are a fixed target rolled once per hundred feet, and failure costs a
 * round or a fall. This is none of those:
 *
 *  - the target IS the swimmer's encumbrance, so a naked man swims freely and
 *    a mailed one is trying to make an 8+ he has no business making;
 *  - it is rolled EVERY ROUND, at the start of initiative, for as long as the
 *    water is deep;
 *  - failing does not cost progress, it starts a drowning — no actions, no
 *    further throws, and a sink rate measured in the same encumbrance that
 *    caused it.
 *
 * So it is derived here rather than added as two rows to the obstacle table,
 * where every one of those differences would have had to be a special case.
 */

const LANG_PREFIX = "ACKS-FORMATION.swimming";

/** What the water itself does to the throw. */
export const WATER = Object.freeze({
  calm: { label: `${LANG_PREFIX}.water.calm`, modifier: 0 },
  cold: { label: `${LANG_PREFIX}.water.cold`, modifier: -2 },
  rough: { label: `${LANG_PREFIX}.water.rough`, modifier: -4 },
});

/** Knowing how to swim is worth four. */
export const SWIMMING_BONUS = 4;

/** A swimmer makes a quarter of their speed, whether they crawl or race. */
export const SPEED_SHARE = 1 / 4;

/** How deep a drowning body sinks each round, per stone it carries. */
export const SINK_FEET_PER_STONE = 10;

/**
 * A drowning swimmer being hauled up counts as this much, plus half of what
 * their kit weighs — a rescuer takes the body's whole weight and only some of
 * its baggage, because the rest is what is pulling them both down.
 */
export const RESCUE_BODY_STONE = 7.5;
export const RESCUE_GEAR_SHARE = 1 / 2;

/**
 * The throw one swimmer needs this round.
 *
 * A target of zero or less is not a throw at all: the rule says so outright,
 * and reporting it as "0+" would have a Judge rolling for a naked swimmer in
 * calm water every round of a crossing.
 *
 * @param {object} o
 * @param {number} o.encumbrance what they are carrying, in stone
 * @param {boolean} [o.proficient] has the Swimming proficiency
 * @param {string} [o.water] a key of WATER
 * @returns {{target: number, needed: boolean, parts: object[]}}
 */
export function swimmingThrow({ encumbrance = 0, proficient = false, water = "calm" } = {}) {
  const stone = Math.max(0, Number(encumbrance) || 0);
  const conditions = WATER[water] ?? WATER.calm;
  const parts = [{ key: "encumbrance", value: stone }];
  if (proficient) parts.push({ key: "proficient", value: SWIMMING_BONUS });
  if (conditions.modifier) parts.push({ key: `water.${water}`, value: conditions.modifier });
  // The water's penalty makes the throw HARDER, so it raises the target the
  // same way the proficiency lowers it.
  const target = stone - (proficient ? SWIMMING_BONUS : 0) - conditions.modifier;
  return { target, needed: target > 0, parts };
}

/** A swimmer's pace: a quarter of whichever speed they are using. */
export const swimSpeed = (feet) => Math.max(0, (Number(feet) || 0) * SPEED_SHARE);

/**
 * How long a drowning character has, and how deep they are when it runs out.
 *
 * Breath is Constitution's, and the sink rate is encumbrance's — so the heavy
 * swimmer both drowns sooner and ends up further down, which is why a rescue
 * that starts late may not be able to reach them at all.
 *
 * @returns {{rounds: number, feetPerRound: number, depthAtDeath: number}}
 */
export function drowning({ conMod = 0, encumbrance = 0 } = {}) {
  const rounds = Math.max(1, 5 + (Number(conMod) || 0));
  const feetPerRound = Math.max(0, Number(encumbrance) || 0) * SINK_FEET_PER_STONE;
  return { rounds, feetPerRound, depthAtDeath: rounds * feetPerRound };
}

/** What a rescuer is lifting: the whole body, and half of what it carries. */
export const rescueStone = (gearStone = 0) =>
  RESCUE_BODY_STONE + Math.max(0, Number(gearStone) || 0) * RESCUE_GEAR_SHARE;

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
