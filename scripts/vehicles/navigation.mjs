/**
 * Staying on course, and what happens when you do not (RR ch. 7).
 *
 * A voyage asks two separate questions each day, and they have different
 * owners: the NAVIGATOR keeps the vessel on course, and the CAPTAIN keeps her
 * off the rocks. Conflating them loses the fact that a ship can be perfectly
 * sure where she is and still tear her bottom out on a reef nobody charted.
 *
 * Both are ordinary proficiency throws, so the numbers here are targets and
 * modifiers, never a table of places: which hex holds a hazard is the Judge's
 * map, not this module's business.
 */

/**
 * How hard it is to stay on course, by water.
 *
 * The spread is the point: a river is nearly unmissable, and the open sea is
 * a throw a crew without a navigator fails half the time.
 */
export const NAVIGATION_TARGETS = Object.freeze({
  lakeOrRiver: 4,
  coast: 7,
  openSea: 11,
});

/** Knowing the way is worth +4; knowing it two ways is worth +8. */
export const PATHFINDING_BONUS = 4;
export const BOTH_ARTS_BONUS = 8;

/**
 * The Navigation throw a vessel makes at the start of each day OR NIGHT of
 * travel — sailing through the dark is a second chance to get lost, not a
 * continuation of the first.
 *
 * @param {object} o
 * @param {string} [o.terrain] a key of NAVIGATION_TARGETS
 * @param {boolean} [o.pathfinding] someone aboard has the Pathfinding power
 * @param {boolean} [o.navigation] someone aboard has the Navigation proficiency
 * @returns {{target: number, bonus: number, effective: number, parts: object[]}}
 */
export function navigationThrow({ terrain = "openSea", pathfinding = false, navigation = false } = {}) {
  const target = NAVIGATION_TARGETS[terrain] ?? NAVIGATION_TARGETS.openSea;
  // Both arts together are worth more than either alone, and more than the
  // two of them added — the rule names 8 outright rather than 4+4.
  const bonus = pathfinding && navigation ? BOTH_ARTS_BONUS : pathfinding || navigation ? PATHFINDING_BONUS : 0;
  const parts = [{ key: `terrain.${terrain}`, value: target }];
  if (bonus) parts.push({ key: pathfinding && navigation ? "bothArts" : "oneArt", value: bonus });
  return { target, bonus, effective: target - bonus, parts };
}

/**
 * The captain's Seafaring throw on entering a hex that holds a hazard.
 *
 * Slowing down is the universally available answer — half speed or less is
 * worth +4 here AND halves the damage if she strikes anyway, which is the
 * rule rewarding caution twice for one decision.
 *
 * @param {object} o
 * @param {boolean} [o.masterMariner] Seafaring taken three times
 * @param {boolean} [o.halfSpeed] making half her speed or less
 * @param {boolean} [o.shallowDraft] a galley or longship, over sandbar or shoal
 * @returns {{target: number, bonus: number, effective: number, parts: object[]}}
 */
export function hazardThrow({ masterMariner = false, halfSpeed = false, shallowDraft = false } = {}) {
  const target = masterMariner ? 7 : 11;
  const parts = [{ key: masterMariner ? "masterMariner" : "captain", value: target }];
  let bonus = 0;
  if (halfSpeed) {
    bonus += 4;
    parts.push({ key: "halfSpeed", value: 4 });
  }
  if (shallowDraft) {
    bonus += 4;
    parts.push({ key: "shallowDraft", value: 4 });
  }
  return { target, bonus, effective: target - bonus, parts };
}

/**
 * What is in the water, and what it does to a hull that finds it.
 *
 * `damage` is rolled and then HALVED if she was making half speed or less —
 * the same caution that helped her avoid it helps her survive it.
 */
export const HAZARDS = Object.freeze({
  kelpForest: {
    /** No damage; she simply stops until cut free. */
    damage: null,
    damageType: null,
    /** 1d4 hours, plus an hour for every sixty tons of her. */
    freeFormula: "1d4",
    hoursPerSixtyTons: 1,
    immobile: true,
  },
  rockReefWreck: {
    damage: "8d10",
    damageType: "piercing",
    immobile: false,
  },
  sandbarShoal: {
    damage: "4d10",
    damageType: "bludgeoning",
    immobile: true,
    /** Aground until the tide lifts her, at the Judge's discretion. */
    freeFormula: "1d12",
    /** Or until the crew lightens her: 5% a throw, per 200 stone overboard. */
    escapePerStone: 0.05 / 200,
    unloadStonePerTurn: 33,
  },
});

/** Hours to cut a vessel out of kelp, given her displacement. */
export const kelpHours = (rolled, tons) => (Number(rolled) || 0) + Math.floor((Number(tons) || 0) / 60);

/**
 * The chance a grounded vessel floats free after throwing cargo over the side.
 * Cumulative in the stone jettisoned, and capped at certainty.
 */
export const lightenChance = (stoneJettisoned) =>
  Math.min(1, Math.max(0, Number(stoneJettisoned) || 0) * HAZARDS.sandbarShoal.escapePerStone);

