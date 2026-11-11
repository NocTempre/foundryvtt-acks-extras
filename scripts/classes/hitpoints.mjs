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

/** "5d7 + 2*" → "5d7+2": the printed cell as a rollable formula. */
export function normalizeHd(cell) {
  return String(cell ?? "")
    .replace(/\*/g, "")
    .replace(/\s+/g, "");
}

/** "5d7+3" → {dice: 5, sides: 7, flat: 3}; null when unparseable. */
export function parseHd(formula) {
  const m = /^(\d+)d(\d+)(?:\+(\d+))?$/.exec(String(formula ?? "").replace(/\s+/g, ""));
  return m ? { dice: parseInt(m[1], 10), sides: parseInt(m[2], 10), flat: m[3] ? parseInt(m[3], 10) : 0 } : null;
}

/**
 * Roll one hit-dice cell into a point total, Constitution applied per die.
 * Reads the individual faces off the evaluated roll so `dieMinimum` can raise
 * the cell's FIRST die before Constitution applies; every other die is read as
 * it fell, so a cell of several dice floors one of them. A term reporting no
 * faces (Foundry evaluated the formula some other way) falls back to a bulk
 * adjustment that holds the same floor on the total.
 * @returns {Promise<{roll: Roll, total: number, perDie: boolean, faces: number[]|null}>}
 *   `faces` are the dice as they fell, null where the roll reported none
 */
export async function rollHitDice(hd, conMod, { dieMinimum = 1 } = {}) {
  const roll = await new Roll(`${hd.dice}d${hd.sides}`).evaluate();
  const faces = (roll.dice?.[0]?.results ?? []).filter((r) => r.active !== false).map((r) => r.result);
  const perDie = faces.length === hd.dice;
  const total = perDie
    ? hitPointsFromFaces(faces, conMod, { dieMinimum, flat: hd.flat ?? 0 })
    : Math.max(roll.total, dieMinimum + Math.max(0, hd.dice - 1)) + hd.dice * conMod + (hd.flat ?? 0);
  return { roll, total, perDie, faces: perDie ? faces : null };
}

/**
 * A hit-dice cell's point total from its faces: Constitution on each die, no
 * die below one, `dieMinimum` raising the first face before Constitution, and
 * the cell's printed flat added after. The dice and the modifier stay apart,
 * so the same faces answer for whatever modifier the character holds.
 */
export function hitPointsFromFaces(faces, conMod, { dieMinimum = 1, flat = 0 } = {}) {
  return faces.reduce((sum, face, i) => sum + Math.max(1, (i === 0 ? Math.max(face, dieMinimum) : face) + conMod), 0) + flat;
}

/**
 * A character's hit point maximum as the document stores it. The prepared
 * `system.hp.max` carries whatever effects and modifiers add on top, so a value
 * read from it and written back as the stored one compounds them at every
 * write. A plain object with no `_source` reads its own figure.
 */
export function storedMaxHp(actor) {
  const stored = actor?._source ? actor._source.system?.hp?.max : actor?.system?.hp?.max;
  return Number(stored) || 0;
}

/**
 * The level after which a class's hit dice stop rising, read off its own level
 * rows: the last level whose cell prints more dice than any row before it.
 * Null where no row prints a hit-dice cell.
 */
export function lastDieLevel(classItem) {
  const rows = (classItem.system?.levels ?? [])
    .map((row) => ({ level: Number(row.level), hd: parseHd(normalizeHd(row.hd)) }))
    .filter((row) => row.hd && Number.isFinite(row.level))
    .sort((a, b) => a.level - b.level);
  let last = null;
  let most = 0;
  for (const { level, hd } of rows) {
    if (hd.dice > most) last = level;
    most = Math.max(most, hd.dice);
  }
  return last;
}

/**
 * The hit-dice cell for a level. A level whose row prints no cell (a hand-made
 * class part-way through being typed) takes one die per level up to the class's
 * own last die level (`lastDieLevel`), in the die size that level prints.
 * Null where the class prints no hit-dice cell at all: nothing is guessed, and
 * the caller says the hit dice are not set.
 */
export function hdAt(classItem, level) {
  const sys = classItem.system;
  const printed = parseHd(normalizeHd(sys.levelRow(level)?.hd));
  if (printed) return printed;
  const last = lastDieLevel(classItem);
  if (last == null) return null;
  const { sides } = parseHd(normalizeHd(sys.levelRow(last)?.hd));
  return { dice: Math.max(1, Math.min(level, last)), sides, flat: 0 };
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
 * @returns {Promise<{max: number, steps: Array<{level: number, formula: string, total: number}>}|null>}
 *   null, with nothing rolled, where the class prints no hit-dice cell
 */
export async function rebuildHitPoints(actor, classItem, level, { dieMinimum = firstLevelDieMinimum() } = {}) {
  const conMod = Number(actor.system?.scores?.con?.mod) || 0;
  const target = Math.max(1, Math.min(Number(level) || 1, classItem.system.maximumLevel || 14));
  const cells = Array.from({ length: target }, (_, i) => hdAt(classItem, i + 1));
  if (cells.some((hd) => !hd)) return null;
  const steps = [];
  let max = 0;
  for (let n = 1; n <= target; n++) {
    const { roll, total } = await rollHitDice(cells[n - 1], conMod, n === 1 ? { dieMinimum } : {});
    max = n === 1 ? Math.max(1, total) : Math.max(total, max + 1);
    steps.push({ level: n, formula: roll.formula, total });
  }
  return { max, steps };
}

/**
 * A character's full hit points rolled afresh, for the sheet's roll that
 * replaces the total. A character holding a class at 1st level or above is
 * rebuilt level by level (`rebuildHitPoints`); any other rolls its own hit
 * dice formula once, Constitution on each die and, from 1st level, the
 * 1st-level floor on the first. Null where the formula is not one cell of
 * dice, or the class prints no hit dice, for the caller to fall back on the
 * system's own roll.
 * @returns {Promise<{max: number, steps: Array<{level: number, formula: string, total: number}>}|null>}
 */
export async function rollFullHitPoints(actor, classItem, { dieMinimum = firstLevelDieMinimum() } = {}) {
  const level = Number(actor.system?.details?.level) || 0;
  if (classItem && level >= 1) return rebuildHitPoints(actor, classItem, level, { dieMinimum });
  const hd = parseHd(normalizeHd(actor.system?.hp?.hd));
  if (!hd) return null;
  const conMod = Number(actor.system?.scores?.con?.mod) || 0;
  const { roll, total } = await rollHitDice(hd, conMod, level >= 1 ? { dieMinimum } : {});
  return { max: Math.max(1, total), steps: [{ level, formula: roll.formula, total }] };
}

/**
 * Where a character's experience should sit once their level is set by hand,
 * or null where it already agrees with the level and stays.
 *
 * Experience short of the new level's threshold rises to it — a character
 * promoted to 5th has just earned 5th. Experience past the next threshold
 * after a LOWERED level drops to one short of it — one corrected back down to
 * 3rd has not lost the 3rd level they had. Experience past the band after a
 * RAISED level stays: it is climbs not yet taken, as a successor's start from
 * the legacy fund is. Null too where the class prints no number to move to.
 */
export function xpForLevel(classItem, level, previousLevel, xp = 0) {
  const sys = classItem.system;
  if (level === previousLevel) return null;
  const held = Number(xp) || 0;
  const floor = sys.levelRow(level)?.xp;
  if (Number.isFinite(floor) && held < floor) return floor;
  if (level > previousLevel) return null;
  const above = sys.nextXp(level);
  return above != null && held >= above ? Math.max(0, above - 1) : null;
}
