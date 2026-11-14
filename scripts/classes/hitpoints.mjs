/* global Roll, game */
/**
 * Hit dice: reading the printed cell, the rules that turn it into a number of
 * hit points, and the per-level record of what was rolled. Owned here rather
 * than in apply.mjs or levelup.mjs because both need it. See
 * docs/classes/MODEL.md, "Hit points".
 */
import { getDoc, hasDoc, expectTables } from "../lib/tables.mjs";
import { MODULE_ID, LANG_PREFIX, FLAG_CLASSES } from "./constants.mjs";
import { clampLevel } from "./level-cap.mjs";

/** The registered ruledata document these derivations read. */
export const HITPOINTS_DOC = "hitPoints";

/**
 * The key, under the classes flag, of the hit point record: one step per level
 * the module rolled, in level order (`hpRollStep`).
 */
export const HP_ROLLS_KEY = "hpRolls";

/** Declare what is read, so import UX can name the gap. */
export function registerHitPointExpectations() {
  expectTables(HITPOINTS_DOC, ["firstLevel"]);
}

/**
 * The imported floor under a 1st-level hit die, or null where the world holds
 * none — no book read, or a table carrying no positive whole number.
 */
export function importedDieMinimum() {
  if (!hasDoc(HITPOINTS_DOC)) return null;
  const v = getDoc(HITPOINTS_DOC)?.tables?.firstLevel?.dieMinimum;
  return Number.isInteger(v) && v > 0 ? v : null;
}

/**
 * The printed floor under a 1st-level hit die, or 1 where no book has been
 * read. Never a guessed number: an absent table means no floor, not a
 * remembered one.
 */
export function firstLevelDieMinimum() {
  return importedDieMinimum() ?? 1;
}

/** "5d7 + 2*" → "5d7+2": the printed cell as a rollable formula. */
export function normalizeHd(cell) {
  return String(cell ?? "")
    .replace(/\*/g, "")
    .replace(/\s+/g, "");
}

/**
 * "5d7+3" → {dice: 5, sides: 7, flat: 3}: one cell of dice and a signed flat,
 * in any spelling Foundry rolls the same way ("2D6", "d8", "1d8-1"). Null for
 * anything else, a formula of two dice terms included.
 */
