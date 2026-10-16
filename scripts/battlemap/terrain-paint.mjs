/* global game, canvas, foundry, PIXI, CONST, Hooks, ui */
/**
 * Hex terrain painting — map prep for the overland journey. A hex-gridded
 * scene's terrain is painted into scene REGIONS: one region per terrain
 * kind, its shapes the painted cells, tinted and flagged `terrain: <key>`.
 * Each region also carries the painted cells as OFFSET KEYS
 * (`terrainHexes`, aligned index-for-index with `shapes`), so "what terrain
 * is this hex?" is a flag read, never a point-in-polygon test. One terrain
 * per hex; painting is GM-only, hex grids only. The PAINT SESSION is armed
 * by the battlemap control group's terrain tool, a screen-space pointer
 * catcher (capture.mjs's pattern) turning clicks and drags into cell writes.
 *
 * Terrain is one LAYER of three (`PAINT_LAYERS`): territory and climate are
 * painted the same way into regions of their own, under flags of their own,
 * one value per hex per layer. The terrain names below keep their meaning;
 * each layer-aware form takes a trailing `layer`, "terrain" by default.
 *
 * See docs/battlemap/DECISIONS.md, "Terrain paints as regions, and the
 * cell key is the identity."
 */
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import { TERRAIN, readTable, TRAVEL_DOC } from "../vehicles/vehicle-speed.mjs";
import { ENCOUNTER_TERRAINS } from "../formation/encounter-terrains.mjs";
import { TERRITORY_KEYS } from "../formation/country-keys.mjs";
import { CLIMATES } from "../formation/weather.mjs";

/** Region flags: the terrain kind, and the painted cells as offset keys. */
export const TERRAIN_FLAG = "terrain";
export const HEXES_FLAG = "terrainHexes";

/**
 * The brush's layers, each a pair of region flags: the value a region paints,
 * and its painted cells as offset keys. A hex holds one value per layer, and a
 * layer's write never touches another's regions: a terrain, a territory and a
 * climate answer different questions about the same hex.
 */
export const PAINT_LAYERS = Object.freeze({
  terrain: Object.freeze({ flag: TERRAIN_FLAG, hexesFlag: HEXES_FLAG }),
  territory: Object.freeze({ flag: "territory", hexesFlag: "territoryHexes" }),
  climate: Object.freeze({ flag: "climate", hexesFlag: "climateHexes" }),
});

/** The flags of a layer the brush knows, or null. */
const layerSpec = (layer) => (Object.hasOwn(PAINT_LAYERS, layer) ? PAINT_LAYERS[layer] : null);

/**
 * Terrain kinds the brush refuses even though they are valid terrain: mud
 * and snow describe what the weather has left, and the footing state
 * machine already derives them daily. See docs/battlemap/DECISIONS.md,
 * "Mud and snow leave the brush."
 */
export const UNPAINTABLE = Object.freeze(["mud", "snow"]);

/**
 * The palette — a fixed UI colour per terrain key. Presentation, not rules:
 * the keys are the structural terrain vocabularies, the encounter terrains
 * (tinted by family) and the bare grounds a map painted before the brush
 * took the book's grain still carries; the colours are ours.
 *
 * An imported kind the module has never heard of gets a derived hue instead
 * (`colorFor`), so the vocabulary can grow without the palette blocking it.
 */
export const TERRAIN_COLORS = Object.freeze({
  barrensRocky: "#b09067",
  barrensTundra: "#c6b8a4",
  desertRocky: "#cfae5c",
  desertSandy: "#e0c060",
  forestDeciduous: "#2e6b34",
  forestTaiga: "#205a4c",
  grassland: "#7cb45b",
  grasslandSavanna: "#b1b85c",
  grasslandSteppe: "#9db27c",
  hillsForested: "#6d7f47",
  hillsRocky: "#8f7b4f",
  jungle: "#1e5c2e",
  mountainsForested: "#5c6c58",
  mountainsRocky: "#7d7d85",
  mountainsSnowy: "#b8c2cb",
  mountainsVolcanic: "#6d4f4f",
  riverLand: "#3f7fb5",
  riverDesertJungle: "#3f9fb0",
  scrublandSparse: "#a8a84f",
  scrublandDense: "#8b8f3f",
  swampMarshy: "#4f6b52",
  swampScrubby: "#5f7a4b",
  swampForested: "#3f5f46",
  scrubland: "#a8a84f",
  barrens: "#b09067",
  desert: "#e0c060",
  hills: "#8f7b4f",
  forest: "#2e6b34",
  mountains: "#7d7d85",
  swamp: "#4f6b52",
  mud: "#6e5a3e",
  snow: "#dfe8ee",
});

