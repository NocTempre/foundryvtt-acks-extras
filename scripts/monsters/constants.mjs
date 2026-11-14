/**
 * Static identifiers for the Full Monster Sheet feature.
 *
 * Kept free of any `foundry` references so this file (and config.mjs, which it
 * pairs with) can be imported by the Node tooling as well as at runtime.
 */

export { MODULE_ID } from "../lib/constants.mjs";

/** The core ACKS actor type the monster feature enhances. */
export const MONSTER_TYPE = "monster";

/** Flag scope + the single object holding all extended stat-block data. */
export const FLAG_EXTRAS = "extras";