export function parseHd(formula) {
  const m = /^(\d*)d(\d+)(?:([+-])(\d+))?$/i.exec(String(formula ?? "").replace(/\s+/g, ""));
  if (!m) return null;
  const dice = m[1] ? parseInt(m[1], 10) : 1;
  const sides = parseInt(m[2], 10);
  if (!(dice >= 1) || !(sides >= 1)) return null;
  const flat = m[4] ? parseInt(m[4], 10) * (m[3] === "-" ? -1 : 1) : 0;
  return { dice, sides, flat };
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
 * @param {number|null} [options.dieMinimum] the printed 1st-level floor;
 *   defaults to whatever the world has imported, and null (no floor, recorded
 *   as null) where it has none
 * @returns {Promise<{max: number, steps: object[]}|null>} `steps` are the
 *   record's (`hpRollStep`), one per level; null, with nothing rolled, where
 *   the class prints no hit-dice cell
 */
export async function rebuildHitPoints(actor, classItem, level, { dieMinimum = importedDieMinimum() } = {}) {
  const conMod = Number(actor.system?.scores?.con?.mod) || 0;
  const target = clampLevel(classItem.system, level);
  const cells = Array.from({ length: target }, (_, i) => hdAt(classItem, i + 1));
  if (cells.some((hd) => !hd)) return null;
  const steps = [];
  let max = 0;
  for (let n = 1; n <= target; n++) {
    const hd = cells[n - 1];
    const { roll, total, faces } = await rollHitDice(hd, conMod, n === 1 ? { dieMinimum: dieMinimum ?? 1 } : {});
    const previous = max;
    max = n === 1 ? Math.max(1, total) : Math.max(total, max + 1);
    const prior = n > 1 && max > total ? previous : undefined;
    steps.push(hpRollStep({ level: n, formula: roll.formula, faces, con: conMod, flat: hd.flat, floor: n === 1 ? dieMinimum : undefined, total, max, prior }));
  }
  return { max, steps };
}

/**
 * One step of the hit point record: what the module did to the maximum at one
 * level. `kind` is "roll" (the level's whole pool rolled: its dice, with the
 * printed flat as `flat`, every level past the last die level included) or
 * "none" (the class's hit dice for the level are not set; the maximum took
 * the previous, `prior`, plus one). `floor` is present only on a step rolled
 * under the 1st-level floor: the floor used, or null where none was
 * imported. `faces` is null where the
 * roll reported none. `total` is the level's own figure, `max` the maximum it
 * left, and `prior` the maximum a step was held above where one was. `whole`
 * marks one roll of the character's own hit dice formula standing for every
 * level up to its own (a character with no class), so the levels below it
 * carry no step of their own.
 * @param {{level: number, kind?: string, whole?: boolean,
 *   formula?: string|null, faces?: number[]|null, con?: number, flat?: number,
 *   floor?: number|null, total: number, max: number, prior?: number}} parts
 * @returns {object}
 */
export function hpRollStep({ level, kind = "roll", whole = false, formula = null, faces = null, con = 0, flat = 0, floor, total, max, prior }) {
  const step = {
    level: Number(level) || 0,
    kind,
    formula,
    faces: Array.isArray(faces) ? [...faces] : null,
    con: Number(con) || 0,
    flat: Number(flat) || 0,
    total: Number(total) || 0,
    max: Number(max) || 0,
    at: Date.now(),
  };
  if (floor !== undefined) step.floor = Number.isInteger(floor) ? floor : null;
  if (prior !== undefined) step.prior = Number(prior) || 0;
  if (whole) step.whole = true;
  return step;
}

/**
 * A rebuilt record closed on the maximum actually written. Where that differs
 * from the last step's own figure (a 0th-level character keeps one over the
 * maximum it held), the last step carries it, with the maximum held before as
 * `prior`.
 */
export function closeHpRolls(steps, written, prior) {
  const last = steps.at(-1);
  if (!last || Number(written) === last.max) return steps;
  return [...steps.slice(0, -1), { ...last, max: Number(written) || 0, prior: Number(prior) || 0 }];
}

/** The hit point record an actor carries, in level order; empty where none. */
export function hitPointRolls(actor) {
  const flag = actor?.getFlag?.(MODULE_ID, FLAG_CLASSES) ?? actor?.flags?.[MODULE_ID]?.[FLAG_CLASSES];
  const record = flag?.[HP_ROLLS_KEY];
  if (!Array.isArray(record)) return [];
  return record.filter((s) => s && Number.isFinite(Number(s.level))).sort((a, b) => a.level - b.level);
}

/** A record with `step` in its level's place and nothing above it. */
export function withHpRoll(record, step) {
  return [...(record ?? []).filter((s) => s.level < step.level), step];
}

/**
 * The record read against the maximum the actor stores. `state` is "none" (no
 * step recorded), "level" (the record ends at another level than the one held),
 * "differs" (the last step's maximum is not the stored one — a hand edit, a
 * level lowered by hand, core's own roll; the record cannot tell which) or
 * "recorded". `missing` lists the levels
 * below the last step that carry none, counted above the latest `whole` step,
 * which stands for every level up to its own.
 * @returns {{state: string, stored: number, level: number, steps: object[],
 *   recorded: number|null, missing: number[]}}
 */
export function hitPointAudit(actor) {
  const steps = hitPointRolls(actor);
  const stored = storedMaxHp(actor);
  const level = Number(actor?.system?.details?.level) || 0;
  const last = steps.at(-1);
  if (!last) return { state: "none", stored, level, steps, recorded: null, missing: [] };
  const have = new Set(steps.map((s) => s.level));
  const whole = steps.findLast((s) => s.whole);
  const missing = [];
  for (let n = whole ? whole.level + 1 : Math.min(1, steps[0].level); n < last.level; n++) if (!have.has(n)) missing.push(n);
  const state = last.level !== level ? "level" : Number(last.max) !== stored ? "differs" : "recorded";
  return { state, stored, level, steps, recorded: Number(last.max), missing };
}

const fmt = (key, data) => game.i18n.format(`${LANG_PREFIX}.hpAudit.${key}`, data);
const signedMod = (n) => (n >= 0 ? `+${n}` : `${n}`);

/** One step as the tooltip states it: its dice, faces, parts and figures. */
function stepText(s) {
  const data = { level: s.level, total: s.total, max: s.max };
  if (s.kind === "none") return fmt("stepNone", { ...data, prior: s.prior ?? s.max - 1 });
  const faces = Array.isArray(s.faces) ? s.faces.join(", ") : fmt("facesUnknown");
  const parts = [fmt("conPerDie", { con: signedMod(s.con) })];
  if (s.flat) parts.push(fmt("flat", { flat: signedMod(s.flat) }));
  if (s.floor != null) parts.push(fmt("floor", { floor: s.floor }));
  const text = fmt(s.whole ? "stepWhole" : "stepRoll", { ...data, formula: s.formula ?? "", faces, parts: parts.join(", ") });
  return s.prior !== undefined ? `${text} ${fmt("prior", { prior: s.prior })}` : text;
}

/**
 * The hit point maximum's provenance as the character sheet shows it: `tip`
 * for the maximum's tooltip (each recorded level's parts, what the record does
 * not account for, and the figure effects put in force), and `line`, the
 * compact copy shown beneath the field.
 * @returns {{state: string, tip: string, line: string}}
 */
export function hitPointAuditText(actor) {
  const audit = hitPointAudit(actor);
  const tip = [fmt("head", { max: audit.stored })];
  const notes = [];
  if (audit.state === "none") notes.push(fmt("none"));
  else {
    tip.push(...audit.steps.map(stepText));
    if (audit.missing.length) notes.push(fmt("missing", { levels: audit.missing.join(", ") }));
    if (audit.state === "level") notes.push(fmt("otherLevel", { recorded: audit.steps.at(-1).level, level: audit.level }));
    if (audit.state === "differs") notes.push(fmt("differs", { recorded: audit.recorded, stored: audit.stored }));
  }
  tip.push(...notes);
  const prepared = Number(actor?.system?.hp?.max);
  if (actor?._source && Number.isFinite(prepared) && prepared !== audit.stored) tip.push(fmt("inForce", { value: prepared }));
  if (audit.state === "none") return { state: audit.state, tip: tip.join(" · "), line: fmt("lineNone") };
  const short = audit.steps.map((s) => fmt("short", { level: s.level, faces: Array.isArray(s.faces) && s.faces.length ? s.faces.join(", ") : "—", max: s.max }));
  return { state: audit.state, tip: tip.join(" · "), line: [fmt("line", { steps: short.join(" · ") }), ...notes].join(" · ") };
}

/**
 * A character's full hit points rolled afresh, for the sheet's roll that
 * replaces the total. A character holding a class at 1st level or above is
 * rebuilt level by level (`rebuildHitPoints`); any other rolls its own hit
 * dice formula once, Constitution on each die and, from 1st level, the
 * 1st-level floor on the first. Null, with nothing rolled, where the formula
 * is not one cell of dice or the class prints no hit dice; the caller says so
 * (`rerollRefusal`) and never hands the roll to the system's own, which
 * applies no Constitution.
 * @returns {Promise<{max: number, steps: object[]}|null>} `steps` are the
 *   record's (`hpRollStep`)
 */
export async function rollFullHitPoints(actor, classItem, { dieMinimum = importedDieMinimum() } = {}) {
  const level = Number(actor.system?.details?.level) || 0;
  if (classItem && level >= 1) return rebuildHitPoints(actor, classItem, level, { dieMinimum });
  const hd = parseHd(normalizeHd(actor.system?.hp?.hd));
  if (!hd) return null;
  const conMod = Number(actor.system?.scores?.con?.mod) || 0;
  const { roll, total, faces } = await rollHitDice(hd, conMod, level >= 1 ? { dieMinimum: dieMinimum ?? 1 } : {});
  const max = Math.max(1, total);
  const step = hpRollStep({ level, whole: true, formula: roll.formula, faces, con: conMod, flat: hd.flat, floor: level >= 1 ? dieMinimum : undefined, total, max });
  return { max, steps: [step] };
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
