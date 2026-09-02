/* global game, canvas, foundry, PIXI, CONST, Hooks, ui */
/**
 * Hex terrain painting — map prep for the overland journey.
 *
 * A hex-gridded scene's terrain is painted into scene REGIONS: one region
 * per terrain kind per scene, its shapes the painted hex cells, tinted in
 * the terrain's colour and flagged `terrain: <TERRAIN key>`. Beside the
 * shapes each region carries the painted cells as OFFSET KEYS
 * (`terrainHexes: ["i:j", …]`, aligned index-for-index with `shapes`), which
 * is what makes erasing exact and the travel lookup geometry-free: "what
 * terrain is this hex?" is a flag read, never a point-in-polygon test, so it
 * answers identically on a client with no canvas.
 *
 * ONE TERRAIN PER HEX: painting a cell removes it from every other terrain
 * region first — two regions claiming one cell is a map that answers a
 * question two ways.
 *
 * The PAINT SESSION is armed by the battlemap control group's terrain tool
 * (one armed thing at a time, Foundry's own tool exclusivity): a
 * screen-space pointer catcher (capture.mjs's proven pattern) turns clicks
 * and drags into cell writes, and a small palette window picks which terrain
 * the brush lays down — or the eraser. Painting is GM-only, hex grids only;
 * a square-grid scene refuses with a warning rather than approximating.
 */
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import { TERRAIN, readTable, TRAVEL_DOC } from "../vehicles/vehicle-speed.mjs";

/** Region flags: the terrain kind, and the painted cells as offset keys. */
export const TERRAIN_FLAG = "terrain";
export const HEXES_FLAG = "terrainHexes";

/**
 * Terrain kinds the brush refuses even though they are valid terrain.
 *
 * Mud and snow are rows of the printed terrain table, so they price a march
 * like any other ground — but they describe what the weather has LEFT, and the
 * footing state machine already derives them daily. Painting them would bake a
 * transient into the geography and leave two systems with an opinion about one
 * hex, so they stay lookup-only.
 */
export const UNPAINTABLE = Object.freeze(["mud", "snow"]);

/**
 * The palette — a fixed UI colour per terrain kind. Presentation, not rules:
 * the keys are the structural terrain vocabulary; the colours are ours.
 *
 * An imported kind the module has never heard of gets a derived hue instead
 * (`colorFor`), so the vocabulary can grow without the palette blocking it.
 */
export const TERRAIN_COLORS = Object.freeze({
  grassland: "#7cb45b",
  scrubland: "#a8a84f",
  barrens: "#b09067",
  desert: "#e0c060",
  hills: "#8f7b4f",
  forest: "#2e6b34",
  jungle: "#1e5c2e",
  mountains: "#7d7d85",
  swamp: "#4f6b52",
  mud: "#6e5a3e",
  snow: "#dfe8ee",
});

/**
 * Every terrain the brush may lay down: the shipped structural keys plus any
 * key the imported multiplier table carries, minus the ones weather owns.
 *
 * This is what lets a Judge with an ash waste paint one — adding a terrain is
 * adding a registry row, the way everything else in this family extends.
 */