/**
 * Every terrain the brush may lay down: the encounter terrains — the book's
 * own grain, each standing on a travel ground — plus any key the imported
 * multiplier table carries that no encounter terrain covers, minus the ones
 * weather owns. A bare ground an encounter terrain covers is never a brush:
 * its kinds are. A kind that stands on no ground (a river) is not a hex's at
 * all: water is drawn as a line (water.mjs), and a hex that holds one still
 * reads as painted. See docs/battlemap/DECISIONS.md, "The brush
 * paints at the book's grain", "The terrain vocabulary opens to imported
 * keys" and "A river or a coast is a line".
 */
export function paintableTerrains() {
  const fine = Object.keys(ENCOUNTER_TERRAINS).filter((k) => ENCOUNTER_TERRAINS[k].ground);
  const covered = new Set(Object.values(ENCOUNTER_TERRAINS).map((t) => t.ground).filter(Boolean));
  let imported = [];
  try {
    imported = Object.keys(readTable(TRAVEL_DOC, "terrainMultipliers") ?? {});
  } catch {
    imported = [];
  }
  const extra = imported.filter((k) => !covered.has(k) && !UNPAINTABLE.includes(k));
  return [...new Set([...fine, ...extra])];
}

/**
 * A stable colour for any terrain key: the shipped palette first, then a hue
 * derived from the key itself so an imported kind is at least consistent
 * between sessions and distinguishable from its neighbours.
 */
export function colorFor(key) {
  if (TERRAIN_COLORS[key]) return TERRAIN_COLORS[key];
  const name = String(key ?? "");
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 38% 42%)`;
}

/** The label for any terrain key: the encounter terrain's, the ground's, or the key made readable. */
export function labelFor(key) {
  const shipped = ENCOUNTER_TERRAINS[key]?.label ?? TERRAIN[key]?.label;
  if (shipped) return game.i18n.localize(shipped);
  return String(key ?? "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

/**
 * A colour per territory, ours: warm where the country is settled, darkening
 * as it empties. Kept apart from `TERRAIN_COLORS`, whose keys are terrains.
 */
export const TERRITORY_COLORS = Object.freeze({
  civilized: "#d8b04a",
  borderlands: "#c47a36",
  outlands: "#9c4a3a",
  unsettled: "#5e3b5a",
});

/**
 * A colour per climate group, ours. Each climate of a group is drawn a step
 * lighter than the one listed before it (`climateColorFor`), so two climates
 * of one group still read apart where they meet on the map.
 */
export const CLIMATE_GROUP_COLORS = Object.freeze({
  A: "#1f7a5c",
  B: "#b8862f",
  C: "#4a8a3c",
  D: "#3f6a9e",
  E: "#6f8798",
});

/** A `#rrggbb` colour mixed toward white by `t`, from 0 (itself) to 1 (white). */
function lighten(hex, t) {
  const n = parseInt(String(hex).slice(1), 16);
  const mix = (c) => Math.round(c + (255 - c) * t);
  const rgb = (mix((n >> 16) & 255) << 16) | (mix((n >> 8) & 255) << 8) | mix(n & 255);
  return `#${rgb.toString(16).padStart(6, "0")}`;
}

/** A climate's colour: its group's, lightened by its place in the group. */
export function climateColorFor(code) {
  const group = CLIMATES[code]?.group;
  const base = CLIMATE_GROUP_COLORS[group];
  if (!base) return colorFor(code);
  const kin = Object.keys(CLIMATES).filter((k) => CLIMATES[k].group === group);
  return lighten(base, (kin.indexOf(code) / kin.length) * 0.5);
}

