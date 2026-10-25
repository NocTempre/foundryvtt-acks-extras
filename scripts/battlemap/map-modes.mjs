/* global game, canvas, foundry, PIXI, Hooks */
/**
 * Map modes: what a GM's map draws over its terrain, one mode at a time.
 * Terrain is the rest state, where core's terrain regions are the whole
 * drawing. Any other mode is registered (`registerMapMode`) — the module's own
 * is Territory, a feature brings its own — and draws a module overlay in the
 * regions layer above core's region fills: a border, in the value's colour,
 * along every side of a hex whose neighbour across it holds another value or
 * none, drawn on the hex's own side so two values meeting show as two lines.
 * The terrain fill under it stays readable. A mode may weight each side by
 * the two values it parts (a realm's edge heavier than a barony's), and
 * stripe a hex whose painted value differs from the one it would take
 * otherwise (a territory painted over its domain's class).
 *
 * The mode, the overlay's opacity and the handout switch are this client's
 * view (`mapView`, a client setting the Map modes window writes), and they
 * outlive the brush: the mode a palette pill shows stays on through every
 * control until the Judge picks Terrain again. The handout switch hides every
 * GM overlay, the road markers included (`acksExtrasMapView`). A player is
 * drawn none.
 *
 * See docs/battlemap/DECISIONS.md, "The map shows one mode at a time".
 */
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import {
  PAINT_LAYERS, PAINT_LAYER_CHANGED_HOOK, climateLabelFor, derivedHexes, hexKeyOf, isHexScene, layerColorFor,
  layerLabelFor, layerRegionsOf, paintableValues, terrainPaint,
} from "./terrain-paint.mjs";
import { sceneCountry } from "./scene-setup.mjs";
import { TERRITORY_KEYS } from "../formation/country-keys.mjs";

/** The client setting the view is held in. */
export const MAP_VIEW_SETTING = "mapView";

/** The rest state's key: no overlay, core's terrain fill alone. */
export const TERRAIN_MODE = "terrain";

/** A view nobody has set: the terrain alone, the overlay near opaque when a mode is picked, nothing hidden. */
export const MAP_VIEW_DEFAULT = Object.freeze({ mode: TERRAIN_MODE, opacity: 0.85, handout: false });

/** The faintest the opacity slider goes; below it a border no longer reads at all. */
const OPACITY_FLOOR = 0.2;

/**
 * A border's width, and how far its hex's corners are pulled toward the
 * centre, as fractions of the grid size. At these two a line's outer edge runs
 * along the hex's side, so both scale with a side's weight: a heavier line is
 * drawn further in, never over the neighbour's.
 */
const BORDER_WIDTH = 0.08;
const BORDER_INSET = 0.08;

/** The range a mode's side weight is held to: thinner than this does not read, thicker eats the hex. */
const WEIGHT_RANGE = Object.freeze([0.4, 2]);

/** A stripe's spacing and width, as fractions of the grid size. */
const STRIPE_SPACING = 0.14;
const STRIPE_WIDTH = 0.025;

/** The registered modes, by key, in registration order. */
const modes = new Map();

/** The overlay's container, and the Map modes window, once made. */
let overlay = null;
let legendWindow = null;

/**
 * Register a map mode. `label` is its i18n key; `layer`, where given, is the
 * paint layer whose palette pill shows the mode; `plan(scene)` lists the hexes
 * it draws, `[{key, value, color, stripe?}]` by offset key, `stripe` the colour
 * a hex is striped in or null; `legend(scene)` returns `{rows: [{color,
 * label}], unpainted, stripes?}`, `unpainted` the label of what a hex the mode
 * has not painted reads as, or null, and `stripes` what a striped hex means,
 * or null; `weights(scene)`, where given, returns `(value, across) => number`,
 * the weight of a side between a hex of `value` and its neighbour's (null
 * where the neighbour holds none), asked once per drawing. Throws, naming the
 * mode, on a key already taken (Terrain's included) or a missing function.
 *
 * @param {{key: string, label: string, layer?: string|null, plan: Function, legend: Function,
 *   weights?: Function|null}} spec
 * @returns {() => void} a handle that takes the mode out again
 */
