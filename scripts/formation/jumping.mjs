/**
 * Jumping and leaping (RR ch. 6): a distance the character has, compared
 * against a gap the dungeon has, reported as a range rather than rolled.
 * See docs/formation/DECISIONS.md, "Jumping is a distance, not a throw, so
 * it is not an obstacle" and "Jumping holds no printed value that already
 * has an owner". The attribute-modifier table is the system's and the
 * Acrobatics numbers are the proficiency's; both are passed in — see
 * `dexModifier` and `NO_ACROBATICS`.
 */

/**
 * What Acrobatics is worth belongs to Acrobatics — passed in, never
 * hardcoded here. See docs/formation/DECISIONS.md, "Jumping holds no
 * printed value that already has an owner". Absent the ability's terms,
 * Acrobatics contributes nothing rather than a guess.
 */
export const NO_ACROBATICS = Object.freeze({ dexCap: null, saveBonus: 0 });

/** A jump wants this much of a run-up, or it is halved. */
export const RUNNING_START_FEET = 20;

/** What a standing jump keeps of a running one. */
export const NO_RUN_UP_SHARE = 1 / 2;

/** A creature's jump scales by its running speed against this baseline. */
export const CREATURE_SPEED_BASE = 120;

/** A creature whose DEX nobody wrote down has this one. */
export const DEFAULT_CREATURE_DEX = 9;

/** The horizontal jump carries a die; the leap does not. */
export const JUMP_DIE_FACES = 6;

/** A failed landing lands the jumper this far short. */
export const SHORTFALL_DIE = "1d6";

/** A fall costs one bludgeoning die per this many feet, of this many faces. */
export const FALL_FEET_PER_DIE = 10;
export const FALL_DIE_FACES = 6;

/**
 * The Dexterity modifier a jump is figured from. Not derived here: every
 * sheet already carries it as `system.scores.dex.mod`. A caller holding a
 * seat's own imported extended bands (past what the printed table covers)
 * passes `extended`; one that does not gets the sheet's own.
 */
export function dexModifier({ mod = 0, extended = null } = {}) {
  const supplied = given(extended);
  if (supplied !== null) return supplied;
  return given(mod) ?? 0;
}

/**
 * A number that was actually supplied, or null.
 *
 * `Number(null)` is ZERO, not NaN, so a bare `Number.isFinite` check reads every
 * absent option as a supplied zero — which silently caps an uncapped score at 0
 * and answers every modifier with 0. Nothing here may treat "not given" and
 * "given as zero" alike; both are meaningful and they are not the same.
 */
