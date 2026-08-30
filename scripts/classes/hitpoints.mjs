/* global Roll */
/**
 * Hit dice: reading the printed cell, and the two rules that turn it into a
 * number of hit points.
 *
 * Owned here rather than in apply.mjs or levelup.mjs because BOTH need them —
 * the picker rebuilds a character's whole total, the level-up wizard adds one
 * level to it, and a rule stated twice is a rule that drifts.
 *
 * THE CONSTITUTION MINIMUM IS PER DIE. RR Ch. 1 (Character Attributes,
 * Constitution): the adjustment applies to each Hit Die rolled, and a penalty
 * "cannot reduce any Hit Die roll to less than 1 point". Applying the modifier
 * to the total instead is not the same arithmetic — a 3rd-level character with
 * CON 4 rolling 1, 1, 2 holds 3 points by the book and −3 by the shortcut.
 *
 * THE PRINTED FLAT BONUS TAKES NO CONSTITUTION. Past 9th the table stops
 * adding dice and prints "+2" instead; the book's footnote excludes it from the
 * per-die adjustment, so it is added raw.
 *
 * THE FIRST HIT DIE IS READ AT A FLOOR, AND THE FLOOR IS ON THE DIE. RR Ch. 1
 * §I.5 puts a minimum under the 1st-level roll and adds Constitution AFTER it,
 * which is not the same arithmetic as flooring the total: the modifier is
 * applied to a die that has already been raised. What the floor IS is printed,
 * so it is imported (`hitPoints.firstLevel.dieMinimum`) and passed in; a world
 * that has read no book gets 1, which is the arithmetic identity of no floor
 * and leaves today's totals unchanged. It reaches the FIRST die only — every
 * level after rerolls with no floor above the per-die one.
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
 *
 * Reads the individual faces off the evaluated roll so the per-die floor can
 * be applied to each. A term that reports no faces (a formula Foundry
 * evaluated some other way) falls back to the bulk adjustment rather than
 * inventing per-die numbers — the same total the wizard used to give, which is
 * right whenever Constitution is not a penalty.
 *
 * `dieMinimum` raises each face before Constitution is applied to it; the
 * default of 1 cannot raise any face of any die, so it is the arithmetic of no
 * floor. The bulk fallback floors the whole roll the same way for the same
 * reason — a term reporting no faces still owes each of its dice the minimum.
 *
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
 * Build a character's hit points from nothing: roll 1st level, then take each
 * level after it the way the level-up wizard does.
 *
 * The two rules are different and both are the book's. First level is one roll
 * of the class's die read at the printed floor, Constitution applied after it.
 * Every level after it REROLLS the whole Hit Dice — with no floor above the
 * per-die one — and keeps at least one point more than the level before
 * (classes/DECISIONS.md, 2026-08-05), so the walk cannot hand back a 5th-level
 * character fewer points than they held at 4th, however the dice fall.
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
