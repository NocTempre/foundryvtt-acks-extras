/**
 * What a scene has been SET UP as: the module's own record of it, and the
 * reads every other surface makes of that record.
 *
 * Core's fields say what the grid is; this flag says what nobody else can —
 * that the map was calibrated here, whether tokens placed on it are auto-sized,
 * and which travel system a party adopts on arrival. The setup tool writes
 * it, and the navigation card's icon writes the travel system through the
 * same writer; formation and token sizing are readers.
 *
 * Document methods only — no canvas, no `game` — so any client can ask.
 */

import { MODULE_ID, FLAG_BATTLEMAP, GRID_TYPE, HEX_TYPES, TRAVEL_MODES, gridTypeFor } from "./constants.mjs";
import { TERRITORY_KEYS } from "../formation/country-keys.mjs";
import { CLIMATES } from "../formation/weather.mjs";

/** The grid size a hex is measured at before being scaled; any size would do. */
const HEX_PROBE_SIZE = 100;

/**
 * The scene's setup record, with every field resolved.
 * @returns {{calibrated:boolean, distance:number|null, autoScale:boolean,
 *   mapSystem:string|null, blockFeet:number|null}}
 */
export function sceneSetup(scene) {
  const flag = scene?.getFlag?.(MODULE_ID, FLAG_BATTLEMAP) ?? {};
  return {
    calibrated: !!flag.calibrated,
    distance: flag.distance > 0 ? flag.distance : null,
    autoScale: !!flag.autoScale,
    mapSystem: TRAVEL_MODES.includes(flag.mapSystem) ? flag.mapSystem : null,
    blockFeet: flag.blockFeet > 0 ? Number(flag.blockFeet) : null,
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
 * How big one city block is drawn on this map, in the scene's own distance
 * units, or null when nobody has said (the city tracker then times the party
 * by walking speed instead). See docs/formation/DECISIONS.md, "The block is
 * the map's, not the book's."
 */
export function sceneBlockFeet(scene) {
  return sceneSetup(scene).blockFeet;
}

/**
 * What this map says of its city's own incident list, or null when it names
 * none: `afterDark` is what the list adds once it is dark, `band` the
 * stretch of it read for the party's quarter; both null (silent) at zero.
 * See docs/formation/DECISIONS.md, "A city's own list belongs to its map,
 * and hands one band to the quarter."
 *
 * @returns {{tableUuid: string, afterDark: number,
 *   band: {from: number, to: number}|null}|null}
 */
export function sceneIncidents(scene) {
  const flag = scene?.getFlag?.(MODULE_ID, FLAG_BATTLEMAP)?.incidents ?? null;
  if (!flag?.tableUuid) return null;
  const afterDark = Number(flag.afterDark);
  const from = Number(flag.bandFrom);
  const to = Number(flag.bandTo);
  return {
    tableUuid: String(flag.tableUuid),
    afterDark: Number.isFinite(afterDark) ? afterDark : 0,
    band: from >= 1 && to >= from ? { from, to } : null,
  };
}

/**
 * The country this whole map stands in, under whatever the brush painted: the
 * answer for an unpainted hex, and the only one on a map that is not a hex
 * map. `ground` is a terrain brush value (a terrain key, read as a painted
 * hex's would be), `territory` a territory key, `climate` a climate code; each
 * is null where the Judge has not said, and a key the module does not know
 * reads as null.
 *
 * @returns {{ground: string|null, territory: string|null, climate: string|null}}
 */
export function sceneCountry(scene) {
  const flag = scene?.getFlag?.(MODULE_ID, FLAG_BATTLEMAP)?.country ?? {};
  return {
    ground: typeof flag.ground === "string" && flag.ground ? flag.ground : null,
    territory: TERRITORY_KEYS.includes(flag.territory) ? flag.territory : null,
    climate: Object.hasOwn(CLIMATES, flag.climate ?? "") ? flag.climate : null,
  };
}

/**
 * Merge a patch into the map's incident record, leaving the rest of the setup
 * record as it was. Blank, zero and junk clear a figure rather than storing it.
 */
export function writeSceneIncidents(scene, patch) {
  const current = scene.getFlag(MODULE_ID, FLAG_BATTLEMAP)?.incidents ?? {};
  const next = { ...current };
  if ("tableUuid" in patch) next.tableUuid = patch.tableUuid ? String(patch.tableUuid) : null;
  // The shift is signed — a list may be read lower after dark as readily as
  // higher — while an edge of the band is a face of the die and never below 1.
  for (const [key, floor] of [["afterDark", -Infinity], ["bandFrom", 1], ["bandTo", 1]]) {
    if (!(key in patch)) continue;
    const n = patch[key] === "" || patch[key] == null ? NaN : Number(patch[key]);
    next[key] = Number.isFinite(n) && n !== 0 && n >= floor ? n : null;
  }
  return writeSceneSetup(scene, { incidents: next });
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
 * Declare the travel system a scene calls for, or clear it with null: the ONE
 * writer of `mapSystem`, which the setup panel's select and the navigation
 * card's icon both come through. A value outside `TRAVEL_MODES` is written as
 * null, which is what the read makes of it. Resolves to null with no write
 * when the scene already says so.
 */
export function writeSceneSystem(scene, mapSystem) {
  const next = TRAVEL_MODES.includes(mapSystem) ? mapSystem : null;
  if (sceneSetup(scene).mapSystem === next) return Promise.resolve(null);
  return writeSceneSetup(scene, { mapSystem: next });
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
 * this scene carrying that grid — asked rather than derived, since a copy of
 * core's hex ratio here would drift. The size it is measured at is arbitrary
 * — callers scale the answer.
 *
 * The same clone's grid also names the lattice: `basis` holds the two
 * centre-to-centre steps that generate it (`u` from hex {i:0,j:0} to {i:1,j:0},
 * `v` to {i:0,j:1}, both at `refSize`), and `vertices` the six corners of hex
 * {i:0,j:0} relative to its centre. Both keys are absent, never null, when the
 * grid cannot answer, so a caller that only scales the box is unaffected.
 *
 * @returns {{refW:number, refH:number, refSize:number,
 *   basis?:{u:{x:number,y:number}, v:{x:number,y:number}},
 *   vertices?:Array<{x:number,y:number}>}|null} null when the family writes no
 *   hexes or the clone's grid cannot be read.
 */
export function hexProbe(scene, family, even = false) {
  const type = gridTypeFor(family, even);
  if (type === null || type === GRID_TYPE.SQUARE || !scene?.clone) return null;
  const probe = scene.clone({ "grid.type": type, "grid.size": HEX_PROBE_SIZE }, { keepId: true });
  const refW = probe.grid?.sizeX;
  const refH = probe.grid?.sizeY;
  // Equal edges mean the clone never rebuilt its grid from the changed type;
  // refuse rather than scale a map by a ratio of one.
  if (!(refW > 0) || !(refH > 0) || Math.abs(refW - refH) < 1e-6) return null;
  return { refW, refH, refSize: HEX_PROBE_SIZE, ...latticeOf(probe.grid) };
}

const isPoint = (p) => Number.isFinite(p?.x) && Number.isFinite(p?.y);

/**
 * What a hex grid says about its own lattice: the two steps between hex
 * centres and one hex's corners about its centre. A grid that lacks the
 * methods, throws, or answers with a non-point yields `{}` for the part it
 * cannot give.
 */
function latticeOf(grid) {
  const out = {};
  try {
    if (typeof grid?.getCenterPoint !== "function") return out;
    const c00 = grid.getCenterPoint({ i: 0, j: 0 });
    const c10 = grid.getCenterPoint({ i: 1, j: 0 });
    const c01 = grid.getCenterPoint({ i: 0, j: 1 });
    if (![c00, c10, c01].every(isPoint)) return out;
    out.basis = { u: { x: c10.x - c00.x, y: c10.y - c00.y }, v: { x: c01.x - c00.x, y: c01.y - c00.y } };
    if (typeof grid.getVertices === "function") {
      const corners = grid.getVertices({ i: 0, j: 0 });
      if (Array.isArray(corners) && corners.length && corners.every(isPoint)) {
        out.vertices = corners.map((p) => ({ x: p.x - c00.x, y: p.y - c00.y }));
      }
    }
  } catch {
    // Whatever was read before the throw stands; the rest stays absent.
  }
  return out;
}
