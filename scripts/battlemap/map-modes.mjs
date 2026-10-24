/* global game, canvas, foundry, PIXI, Hooks */
/**
 * Map modes: what a GM's map draws over its terrain, one mode at a time.
 * Terrain is the rest state, where core's terrain regions are the whole
 * drawing. Any other mode is registered (`registerMapMode`) — the module's own
 * is Territory, a feature brings its own — and draws a module overlay in the
 * regions layer above core's region fills: a border, in the value's colour,
 * along every side of a hex whose neighbour across it holds another value or
 * none, drawn on the hex's own side so two values meeting show as two lines.
 * The terrain fill under it stays readable.
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
  PAINT_LAYERS, climateLabelFor, hexKeyOf, isHexScene, layerColorFor, layerLabelFor, layerRegionsOf,
  paintableValues, terrainPaint,
} from "./terrain-paint.mjs";
import { sceneCountry } from "./scene-setup.mjs";

/** The client setting the view is held in. */
export const MAP_VIEW_SETTING = "mapView";

/** The rest state's key: no overlay, core's terrain fill alone. */
export const TERRAIN_MODE = "terrain";

/** A view nobody has set: the terrain alone, the overlay near opaque when a mode is picked, nothing hidden. */
export const MAP_VIEW_DEFAULT = Object.freeze({ mode: TERRAIN_MODE, opacity: 0.85, handout: false });

/** The faintest the opacity slider goes; below it a border no longer reads at all. */
const OPACITY_FLOOR = 0.2;

/** A border's width, and how far its hex's corners are pulled toward the centre, as fractions of the grid size. */
const BORDER_WIDTH = 0.08;
const BORDER_INSET = 0.08;

/** The registered modes, by key, in registration order. */
const modes = new Map();

/** The overlay's container, and the Map modes window, once made. */
let overlay = null;
let legendWindow = null;

/**
 * Register a map mode. `label` is its i18n key; `layer`, where given, is the
 * paint layer whose palette pill shows the mode; `plan(scene)` lists the hexes
 * it draws, `[{key, value, color}]` by offset key; `legend(scene)` returns
 * `{rows: [{color, label}], unpainted}`, `unpainted` the label of what a hex
 * the mode has not painted reads as, or null. Throws, naming the mode, on a
 * key already taken (Terrain's included) or a missing function.
 *
 * @param {{key: string, label: string, layer?: string|null, plan: Function, legend: Function}} spec
 * @returns {() => void} a handle that takes the mode out again
 */
export function registerMapMode({ key, label, layer = null, plan, legend }) {
  if (typeof key !== "string" || !key) throw new Error(`${MODULE_ID} | a map mode needs a key`);
  if (key === TERRAIN_MODE || modes.has(key)) throw new Error(`${MODULE_ID} | map mode "${key}" is already registered`);
  if (typeof plan !== "function" || typeof legend !== "function") {
    throw new Error(`${MODULE_ID} | map mode "${key}" needs a plan and a legend`);
  }
  const entry = { key, label: label ?? `${LANG_PREFIX}.mapMode.${key}`, layer, plan, legend };
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

/**
 * The border segments a plan draws: each side of a planned hex whose
 * neighbour across it holds another value, or none, as its two corners pulled
 * `inset` of the way toward the hex's centre, in the hex's colour. The
 * neighbour is the hex whose centre mirrors this one's across the side's
 * midpoint, which holds on any hex grid, stretched or not.
 * @returns {Array<{color: string, from: {x: number, y: number}, to: {x: number, y: number}}>}
 */
export function borderSegments(scene, plan, inset = BORDER_INSET) {
  const valueAt = new Map(plan.map((h) => [h.key, h.value]));
  const segments = [];
  for (const hex of plan) {
    const [i, j] = hex.key.split(":").map(Number);
    const corners = scene.grid.getVertices({ i, j });
    const centre = centreOf(corners);
    for (let n = 0; n < corners.length; n++) {
      const a = corners[n];
      const b = corners[(n + 1) % corners.length];
      const across = hexKeyOf(scene.grid.getOffset({ x: a.x + b.x - centre.x, y: a.y + b.y - centre.y }));
      if (valueAt.has(across) && valueAt.get(across) === hex.value) continue;
      segments.push({ color: hex.color, from: pulled(a, centre, inset), to: pulled(b, centre, inset) });
    }
  }
  return segments;
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
  const width = Math.max(2, (scene.grid.size ?? 100) * BORDER_WIDTH);
  const byColor = new Map();
  for (const s of borderSegments(scene, mode.plan(scene))) {
    if (!byColor.has(s.color)) byColor.set(s.color, []);
    byColor.get(s.color).push(s);
  }
  const g = container.addChild(new PIXI.Graphics());
  for (const [color, segments] of byColor) {
    g.lineStyle({ width, color: parseInt(String(color).slice(1), 16) || 0, alpha: 1, cap: "round" });
    for (const { from, to } of segments) {
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
  terrainPaint.onChange(followBrush);
}

/* -------------------------------------------------------------------- */
/*  The module's own mode                                                */
/* -------------------------------------------------------------------- */

// Territory: the border colour says how settled the land is; the terrain
// stays the fill. A hex nobody painted is drawn no border and reads as the
// scene's default, which the legend names.
registerMapMode({
  key: "territory",
  label: `${LANG_PREFIX}.mapMode.territory`,
  layer: "territory",
  plan: (scene) => layerPlan(scene, "territory"),
  legend: (scene) => {
    const unpainted = sceneCountry(scene).territory;
    return {
      rows: paintableValues("territory").map((v) => ({ color: layerColorFor(v, "territory"), label: layerLabelFor(v, "territory") })),
      unpainted: unpainted ? layerLabelFor(unpainted, "territory") : null,
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
 * legend and what an unpainted hex reads as; the map's climate; the overlay's
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
