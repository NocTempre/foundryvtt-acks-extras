/* global game, canvas, ui, Hooks, PIXI */
/**
 * Seeing the streets you drew: a GM-only, presentation-only overlay drawing
 * the road network over the map — tinted by surface, dashed where the road
 * is an alley. Decides nothing; the party's movement is measured off the
 * walls whether or not this ever draws. Drawn only while the Judge is
 * working the map (the Walls control, or the battlemap's own group), never
 * as a permanent overlay.
 */
import { MODULE_ID, CONTROL_GROUP } from "./constants.mjs";
import { roadWallsOf, wallRoad } from "./roads.mjs";

/**
 * Road tints by surface. Presentation, not rules — an imported surface nobody
 * shipped a colour for draws as an earthen road.
 */
export const ROAD_TINT = Object.freeze({ earth: 0x8a6a44, gravel: 0xa8a094, paved: 0xd8d2c6 });

/**
 * The controls whose tools work the map, and so want the streets visible.
 * Named from the constant, never spelled out — a literal here that drifted
 * from the control's key would leave the overlay silently never drawing.
 */
const DRAW_CONTROLS = Object.freeze(["walls", CONTROL_GROUP]);

/** Is this client, right now, laying out a map? */
const drawingMap = () => !!game.user?.isGM && DRAW_CONTROLS.includes(ui.controls?.control?.name);

let layer = null;

/** The container the road overlay lives in, created on first use. */
function roadLayer() {
  if (layer && !layer.destroyed) return layer;
  layer = new PIXI.Container();
  // `none`: this is a drawing, and it must never take a click meant for the
  // wall underneath it — which is the one thing the Judge is reaching for.
  layer.eventMode = "none";
  canvas.controls.addChild(layer);
  return layer;
}

/**
 * A dashed line, drawn as a run of short segments.
 *
 * PIXI has no dash, and an alley wants one: a tint alone is a colour difference
 * a Judge has to remember, where a dashed line reads as "narrow" at a glance.
 */
function dashed(g, from, to, dash = 12, gap = 8) {
  const total = Math.hypot(to.x - from.x, to.y - from.y);
  if (!total) return;
  const ux = (to.x - from.x) / total;
  const uy = (to.y - from.y) / total;
  for (let at = 0; at < total; at += dash + gap) {
    const end = Math.min(at + dash, total);
    g.moveTo(from.x + ux * at, from.y + uy * at);
    g.lineTo(from.x + ux * end, from.y + uy * end);
  }
}

/** Redraw the overlay from the scene's road walls. */
export function refreshRoadMarkers() {
  if (!canvas?.ready) return;
  const container = roadLayer();
  container.removeChildren().forEach((c) => c.destroy({ children: true }));
  const scene = canvas.scene;
  if (!scene || !drawingMap()) return;

  const g = container.addChild(new PIXI.Graphics());
  for (const wall of roadWallsOf(scene)) {
    const road = wallRoad(wall);
    const [x1, y1, x2, y2] = wall.c;
    const tint = ROAD_TINT[road.surface] ?? ROAD_TINT.earth;
    g.lineStyle(road.street === "alley" ? 4 : 7, tint, 0.85);
    if (road.street === "alley") dashed(g, { x: x1, y: y1 }, { x: x2, y: y2 });
    else {
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
    }
  }
}

/** Redraw whenever the scene, its walls, or the active control change. */
export function installRoadMarkers() {
  const redraw = () => {
    try {
      refreshRoadMarkers();
    } catch (err) {
      console.error(`${MODULE_ID} | road markers failed`, err);
    }
  };
  Hooks.on("canvasReady", redraw);
  // Switching scene control takes the Judge into or out of map-drawing mode,
  // which is what decides whether the overlay is drawn at all.
  Hooks.on("renderSceneControls", redraw);
  for (const hook of ["createWall", "updateWall", "deleteWall"]) Hooks.on(hook, redraw);
}