export function registerMapMode({ key, label, layer = null, plan, legend, weights = null }) {
  if (typeof key !== "string" || !key) throw new Error(`${MODULE_ID} | a map mode needs a key`);
  if (key === TERRAIN_MODE || modes.has(key)) throw new Error(`${MODULE_ID} | map mode "${key}" is already registered`);
  if (typeof plan !== "function" || typeof legend !== "function") {
    throw new Error(`${MODULE_ID} | map mode "${key}" needs a plan and a legend`);
  }
  if (weights != null && typeof weights !== "function") throw new Error(`${MODULE_ID} | map mode "${key}" has weights that are no function`);
  const entry = { key, label: label ?? `${LANG_PREFIX}.mapMode.${key}`, layer, plan, legend, weights };
  modes.set(key, entry);
  refreshMapView();
  return () => {
    if (modes.get(key) !== entry) return;
    modes.delete(key);
    refreshMapView();
  };
}

/** Every mode a Judge can pick, Terrain first: `[{key, label, layer}]`, labels as i18n keys. */
export function mapModes() {
  return [
    { key: TERRAIN_MODE, label: `${LANG_PREFIX}.mapMode.terrain`, layer: "terrain" },
    ...[...modes.values()].map(({ key, label, layer }) => ({ key, label, layer })),
  ];
}

/** The mode a paint layer's pill shows: the one registered for it, else Terrain. */
export function modeForLayer(layer) {
  return [...modes.values()].find((m) => m.layer === layer)?.key ?? TERRAIN_MODE;
}

/**
 * This client's view, every field resolved: a mode nobody registered reads as
 * Terrain, an opacity out of range is held to it, and anything but `true` is
 * no handout.
 * @returns {{mode: string, opacity: number, handout: boolean}}
 */
export function mapView() {
  let held = null;
  try {
    held = game.settings.get(MODULE_ID, MAP_VIEW_SETTING);
  } catch (_err) {
    // Not registered yet (before init) or no settings at all: the default.
  }
  const opacity = Number(held?.opacity);
  return {
    mode: modes.has(held?.mode) ? held.mode : TERRAIN_MODE,
    opacity: Number.isFinite(opacity) ? Math.min(1, Math.max(OPACITY_FLOOR, opacity)) : MAP_VIEW_DEFAULT.opacity,
    handout: held?.handout === true,
  };
}

/** Merge a patch into this client's view. */
export function setMapView(patch) {
  return game.settings.set(MODULE_ID, MAP_VIEW_SETTING, { ...mapView(), ...patch });
}

/** Register the view's client setting. Not in the settings window: the Map modes window is its editor. */
export function registerMapViewSetting() {
  game.settings.register(MODULE_ID, MAP_VIEW_SETTING, {
    scope: "client",
    config: false,
    type: Object,
    default: { ...MAP_VIEW_DEFAULT },
    onChange: () => {
      refreshMapView();
      Hooks.callAll("acksExtrasMapView", mapView());
    },
  });
}

/* -------------------------------------------------------------------- */
/*  The plan and its borders (pure over the scene document)             */
/* -------------------------------------------------------------------- */

/** A paint layer's painted hexes as a plan: `[{key, value, color}]`, one per hex, coloured as the layer colours the value. */
export function layerPlan(scene, layer) {
  const spec = PAINT_LAYERS[layer];
  if (!spec) return [];
  return layerRegionsOf(scene, layer).flatMap((region) => {
    const value = region.getFlag(MODULE_ID, spec.flag);
    const color = layerColorFor(value, layer);
    return (region.getFlag(MODULE_ID, spec.hexesFlag) ?? []).map((key) => ({ key, value, color }));
  });
}

const centreOf = (corners) => ({
  x: corners.reduce((s, p) => s + p.x, 0) / corners.length,
  y: corners.reduce((s, p) => s + p.y, 0) / corners.length,
});

const pulled = (p, c, t) => ({ x: p.x + (c.x - p.x) * t, y: p.y + (c.y - p.y) * t });

/** A side weight held to `WEIGHT_RANGE`; anything that is no number weighs 1. */
function heldWeight(w) {
  const n = Number(w);
  return Number.isFinite(n) ? Math.min(WEIGHT_RANGE[1], Math.max(WEIGHT_RANGE[0], n)) : 1;
}

