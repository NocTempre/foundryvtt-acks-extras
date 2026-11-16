/**
 * Jumping and leaping (RR ch. 6, pp. 270-271): a distance the character has,
 * compared against a gap the dungeon has, reported as a range rather than
 * rolled. See docs/formation/DECISIONS.md, "Jumping is a distance, not a
 * throw, so it is not an obstacle" and the entry that moved its figures onto
 * the importer.
 *
 * This file knows the procedure: a leap is a bonus plus a constant held to a
 * floor, a jump is a score plus a die, a stone of encumbrance takes a distance
 * off, a standing start keeps a share, a creature scales by its running speed
 * against a baseline, and a failed landing falls short and may fall. What each
 * of those is worth is printed, and arrives in the `jumping` and `fall`
 * registered tables (`formationValue`). A figure not imported answers null, and
 * every distance that rests on it is null with the figure named in `unknown`:
 * a jump reported on a number nobody printed is a Judge ruling on a guess.
 *
 * The Acrobatics score ceiling and the leap's bonus bands are printed in the
 * passage and arrive in the `jumping` table (`acrobaticsDexCap`,
 * `extendedDexBands`); a caller's own `dexCap` or `extended` wins over them.
 * The sheet's modifier stands for the score the sheet holds, and the system's
 * attribute table answers for a score under the bands — see `dexModifier`.
 * What the proficiency is worth to the landing save is its own and is passed
 * in (`NO_ACROBATICS`).
 */
import { diceFormula, formationValue } from "./constants.mjs";

/**
 * What Acrobatics is worth belongs to Acrobatics — passed in, never
 * hardcoded here. Absent the ability's terms, Acrobatics contributes nothing
 * rather than a guess.
 */
export const NO_ACROBATICS = Object.freeze({ dexCap: null, saveBonus: 0 });

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

/** One figure of the `jumping` table as a number, or null until imported. */
const figure = (key) => given(formationValue("jumping")?.[key]);

/** A figure that must be above zero to mean anything, else null. */
const positive = (key) => {
  const n = figure(key);
  return n !== null && n > 0 ? n : null;
};

/** The figure the leap's height adds to the Dexterity bonus, or null until imported. */
export const leapPlus = () => figure("leapPlus");

/** The floor a leap's height holds to before conditions, or null until imported. */
export const leapMinimum = () => figure("leapMinimum");

/** Feet of distance a stone of encumbrance takes off, or null until imported. */
export const feetPerStone = () => positive("feetPerStone");

/** The run-up a jump wants, in feet, or null until imported. */
export const runningStartFeet = () => positive("runUpFeet");

/** What a jump or leap keeps without its run-up, as a share, or null until imported. */
export const standingShare = () => {
  const n = figure("standingShare");
  return n !== null && n > 0 && n <= 1 ? n : null;
};

/** The running speed a creature's jump is scaled against, or null until imported. */
export const creatureSpeedBase = () => positive("creatureSpeedBase");

/** The Dexterity score a creature with none written down is assumed to have, or null until imported. */
export const creatureDex = () => figure("creatureDex");

/** The ceiling Acrobatics holds a raised Dexterity score to, or null until imported. */
export const acrobaticsDexCap = () => positive("acrobaticsDexCap");

/**
 * The bonus the leap takes at each Dexterity score band, as ascending rows
 * `{min, max, mod}` of whole numbers, or null until imported. The rows are read
 * whole: one that is no band of whole numbers, or that overlaps the one before
 * it, makes the list no list, since a partial reading would answer a score
 * the page may have priced differently.
 */
export function extendedDexBands() {
  const rows = formationValue("jumping")?.extendedDexBands;
  if (!Array.isArray(rows) || !rows.length) return null;
  const bands = [];
  for (const row of rows) {
    const min = given(row?.min);
    const max = given(row?.max);
    const mod = given(row?.mod);
    if (![min, max, mod].every(Number.isInteger) || max < min) return null;
    bands.push({ min, max, mod });
  }
  bands.sort((a, b) => a.min - b.min);
  return bands.every((b, i) => i === 0 || b.min > bands[i - 1].max) ? bands : null;
}

/**
 * The system's own modifier for a score, from its attribute table, or null
 * where the system does not answer (no table loaded).
 */
function systemModifier(score) {
  const read = globalThis.CONFIG?.Actor?.dataModels?.character?.getAttributeModifier;
  return typeof read === "function" ? given(read.call(globalThis.CONFIG.Actor.dataModels.character, score)) : null;
}

