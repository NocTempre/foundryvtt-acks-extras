/**
 * The dungeon turn's two imported figures as a test registers them: INVENTED
 * counts, never the printed ones, in the `formation` document's `roundsPerTurn`
 * and `turnsPerHour` tables (`scripts/lib/time-unit.mjs`). They sit on the
 * catalog layer, so a test's own `formation` document at the world layer
 * leaves them standing.
 */
import { registerTable, unregisterTable, PRIORITY } from "../scripts/lib/tables.mjs";

/** The invented counts: rounds to a turn, and turns to an hour. */
export const INVENTED_TIME = Object.freeze({ roundsPerTurn: 20, turnsPerHour: 12 });
/** A turn's seconds under the invented counts: an hour over the turns it holds. */
export const INVENTED_TURN_SECONDS = 3600 / INVENTED_TIME.turnsPerHour;
/** A round's seconds under the invented counts. */
export const INVENTED_ROUND_SECONDS = INVENTED_TURN_SECONDS / INVENTED_TIME.roundsPerTurn;

/** Register the invented counts; `counts` overrides either one. */
export function registerInventedTime(counts = {}) {
  registerTable({ id: "formation", tables: { ...INVENTED_TIME, ...counts } }, { priority: PRIORITY.CATALOG, source: "test" });
}

/** Take the registered counts away, leaving the world as an import that read nothing. */
export function removeInventedTime() {
  unregisterTable("formation", { priority: PRIORITY.CATALOG });
}