export function paintableTerrains() {
  const shipped = Object.keys(TERRAIN);
  let imported = [];
  try {
    imported = Object.keys(readTable(TRAVEL_DOC, "terrainMultipliers") ?? {});
  } catch {
    imported = [];
  }
  const all = [...new Set([...shipped, ...imported])];
  return all.filter((k) => !UNPAINTABLE.includes(k));
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

/** The label for any terrain key: the shipped one, or the key made readable. */
export function labelFor(key) {
  const shipped = TERRAIN[key]?.label;
  if (shipped) return game.i18n.localize(shipped);
  return String(key ?? "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
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

/** Every terrain region of a scene. */
export function terrainRegionsOf(scene) {
  return (scene?.regions ?? []).filter((r) => !!r.getFlag?.(MODULE_ID, TERRAIN_FLAG));
}

/**
 * The painted terrain of the hex containing `point`, or null. A flag read
 * over the cell key — exact, and canvas-free, so the journey's movement
 * handler can ask it on any client.
 */
export function terrainAtPoint(scene, point) {
  if (!isHexScene(scene)) return null;
  const key = hexKeyOf(scene.grid.getOffset(point));
  for (const region of terrainRegionsOf(scene)) {
    if ((region.getFlag(MODULE_ID, HEXES_FLAG) ?? []).includes(key)) {
      return region.getFlag(MODULE_ID, TERRAIN_FLAG);
    }
  }
  return null;
}

/** The cell's polygon shape data, from the scene's own grid. */
function hexShapeAt(scene, offset) {
  const vertices = scene.grid.getVertices(offset);
  return { type: "polygon", hole: false, points: vertices.flatMap((v) => [v.x, v.y]) };
}

/** Remove one cell from every terrain region it appears in. */
async function eraseHexEverywhere(scene, key, { except = null } = {}) {
  for (const region of terrainRegionsOf(scene)) {
    if (region.id === except) continue;
    const next = withHexRemoved(region.getFlag(MODULE_ID, HEXES_FLAG) ?? [], region.toObject().shapes ?? [], key);
    if (!next.changed) continue;
    if (!next.hexKeys.length) {
      await region.delete();
    } else {
      await region.update({ shapes: next.shapes, [`flags.${MODULE_ID}.${HEXES_FLAG}`]: next.hexKeys });
    }
  }
}

/**
 * Paint the hex containing `point` with a terrain kind (or erase it, when
 * `terrainKey` is null). One terrain per hex; the region is created on first
 * use, tinted, visible to everyone — a hex map's terrain is the map.
 */
export async function paintHexAt(scene, point, terrainKey) {
  if (!game.user.isGM || !isHexScene(scene) || !scene.grid.getVertices) return false;
  const offset = scene.grid.getOffset(point);
  const key = hexKeyOf(offset);

  if (terrainKey == null) {
    await eraseHexEverywhere(scene, key);
    return true;
  }
  if (!paintableTerrains().includes(terrainKey)) return false;

  let region = terrainRegionsOf(scene).find((r) => r.getFlag(MODULE_ID, TERRAIN_FLAG) === terrainKey);
  const already = region && (region.getFlag(MODULE_ID, HEXES_FLAG) ?? []).includes(key);
  if (already) return false;

  await eraseHexEverywhere(scene, key, { except: region?.id ?? null });
  const shape = hexShapeAt(scene, offset);
  if (!region) {
    const [made] = await scene.createEmbeddedDocuments("Region", [
      {
        // labelFor/colorFor, never the frozen maps: an imported kind has no
        // entry in either, and TERRAIN[key].label would throw on it.
        name: labelFor(terrainKey),
        color: colorFor(terrainKey),
        visibility: CONST.REGION_VISIBILITY?.ALWAYS ?? 2,
        shapes: [shape],
        flags: { [MODULE_ID]: { [TERRAIN_FLAG]: terrainKey, [HEXES_FLAG]: [key] } },
      },
    ]);
    region = made;
  } else {
    const next = withHexAdded(region.getFlag(MODULE_ID, HEXES_FLAG) ?? [], region.toObject().shapes ?? [], key, shape);
    await region.update({ shapes: next.shapes, [`flags.${MODULE_ID}.${HEXES_FLAG}`]: next.hexKeys });
  }
  return true;
}

/* -------------------------------------------------------------------- */
/*  The paint session and its canvas catcher                            */
/* -------------------------------------------------------------------- */

class TerrainPaintSession {
  /** The brush: a TERRAIN key, "erase", or null (disarmed). */
  brush = null;

  #container = null;
  #lastKey = null;
  #listeners = new Set();

  onChange(fn) {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #notify() {
    for (const fn of this.#listeners) fn(this.brush);
  }

  arm(brush = "grassland") {
    this.brush = brush;
    if (!this.#container) this.#build();
    this.#notify();
  }

  disarm() {
    if (!this.brush && !this.#container) return;
    this.brush = null;
    this.#teardown();
    this.#notify();
  }

  /** The palette changes the brush without re-arming the catcher. */
  setBrush(brush) {
    if (!this.brush) return this.arm(brush);
    this.brush = brush;
    this.#notify();
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
    await paintHexAt(canvas.scene, point, this.brush === "erase" ? null : this.brush);
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

/** The brush picker: one swatch per terrain, and the eraser. */
export class TerrainPaletteApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "acks-extras-terrain-palette",
    classes: ["acks-ui", "acks-extras", "acks-extras-terrain-palette", "acks-extras-scroll"],
    position: { width: 260 },
    window: { title: "ACKS-BATTLEMAP.terrain.palette", icon: "fa-solid fa-paintbrush" },
    actions: { pickBrush: TerrainPaletteApp.#pickBrush },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/battlemap/terrain-palette.hbs` },
  };

  #unsubscribe = null;

  async _prepareContext() {
    return {
      swatches: paintableTerrains().map((key) => ({
        key,
        label: labelFor(key),
        color: colorFor(key),
        active: terrainPaint.brush === key,
      })),
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
  }

  static async #pickBrush(_event, target) {
    terrainPaint.setBrush(target.dataset.brush);
  }
}

let palette = null;

/** Open (or front) the palette. */
export function openTerrainPalette() {
  palette ??= new TerrainPaletteApp();
  palette.render({ force: true });
  return palette;
}
