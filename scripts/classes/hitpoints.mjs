/* global Roll */
/**
 * Hit dice: reading the printed cell, and the rules that turn it into a
 * number of hit points. Owned here rather than in apply.mjs or levelup.mjs
 * because both need it. See docs/classes/MODEL.md, "Hit points".
 */
import { getDoc, hasDoc, expectTables } from "../lib/tables.mjs";

/** The registered ruledata document these derivations read. */
export const HITPOINTS_DOC = "hitPoints";

/** Declare what is read, so import UX can name the gap. */
export function registerHitPointExpectations() {
  expectTables(HITPOINTS_DOC, ["firstLevel"]);
}

/**
 * The printed floor under a 1st-level hit die, or 1 where no book has been
 * read. Never a guessed number: an absent table means no floor, not a
 * remembered one.
 */
export function firstLevelDieMinimum() {
  if (!hasDoc(HITPOINTS_DOC)) return 1;
  const v = getDoc(HITPOINTS_DOC)?.tables?.firstLevel?.dieMinimum;
  return Number.isInteger(v) && v > 0 ? v : 1;
}

/** "9d8 + 2*" → "9d8+2": the printed cell as a rollable formula. */
export function normalizeHd(cell) {
  return String(cell ?? "")
    .replace(/\*/g, "")
    .replace(/\s+/g, "");
}

/** "9d8+4" → {dice: 9, sides: 8, flat: 4}; null when unparseable. */
export function parseHd(formula) {
  const m = /^(\d+)d(\d+)(?:\+(\d+))?$/.exec(String(formula ?? "").replace(/\s+/g, ""));
  return m ? { dice: parseInt(m[1], 10), sides: parseInt(m[2], 10), flat: m[3] ? parseInt(m[3], 10) : 0 } : null;
}

/**
 * Roll one hit-dice cell into a point total, Constitution applied per die.
 * Reads the individual faces off the evaluated roll so `dieMinimum` can raise
 * each one before Constitution applies; a term reporting no faces (Foundry
 * evaluated the formula some other way) falls back to a bulk adjustment.
 * @returns {Promise<{roll: Roll, total: number, perDie: boolean}>}
 */
export async function rollHitDice(hd, conMod, { dieMinimum = 1 } = {}) {
  const roll = await new Roll(`${hd.dice}d${hd.sides}`).evaluate();
  const faces = (roll.dice?.[0]?.results ?? []).filter((r) => r.active !== false).map((r) => r.result);
  const perDie = faces.length === hd.dice;
  const rolled = perDie
    ? faces.reduce((sum, face) => sum + Math.max(1, Math.max(face, dieMinimum) + conMod), 0)
    : Math.max(roll.total, hd.dice * dieMinimum) + hd.dice * conMod;
  return { roll, total: rolled + (hd.flat ?? 0), perDie };
}

/**
 * The hit-dice cell for a level, falling back to the class's own die when the
 * printed table has no row (a hand-made class part-way through being typed).
 */
export function hdAt(classItem, level) {
  const sys = classItem.system;
  const printed = parseHd(normalizeHd(sys.levelRow(level)?.hd));
  if (printed) return printed;
  const sides = (sys.hitDie?.match(/d(\d+)/) ?? [])[1] ?? 8;
  return { dice: Math.min(level, 9), sides: parseInt(sides, 10), flat: 0 };
}

/**
 * Build a character's hit points from nothing: roll 1st level at the printed
 * floor, then take each level after it the way the level-up wizard does. See
 * docs/classes/DECISIONS.md, "2026-08-05 — Level-up HP is RAW: reroll the
 * full HD, minimum +1".
 *
 * @param {object} [options]
 * @param {number} [options.dieMinimum] the printed 1st-level floor; defaults to
 *   whatever the world has imported, and to 1 (no floor) where it has none
 * @returns {Promise<{max: number, steps: Array<{level: number, formula: string, total: number}>}>}
 */
export async function rebuildHitPoints(actor, classItem, level, { dieMinimum = firstLevelDieMinimum() } = {}) {
  const conMod = Number(actor.system?.scores?.con?.mod) || 0;
  const target = Math.max(1, Math.min(Number(level) || 1, classItem.system.maximumLevel || 14));
  const steps = [];
  let max = 0;
  for (let n = 1; n <= target; n++) {
    const { roll, total } = await rollHitDice(hdAt(classItem, n), conMod, n === 1 ? { dieMinimum } : {});
    max = n === 1 ? Math.max(1, total) : Math.max(total, max + 1);
    steps.push({ level: n, formula: roll.formula, total });
  }
  return { max, steps };
}

/**
 * Where a character's experience should sit once their level is set by hand.
 *
 * Raising a level drops them at the FLOOR of the new band; lowering puts them
 * at its top, one short of the level above. Either way the smallest move that
 * makes experience and level agree — a character promoted to 5th has just
 * earned 5th, and one corrected back down to 3rd has not lost the 3rd level
 * they had. Null when the class prints no number to move to, in which case
 * experience is left alone.
 */
export function xpForLevel(classItem, level, previousLevel) {
  const sys = classItem.system;
  if (level === previousLevel) return null;
  if (level > previousLevel) return sys.levelRow(level)?.xp ?? null;
  const above = sys.nextXp(level);
  return above == null ? null : Math.max(0, above - 1);
}
