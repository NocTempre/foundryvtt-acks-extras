/**
 * The Foundry-FREE half of an encounter group: whether a row offers a Roll, what
 * a press does to its stack, what a count's tooltip says it came from, and what
 * the token shows a seat. group-encounter.mjs writes the documents around these
 * decisions, the same split as group-logic.mjs and group.mjs. A `source` is a
 * prototype actor or the plain snapshot a stack holds.
 */
import { ANIMAL_TYPE } from "./constants.mjs";
import { countText } from "./encounter-line.mjs";
import { ecologyOf, sizeFromEcology } from "./group-logic.mjs";

/** The two encounter lines a stat block prints. */
export const ROLL_CONTEXTS = Object.freeze(["dungeon", "wilderness"]);

/** The two sides of a line. */
export const ROLL_STATES = Object.freeze(["wandering", "lair"]);

/** A Roll's state choice that throws the lair chance first, the book's own order (JJ ch. 2). */
export const BY_LAIR_CHANCE = "chance";

/** What a seat reads off an encounter's token: the noun alone, or the name and the count. */
export const REVEAL = Object.freeze({ noun: "noun", full: "full" });

/** What a Roll does to its stack. */
export const ROLL_KIND = Object.freeze({
  roll: "roll", // sized from its line
  hand: "hand", // a count a hand set, kept
  units: "units", // counted in units, which are no bodies
  none: "none", // this side states no count
  invalid: "invalid", // a line whose formula core's Roll refuses
});

/** The hook a feature answers with the line a scene reads (`{scene, context}`, written in place). */
export const ROLL_CONTEXT_HOOK = "acksExtrasGroupRollContext";

/** Is there a creature behind this stack, whose stat block may print a line? */
export function isCreatureStack(stack) {
  const type = stack?.template?.type;
  return type === "monster" || type === ANIMAL_TYPE;
}

/**
 * A creature's lair chance, a percent, or null where none is stated. Zero is a
 * figure: a creature never in its lair.
 * @param {object} [source]
 * @returns {number|null}
 */
export function lairChanceOf(source) {
  const chance = ecologyOf(source)?.encounter?.lairChance;
  if (chance === null || chance === undefined || chance === "") return null;
  return Number.isFinite(Number(chance)) ? Number(chance) : null;
}

/**
 * One side of a source's line, as a Roll reads it.
 * @param {object} [source]
 * @param {string} context
 * @param {string} state
 * @returns {{noun: string, formula: string, unit: string, count: string}} `count`
 *   is the side as a reader sees it, its unit named; `formula` is blank where
 *   the side gives no number of bodies
 */
export function lineReading(source, context, state) {
  const side = ecologyOf(source)?.encounter?.[context]?.[state] ?? {};
  const formula = sizeFromEcology(source, context, state) ?? "";
  return {
    noun: String(side.noun ?? "").trim(),
    formula,
    unit: String(side.unit ?? "").trim(),
    count: countText(side) || formula,
  };
}

/** Every side of a source's lines that counts units, each named by its line. */
export function unitSides(source) {
  const sides = [];
  for (const context of ROLL_CONTEXTS) {
    for (const state of ROLL_STATES) {
      const { unit, count } = lineReading(source, context, state);
      if (unit && count) sides.push({ context, state, count });
    }
  }
  return sides;
}

/** Does any side of a source's lines state a count? */
export function statesACount(source) {
  return ROLL_CONTEXTS.some((context) => ROLL_STATES.some((state) => lineReading(source, context, state).count));
}

/** Does any side of a source's lines give a number of bodies? */
export function rollsBodies(source) {
  return ROLL_CONTEXTS.some((context) => ROLL_STATES.some((state) => lineReading(source, context, state).formula));
}

/**
 * May a Roll write this stack's count? A stack that stands empty or that a roll
 * sized may be written. A count a hand set stands, and no roll replaces it.
 */
export function rollsOver(stack) {
  return stack?.rolled?.total != null || !((stack?.size?.current ?? 0) > 0);
}

