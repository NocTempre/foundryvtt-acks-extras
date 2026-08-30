/**
 * What a scene has been SET UP as: the module's own record of it, and the
 * reads every other surface makes of that record.
 *
 * Core's fields say what the grid is; this flag says what nobody else can —
 * that the map was calibrated here, whether tokens placed on it are auto-sized,
 * and which travel system a party adopts on arrival. The setup tool is the one
 * writer; formation and token sizing are readers.
 *
 * Document methods only — no canvas, no `game` — so any client can ask.
 */

import { MODULE_ID, FLAG_BATTLEMAP, GRID_TYPE, HEX_TYPES, TRAVEL_MODES, gridTypeFor } from "./constants.mjs";

/** The grid size a hex is measured at before being scaled; any size would do. */
const HEX_PROBE_SIZE = 100;

/**
 * The scene's setup record, with every field resolved.
 * @returns {{calibrated:boolean, distance:number|null, autoScale:boolean,
 *   mapSystem:string|null}}
 */
export function sceneSetup(scene) {
  const flag = scene?.getFlag?.(MODULE_ID, FLAG_BATTLEMAP) ?? {};
  return {
    calibrated: !!flag.calibrated,
    distance: flag.distance > 0 ? flag.distance : null,
    autoScale: !!flag.autoScale,
    mapSystem: TRAVEL_MODES.includes(flag.mapSystem) ? flag.mapSystem : null,
  };
}

/**
 * The travel system a formation adopts on this scene, or null when the Judge
 * has not said. Null is silence, not a default: a scene nobody has declared
 * leaves a party in whatever mode it was already in.
 */
export function sceneTravelSystem(scene) {
  return sceneSetup(scene).mapSystem;
}

/**
 * Merge a patch into the setup record. Read-modify-write over the whole flag,
 * because Foundry replaces a flag object rather than merging into it and the
 * apply and the scene-config row each write only their own half.
 */
export function writeSceneSetup(scene, patch) {
  return scene.setFlag(MODULE_ID, FLAG_BATTLEMAP, { ...(scene.getFlag(MODULE_ID, FLAG_BATTLEMAP) ?? {}), ...patch });
}

/**
 * The grid family this scene already uses — the setup tool's default, so the
 * panel opens describing the map in front of the Judge. A gridless scene reads
 * as `square`: calibrating one IS choosing square (DECISIONS 2026-08-24), and
 * a Judge who wants no grid picks scale-only.
 */
export function familyOfScene(scene) {
  const type = scene?.grid?.type ?? GRID_TYPE.GRIDLESS;
  for (const [family, hex] of Object.entries(HEX_TYPES)) {
    if (type === hex.odd || type === hex.even) return family;
  }
  return "square";
}

/**
 * The bounding box of ONE hex of the given family, measured off a clone of
 * this scene carrying that grid.
 *
 * Asked rather than derived: a hex's proportions are core's own geometry, they
 * differ between pointy-topped rows and flat-topped columns, and a second copy
 * of the ratio here is a second answer to drift from. The size it is measured
 * at is arbitrary — callers scale the answer.
 *
 * @returns {{refW:number, refH:number, refSize:number}|null} null when the
 *   family writes no hexes or the clone's grid cannot be read.
 */
export function hexProbe(scene, family, even = false) {
  const type = gridTypeFor(family, even);
  if (type === null || type === GRID_TYPE.SQUARE || !scene?.clone) return null;
  const probe = scene.clone({ "grid.type": type, "grid.size": HEX_PROBE_SIZE }, { keepId: true });
  const refW = probe.grid?.sizeX;
  const refH = probe.grid?.sizeY;
  // A hex's bounding box is never square. Equal edges mean the clone did not
  // rebuild its grid from the changed type and is still answering as a square
  // one — refuse rather than scale a map by a ratio of one.
  if (!(refW > 0) || !(refH > 0) || Math.abs(refW - refH) < 1e-6) return null;
  return { refW, refH, refSize: HEX_PROBE_SIZE };
}