/**
 * The leap's bonus for a Dexterity score the sheet does not hold (one Acrobatics
 * raised, or a creature's assumed one). A score inside an imported band takes
 * that band's bonus; one below the lowest band takes the system's table; one
 * past the top band or between two bands answers null, never the nearest row.
 * Null throughout while no bands are imported, since where they begin is
 * unknown.
 */
export function scoreModifier(score) {
  const s = given(score);
  const bands = extendedDexBands();
  if (s === null || bands === null) return null;
  const band = bands.find((b) => s >= b.min && s <= b.max);
  if (band) return band.mod;
  return s < bands[0].min ? systemModifier(s) : null;
}

/**
 * Faces of the die the horizontal jump adds, or null until imported. Only a
 * single die is read: the range a jump reports is that die's faces, and a
 * Judge's override of some other shape is no die for it.
 */
export function jumpFaces() {
  const m = /^1d(\d+)$/.exec(diceFormula(formationValue("jumping")?.jumpDie) ?? "");
  return m && Number(m[1]) > 0 ? Number(m[1]) : null;
}

/** The dice a failed landing falls short by, or null until imported. */
export const shortfallDie = () => diceFormula(formationValue("jumping")?.shortfallDie);

/**
 * What a fall deals: `{die, feetPerDie}` — the die and the feet it is dealt
 * per — or null until both are imported. The die is read as `NdM`.
 */
export function fallFigures() {
  const table = formationValue("fall");
  const die = /^(\d+)d(\d+)$/.exec(diceFormula(table?.die) ?? "");
  const feet = given(table?.feetPerDie);
  if (!die || feet === null || !(feet > 0)) return null;
  return { count: Number(die[1]), faces: Number(die[2]), feetPerDie: feet };
}

/**
 * The Dexterity modifier a leap is figured from. A caller holding its own
 * figure passes `extended`, which wins. Otherwise the sheet's own
 * `system.scores.dex.mod` stands for the score the sheet holds, and where the
 * score used is not that one (`raised`, Acrobatics having moved it, or no sheet
 * modifier given for an assumed score) the modifier is the score's own,
 * `scoreModifier`, which is null while the bands that answer it are not
 * imported.
 *
 * @param {object} o
 * @param {number} [o.mod] the sheet's modifier for the score it holds
 * @param {number} [o.extended] a modifier to use instead
 * @param {number} [o.score] the score the leap is figured from
 * @param {boolean} [o.raised] Acrobatics raised that score past the sheet's
 * @returns {number|null}
 */
export function dexModifier({ mod = null, extended = null, score = null, raised = false } = {}) {
  const supplied = given(extended);
  if (supplied !== null) return supplied;
  const held = given(mod);
  if (!raised && (held !== null || given(score) === null)) return held ?? 0;
  return scoreModifier(score);
}

/**
 * The score a jump or leap is figured from, with what it could not be
 * figured without: the character's own, raised by class level if they are an
 * acrobat and held at the proficiency's ceiling, the caller's `dexCap` first
 * and the imported one after it. A raise with no ceiling known is not a score
 * (`score` null, `acrobaticsDexCap` named), and so is a score nobody wrote
 * down while the creature's assumed one is not imported (`creatureDex`).
 */
function scoreFigures({ dex, acrobatics = false, level = 0, dexCap = null } = {}) {
  const base = given(dex) ?? creatureDex();
  if (base === null) return { score: null, unknown: ["creatureDex"] };
  const gain = acrobatics ? Math.max(0, Number(level) || 0) : 0;
  if (!gain) return { score: base, unknown: [] };
  const cap = given(dexCap) ?? acrobaticsDexCap();
  if (cap === null) return { score: null, unknown: ["acrobaticsDexCap"] };
  return { score: Math.min(cap, base + gain), unknown: [] };
}

/**
 * The DEX a jump is figured from: the character's own, raised by class
 * level if they are an acrobat, and held at the proficiency's cap, the
 * caller's `dexCap` or else the imported one. Null, never an uncapped score,
 * while a raise has no cap to hold it to. A score nobody wrote down is the
 * creature's assumed one, which is null until imported.
 */
export function effectiveDex(options = {}) {
  return scoreFigures(options).score;
}