/** Every value a layer's brush may lay down. */
export function paintableValues(layer = "terrain") {
  if (layer === "territory") return [...TERRITORY_KEYS];
  if (layer === "climate") return Object.keys(CLIMATES);
  return layer === "terrain" ? paintableTerrains() : [];
}

/** A layer value's colour: the terrain palette, the territory table, or the climate's group. */
export function layerColorFor(key, layer = "terrain") {
  if (layer === "territory") return TERRITORY_COLORS[key] ?? colorFor(key);
  if (layer === "climate") return climateColorFor(key);
  return colorFor(key);
}

/**
 * A layer value's label, from the strings the party sheet already names it by
 * (a climate as its code and name, as the sheet's climate select reads).
 */
export function layerLabelFor(key, layer = "terrain") {
  if (layer === "territory") {
    return TERRITORY_KEYS.includes(key) ? game.i18n.localize(`ACKS-FORMATION.travel.territory.${key}`) : String(key ?? "");
  }
  if (layer === "climate") return CLIMATES[key] ? `${key} — ${game.i18n.localize(CLIMATES[key].label)}` : String(key ?? "");
  return labelFor(key);
}

/* -------------------------------------------------------------------- */
/*  Pure cell bookkeeping (committed tests)                             */
/* -------------------------------------------------------------------- */

/** One cell's identity, from a grid offset. */
export const hexKeyOf = (offset) => `${offset.i}:${offset.j}`;

/**
 * A human hex label from a grid offset: column letters, row number — "C4".
 * Columns run A…Z, AA…; rows are one-based. The label is a NAME for the log
 * and the panel; the offset stays the identity.
 */
export function hexLabelFromOffset(offset) {
  let j = Math.max(0, Number(offset?.j) || 0);
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (j % 26)) + letters;
    j = Math.floor(j / 26) - 1;
  } while (j >= 0);
  return `${letters}${Math.max(0, Number(offset?.i) || 0) + 1}`;
}

/**
 * A cell added to a region's aligned (hexKeys, shapes) pair — unchanged when
 * the cell is already painted there.
 */
export function withHexAdded(hexKeys, shapes, key, shape) {
  if ((hexKeys ?? []).includes(key)) return { hexKeys, shapes, changed: false };
  return { hexKeys: [...(hexKeys ?? []), key], shapes: [...(shapes ?? []), shape], changed: true };
}

/** A cell removed from the pair — unchanged when it was never there. */
export function withHexRemoved(hexKeys, shapes, key) {
  const i = (hexKeys ?? []).indexOf(key);
  if (i < 0) return { hexKeys, shapes, changed: false };
  return {
    hexKeys: hexKeys.filter((_k, n) => n !== i),
    shapes: (shapes ?? []).filter((_s, n) => n !== i),
    changed: true,
  };
}

/* -------------------------------------------------------------------- */
/*  Scene reads and writes                                              */
/* -------------------------------------------------------------------- */

/** Is this scene's grid one the painter works in? */
export function isHexScene(scene) {
  const type = scene?.grid?.type;
  const T = CONST.GRID_TYPES;
  return [T.HEXODDR, T.HEXEVENR, T.HEXODDQ, T.HEXEVENQ].includes(type);
}

/** Every region a layer has painted on a scene. */
export function layerRegionsOf(scene, layer = "terrain") {
  const spec = layerSpec(layer);
  if (!spec) return [];
  return (scene?.regions ?? []).filter((r) => !!r.getFlag?.(MODULE_ID, spec.flag));
}

/** Every terrain region of a scene. */
export function terrainRegionsOf(scene) {
  return layerRegionsOf(scene, "terrain");
}

/**
 * A layer's painted value in the hex containing `point`, or null. A flag read
 * over the cell key — exact, and canvas-free, so the journey's movement
 * handler can ask it on any client.
 */
export function layerValueAt(scene, point, layer = "terrain") {
  const spec = layerSpec(layer);
  if (!spec || !isHexScene(scene)) return null;
  const key = hexKeyOf(scene.grid.getOffset(point));
  for (const region of layerRegionsOf(scene, layer)) {
    if ((region.getFlag(MODULE_ID, spec.hexesFlag) ?? []).includes(key)) {
      return region.getFlag(MODULE_ID, spec.flag);
    }
  }
  return null;
}

