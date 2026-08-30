/**
 * Static identifiers for the battlemap alignment and token scaling assistant.
 * Kept free of any `foundry` references so the pure solver and the offline
 * tests can import them in Node.
 */

export { MODULE_ID } from "../lib/constants.mjs";
export { TRAVEL_MODES } from "../lib/vocab.mjs";

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
 * `{ calibrated, distance, autoScale, mapSystem }`. `distance` mirrors the
 * grid.distance the assistant wrote (in the scene's own units); `autoScale`
 * gates preCreateToken auto-sizing on this scene; `mapSystem` is the travel
 * mode a formation adopts on arrival (`scene-setup.mjs`).
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
 * Foundry's `CONST.GRID_TYPES` numerals, as literals so the pure modules and
 * the offline tests can name a grid without loading Foundry. The runtime
 * reads `CONST` where it has it; these are the same numbers.
 */
export const GRID_TYPE = Object.freeze({
  GRIDLESS: 0,
  SQUARE: 1,
  HEXODDR: 2,
  HEXEVENR: 3,
  HEXODDQ: 4,
  HEXEVENQ: 5,
});

/**
 * What the tool WRITES — the choice at the top of the panel, which decides
 * what the samples mean, which fields are shown, and which apply runs.
 *
 * - `square` — a square grid fitted to the map's drawn boxes.
 * - `hexRows` / `hexCols` — a hex grid pitched to one drawn hex; rows are
 *   pointy-topped, columns flat-topped, which is Foundry's own distinction.
 * - `scale` — no grid geometry at all: only what the map's distances are
 *   worth. The scene keeps whatever grid it has, gridless included.
 */
export const GRID_FAMILIES = Object.freeze(["square", "hexRows", "hexCols", "scale"]);

/** Whether a family writes hexes, and which pair of Foundry types it picks from. */
export const HEX_TYPES = Object.freeze({
  hexRows: { odd: GRID_TYPE.HEXODDR, even: GRID_TYPE.HEXEVENR, columns: false },
  hexCols: { odd: GRID_TYPE.HEXODDQ, even: GRID_TYPE.HEXEVENQ, columns: true },
});

/** The Foundry grid type a family + offset parity writes, or null for scale-only. */
export function gridTypeFor(family, even = false) {
  if (family === "square") return GRID_TYPE.SQUARE;
  const hex = HEX_TYPES[family];
  return hex ? (even ? hex.even : hex.odd) : null;
}

/**
 * Grid types the SQUARE fit can be applied over: SQUARE and GRIDLESS. A
 * gridless scene is the ordinary state of a freshly imported map and is given
 * a square grid by the apply. A hex scene is refused a square fit — but is now
 * calibratable in its own right, by choosing a hex family.
 */
export const CALIBRATABLE_GRIDS = new Set([GRID_TYPE.GRIDLESS, GRID_TYPE.SQUARE]);