function given(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * The DEX a jump is figured from: the character's own, raised by class
 * level if they are an acrobat, and held at the proficiency's own cap
 * where one is given. No cap is invented in its absence.
 */
export function effectiveDex({ dex = DEFAULT_CREATURE_DEX, acrobatics = false, level = 0, dexCap = null } = {}) {
  const base = Number(dex);
  const score = Number.isFinite(base) ? base : DEFAULT_CREATURE_DEX;
  if (!acrobatics) return score;
  const raised = score + Math.max(0, Number(level) || 0);
  const cap = given(dexCap);
  return cap === null ? raised : Math.min(cap, raised);
}

/**
 * Encumbrance, then the standing-jump halving, then the creature
 * multiplier, in the rule's own order. Clamped at zero: a negative result
 * is an arithmetic leftover, not a distance. See
 * docs/formation/DECISIONS.md, "Jumping is a distance, not a throw, so it
 * is not an obstacle".
 */
function applyConditions(base, { encumbrance = 0, runningStart = true, runSpeed = null } = {}) {
  let feet = base - Math.max(0, Number(encumbrance) || 0);
  if (!runningStart) feet *= NO_RUN_UP_SHARE;
  const speed = Number(runSpeed);
  if (Number.isFinite(speed) && speed > 0) feet *= speed / CREATURE_SPEED_BASE;
  return Math.max(0, feet);
}

/** The parts every jump is built from, so a card can show its working. */
function conditionParts({ encumbrance = 0, runningStart = true, runSpeed = null } = {}) {
  const parts = [];
  const stone = Math.max(0, Number(encumbrance) || 0);
  if (stone) parts.push({ key: "encumbrance", value: -stone });
  if (!runningStart) parts.push({ key: "standing", value: NO_RUN_UP_SHARE });
  const speed = Number(runSpeed);
  if (Number.isFinite(speed) && speed > 0 && speed !== CREATURE_SPEED_BASE) {
    parts.push({ key: "speed", value: speed / CREATURE_SPEED_BASE });
  }
  return parts;
}

/**
 * How high this character can leap straight up, in feet.
 *
 * DEX bonus + 1, never less than one foot before conditions are applied. The
 * bonus is the SHEET's — see `dexModifier` — while the effective score is still
 * reported, because a caller holding the extended bands needs to know which
 * score to resolve them for before it can supply `extended`.
 *
 * @param {object} o
 * @param {number} [o.dex] the DEX score, for reporting the effective one
 * @param {number} [o.mod] the sheet's own `system.scores.dex.mod`
 * @param {number} [o.extended] the modifier to use instead, where a seat's
 *   imported bands cover a score Acrobatics pushed past the printed ones
 * @param {number} [o.encumbrance] what they carry, in stone
 * @param {boolean} [o.acrobatics] has the Acrobatics proficiency
 * @param {number} [o.level] class level, which Acrobatics adds to DEX
 * @param {number} [o.dexCap] the proficiency's own ceiling on that score
 * @param {boolean} [o.runningStart] had 20' to build up speed
 * @param {number} [o.runSpeed] a creature's running speed, for the scaling
 * @returns {{feet: number, dex: number, bonus: number, parts: object[]}}
 */
export function leapHeight({
  dex,
  mod = 0,
  extended = null,
  encumbrance = 0,
  acrobatics = false,
  level = 0,
  dexCap = null,
  runningStart = true,
  runSpeed = null,
} = {}) {
  const score = effectiveDex({ dex, acrobatics, level, dexCap });
  const bonus = dexModifier({ mod, extended });
  const base = Math.max(1, bonus + 1);
  return {
    feet: applyConditions(base, { encumbrance, runningStart, runSpeed }),
    dex: score,
    bonus,
    parts: [{ key: "base", value: base }, ...conditionParts({ encumbrance, runningStart, runSpeed })],
  };
}

/**
 * How far this character can jump across, in feet — as a RANGE, because the
 * distance carries a d6 the jumper does not get to see first.
 *
 * `min` is what they can count on and `max` is the most the die can give them,
 * which is the pair a Judge needs to answer "can we clear it?" honestly: a gap
 * inside the range is a gamble, and one past `max` is not a jump at all.
 *
 * @returns {{min: number, max: number, average: number, dex: number, die: string, parts: object[]}}
 */
export function jumpDistance({
  dex,
  encumbrance = 0,
  acrobatics = false,
  level = 0,
  dexCap = null,
  runningStart = true,
  runSpeed = null,
} = {}) {
  const score = effectiveDex({ dex, acrobatics, level, dexCap });
  const conditions = { encumbrance, runningStart, runSpeed };
  const roll = (die) => applyConditions(score + die, conditions);
  return {
    min: roll(1),
    max: roll(JUMP_DIE_FACES),
    average: roll((1 + JUMP_DIE_FACES) / 2),
    dex: score,
    die: `1d${JUMP_DIE_FACES}`,
    parts: [{ key: "dex", value: score }, { key: "die", value: `1d${JUMP_DIE_FACES}` }, ...conditionParts(conditions)],
  };
}

/**
 * Can this jumper clear a gap, and how surely?
 *
 * Three answers, not two: `certain` when even the lowest die reaches, `chance`
 * when only some of the die does, and `impossible` when the best roll falls
 * short. The middle answer is the one worth having — it is where the Judge
 * decides whether to let someone try.
 *
 * @returns {{verdict: "certain"|"chance"|"impossible", needed: number, min: number, max: number, onSix: number}}
 */
export function canClear(gapFeet, options = {}) {
  const gap = Math.max(0, Number(gapFeet) || 0);
  const { min, max } = jumpDistance(options);
  const verdict = min >= gap ? "certain" : max >= gap ? "chance" : "impossible";
  // How many of the six faces carry them across, so "a chance" has a size.
  const score = effectiveDex(options);
  let onSix = 0;
  for (let die = 1; die <= JUMP_DIE_FACES; die++) {
    if (applyConditions(score + die, options) >= gap) onSix++;
  }
  return { verdict, needed: gap, min, max, onSix };
}

/**
 * The saving throw a landing asks for — and, first, whether it asks at all.
 *
 * RAW the save is NOT part of jumping: it is owed only for a precarious
 * destination (an incline, loose scree, a narrow pillar) or a jump made
 * charging into melee. A jump onto solid ground is simply made, and prompting
 * for a save every time would invent a check the rules do not have.
 *
 * @param {object} o
 * @param {boolean} [o.precarious] the far side is inclined, loose or narrow
 * @param {boolean} [o.charging] the jump is a charge into melee
 * @param {boolean} [o.acrobatics] has the Acrobatics proficiency
 * @param {number} [o.saveBonus] what that proficiency is worth here, from the
 *   ability's own terms — see NO_ACROBATICS
 * @returns {{needed: boolean, save: string, bonus: number}}
 */
export function landingSave({ precarious = false, charging = false, acrobatics = false, saveBonus = 0 } = {}) {
  return {
    needed: !!(precarious || charging),
    save: "paralysis",
    bonus: acrobatics ? Math.max(0, Number(saveBonus) || 0) : 0,
  };
}

/**
 * What a failed landing costs, given what is under the spot they fall short of.
 *
 * The jumper lands 1d6 feet short, and the ground decides the rest: prone on
 * solid footing, hanging by the fingers exactly at an edge, and a fall over
 * empty space at 1d6 bludgeoning per ten feet.
 *
 * @param {string} footing one of "solid", "edge", "empty"
 * @param {number} [dropFeet] how far the fall is, when it is a fall
 * @returns {{outcome: string, shortBy: string, damage: string|null}}
 */
export function landingFailure(footing = "solid", dropFeet = 0) {
  const drop = Math.max(0, Number(dropFeet) || 0);
  const dice = Math.floor(drop / FALL_FEET_PER_DIE);
  const outcome = footing === "empty" ? "fall" : footing === "edge" ? "hanging" : "prone";
  return {
    outcome,
    shortBy: SHORTFALL_DIE,
    damage: outcome === "fall" && dice > 0 ? `${dice}d${FALL_DIE_FACES}` : null,
  };
}

/**
 * Everyone in a formation against one gap — so a Judge can see before anybody
 * runs at it which of them is going to end up in it.
 *
 * @param {object[]} members [{ name, dex, encumbrance, acrobatics, level, dexCap, runSpeed }]
 * @param {number} gapFeet the distance to be cleared
 * @param {object} [opts] conditions shared by the whole party (the run-up)
 */
export function partyJump(members = [], gapFeet = 0, { runningStart = true } = {}) {
  return members.filter(Boolean).map((m) => ({
    name: m.name,
    ...canClear(gapFeet, {
      dex: m.dex,
      encumbrance: m.encumbrance,
      acrobatics: m.acrobatics,
      level: m.level,
      dexCap: m.dexCap,
      runSpeed: m.runSpeed,
      runningStart,
    }),
  }));
}
