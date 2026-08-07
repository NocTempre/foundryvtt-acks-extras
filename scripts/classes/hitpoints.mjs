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
 */
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
 * @returns {Promise<{roll: Roll, total: number, perDie: boolean}>}
 */
export async function rollHitDice(hd, conMod) {
  const roll = await new Roll(`${hd.dice}d${hd.sides}`).evaluate();
  const faces = (roll.dice?.[0]?.results ?? []).filter((r) => r.active !== false).map((r) => r.result);
  const perDie = faces.length === hd.dice;
  const rolled = perDie
    ? faces.reduce((sum, face) => sum + Math.max(1, face + conMod), 0)
    : roll.total + hd.dice * conMod;
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
 * The two rules are different and both are the book's. First level is a plain
 * roll of the class's die with no floor above the per-die one. Every level
 * after it REROLLS the whole Hit Dice and keeps at least one point more than
 * the level before (classes/DECISIONS.md, 2026-08-05) — so the walk cannot
 * hand back a 5th-level character fewer points than they held at 4th, however
 * the dice fall.
 *
 * @returns {Promise<{max: number, steps: Array<{level: number, formula: string, total: number}>}>}
 */
export async function rebuildHitPoints(actor, classItem, level) {
  const conMod = Number(actor.system?.scores?.con?.mod) || 0;
  const target = Math.max(1, Math.min(Number(level) || 1, classItem.system.maximumLevel || 14));
  const steps = [];
  let max = 0;
  for (let n = 1; n <= target; n++) {
    const { roll, total } = await rollHitDice(hdAt(classItem, n), conMod);
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