/** The painted terrain of the hex containing `point`, or null (`layerValueAt` on the terrain layer). */
export function terrainAtPoint(scene, point) {
  return layerValueAt(scene, point, "terrain");
}

/**
 * The painted terrain of the hex containing `point`, read in both
 * vocabularies the journey reads: `key` as painted (null when unpainted),
 * `ground` the travel ground it stands on (null when the key names none —
 * a river, or nothing painted) and `encounterTerrain` the encounter pick it
 * names ("" for a bare ground, whose pick stays the Judge's or the ground's
 * default). A bare ground is a map painted before the brush took the book's
 * grain, or an imported kind no encounter terrain covers.
 */
export function paintedTerrainAt(scene, point) {
  const key = terrainAtPoint(scene, point);
  if (!key) return { key: null, ground: null, encounterTerrain: "" };
  const fine = ENCOUNTER_TERRAINS[key];
  if (fine) return { key, ground: fine.ground ?? null, encounterTerrain: key };
  return { key, ground: key, encounterTerrain: "" };
}

/** The cell's polygon shape data, from the scene's own grid. */
function hexShapeAt(scene, offset) {
  const vertices = scene.grid.getVertices(offset);
  return { type: "polygon", hole: false, points: vertices.flatMap((v) => [v.x, v.y]) };
}

/** Remove one cell from every region of one layer it appears in; the other layers keep theirs. */
async function eraseHexEverywhere(scene, key, { except = null, layer = "terrain" } = {}) {
  const { hexesFlag } = layerSpec(layer);
  for (const region of layerRegionsOf(scene, layer)) {
    if (region.id === except) continue;
    const next = withHexRemoved(region.getFlag(MODULE_ID, hexesFlag) ?? [], region.toObject().shapes ?? [], key);
    if (!next.changed) continue;
    if (!next.hexKeys.length) {
      await region.delete();
    } else {
      await region.update({ shapes: next.shapes, [`flags.${MODULE_ID}.${hexesFlag}`]: next.hexKeys });
    }
  }
}

/**
 * Paint the hex containing `point` with a layer's value (or erase it from that
 * layer, when `value` is null). One value per hex per layer; the region is
 * created on first use and tinted. A terrain region is visible to everyone —
 * a hex map's terrain is the map; a territory or a climate is the Judge's
 * bookkeeping, drawn for a GM only.
 */
export async function paintHexAt(scene, point, value, layer = "terrain") {
  const spec = layerSpec(layer);
  if (!spec || !game.user.isGM || !isHexScene(scene) || !scene.grid.getVertices) return false;
  const offset = scene.grid.getOffset(point);
  const key = hexKeyOf(offset);

  if (value == null) {
    await eraseHexEverywhere(scene, key, { layer });
    return true;
  }
  if (!paintableValues(layer).includes(value)) return false;

  let region = layerRegionsOf(scene, layer).find((r) => r.getFlag(MODULE_ID, spec.flag) === value);
  const already = region && (region.getFlag(MODULE_ID, spec.hexesFlag) ?? []).includes(key);
  if (already) return false;

  await eraseHexEverywhere(scene, key, { except: region?.id ?? null, layer });
  const shape = hexShapeAt(scene, offset);
  if (!region) {
    const visibility = layer === "terrain"
      ? CONST.REGION_VISIBILITY?.ALWAYS ?? 2
      : CONST.REGION_VISIBILITY?.GAMEMASTER ?? 1;
    const [made] = await scene.createEmbeddedDocuments("Region", [
      {
        // The layer's label and colour functions, never the frozen maps: an
        // imported terrain has no entry in either, and TERRAIN[key].label
        // would throw on it.
        name: layerLabelFor(value, layer),
        color: layerColorFor(value, layer),
        visibility,
        shapes: [shape],
        flags: { [MODULE_ID]: { [spec.flag]: value, [spec.hexesFlag]: [key] } },
      },
    ]);
    region = made;
  } else {
    const next = withHexAdded(region.getFlag(MODULE_ID, spec.hexesFlag) ?? [], region.toObject().shapes ?? [], key, shape);
    await region.update({ shapes: next.shapes, [`flags.${MODULE_ID}.${spec.hexesFlag}`]: next.hexKeys });
  }
  return true;
}

