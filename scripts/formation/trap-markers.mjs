/* global game, canvas, Hooks, PIXI */
import { MODULE_ID, TRAP_ZONE_TYPE } from "./constants.mjs";
import { STATES } from "./trap-rules.mjs";
import { wallTrap } from "./trap-walls.mjs";

/**
 * What a Judge can see of a trap, and what the party has earned the right to.
 *
 * Modelled on the secret door, which is the closest thing the system already
 * has, and it has two stages. **Hidden:** while a trap is armed and unfound a
 * player is shown nothing at all — no icon, no wall, no hint that the square is
 * different — and only the Judge sees a marker. **Known:** once the party has
 * found the thing, sprung it, or disarmed it, the marker is theirs too, and it
 * says which state it is in — armed, spotted, disarmed, spent — the same way a
 * discovered secret door goes on to show whether it is open or shut.
 *
 * The stage is `known`, not the state. A trap the thief disarmed and re-armed
 * reads `armed` again and is still perfectly well known; a trap the Judge reset
 * reads `armed` and is a fresh secret. Reading the stage off the state would
 * make the party forget a trap by re-arming it.
 *
 * A player's marker is the thing the Trapbreaking dialog points at, which is
 * why the two stages exist at all: a target you cannot see is a target you
 * cannot choose.
 *
 * Drawn into the controls layer rather than onto the walls: a trap wall is
 * non-blocking and often lies on top of an ordinary wall or a door, so the
 * marker has to be visible when the Walls layer is not the active one.
 *
 * The gate is at the point of DRAWING, not a hide applied after the fact.
 * Nothing about an unfound trap reaches a player's client through this file.
 */

/** The glyph and colour each state is drawn in. */
const MARKS = Object.freeze({
  [STATES.armed]: { glyph: "▲", color: 0xa3312c }, // filled triangle, danger
  [STATES.found]: { glyph: "△", color: 0xc8862a }, // hollow triangle, spotted
  [STATES.disarmed]: { glyph: "✓", color: 0x4a7a46 }, // a tick, made safe
  [STATES.discharged]: { glyph: "×", color: 0x6b6b6b }, // spent, and grey
});

let layer = null;

/** The container the markers live in, created on first use. */
function markerLayer() {
  if (layer && !layer.destroyed) return layer;
  layer = new PIXI.Container();
  layer.eventMode = "none"; // decoration: never intercept a click meant for the map
  canvas.controls.addChild(layer);
  return layer;
}

/** One marker, centred on a point. */
function drawMark(container, x, y, state) {
  const mark = MARKS[state] ?? MARKS[STATES.armed];
  const size = Math.max(16, (canvas.grid?.size ?? 100) * 0.34);
  const text = new PIXI.Text(mark.glyph, {
    fontFamily: "Signika, sans-serif",
    fontSize: size,
    fill: mark.color,
    stroke: 0x000000,
    strokeThickness: Math.max(2, size * 0.14),
  });
  text.anchor.set(0.5);
  text.position.set(x, y);
  container.addChild(text);
}

/**
 * Redraw every trap marker on the current scene.
 *
 * Cheap enough to run wholesale on any change: a scene holds a handful of
 * traps, and rebuilding is the only way to be certain a marker for a deleted
 * wall does not survive its wall.
 */
export function refreshTrapMarkers() {
  if (!canvas?.ready) return;
  const container = markerLayer();
  container.removeChildren().forEach((child) => child.destroy());
  // The gate, applied once: a Judge sees every trap, everyone else sees only
  // the ones the party has found.
  const gm = game.user.isGM;

  const marks = [];
  for (const wall of canvas.scene?.walls ?? []) {
    const trap = wallTrap(wall);
    if (!trap) continue;
    if (!gm && !trap.known) continue;
    const [x1, y1, x2, y2] = wall.c;
    marks.push({ x: (x1 + x2) / 2, y: (y1 + y2) / 2, state: trap.state });
  }
  for (const region of canvas.scene?.regions ?? []) {
    const behavior = region.behaviors.find((b) => b.type === TRAP_ZONE_TYPE && !b.disabled);
    if (!behavior) continue;
    if (!gm && !behavior.system.known) continue;
    const at = regionCentre(region);
    if (at) marks.push({ x: at.x, y: at.y, state: behavior.system.state });
  }

  for (const { x, y, state } of spread(marks)) drawMark(container, x, y, state);
}

/**
 * Nudge markers that land on the same spot into a row.
 *
 * A trap on a door already shares its midpoint with core's own door control,
 * and two traps can share a midpoint with each other — a wall trapped along a
 * region's edge, or two segments drawn over one another. Stacked glyphs read as
 * one, so the Judge sees a single trap where there are two and cannot tell
 * which state belongs to which.
 *
 * Laid out left to right around the shared point, so the row stays centred on
 * the thing it marks rather than drifting off it.
 */
export function spread(marks, gap = 18) {
  const buckets = new Map();
  for (const mark of marks) {
    // Quantised to the gap so "near enough to overlap" groups, not just exact
    // ties — two wall midpoints a pixel apart still collide visually.
    const key = `${Math.round(mark.x / gap)}:${Math.round(mark.y / gap)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(mark);
  }
  const out = [];
  for (const group of buckets.values()) {
    const offset = ((group.length - 1) * gap) / 2;
    group.forEach((mark, i) => out.push({ ...mark, x: mark.x - offset + i * gap }));
  }
  return out;
}

/**
 * The middle of a region's first solid shape.
 *
 * The average of a polygon's vertices rather than its true centroid: for the
 * rectangles and rough loops a Judge draws round a trap the two are close
 * enough, and this one cannot divide by a zero area.
 */
function regionCentre(region) {
  const shape = (region.shapes ?? []).find((s) => !s.hole);
  if (!shape) return null;
  switch (shape.type) {
    case "rectangle":
      return { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
    case "circle":
    case "ellipse":
      return { x: shape.x, y: shape.y };
    case "polygon": {
      const pts = shape.points ?? [];
      if (pts.length < 2) return null;
      let sx = 0;
      let sy = 0;
      for (let i = 0; i < pts.length; i += 2) {
        sx += pts[i];
        sy += pts[i + 1];
      }
      const n = pts.length / 2;
      return { x: sx / n, y: sy / n };
    }
    default:
      return null;
  }
}

/** Redraw whenever the scene, its walls, or its regions change. */
export function installTrapMarkers() {
  const redraw = () => {
    try {
      refreshTrapMarkers();
    } catch (err) {
      console.error(`${MODULE_ID} | trap markers failed`, err);
    }
  };
  Hooks.on("canvasReady", redraw);
  for (const hook of [
    "createWall",
    "updateWall",
    "deleteWall",
    "createRegion",
    "updateRegion",
    "deleteRegion",
    "createRegionBehavior",
    "updateRegionBehavior",
    "deleteRegionBehavior",
  ]) {
    Hooks.on(hook, redraw);
  }
}
