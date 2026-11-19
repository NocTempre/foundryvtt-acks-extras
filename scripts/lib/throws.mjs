/**
 * The general rule for the natural die of a throw: which natural results fail
 * and which succeed whatever the modifiers and the target (RR p. 10, "Throwing
 * the Dice", "Automatic Success and Failure"). The procedure ships; the two
 * figures it needs are read.
 *
 * The page prints one natural result that fails and one that succeeds, the
 * second only for a thrower proficient in the task. They are the `throws`
 * document's `throwProse` table: `autoFailMax`, the highest natural result that
 * fails, and `autoSucceedMin`, the lowest that succeeds. Nothing else is
 * assumed of the die, so the lowest result that can succeed is one past the
 * failing edge (`dieFloor`).
 *
 * The natural die is read before the target: a throw whose natural result is
 * automatic never consults the modifiers or the target number. This is the
 * general rule only; a throw that prints a band of its own (a botch band, a
 * wider failure range) keeps its own figures and does not read these.
 *
 * Every answer is null while nothing is imported, a figure the Judge has not
 * read or set is never replaced by a default, and a pair of figures that
 * contradict each other (a success edge no higher than the failing one) is read
 * as neither. The caller then lets the target alone decide. See
 * docs/lib/MODEL.md, "The natural die of a throw".
 */
import { citeOf, expectTables, getDoc, hasDoc } from "./tables.mjs";
import { numOrNull } from "./util.mjs";

/** The registered document the natural-die figures arrive in. */
export const THROWS_DOC = "throws";
/** Its table holding the two figures: `{autoFailMax, autoSucceedMin}`. */
export const THROW_TABLE = "throwProse";

/** Declare the throws table, so an import names it as missing until it lands. */
export function declareThrowTables() {
  expectTables(THROWS_DOC, [THROW_TABLE]);
}

/** One stored figure, or undefined where nothing is imported. */
const printed = (key) => (hasDoc(THROWS_DOC) ? getDoc(THROWS_DOC)?.tables?.[THROW_TABLE]?.[key] : undefined);

/** A whole number at or above `min`, else null. */
function whole(v, min) {
  const n = numOrNull(v);
  return n != null && Number.isInteger(n) && n >= min ? n : null;
}

/**
 * The page the figures were read from, or null when they are the Judge's own or
 * nothing is imported (`citeOf`).
 */
export function throwsCite() {
  return citeOf(THROWS_DOC, THROW_TABLE);
}

/**
 * The two edges, each null until read: `failMax`, the highest natural result
 * that fails (zero where a Judge sets none), and `succeedMin`, the lowest that
 * succeeds for a proficient thrower. Both are null when they contradict each
 * other. The Judge's override layer answers first, as everywhere in the
 * registry.
 *
 * @returns {{failMax: number|null, succeedMin: number|null, cite: string|null}}
 */
export function throwFigures() {
  const failMax = whole(printed("autoFailMax"), 0);
  const succeedMin = whole(printed("autoSucceedMin"), 1);
  const contradict = failMax != null && succeedMin != null && succeedMin <= failMax;
  return { failMax: contradict ? null : failMax, succeedMin: contradict ? null : succeedMin, cite: throwsCite() };
}

/** The natural result as a whole number, or null for anything else. */
const naturalOf = (natural) => whole(natural, Number.MIN_SAFE_INTEGER);

/**
 * Whether a natural result fails the throw whatever the modifiers and the
 * target: true or false, or null where the failing edge is not imported or
 * `natural` is no whole number.
 */
export function isAutoFail(natural) {
  const n = naturalOf(natural);
  const { failMax } = throwFigures();
  return n == null || failMax == null ? null : n <= failMax;
}

/**
 * Whether a natural result succeeds the throw whatever the modifiers and the
 * target. The page grants it to a thrower proficient in the task only, so the
 * answer takes `proficient`: false is never an automatic success, and a thrower
 * whose proficiency is not stated (anything but a boolean) is null, never
 * assumed. Null as well where the succeeding edge is not imported or `natural`
 * is no whole number.
 *
 * @param {number} natural
 * @param {{proficient?: boolean}} [who]
 */
export function isAutoSucceed(natural, { proficient } = {}) {
  const n = naturalOf(natural);
  const { succeedMin } = throwFigures();
  if (n == null || succeedMin == null || typeof proficient !== "boolean") return null;
  return proficient && n >= succeedMin;
}

/**
 * The lowest natural result that can succeed, one past the failing edge, or
 * null where the edge is not imported.
 */
export function dieFloor() {
  const { failMax } = throwFigures();
  return failMax == null ? null : failMax + 1;
}
