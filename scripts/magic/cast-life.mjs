/**
 * How long a condition record lasts when its row's `lasts` is `nextTurn`,
 * `followingTurn` or `rounds`: the pure half of the record that lives. FOUNDRY-FREE: the rolled
 * count, the formula's extremes and the bearer's fight are read by the caller
 * and passed in.
 *
 * Two ends are written on one record and the first to come deletes it by id. The
 * turn end is lib's `turnLife` flag (`lib/turn-life.mjs`), written only where the
 * bearer is a combatant of a begun fight: `nextTurn` ends at the end of the
 * bearer's next turn, `rounds` at the start of the bearer's turn that reaches the
 * rolled count, and `followingTurn` at the start of the second of the bearer's
 * turns to begin after the record was written. The clock end is the record's own
 * `duration` and `startTime` (`cast-expiry.mjs`), one round for `nextTurn`, two for
 * `followingTurn` and the rolled rounds for `rounds`, which is the only end outside
 * a fight. A `rounds` row whose formula
 * the import left blank, or whose count is no whole number of one or more, leaves
 * the record untimed.
 */

/** The `lasts` values this file times. */
export const LIFE_KINDS = Object.freeze(["nextTurn", "followingTurn", "rounds"]);

/** Does this row's life read the bearer's fight? A turn end is written for a next or following turn, and for a `rounds` row that has a count to roll. */
export const readsFight = (row) => row?.lasts === "nextTurn" || row?.lasts === "followingTurn" || Boolean(roundsFormulaOf(row));

/** Does this row's `lasts` ask for a life of its own? */
export const hasLife = (row) => LIFE_KINDS.includes(row?.lasts);

/** The formula a `rounds` row counts, trimmed, or "" where the import read none. */
export const roundsFormulaOf = (row) => String(row?.rounds ?? "").trim();

/** Is this a whole number of rounds of one or more? */
const wholeCount = (n) => Number.isInteger(n) && n >= 1;

/**
 * The count a formula's roll gives, held to a floor of one round: a record that
 * lasts no rounds would never apply.
 * @param {number} total  the roll's total
 * @returns {number|null} null where the total is no number
 */
export function roundsCount(total) {
  const n = Math.floor(Number(total));
  return Number.isFinite(n) ? Math.max(1, n) : null;
}

/**
 * The extremes a rolled count may fall between: the formula's own, each held to
 * the same floor of one.
 * @param {string} formula
 * @param {(formula: string) => {min: number, max: number}} boundsOf  the extremes of a formula, throwing where it is no formula
 * @returns {{min: number, max: number}|null} null where the formula cannot be read
 */
export function roundsBounds(formula, boundsOf) {
  if (!formula) return null;
  try {
    const { min, max } = boundsOf(formula);
    return Number.isFinite(min) && Number.isFinite(max) ? { min: Math.max(1, Math.floor(min)), max: Math.max(1, Math.floor(max)) } : null;
  } catch {
    return null;
  }
}

/**
 * What one condition row's record lasts, on one bearer.
 *
 * `kind` is the row's `lasts`; `rounds` the clock's length in rounds, null where
 * the record is untimed; `turnLife` lib's flag (`seen` zero), null where the
 * bearer holds no fight turn to count; `formula` the row's own `rounds` figure.
 * Null for a row that asks for no life of its own.
 *
 * @param {object} row  the spell's own row
 * @param {object} [o]
 * @param {number|null} [o.count]  the rolled count of a `rounds` row, as the casting client rolled it
 * @param {{combatId: string, combatantId: string}|null} [o.fight]  the begun fight the bearer is a combatant of
 * @returns {{kind: "nextTurn"|"followingTurn"|"rounds", rounds: number|null, turnLife: object|null, formula: string}|null}
 */
export function lifeOf(row, { count = null, fight = null } = {}) {
  if (!hasLife(row)) return null;
  const formula = roundsFormulaOf(row);
  const turn = (edge, n) => (fight?.combatId && fight?.combatantId ? { combatId: fight.combatId, combatantId: fight.combatantId, edge, count: n, seen: 0 } : null);
  if (row.lasts === "nextTurn") return { kind: "nextTurn", rounds: 1, turnLife: turn("end", 1), formula };
  if (row.lasts === "followingTurn") return { kind: "followingTurn", rounds: 2, turnLife: turn("start", 2), formula };
  const n = formula && wholeCount(Number(count)) ? Number(count) : null;
  return { kind: "rounds", rounds: n, turnLife: n ? turn("start", n) : null, formula };
}

/**
 * What an applied entry keeps of a record's life, for the card: the kind, the
 * count, the formula and the roll's detail as the cast showed it, and whether a
 * turn end was written beside the clock. A count of null is the untimed record.
 *
 * @param {NonNullable<ReturnType<typeof lifeOf>>} life
 * @param {string} [detail]  the roll's detail, from the entry the cast opened
 */
export const lifeEntry = (life, detail = "") => ({
  kind: life.kind,
  count: life.rounds,
  formula: life.formula,
  ...(detail ? { detail } : {}),
  turn: Boolean(life.turnLife),
});
