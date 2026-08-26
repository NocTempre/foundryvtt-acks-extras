/**
 * Static identifiers for the battlemap alignment and token scaling assistant.
 * Kept free of any `foundry` references so the pure solver and the offline
 * tests can import them in Node.
 */

export { MODULE_ID } from "../lib/constants.mjs";

export const LANG_PREFIX = "ACKS-BATTLEMAP";

/**
 * The id shared by the scene-control group and the sidebar tab. One string:
 * the session addresses the toolbar by it, the toolbar declares it, and the
 * tab registers under it, so they cannot drift apart.
 */
export const CONTROL_GROUP = "acksBattlemap";

/** The scene-control tool that arms nothing — the group's resting state. */
export const TOOL_OFF = "off";

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

/**
 * Grid types the assistant can calibrate: SQUARE (0 is GRIDLESS, 1 is SQUARE
 * — the numerals rather than `CONST` so the pure modules can import this).
 * A gridless scene is the ordinary state of a freshly imported map and is
 * given a square grid by the apply; hex is refused, the solver fitting a
 * rectangular lattice that a hex scene is not.
 */
export const CALIBRATABLE_GRIDS = new Set([0, 1]);
