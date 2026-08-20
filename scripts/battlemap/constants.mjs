/**
 * Static identifiers for the battlemap alignment and token scaling assistant.
 * Kept free of any `foundry` references so the pure solver and the offline
 * tests can import them in Node.
 */

export { MODULE_ID } from "../lib/constants.mjs";

export const LANG_PREFIX = "ACKS-BATTLEMAP";

/**
 * Scene flag holding the calibration record:
 * `{ calibrated: boolean, distance: number, autoScale: boolean }`.
 * `distance` mirrors the grid.distance the assistant wrote (feet per square);
 * `autoScale` gates preCreateToken auto-sizing on this scene.
 */
export const FLAG_BATTLEMAP = "battlemap";

/**
 * Token / actor flag overriding the derived footprint: `{ w, h }` in feet.
 * A token flag wins over an actor flag; either wins over the size category.
 */
export const FLAG_FOOTPRINT = "footprint";

/** Token flag opting a token out of every automatic resize. */
export const FLAG_FOOTPRINT_LOCK = "footprintLock";
