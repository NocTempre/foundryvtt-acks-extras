/* global game, canvas, ui, foundry, CONST */
/**
 * Layers over a wall: the module's way of meaning something by a line the
 * Judge drew.
 *
 * A wall is Foundry's only drawn LINE, and the module means more than one thing
 * by one — a tripwire, a street. Each is a FLAG over whatever segment is already
 * there and never replaces the wall's own job.
 *
 * The mechanics live here once: the dual flag read, the merge that can empty a
 * field, the all-NONE restriction data a non-blocking line is drawn with, arming
 * core's own wall tool as a preset, and turning a selection of lines into the
 * region they enclose. What a layer MEANS belongs to the feature that owns its
 * key.
 *
 * [wall-geometry.mjs](./wall-geometry.mjs) is the pure half — crossings,
 * distances, the graph. This half needs a world.
 */
import { MODULE_ID } from "./constants.mjs";
import { chainWalls } from "./wall-geometry.mjs";

/**
 * A wall's layer under `key`, raw, or null when it carries none.
 *
 * Read through the document's accessor where there is one, and off the raw
 * flags where there is not: a wall arrives as a document or as plain data (a
 * create hook's bag, the palette's preset, a scene's source).
 */
export function wallLayer(wall, key) {
  return wall?.getFlag?.(MODULE_ID, key) ?? wall?.flags?.[MODULE_ID]?.[key] ?? null;
}

/** Does this wall carry a layer under `key` at all? */
export const hasWallLayer = (wall, key) => !!wallLayer(wall, key);

/**
 * Write a layer, merging the patch over what is there.
 *
 * The merge is done here and written as a forced replacement, since a flag
 * write is itself a merge and cannot empty a field: a patch of `{repeatLock: {}}`
 * would leave every entry standing.
 */
export async function setWallLayer(wall, key, patch) {
  const merged = { ...(wallLayer(wall, key) ?? {}), ...patch };
  return wall.setFlag(MODULE_ID, key, foundry.data.operators.ForcedReplacement.create(merged));
}

/** Take a layer off a wall, leaving the wall itself exactly as it was. */
export async function clearWallLayer(wall, key) {
  return wall.unsetFlag(MODULE_ID, key);
}

/** Every wall of a scene carrying a layer under `key`. */
export function wallsFlagged(scene, key) {
  return [...(scene?.walls ?? [])].filter((w) => hasWallLayer(w, key));
}

/**
 * A wall that obstructs nothing: the shape a non-blocking line is drawn as.
 * Resolved at call time, since the restriction vocabulary is a Foundry global.
 */
export function openWallData() {
  // `EDGE_SENSE_TYPES` is v14's name for the same numbers; `WALL_SENSE_TYPES`
  // still answers behind a deprecation proxy and is the v13 fallback.
  const none = (CONST.EDGE_SENSE_TYPES ?? CONST.WALL_SENSE_TYPES).NONE;
  return { move: none, sight: none, sound: none, light: none };
}

/** Does this wall block movement? The one question a travel line must answer no to. */
export function blocksMovement(wall) {
  const none = (CONST.EDGE_SENSE_TYPES ?? CONST.WALL_SENSE_TYPES).NONE;
  return (wall?.move ?? none) !== none;
}

/** The walls the Judge currently has selected, as documents. */
export function controlledWalls() {
  return (canvas?.walls?.controlled ?? []).map((w) => w.document).filter(Boolean);
}

/** Perpendicular distance from a point to a wall segment. */
const distanceToWall = (wall, x, y) => {
  const [x1, y1, x2, y2] = wall.c;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
};

/**
 * The wall nearest a canvas point, within `reach` pixels.
 *
 * @param {string} [key] consider only walls carrying this layer
 */
export function wallNear(scene, x, y, reach, key = null) {
  let best = null;
  for (const wall of scene?.walls ?? []) {
    if (key && !hasWallLayer(wall, key)) continue;
    const dist = distanceToWall(wall, x, y);
    if (dist <= reach && (!best || dist < best.dist)) best = { wall, dist };
  }
  return best?.wall ?? null;
}

/**
 * Make `data` the shape core's wall tool draws, and hand the Judge that tool.
 *
 * Foundry's wall types are **presets**: pressing one stores the data new walls
 * are created with, and the Judge then drags the wall out. Each layer this
 * module draws is one of those presets and persists until another is pressed.
 *
 * **There is only ONE preset slot**, client-scoped: arming a street disarms a
 * tripwire. See docs/battlemap/DECISIONS.md, "The trap line and the road share
 * core's ONE preset slot". Where no palette answers, the drawing tool is still
 * handed over and the result says the arming did not happen.
 *
 * @returns {Promise<boolean>} whether the preset was actually armed
 */
