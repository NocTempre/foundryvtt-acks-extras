/* global canvas, foundry, game */
/**
 * The marching column's lights on the canvas: one client-side point light per
 * bearer still inside the party token, at the centre of that bearer's cell
 * (`column-light-logic.mjs` says which and where).
 *
 * Built on every client from the formation record and the token, so no write
 * carries them: lighting, dousing or shuttering a source is a record write,
 * and every client rebuilds. Their radius is the figure in feet at the
 * scene's scale with no padding, which a token's own light carries through
 * core's `getLightRadius`; lib's padding patch takes the same padding off a
 * member's token, so a lantern reaches as far in the column as in a hand.
 *
 * `carriedLightPoints` is the same set at rest, for the Night Vision sweep,
 * which runs on the primary GM over scenes no canvas is drawing.
 */
import { MODULE_ID } from "./constants.mjs";
import { columnLights } from "./column-light-logic.mjs";
import { columnFor } from "./column.mjs";
import { getPartyToken, readFormations } from "./formation-model.mjs";
import { feetToUnits } from "../lib/distance-units.mjs";
import { effectLight } from "../lib/light.mjs";
import { lightLookFor } from "../lib/token-sync.mjs";

/** A member's effect light in feet, the extra source a column point may take. */
const memberEffectLight = (actorId) => effectLight(game.actors?.get?.(actorId));

/** The world setting that turns carried light on the map on or off. */
const SETTING_SYNC_LIGHT = "syncTokenLight";

/** Whether carried lights shine on the map at all. */
export function columnLightsOn() {
  try {
    return game.settings.get(MODULE_ID, SETTING_SYNC_LIGHT) !== false;
  } catch {
    return true;
  }
}

/** The id a column light carries in core's light-source collection. */
export function columnLightId(formationId, bearerId) {
  return `${MODULE_ID}.column.${formationId}.${bearerId}`;
}

/**
 * Bring a party's light sources in line with its column: one per lit bearer,
 * created, moved or removed. `state.lights` is a Map of bearer id → source,
 * owned by the caller (the column view's per-token state).
 *
 * @param {{lights: Map<string, object>}} state
 * @param {object} formation the record
 * @param {Token} token the party token's placeable
 * @param {{x: number, y: number}[]} cells `columnFor(...).cells`
 */
export function syncColumnLights(state, formation, token, cells) {
  const doc = token?.document;
  const scene = doc?.parent;
  const gs = Number(scene?.grid?.size);
  const wanted = new Map();
  // A hidden party token sheds nothing, as a hidden token's own light does not.
  if (columnLightsOn() && gs > 0 && !doc.hidden && token.visible !== false) {
    for (const point of columnLights(formation, cells, gs, memberEffectLight)) wanted.set(point.bearerId, point);
  }
  let changed = false;
  for (const [bearerId, source] of state.lights) {
    if (wanted.has(bearerId)) continue;
    source.destroy();
    state.lights.delete(bearerId);
    state.lightKeys?.delete(bearerId);
    changed = true;
  }
  const pixels = canvas.dimensions.distancePixels;
  const units = scene.grid.units;
  let defaults = null;
  for (const [bearerId, point] of wanted) {
    // A token refreshes every frame, and a perception update refreshes it
    // again: a source is re-initialised only when what it shines changed, or
    // the two would drive each other.
    const key = `${point.x},${point.y},${point.bright},${point.dim},${point.kind},${doc.elevation ?? 0},${doc.level ?? ""},${pixels},${units}`;
    let source = state.lights.get(bearerId);
    // Still in core's collection too: a source a re-initialisation dropped is
    // added again, whatever the key says.
    if (source && state.lightKeys?.get(bearerId) === key && canvas.effects?.lightSources?.has?.(source.sourceId)) continue;
    if (!source) {
      source = new foundry.canvas.sources.PointLightSource({ sourceId: columnLightId(formation.id, bearerId), object: token });
      state.lights.set(bearerId, source);
    }
    (state.lightKeys ??= new Map()).set(bearerId, key);
    defaults ??= new foundry.data.LightData().toObject();
    const look = lightLookFor(point.kind);
    source.initialize({
      ...defaults,
      x: point.x,
      y: point.y,
      elevation: doc.elevation ?? 0,
      level: doc.level ?? null,
      color: look.color,
      alpha: look.alpha,
      animation: { ...defaults.animation, ...look.animation },
      // Feet at the scene's scale, never padded by the token's own size.
      bright: feetToUnits(point.bright, units) * pixels,
      dim: feetToUnits(point.dim, units) * pixels,
      seed: doc.getFlag?.("core", "animationSeed"),
      disabled: false,
    });
    source.add();
    changed = true;
  }
  if (changed) canvas.perception.update({ refreshLighting: true, refreshVision: true });
}

/** Remove every light source a party's state holds. */
export function destroyColumnLights(state) {
  if (!state?.lights?.size) return;
  for (const source of state.lights.values()) source.destroy();
  state.lights.clear();
  state.lightKeys?.clear();
  canvas.perception?.update?.({ refreshLighting: true, refreshVision: true });
}

/**
 * Every column light standing on `scene`, at rest: `{x, y, bright}` with `x`/`y`
 * a pixel centre and `bright` in the scene's units, the same reading a token's
 * stored `light.bright` gives. Read from the record, the token's stored
 * position and its stored trail, so it answers for a scene nobody is viewing.
 * Published on the formation namespace for lib's `brightestLightReaching`.
 */
export function carriedLightPoints(scene) {
  if (!scene || !columnLightsOn()) return [];
  const gs = Number(scene.grid?.size);
  if (!(gs > 0)) return [];
  const out = [];
  // The stored records, read-only: this runs once per watcher per sweep.
  for (const formation of Object.values(readFormations())) {
    const token = getPartyToken(formation);
    if (!token || token.parent?.id !== scene.id || token.hidden) continue;
    const at = columnFor(formation, token);
    if (!at) continue;
    for (const point of columnLights(formation, at.cells, gs, memberEffectLight)) {
      out.push({ x: point.x, y: point.y, bright: feetToUnits(point.bright, scene.grid.units) });
    }
  }
  return out;
}