/* -------------------------------------------------------------------- */
/*  The paint session and its canvas catcher                            */
/* -------------------------------------------------------------------- */

class TerrainPaintSession {
  /** The brush: a value of the current layer, "erase", or null (disarmed). */
  brush = null;

  /** The layer the brush paints, a key of `PAINT_LAYERS`; this session's own, never stored. */
  layer = "terrain";

  /**
   * What armed the brush: "tool" (the toolbar's terrain tool, which disarms it
   * when toggled off), "sheet" (a party sheet's paint chip) or "palette" (a
   * swatch picked while disarmed). Closing the palette disarms any but the
   * tool's, since nothing else on screen says the canvas is captured.
   */
  armedBy = null;

  #container = null;
  #lastKey = null;
  #listeners = new Set();
  /** The last value picked on each layer, so a layer switch or a re-arm comes back to it. */
  #lastBrush = { terrain: "grassland" };

  onChange(fn) {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #notify() {
    for (const fn of this.#listeners) fn(this.brush);
  }

  /**
   * Arm the brush on a layer: `brush` null takes the layer's last value, or
   * its first.
   */
  arm(brush = null, { layer = this.layer, by = "tool" } = {}) {
    this.layer = layerSpec(layer) ? layer : "terrain";
    this.brush = brush ?? this.#remembered(this.layer);
    this.armedBy = by;
    if (this.brush && this.brush !== "erase") this.#lastBrush[this.layer] = this.brush;
    if (!this.#container) this.#build();
    this.#notify();
  }

  disarm() {
    if (!this.brush && !this.#container) return;
    this.brush = null;
    this.armedBy = null;
    this.#teardown();
    this.#notify();
  }

  /** The palette changes the brush without re-arming the catcher. */
  setBrush(brush) {
    if (!this.brush) return this.arm(brush, { by: "palette" });
    this.brush = brush;
    if (brush !== "erase") this.#lastBrush[this.layer] = brush;
    this.#notify();
  }

  /** Switch the layer; an armed brush moves to that layer's last value. */
  setLayer(layer) {
    if (!layerSpec(layer) || layer === this.layer) return;
    this.layer = layer;
    if (this.brush) this.brush = this.#remembered(layer);
    this.#notify();
  }

  #remembered(layer) {
    const values = paintableValues(layer);
    const last = this.#lastBrush[layer];
    return values.includes(last) ? last : (values[0] ?? null);
  }

  #build() {
    if (!canvas?.stage) return;
    const container = (this.#container = canvas.stage.addChild(new PIXI.Container()));
    container.eventMode = "passive";
    container.zIndex = 10000;
    // Screen-space pointer catcher — capture.mjs's pattern: invisible, and it
    // swallows canvas pointer events while the brush is armed.
    const catcher = container.addChild(new PIXI.Sprite(PIXI.Texture.WHITE));
    catcher.alpha = 0;
    catcher.eventMode = "static";
    catcher.hitArea = canvas.app.screen;
    catcher.updateTransform = function () {
      const screen = canvas.app.screen;
      this.width = screen.width;
      this.height = screen.height;
      this._boundsID++;
      this.transform.updateTransform(PIXI.Transform.IDENTITY);
      this.worldAlpha = this.alpha;
    };
    catcher.on("pointerdown", (ev) => this.#paintAt(ev));
    catcher.on("pointermove", (ev) => {
      if (ev.buttons & 1) this.#paintAt(ev);
    });
    catcher.on("pointerup", () => (this.#lastKey = null));
    catcher.on("pointerupoutside", () => (this.#lastKey = null));
  }

  #teardown() {
    this.#container?.destroy({ children: true });
    this.#container = null;
    this.#lastKey = null;
  }

  async #paintAt(ev) {
    if (!this.brush || !canvas?.scene) return;
    const point = ev.getLocalPosition(canvas.stage);
    if (!isHexScene(canvas.scene)) {
      // Once per STROKE, not once per pointermove: the sentinel is cleared by
      // pointerup, and checked before the warning re-fires.
      if (this.#lastKey !== "warned") {
        ui.notifications?.warn(game.i18n.localize(`${LANG_PREFIX}.terrain.hexOnly`));
        this.#lastKey = "warned";
      }
      return;
    }
    const key = hexKeyOf(canvas.scene.grid.getOffset(point));
    if (key === this.#lastKey) return; // drag-paint: one write per cell
    this.#lastKey = key;
    await paintHexAt(canvas.scene, point, this.brush === "erase" ? null : this.brush, this.layer);
  }
}

export const terrainPaint = new TerrainPaintSession();

/**
 * A scene change tears the catcher down; the toolbar re-arms it. Registered
 * by battlemap's module.mjs — never at module scope, so the travel engine's
 * Node test graph can import the pure half of this file.
 */
export function registerTerrainPaintHooks() {
  Hooks.on("canvasReady", () => terrainPaint.disarm());
}

/* -------------------------------------------------------------------- */
/*  The palette                                                          */
/* -------------------------------------------------------------------- */

// Dereferenced at module scope with a stand-in for Node (the family
// convention): the class is only ever instantiated by Foundry.
const { ApplicationV2, HandlebarsApplicationMixin } = globalThis.foundry?.applications?.api ?? {
  ApplicationV2: class {},
  HandlebarsApplicationMixin: (cls) => cls,
};

/**
 * The brush picker: the three layers as pills at its head, then one swatch per
 * value of the chosen layer (a climate's grouped as the party sheet groups
 * them), and the eraser.
 */
export class TerrainPaletteApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "acks-extras-terrain-palette",
    classes: ["acks-ui", "acks-extras", "acks-extras-terrain-palette", "acks-extras-scroll"],
    // Two columns of swatches: wide enough that a kind's full name shows.
    position: { width: 380 },
    window: { title: "ACKS-BATTLEMAP.terrain.palette", icon: "fa-solid fa-paintbrush" },
    actions: { pickBrush: TerrainPaletteApp.#pickBrush, pickLayer: TerrainPaletteApp.#pickLayer },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/battlemap/terrain-palette.hbs` },
  };

  #unsubscribe = null;

  async _prepareContext() {
    const layer = terrainPaint.layer;
    const swatch = (key) => ({
      key,
      label: layerLabelFor(key, layer),
      color: layerColorFor(key, layer),
      active: terrainPaint.brush === key,
    });
    const values = paintableValues(layer);
    const groups = layer === "climate"
      ? [...new Set(values.map((k) => CLIMATES[k].group))].map((group) => ({
        label: game.i18n.localize(`ACKS-FORMATION.travel.weather.climateGroup.${group}`),
        swatches: values.filter((k) => CLIMATES[k].group === group).map(swatch),
      }))
      : [{ label: null, swatches: values.map(swatch) }];
    return {
      layers: Object.keys(PAINT_LAYERS).map((key) => ({
        key,
        label: game.i18n.localize(`${LANG_PREFIX}.terrain.layer.${key}`),
        active: key === layer,
      })),
      groups,
      erasing: terrainPaint.brush === "erase",
      armed: !!terrainPaint.brush,
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this.#unsubscribe ??= terrainPaint.onChange(() => this.render());
  }

  _onClose(options) {
    super._onClose?.(options);
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    if (terrainPaint.armedBy !== "tool") terrainPaint.disarm();
  }

  static async #pickBrush(_event, target) {
    terrainPaint.setBrush(target.dataset.brush);
  }

  static async #pickLayer(_event, target) {
    terrainPaint.setLayer(target.dataset.layer);
  }
}

let palette = null;

/** Open (or front) the palette. */
export function openTerrainPalette() {
  palette ??= new TerrainPaletteApp();
  palette.render({ force: true });
  return palette;
}

/**
 * Arm the brush and open the palette: the toolbar's terrain tool and a party
 * sheet's paint chip both come through here. `layer` and `brush` default to
 * the session's own; `by` says who armed it (`terrainPaint.armedBy`). Arming
 * writes nothing — a hex is painted only by a click on the map.
 */
export function openCountryBrush({ layer = null, brush = null, by = "tool" } = {}) {
  terrainPaint.arm(brush, { layer: layer ?? terrainPaint.layer, by });
  return openTerrainPalette();
}