/**
 * What the conditions do to a base distance, in the rule's own order:
 * encumbrance, then the standing-jump share, then the creature scale. A
 * condition that applies and whose figure is not imported is named in
 * `unknown`, and `apply` then answers null. Clamped at zero: a negative result
 * is an arithmetic leftover, not a distance.
 *
 * `parts` is what a card shows of the working.
 *
 * @returns {{apply: (base: number) => number|null, parts: object[], unknown: string[]}}
 */
function conditions({ encumbrance = 0, runningStart = true, runSpeed = null } = {}) {
  const unknown = [];
  const parts = [];
  const stone = Math.max(0, Number(encumbrance) || 0);
  const rate = stone ? feetPerStone() : null;
  if (stone) {
    if (rate === null) unknown.push("feetPerStone");
    else parts.push({ key: "encumbrance", value: -stone * rate });
  }
  const share = runningStart ? null : standingShare();
  if (!runningStart) {
    if (share === null) unknown.push("standingShare");
    else parts.push({ key: "standing", value: share });
  }
  const speed = given(runSpeed);
  const scaled = speed !== null && speed > 0;
  const base = scaled ? creatureSpeedBase() : null;
  if (scaled) {
    if (base === null) unknown.push("creatureSpeedBase");
    else if (speed !== base) parts.push({ key: "speed", value: speed / base });
  }
  const apply = (distance) => {
    if (unknown.length) return null;
    let feet = distance - stone * (rate ?? 0);
    if (!runningStart) feet *= share;
    if (scaled) feet *= speed / base;
    return Math.max(0, feet);
  };
  return { apply, parts, unknown };
}

/**
 * How high this character can leap straight up, in feet.
 *
 * The Dexterity bonus plus the imported constant, never less than the imported
 * floor before conditions are applied. The bonus is the modifier of the score
 * the leap is figured from, the one Acrobatics raised: the sheet's own `mod`
 * stands only for a score the sheet holds, and a raised or assumed score takes
 * `scoreModifier`. The effective score is reported with it.
 *
 * @param {object} o
 * @param {number} [o.dex] the character's own DEX score
 * @param {number} [o.mod] the sheet's own `system.scores.dex.mod`, for that score
 * @param {number} [o.extended] the modifier to use instead of any read here
 * @param {number} [o.encumbrance] what they carry, in stone
 * @param {boolean} [o.acrobatics] has the Acrobatics proficiency
 * @param {number} [o.level] class level, which Acrobatics adds to DEX
 * @param {number} [o.dexCap] the proficiency's ceiling on that score; the
 *   imported one when omitted
 * @param {boolean} [o.runningStart] had the run-up the jump wants
 * @param {number} [o.runSpeed] a creature's running speed, for the scaling
 * @returns {{feet: number|null, dex: number|null, bonus: number|null, parts: object[], unknown: string[]}}
 *   `feet` is null while any figure the leap rests on is not imported, and
 *   `unknown` names each one
 */
export function leapHeight({
  dex,
  mod = null,
  extended = null,
  encumbrance = 0,
  acrobatics = false,
  level = 0,
  dexCap = null,
  runningStart = true,
  runSpeed = null,
} = {}) {
  const figures = scoreFigures({ dex, acrobatics, level, dexCap });
  const score = figures.score;
  const raised = !!acrobatics && (Number(level) || 0) > 0;
  const needsScore = given(extended) === null && (raised || given(mod) === null);
  const bonus = needsScore && score === null ? null : dexModifier({ mod, extended, score, raised });
  const plus = leapPlus();
  const floor = leapMinimum();
  const held = conditions({ encumbrance, runningStart, runSpeed });
  const unknown = [
    ...(plus === null ? ["leapPlus"] : []),
    ...(floor === null ? ["leapMinimum"] : []),
    ...(needsScore ? figures.unknown : []),
    ...(needsScore && score !== null && bonus === null ? ["extendedDexBands"] : []),
    ...held.unknown,
  ];
  if (plus === null || floor === null || bonus === null) return { feet: null, dex: score, bonus, parts: held.parts, unknown };
  const base = Math.max(floor, bonus + plus);
  return {
    feet: held.apply(base),
    dex: score,
    bonus,
    parts: [{ key: "base", value: base }, ...held.parts],
    unknown,
  };
}

