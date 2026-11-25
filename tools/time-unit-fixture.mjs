/**
 * The dungeon turn's two counts and what follows from them, as a test reads
 * them: the figures of `scripts/lib/time-unit.mjs` itself, so an assertion
 * moves with the unit and states no second copy of a count.
 */
import { ROUNDS_PER_TURN, SECONDS_PER_HOUR, TURNS_PER_HOUR } from "../scripts/lib/time-unit.mjs";

/** The unit's two counts: rounds to a turn, and turns to an hour. */
export const TIME_COUNTS = Object.freeze({ roundsPerTurn: ROUNDS_PER_TURN, turnsPerHour: TURNS_PER_HOUR });
/** A turn's seconds: an hour over the turns it holds. */
export const TURN_SECONDS = SECONDS_PER_HOUR / TURNS_PER_HOUR;
/** A round's seconds: a turn's over the rounds it counts. */
export const ROUND_SECONDS = TURN_SECONDS / ROUNDS_PER_TURN;
