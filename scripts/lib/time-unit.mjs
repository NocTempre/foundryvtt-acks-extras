/**
 * The dungeon turn and the round, the module's own units of game time.
 *
 * Two counts measure it (RR p. 263, Turns and Rounds): the rounds a turn
 * counts for time-keeping and the turns an hour of game time holds. Both are
 * units of measure stated here, not imported, so every reader answers a
 * positive number and none answers null. A turn's length in seconds is the
 * hour over the turns it holds, and a round's is the turn's over the rounds
 * it counts. The ruling is in `docs/lib/DECISIONS.md`.
 *
 * This file imports nothing, so an importer binding may read the same units.
 */

/** Rounds to a dungeon turn for time-keeping (RR p. 263). */
export const ROUNDS_PER_TURN = 10;
/** Dungeon turns in an hour of game time (RR p. 263). */
export const TURNS_PER_HOUR = 6;

/** Seconds in an hour of game time: the unit the turn's length is measured against. */
export const SECONDS_PER_HOUR = 3600;
/** Hours in a day of game time. */
export const HOURS_PER_DAY = 24;

/** Rounds to a dungeon turn for time-keeping. */
export const roundsPerTurn = () => ROUNDS_PER_TURN;

/** Dungeon turns in an hour of game time. */
export const turnsPerHour = () => TURNS_PER_HOUR;

/** Dungeon turns in a day of game time. */
export const turnsPerDay = () => TURNS_PER_HOUR * HOURS_PER_DAY;

/**
 * Seconds of world time in one dungeon turn. An ACKS `turns` duration is this
 * many seconds on the world clock, never a Foundry combat turn.
 */
export const turnSeconds = () => SECONDS_PER_HOUR / TURNS_PER_HOUR;

/** Seconds of world time in one round for time-keeping. */
export const roundSeconds = () => turnSeconds() / ROUNDS_PER_TURN;

/** The page that prints the two counts, in the cookbook's citation form (`recipeCite`). */
export const timeUnitCite = () => "RR p.263";