export async function armWallPreset(data) {
  // The palette class is reached through the walls layer, which names its own.
  const palette = canvas?.walls?.constructor?.paletteClass;
  const armed = !!palette?.SETTING_KEY;
  if (armed) {
    await game.settings.set("core", palette.SETTING_KEY, data);
    ui.controls?.render?.({ parts: ["tools"] });
    ui.placeablesPalette?.render?.({ preset: data, preservePlacement: true });
  }
  ui.controls?.activate?.({ control: "walls", tool: "wall" });
  return armed;
}

/**
 * Where a layer's row belongs on a wall's configuration sheet.
 *
 * A WallConfig's application root IS its `<form>`, so the row goes inside the
 * scrollable body, not on the root. See docs/battlemap/DECISIONS.md, "A layer's
 * row goes inside the wall sheet's scrolling body".
 *
 * @returns {HTMLElement} the container to append to; never null.
 */
export function wallSheetFields(root) {
  return root.querySelector(".window-content .standard-form")
    ?? root.querySelector(".window-content")
    ?? root;
}
/**
 * The data core's wall tool is currently set to draw, or null, so a tool can
 * modify the armed preset rather than replace it.
 */
export function currentWallPreset() {
  const palette = canvas?.walls?.constructor?.paletteClass;
  if (!palette?.SETTING_KEY) return null;
  try {
    return game.settings.get("core", palette.SETTING_KEY) ?? null;
  } catch {
    return null;
  }
}

/**
 * Does this region already outline these points?
 *
 * Compared as an unordered set of vertices within the chaining's tolerance, so
 * a loop rebuilt from the same walls matches from any corner and direction.
 */
function samePolygon(region, points, tolerance = 8) {
  const shape = (region.shapes ?? []).find((s) => s.type === "polygon" && !s.hole);
  const have = shape?.points ?? [];
  if (have.length !== points.length) return false;
  const pairs = (flat) => Array.from({ length: flat.length / 2 }, (_, i) => [flat[i * 2], flat[i * 2 + 1]]);
  const mine = pairs(points);
  return pairs(have).every((h) => mine.some((m) => Math.hypot(h[0] - m[0], h[1] - m[1]) <= tolerance));
}

/**
 * Build a Region from the outline a set of walls draws.
 *
 * Works from ANY walls, flagged or not: the walls are the shape of an area. The
 * region restricts nothing.
 *
 * **Idempotent.** Running the tool twice on one loop adopts the region it made
 * the first time rather than stacking a second.
 *
 * @param {object[]} walls wall documents
 * @param {object} o
 * @param {string} o.name / @param {string} o.color the region's own fields
 * @param {number} [o.visibility] a `REGION_VISIBILITY` value; core's default
 *   shows the shape to anyone who opens the Regions control.
 * @param {object[]} [o.behaviors] behavior data to create it with
 * @param {string} [o.behaviorType] the type whose presence identifies a region
 *   this tool already made, for the idempotency search
 * @returns {Promise<{region: object, created: boolean, reason: string}|
 *   {region: null, created: false, reason: string}>} `reason` names the gap
 *   rather than notifying, so each caller words its own refusal.
 */
export async function regionFromWalls(walls, { name = "", color = "", visibility = null, behaviors = [], behaviorType = null } = {}) {
  const scene = canvas?.scene;
  if (!scene) return { region: null, created: false, reason: "noScene" };
  if ((walls ?? []).length < 3) return { region: null, created: false, reason: "selectLoop" };
  const { points, closed } = chainWalls(walls);
  if (!closed || points.length < 6) return { region: null, created: false, reason: "notClosed" };

  const existing = behaviorType
    ? scene.regions.find((r) => r.behaviors.some((b) => b.type === behaviorType) && samePolygon(r, points))
    : null;
  if (existing) return { region: existing, created: false, reason: "reused" };

  const data = {
    name,
    shapes: [{ type: "polygon", points, hole: false }],
    behaviors,
  };
  if (color) data.color = color;
  if (visibility != null) data.visibility = visibility;
  const [region] = await scene.createEmbeddedDocuments("Region", [data]);
  return region
    ? { region, created: true, reason: "made" }
    : { region: null, created: false, reason: "refused" };
}