/**
 * How far this character can jump across, in feet — as a RANGE, because the
 * distance carries a die the jumper does not get to see first.
 *
 * `min` is what they can count on and `max` is the most the die can give them,
 * which is the pair a Judge needs to answer "can we clear it?" honestly: a gap
 * inside the range is a gamble, and one past `max` is not a jump at all. All
 * three are null, with `unknown` naming what is not imported, while any figure
 * the jump rests on is missing.
 *
 * @returns {{min: number|null, max: number|null, average: number|null, dex: number|null, die: string|null, parts: object[], unknown: string[]}}
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
  const { score, unknown: scoreUnknown } = scoreFigures({ dex, acrobatics, level, dexCap });
  const faces = jumpFaces();
  const held = conditions({ encumbrance, runningStart, runSpeed });
  const unknown = [
    ...scoreUnknown,
    ...(faces === null ? ["jumpDie"] : []),
    ...held.unknown,
  ];
  if (unknown.length) {
    return { min: null, max: null, average: null, dex: score, die: faces === null ? null : `1d${faces}`, parts: held.parts, unknown };
  }
  const roll = (die) => held.apply(score + die);
  return {
    min: roll(1),
    max: roll(faces),
    average: roll((1 + faces) / 2),
    dex: score,
    die: `1d${faces}`,
    parts: [{ key: "dex", value: score }, { key: "die", value: `1d${faces}` }, ...held.parts],
    unknown,
  };
}

/**
 * Can this jumper clear a gap, and how surely?
 *
 * Three answers, not two: `certain` when even the lowest die reaches, `chance`
 * when only some of the die does, and `impossible` when the best roll falls
 * short. The middle answer is the one worth having — it is where the Judge
 * decides whether to let someone try. A jump whose figures are not imported is
 * a fourth answer, `unknown`, with the missing figures named.
 *
 * @returns {{verdict: "certain"|"chance"|"impossible"|"unknown", needed: number, min: number|null, max: number|null, clearing: number|null, faces: number|null, unknown: string[]}}
 *   `clearing` is how many of the die's `faces` carry the jumper across, so
 *   "a chance" has a size
 */
export function canClear(gapFeet, options = {}) {
  const gap = Math.max(0, Number(gapFeet) || 0);
  const { min, max, dex, unknown } = jumpDistance(options);
  if (min === null) return { verdict: "unknown", needed: gap, min, max, clearing: null, faces: null, unknown };
  const verdict = min >= gap ? "certain" : max >= gap ? "chance" : "impossible";
  const faces = jumpFaces();
  const held = conditions(options);
  let clearing = 0;
  for (let die = 1; die <= faces; die++) {
    if (held.apply(dex + die) >= gap) clearing++;
  }
  return { verdict, needed: gap, min, max, clearing, faces, unknown };
}

/**
 * The saving throw a landing asks for, and first whether it asks at all (RR
 * ch. 6, Jumping and Leaping).
 *
 * The save is not part of every jump: `needed` is true only when the caller
 * marks the destination `precarious` or the jump `charging`. Otherwise the
 * landing is made without a throw, and nothing here prompts one.
 *
 * @param {object} o
 * @param {boolean} [o.precarious] the caller marks the far side precarious
 * @param {boolean} [o.charging] the jump is made charging
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
 * The jumper lands short by the imported die, and the ground decides the rest:
 * prone on solid footing, hanging by the fingers exactly at an edge, and a
 * fall over empty space dealing the imported die per the imported feet.
 * `shortBy` and `damage` are null while their figures are not imported, with
 * the missing table named in `unknown`; `damage` is also null for a fall too
 * short to deal a die, which `unknown` then leaves empty.
 *
 * @param {string} footing one of "solid", "edge", "empty"
 * @param {number} [dropFeet] how far the fall is, when it is a fall
 * @returns {{outcome: string, shortBy: string|null, damage: string|null, unknown: string[]}}
 */
export function landingFailure(footing = "solid", dropFeet = 0) {
  const drop = Math.max(0, Number(dropFeet) || 0);
  const outcome = footing === "empty" ? "fall" : footing === "edge" ? "hanging" : "prone";
  const unknown = [];
  const short = shortfallDie();
  if (short === null) unknown.push("shortfallDie");
  let damage = null;
  if (outcome === "fall") {
    const fall = fallFigures();
    if (fall === null) unknown.push("fall");
    else {
      const dice = Math.floor(drop / fall.feetPerDie) * fall.count;
      if (dice > 0) damage = `${dice}d${fall.faces}`;
    }
  }
  return { outcome, shortBy: short, damage, unknown };
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