/**
 * The border segments a plan draws: each side of a planned hex whose
 * neighbour across it holds another value, or none, as its two corners pulled
 * toward the hex's centre, in the hex's colour. The neighbour is the hex whose
 * centre mirrors this one's across the side's midpoint, which holds on any hex
 * grid, stretched or not. `weightOf(value, across)` weighs the side, 1 where
 * it is not given; the corners are pulled `inset` times the weight, so a
 * heavier line keeps its outer edge on the side.
 * @returns {Array<{color: string, weight: number, from: {x: number, y: number}, to: {x: number, y: number}}>}
 */
export function borderSegments(scene, plan, inset = BORDER_INSET, weightOf = null) {
  const valueAt = new Map(plan.map((h) => [h.key, h.value]));
  const segments = [];
  for (const hex of plan) {
    const [i, j] = hex.key.split(":").map(Number);
    const corners = scene.grid.getVertices({ i, j });
    const centre = centreOf(corners);
    for (let n = 0; n < corners.length; n++) {
      const a = corners[n];
      const b = corners[(n + 1) % corners.length];
      const across = valueAt.get(hexKeyOf(scene.grid.getOffset({ x: a.x + b.x - centre.x, y: a.y + b.y - centre.y }))) ?? null;
      if (across !== null && across === hex.value) continue;
      const weight = weightOf ? heldWeight(weightOf(hex.value, across)) : 1;
      segments.push({ color: hex.color, weight, from: pulled(a, centre, inset * weight), to: pulled(b, centre, inset * weight) });
    }
  }
  return segments;
}

/**
 * The stripes a plan draws: for each planned hex carrying a `stripe` colour,
 * parallel lines `spacing` of the grid size apart, running up to the right,
 * each cut to the hex as the borders' `inset` pulls it in, so a stripe ends
 * at the border's inner edge rather than across it.
 * @returns {Array<{color: string, from: {x: number, y: number}, to: {x: number, y: number}}>}
 */
