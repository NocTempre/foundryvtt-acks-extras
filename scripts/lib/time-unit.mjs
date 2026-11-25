/**
 * The dungeon turn and the round, the module's own unit of game time.
 *
 * Two figures are printed (RR p. 263, Turns and Rounds): the rounds a turn
 * counts for time-keeping and the turns an hour of game time holds. They
 * arrive through the importer in the `formation` ruledata document, tables
 * `roundsPerTurn` and `turnsPerHour`; every reader here answers null for a
 * figure that document does not carry, and so does everything derived from
 * it. Nothing is defaulted: a world with nothing imported has no turn length
 * and no round length, and a caller tests `== null` before it multiplies,
 * because a null in arithmetic is a zero (`count * null`) or an infinity
 * (`feet / null`) and writes a wrong figure instead of failing.
 *
 * The hour is a unit of measure (3600 seconds, 24 to a day), not a printed
 * figure, so a turn's length in seconds is the hour over the turns it holds.
 */
import { citeOf, expectTables, getDoc, hasDoc } from "./tables.mjs";
import { positiveFigure } from "./util.mjs";

/** The registered document the two figures arrive in. */
export const TIME_DOC = "formation";
/** The table holding the rounds a turn counts for. */
export const ROUNDS_TABLE = "roundsPerTurn";
/** The table holding the turns an hour holds. */
export const PER_HOUR_TABLE = "turnsPerHour";

/** Seconds in an hour of game time: the unit the turn's length is measured against. */
export const SECONDS_PER_HOUR = 3600;
/** Hours in a day of game time. */
export const HOURS_PER_DAY = 24;

/** Declare the two tables, so an import names them as missing until they land. */
export function declareTimeTables() {
  expectTables(TIME_DOC, [ROUNDS_TABLE, PER_HOUR_TABLE]);
}

/** A registered table as a positive whole number, or null (absent, blank or not a whole count). */
function wholeFigure(table) {
  const n = positiveFigure(hasDoc(TIME_DOC) ? getDoc(TIME_DOC)?.tables?.[table] : null);
  return Number.isInteger(n) ? n : null;
}

/** Rounds to a dungeon turn for time-keeping, or null where nothing is imported. */
export const roundsPerTurn = () => wholeFigure(ROUNDS_TABLE);

/** Dungeon turns in an hour of game time, or null where nothing is imported. */
export const turnsPerHour = () => wholeFigure(PER_HOUR_TABLE);

/** Dungeon turns in a day of game time, or null where the turns to an hour are not imported. */
export function turnsPerDay() {
  const perHour = turnsPerHour();
  return perHour == null ? null : perHour * HOURS_PER_DAY;
}

/**
 * Seconds of world time in one dungeon turn, or null where the turns to an
 * hour are not imported. An ACKS `turns` duration is this many seconds on the
 * world clock, never a Foundry combat turn.
 */
export function turnSeconds() {
  const perHour = turnsPerHour();
  return perHour == null ? null : SECONDS_PER_HOUR / perHour;
}

/** Seconds of world time in one round for time-keeping, or null where either figure is not imported. */
export function roundSeconds() {
  const turn = turnSeconds();
  const rounds = roundsPerTurn();
  return turn == null || rounds == null ? null : turn / rounds;
}

/**
 * The page the figures were read from, or null when they are the Judge's own
 * or nothing is registered (`citeOf`). The turns to an hour carry the page
 * the rounds to a turn do: one sentence prints both.
 */
export function timeUnitCite() {
  return citeOf(TIME_DOC, ROUNDS_TABLE) ?? citeOf(TIME_DOC, PER_HOUR_TABLE);
}