/** Has this stack's row a Roll to press: a creature that gives bodies, on a count no hand set? */
export function offersRoll(stack, source) {
  return isCreatureStack(stack) && rollsOver(stack) && rollsBodies(source);
}

/**
 * Has anything happened to this stack's bodies that a new count would erase? A
 * record means a body is out, fallen, individuated or gone, and a living count
 * under the initial one means pristine bodies fell, which leaves no record.
 */
export function stackHeld(stack) {
  return (stack?.roster ?? []).length > 0 || (stack?.size?.current ?? 0) < (stack?.size?.initial ?? 0);
}

/**
 * What a Roll does to its stack, with the side it read.
 * @param {object} stack
 * @param {object} [source] the stack's creature
 * @param {{context: string, state: string}} choice `state` is a side, the lair throw already made
 * @returns {{kind: string, noun: string, formula: string, unit: string, count: string}}
 */
export function planStack(stack, source, { context, state }) {
  const reading = lineReading(source, context, state);
  if (!rollsOver(stack)) return { ...reading, kind: ROLL_KIND.hand };
  if (reading.formula) return { ...reading, kind: ROLL_KIND.roll };
  return { ...reading, kind: reading.unit ? ROLL_KIND.units : ROLL_KIND.none };
}

/**
 * The group's noun after a Roll. The side's noun replaces what this monster's
 * last roll wrote and fills a blank; a noun a hand typed or another monster's
 * roll wrote stands, and a side with no noun changes nothing.
 * @param {string} current `system.noun`
 * @param {string} prior the noun this monster's last roll read
 * @param {string} fresh the noun of the side just rolled
 */
export function nextNoun(current, prior, fresh) {
  if (!fresh) return current ?? "";
  return !current || current === prior ? fresh : current;
}

/**
 * Where one stack's count came from, for its tooltip: `rolled` where the count is
 * the roll's, fallen bodies aside, `edited` where a hand changed it after the
 * roll, `hand` where no roll made it, `empty` where nothing did.
 * @param {object} stack
 * @returns {{kind: string, total?: number}}
 */
export function countOrigin(stack) {
  const total = stack?.rolled?.total;
  const current = stack?.size?.current ?? 0;
  const initial = stack?.size?.initial ?? 0;
  if (total == null) return { kind: current > 0 ? "hand" : "empty" };
  return { kind: initial === total && current <= total ? "rolled" : "edited", total };
}

const capitalized = (word) => (word ? `${word[0].toUpperCase()}${word.slice(1)}` : "");

/**
 * The name and the count, as the Judge reads them and as a seat reads them once
 * revealed. One stack reads through its noun; several read as a list, since one
 * noun does not stand for mixed bodies.
 * @param {object[]} stacks
 * @param {string} noun
 * @param {(key: string, data: object) => string} format `counted`, `uncounted` or `several`
 * @returns {string}
 */
export function fullCaption(stacks, noun, format) {
  const living = (stacks ?? []).filter((s) => (s.size?.current ?? 0) > 0);
  if (living.length > 1) {
    return living.map((s) => format("several", { name: s.template?.label ?? "", n: s.size.current })).join(", ");
  }
  const only = living[0] ?? stacks?.[0];
  if (!only) return capitalized(noun);
  const n = only.size?.current ?? 0;
  return format(n ? "counted" : "uncounted", { name: only.template?.label ?? "", noun, n });
}

/**
 * What every seat reads off the token. Below a full reveal the token carries the
 * noun and the mask, because a creature's art names it as surely as its name does.
 * @param {{reveal: string, noun: string, stacks: object[], img: string, mask: string}} group
 * @param {(key: string, data: object) => string} format as `fullCaption`
 * @returns {{name: string, src: string}}
 */
export function encounterFace({ reveal, noun, stacks, img, mask }, format) {
  if (reveal === REVEAL.full) return { name: fullCaption(stacks, noun, format), src: img };
  return { name: capitalized(noun), src: mask };
}