export function stripeSegments(scene, plan, { inset = BORDER_INSET, spacing = STRIPE_SPACING } = {}) {
  // A stripe is a line of constant x + y; lines a distance d apart differ in it by d·√2.
  const step = Math.max(1, (scene.grid.size ?? 100) * spacing * Math.SQRT2);
  const segments = [];
  for (const hex of plan) {
    if (!hex.stripe) continue;
    const [i, j] = hex.key.split(":").map(Number);
    const corners = scene.grid.getVertices({ i, j });
    const centre = centreOf(corners);
    const ring = corners.map((p) => pulled(p, centre, inset));
    const sums = ring.map((p) => p.x + p.y);
    const hi = Math.max(...sums);
    for (let c = Math.min(...sums) + step / 2; c < hi; c += step) {
      // Where the line crosses the ring: a cell is convex, so at two points.
      const cut = [];
      for (let n = 0; n < ring.length; n++) {
        const a = ring[n];
        const b = ring[(n + 1) % ring.length];
        const fa = a.x + a.y - c;
        const fb = b.x + b.y - c;
        if (fa === fb || (fa < 0) === (fb < 0)) continue;
        const t = fa / (fa - fb);
        cut.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
      if (cut.length < 2) continue;
      cut.sort((p, q) => (p.x - p.y) - (q.x - q.y));
      segments.push({ color: hex.stripe, from: cut[0], to: cut.at(-1) });
    }
  }
  return segments;
}

/**
 * The Territory mode's plan: every hex with a territory, painted or derived.
 * A hex with a territory painted is drawn in it, and striped in the class a
 * layer derives for it (a domain's) where the two differ; a hex with none
 * painted is drawn in the derived class.
 * @returns {Array<{key: string, value: string, color: string, stripe: string|null}>}
 */
export function territoryPlan(scene) {
  const color = (v) => layerColorFor(v, "territory");
  const derived = new Map(
    derivedHexes(scene, "territory").filter((h) => TERRITORY_KEYS.includes(h.value)).map((h) => [h.key, h.value]),
  );
  const painted = layerPlan(scene, "territory");
  const plan = painted.map((hex) => {
    const under = derived.get(hex.key);
    return { ...hex, stripe: under && under !== hex.value ? color(under) : null };
  });
  const seen = new Set(painted.map((h) => h.key));
  for (const [key, value] of derived) if (!seen.has(key)) plan.push({ key, value, color: color(value), stripe: null });
  return plan;
}

/* -------------------------------------------------------------------- */
/*  The overlay                                                          */
/* -------------------------------------------------------------------- */

/**
 * The overlay's container in the board's regions layer, made again whenever
 * the layer it sat in was torn down with its scene. Added after core's region
 * fills, so it draws over them; `none`, so it never takes a click meant for a
 * region. Named, so a console finds it with `getChildByName`.
 */
function overlayOf(board) {
  if (overlay && !overlay.destroyed && overlay.parent === board.regions) return overlay;
  overlay = new PIXI.Container();
  overlay.name = `${MODULE_ID}-map-modes`;
  overlay.eventMode = "none";
  board.regions.addChild(overlay);
  return overlay;
}

/** Redraw the overlay from the view and the viewed scene, and refresh an open Map modes window. */
export function refreshMapView() {
  try {
    drawMapView();
  } catch (err) {
    console.error(`${MODULE_ID} | map mode drawing failed`, err);
  }
  if (legendWindow?.rendered) legendWindow.render();
}

function drawMapView() {
  // Read off globalThis: a mode registered at import runs this before any board exists.
  const board = globalThis.canvas;
  if (!board?.ready || !board.regions) return;
  const container = overlayOf(board);
  container.removeChildren().forEach((c) => c.destroy({ children: true }));
  const scene = board.scene;
  const view = mapView();
  const mode = modes.get(view.mode);
  if (!game.user?.isGM || !mode || view.handout || !isHexScene(scene)) return;
  container.alpha = view.opacity;
  const size = scene.grid.size ?? 100;
  const width = Math.max(2, size * BORDER_WIDTH);
  const plan = mode.plan(scene);
  const g = container.addChild(new PIXI.Graphics());
  // The stripes first, so the borders are drawn over their ends.
  stroke(g, stripeSegments(scene, plan), () => Math.max(1, size * STRIPE_WIDTH));
  stroke(g, borderSegments(scene, plan, BORDER_INSET, mode.weights?.(scene) ?? null), (s) => width * s.weight);
}

/** Draw segments on one Graphics, one line style per colour and width. */
function stroke(g, segments, widthOf) {
  const groups = new Map();
  for (const s of segments) {
    const width = widthOf(s);
    const key = `${s.color}|${width}`;
    if (!groups.has(key)) groups.set(key, { color: s.color, width, segments: [] });
    groups.get(key).segments.push(s);
  }
  for (const { color, width, segments: list } of groups.values()) {
    g.lineStyle({ width, color: parseInt(String(color).slice(1), 16) || 0, alpha: 1, cap: "round" });
    for (const { from, to } of list) {
      g.moveTo(from.x, from.y);
      g.lineTo(to.x, to.y);
    }
  }
}

/**
 * Following the brush: arming it, or switching its layer, shows the mode the
 * layer's pill names. A disarm leaves the mode as it is.
 */
let followed = null;
function followBrush() {
  if (!terrainPaint.brush) {
    followed = null;
    return;
  }
  if (terrainPaint.layer === followed) return;
  followed = terrainPaint.layer;
  const mode = modeForLayer(followed);
  if (mode !== mapView().mode) {
    setMapView({ mode }).catch((err) => console.error(`${MODULE_ID} | map mode not saved`, err));
  }
  if (mode !== TERRAIN_MODE) openMapModes();
}

/**
 * Hooks: redraw on a new scene, on a change to the viewed scene's regions,
 * and on its setup record (the legend reads the scene default and the
 * climate); follow the brush. Call once, at init.
 */
export function installMapModes() {
  let pending = false;
  const later = () => {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      refreshMapView();
    }, 50);
  };
  Hooks.on("canvasReady", () => refreshMapView());
  for (const hook of ["createRegion", "updateRegion", "deleteRegion"]) {
    Hooks.on(hook, (region) => {
      if (region?.parent === canvas?.scene) later();
    });
  }
  Hooks.on("updateScene", (scene, change) => {
    if (scene === canvas?.scene && foundry.utils.hasProperty(change, `flags.${MODULE_ID}`)) later();
  });
  // A layer whose values changed meaning with no region written: a domain renamed, re-lieged or reclassified.
  Hooks.on(PAINT_LAYER_CHANGED_HOOK, later);
  terrainPaint.onChange(followBrush);
}

