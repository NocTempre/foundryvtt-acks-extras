/**
 * The dungeon turn and the round, the module's own units of game time.
 *
 * Two counts measure it (RR p. 263, Turns and Rounds): the rounds a turn
 * counts for time-keeping and the turns an hour of game time holds. Both are
 * units of measure stated here as constants, so every reader answers a
 * positive number and none answers null. A world's `formation` document may
 * hold a table of the same name for either count (`roundsPerTurn`,
 * `turnsPerHour`), left by an import made while the figure was imported and
 * overridable by a Judge in the Ruledata Browser, and a table holding a
 * positive whole number stands in for its constant; any other figure leaves
 * the constant. Nothing produces the
 * tables, so they are not declared with `expectTables`. A turn's length in
 * seconds is the hour over the turns it holds, and a round's is the turn's
 * over the rounds it counts, each computed from the readers so an override
 * reaches every figure derived from it. The ruling is in
 * `docs/lib/DECISIONS.md`.
 *
 * This file imports `tables.mjs` and `util.mjs`, neither of which imports a
 * feature, so an importer binding may read the same units.
 */
import { getDoc, hasDoc } from "./tables.mjs";
import { positiveFigure } from "./util.mjs";

/** Rounds to a dungeon turn for time-keeping (RR p. 263). */
export const ROUNDS_PER_TURN = 10;
/** Dungeon turns in an hour of game time (RR p. 263). */
export const TURNS_PER_HOUR = 6;

/** Seconds in an hour of game time: the unit the turn's length is measured against. */
export const SECONDS_PER_HOUR = 3600;
/** Hours in a day of game time. */
export const HOURS_PER_DAY = 24;

/** The registered document a world may hold the two counts in. */
const TIME_DOC = "formation";

/** A world's table as a positive whole number, or null (no document, absent, blank, not a number, not whole). */
function wholeFigure(tableId) {
  const n = positiveFigure(hasDoc(TIME_DOC) ? getDoc(TIME_DOC)?.tables?.[tableId] : null);
  return Number.isInteger(n) ? n : null;
}

/** Rounds to a dungeon turn for time-keeping: the world's `roundsPerTurn` table where it holds a positive whole number, else `ROUNDS_PER_TURN`. */
export const roundsPerTurn = () => wholeFigure("roundsPerTurn") ?? ROUNDS_PER_TURN;

/** Dungeon turns in an hour of game time: the world's `turnsPerHour` table where it holds a positive whole number, else `TURNS_PER_HOUR`. */
export const turnsPerHour = () => wholeFigure("turnsPerHour") ?? TURNS_PER_HOUR;

/** Dungeon turns in a day of game time. */
export const turnsPerDay = () => turnsPerHour() * HOURS_PER_DAY;

/**
 * Seconds of world time in one dungeon turn. An ACKS `turns` duration is this
 * many seconds on the world clock, never a Foundry combat turn.
 */
export const turnSeconds = () => SECONDS_PER_HOUR / turnsPerHour();

/** Seconds of world time in one round for time-keeping. */
export const roundSeconds = () => turnSeconds() / roundsPerTurn();

/** The page that prints the two counts, in the cookbook's citation form (`recipeCite`). */
export const timeUnitCite = () => "RR p.263";
