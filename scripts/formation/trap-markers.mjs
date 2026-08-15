/* global game, canvas, Hooks, PIXI */
import { MODULE_ID } from "./constants.mjs";
import { STATES } from "./trap-rules.mjs";
import { wallTrap } from "./trap-walls.mjs";
import { TRAP_ZONE_TYPE } from "./trap-zone.mjs";

/**
 * What a Judge can see of a trap, and a player cannot.
 *
 * Modelled on the secret door, which is the closest thing the system already
 * has: a player is shown nothing at all — no icon, no wall, no hint that the
 * square is different — while a Judge sees a marker, and that marker goes on to
 * say which STATE the thing is in once it matters. A secret door that has been
 * found shows whether it is open or shut; a trap shows whether it is armed,
 * spotted, disarmed or spent.
 *
 * Drawn into the controls layer rather than onto the walls: a trap wall is
 * non-blocking and often lies on top of an ordinary wall or a door, so the
 * marker has to be visible when the Walls layer is not the active one.
 *
 * Markers are GM-only at the point of DRAWING, not by being hidden after the
 * fact. Nothing about a trap reaches a player's client through this file.
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
  // The whole feature, gated once: a player's client draws nothing.
  if (!game.user.isGM) return;

  for (const wall of canvas.scene?.walls ?? []) {
    const trap = wallTrap(wall);
    if (!trap) continue;
    const [x1, y1, x2, y2] = wall.c;
    drawMark(container, (x1 + x2) / 2, (y1 + y2) / 2, trap.state);
  }

  for (const region of canvas.scene?.regions ?? []) {
    const behavior = region.behaviors.find((b) => b.type === TRAP_ZONE_TYPE && !b.disabled);
    if (!behavior) continue;
    const at = regionCentre(region);
    if (at) drawMark(container, at.x, at.y, behavior.system.state);
  }
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