/* -------------------------------------------------------------------- */
/*  The module's own mode                                                */
/* -------------------------------------------------------------------- */

// Territory: the border colour says how settled the land is; the terrain
// stays the fill. A hex painted into a domain takes its class, and one painted
// a territory over it is striped where the two differ. A hex with neither is
// drawn no border and reads as the scene's default, which the legend names.
registerMapMode({
  key: "territory",
  label: `${LANG_PREFIX}.mapMode.territory`,
  layer: "territory",
  plan: territoryPlan,
  legend: (scene) => {
    const unpainted = sceneCountry(scene).territory;
    return {
      rows: paintableValues("territory").map((v) => ({ color: layerColorFor(v, "territory"), label: layerLabelFor(v, "territory") })),
      unpainted: unpainted ? layerLabelFor(unpainted, "territory") : null,
      stripes: territoryPlan(scene).some((h) => h.stripe) ? game.i18n.localize(`${LANG_PREFIX}.mapMode.stripes`) : null,
    };
  },
});

/* -------------------------------------------------------------------- */
/*  The Map modes window                                                 */
/* -------------------------------------------------------------------- */

// Dereferenced at module scope with a stand-in for Node (the family
// convention): the class is only ever instantiated by Foundry.
const { ApplicationV2, HandlebarsApplicationMixin } = globalThis.foundry?.applications?.api ?? {
  ApplicationV2: class {},
  HandlebarsApplicationMixin: (cls) => cls,
};

/**
 * The Map modes window: one pill per mode, the active one pressed; the mode's
 * legend, what an unpainted hex reads as and what a stripe means; the map's climate; the overlay's
 * opacity; and the handout switch. Every control writes the view at once.
 */
export class MapModesApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "acks-extras-map-modes",
    classes: ["acks-ui", "acks-extras", "acks-extras-map-modes", "acks-extras-scroll"],
    position: { width: 300 },
    window: { title: `${LANG_PREFIX}.mapMode.title`, icon: "fa-solid fa-layer-group" },
    actions: { pickMode: MapModesApp.#pickMode },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/battlemap/map-modes.hbs` },
  };

  async _prepareContext() {
    const view = mapView();
    const scene = globalThis.canvas?.scene ?? null;
    const mode = modes.get(view.mode) ?? null;
    const legend = mode && scene ? mode.legend(scene) : null;
    const climate = scene ? sceneCountry(scene).climate : null;
    return {
      modes: mapModes().map((m) => ({ key: m.key, label: game.i18n.localize(m.label), active: m.key === view.mode })),
      terrain: view.mode === TERRAIN_MODE,
      rows: legend?.rows ?? [],
      unpainted: legend?.unpainted ?? null,
      stripes: legend?.stripes ?? null,
      climate: climate ? climateLabelFor(climate) : null,
      opacity: Math.round(view.opacity * 100),
      opacityFloor: Math.round(OPACITY_FLOOR * 100),
      handout: view.handout,
      hexScene: isHexScene(scene),
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const root = this.element;
    root.querySelector('input[name="opacity"]')?.addEventListener("change", (ev) => {
      setMapView({ opacity: Number(ev.currentTarget.value) / 100 });
    });
    root.querySelector('input[name="handout"]')?.addEventListener("change", (ev) => {
      setMapView({ handout: ev.currentTarget.checked });
    });
  }

  static async #pickMode(_event, target) {
    await setMapView({ mode: target.dataset.mode });
  }
}

/** Open (or front) the Map modes window. */
export function openMapModes() {
  legendWindow ??= new MapModesApp();
  legendWindow.render({ force: true });
  return legendWindow;
}
