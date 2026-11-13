/**
 * The two markers a walk prints for the runner's result file. `run.mjs` hands
 * a walk's whole output to `tools/walk-results.mjs` `reduce`, which reads a
 * walk as passed only where it printed `WALK END`, and as blocked where it
 * printed `WALK BLOCKED: <reason>`.
 */

/**
 * Prints `WALK END`. It is the last statement of a walk's `try`, so it is
 * printed only by a walk that reached its end without throwing.
 */
export function walkDone() {
  console.log("WALK END");
}

/** The error `blocked` throws, so a walk's `catch` can tell it from a fault. */
export class WalkBlocked extends Error {
  constructor(reason) {
    super(reason);
    this.name = "WalkBlocked";
  }
}

/**
 * Prints `WALK BLOCKED: <reason>` and throws, for a walk that cannot start its
 * checks for a reason outside the code under test: a seat joined that is not
 * the walk's own, another GM client holding the active GM, the world down, or
 * a fixture the world refused. A blocked line outranks a `WALK ERROR` line in
 * the reduction, so a `catch` that prints one after it changes nothing.
 * @param {string} reason
 * @returns {never}
 */
export function blocked(reason) {
  console.log(`WALK BLOCKED: ${reason}`);
  throw new WalkBlocked(reason);
}
