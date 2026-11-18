/* global game, canvas, foundry, PIXI, CONST, Hooks, ui */
/**
 * Hex terrain painting — map prep for the overland journey. A hex-gridded
 * scene's terrain is painted into scene REGIONS: one region per terrain
 * kind, flagged `terrain: <key>` and tinted, whose shape is core's own `grid`
 * shape (`GridShapeData`) holding the painted cells as grid offsets. "What
 * terrain is this hex?" is core's `testPoint` on those shapes, and a Judge
 * adds or removes a cell with core's grid tool as readily as the brush does.
 * One terrain per hex; painting is GM-only, hex grids only. The PAINT SESSION
 * is armed by the battlemap control group's terrain tool, a screen-space
 * pointer catcher (pointer-catcher.mjs) turning clicks and drags into cell
 * writes, one queued write per cell.
 *
 * Terrain is one LAYER of a registry (`registerPaintLayer`): territory is
 * painted the same way into regions of its own, under flags of its own, one
 * value per hex per layer, and a feature adds a layer of its own by
 * registering it. A layer may DERIVE a country key — a hex painted into a
 * domain takes the domain's class as its territory — which the territory
 * painted on the hex overrides. The climate is no layer: it is the map's,
 * never a hex's. The terrain names below keep their meaning; each
 * layer-aware form takes a trailing `layer`, "terrain" by default.
 *
 * See docs/battlemap/DECISIONS.md, "Paint is a core grid shape per value."
 */
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import { TERRAIN, readTable, TRAVEL_DOC } from "../vehicles/vehicle-speed.mjs";
import { ENCOUNTER_TERRAINS } from "../formation/encounter-terrains.mjs";
import { TERRITORY_KEYS } from "../formation/country-keys.mjs";
import { CLIMATES } from "../formation/weather.mjs";
import { lighten } from "../lib/color.mjs";
import { gridCellsOf } from "../lib/regions.mjs";
import { buildPointerCatcher, onBoard } from "./pointer-catcher.mjs";

export { onBoard };

/** The region flag naming the terrain kind a terrain region paints. */
export const TERRAIN_FLAG = "terrain";

/**
 * Every registered layer's entry, by key, in registration order. A layer is a
 * region flag (the value a region paints; its cells are the region's own grid
 * shapes) and the functions that say what its brush may lay down. A hex holds
 * one value per layer, and a layer's write never touches another's regions: a
 * terrain and a territory answer different questions about the same hex.
 */
const layers = new Map();

/** The entry of a layer the brush knows, or null. */
const layerSpec = (layer) => layers.get(layer) ?? null;

/**
 * The country keys a layer may derive (`registerPaintLayer`'s `derives`): the
 * keys a reader asks a derived answer for. `countryAt` reads a derived
 * territory beneath a painted one.
 */
export const DERIVED_KEYS = Object.freeze(["territory"]);

/** The layer deriving a country key, or null. */
const derivingLayer = (key) => [...layers.values()].find((l) => l.derives?.key === key) ?? null;

/**
 * The hook a feature calls (through `paintLayerChanged`) when what a layer's
 * values MEAN has changed with no region written — a domain renamed, given
 * another liege or another class. The map modes and an open palette redraw on it.
 */
export const PAINT_LAYER_CHANGED_HOOK = "acksExtrasPaintLayerChanged";

/** Tell the map modes and the palette that a layer's labels, colours or derived values have changed. */
export function paintLayerChanged(layer) {
  Hooks.callAll(PAINT_LAYER_CHANGED_HOOK, layer);
}

/**
 * The registered layers' region flags, `{flag}` by layer key: a live read-only
 * view of the registry, so a layer registered later appears in it. It answers
 * `Object.keys`, `Object.hasOwn` and a key read as a plain map of the entries
 * would; every write is refused, since a layer joins only through
 * `registerPaintLayer`.
 */
export const PAINT_LAYERS = new Proxy({}, {
  get: (_target, key) => layers.get(key)?.pair,
  has: (_target, key) => layers.has(key),
  ownKeys: () => [...layers.keys()],
  getOwnPropertyDescriptor: (_target, key) => (layers.has(key)
    ? { value: layers.get(key).pair, writable: false, enumerable: true, configurable: true }
    : undefined),
  set: () => false,
  defineProperty: () => false,
  deleteProperty: () => false,
  setPrototypeOf: () => false,
  preventExtensions: () => false,
});

/**
 * Register a layer for the country brush. The key and the flag are the
 * layer's alone: a key or a flag another layer holds is refused with a throw,
 * since two layers on one flag would read and erase each other's regions.
 * @param {object} layer
 * @param {string} layer.key          the layer's name, as the palette and `openCountryBrush` give it
 * @param {string} layer.flag         the module flag a region carries to name its value
 * @param {() => string[]} layer.values  every value the brush may lay down now; a layer with none is left out of the palette
 * @param {(value: string) => string} layer.label  a value's name
 * @param {(value: string) => string} layer.color  a value's swatch and region colour
 * @param {boolean} [layer.visible]  whether its regions are drawn for players; the Judge's alone by default
 * @param {boolean} [layer.regionsOnly]  whether its regions are drawn only on the Regions control, for a
 *   layer a map mode draws instead (map-modes.mjs); never with `visible`
 * @param {string} [layer.title]  the i18n key of its palette pill, `<LANG_PREFIX>.terrain.layer.<key>` by default
 * @param {{of: (value: string) => string, label: (group: string) => string}} [layer.groups]
 *   how its swatches are grouped in the palette, in order of first appearance
 * @param {{key: string, of: (value: string) => string|null}} [layer.derives]
 *   a country key a hex painted on this layer answers (`DERIVED_KEYS`), and the
 *   key's value for a value of this layer, or null where it implies none; one
 *   layer derives a key
 * @returns {() => void} removes the layer again; the brush returns to terrain if it was on it
 */
export function registerPaintLayer({
  key, flag, values, label, color, visible = false, regionsOnly = false, title = null, groups = null,
  derives = null,
} = {}) {
  const refuse = (why) => {
    throw new Error(`${MODULE_ID} | paint layer "${key}" refused: ${why}`);
  };
  for (const [name, text] of Object.entries({ key, flag })) {
    if (typeof text !== "string" || !text) refuse(`${name} must be a non-empty string`);
  }
  for (const [name, fn] of Object.entries({ values, label, color })) {
    if (typeof fn !== "function") refuse(`${name} must be a function`);
  }
  if (groups && (typeof groups.of !== "function" || typeof groups.label !== "function")) {
    refuse("groups needs an `of` and a `label` function");
  }
  if (derives) {
    if (!DERIVED_KEYS.includes(derives.key)) refuse(`derives names no key a reader asks (${DERIVED_KEYS.join(", ")})`);
    if (typeof derives.of !== "function") refuse("derives needs an `of` function");
    const other = derivingLayer(derives.key);
    if (other) refuse(`"${other.key}" already derives ${derives.key}, one layer to a key`);
  }
  if (layers.has(key)) refuse("registered twice, one layer to a key");
  if (visible && regionsOnly) refuse("visible and regionsOnly cannot both hold");
  if ([...layers.values()].some((l) => l.flag === flag)) refuse("a flag is shared with another layer");
  const entry = Object.freeze({
    key, flag, values, label, color, visible: !!visible, regionsOnly: !!regionsOnly, title, groups,
    derives: derives ? Object.freeze({ key: derives.key, of: derives.of }) : null,
    pair: Object.freeze({ flag }),
  });
  layers.set(key, entry);
  return () => {
    if (layers.get(key) !== entry) return;
    layers.delete(key);
    if (terrainPaint.layer === key) terrainPaint.setLayer("terrain");
  };
}

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

/** A climate's colour: its group's, lightened by its place in the group. */
export function climateColorFor(code) {
  const group = CLIMATES[code]?.group;
  const base = CLIMATE_GROUP_COLORS[group];
  if (!base) return colorFor(code);
  const kin = Object.keys(CLIMATES).filter((k) => CLIMATES[k].group === group);
  return lighten(base, (kin.indexOf(code) / kin.length) * 0.5);
}

/** A climate's label, its code and name as the sheet's climate select reads; a code the module does not know reads as itself. */
export function climateLabelFor(code) {
  return CLIMATES[code] ? `${code} — ${game.i18n.localize(CLIMATES[code].label)}` : String(code ?? "");
}

/** Every value a layer's brush may lay down: its registered `values()`, or none for a layer the brush does not know. */
export function paintableValues(layer = "terrain") {
  return Array.from(layerSpec(layer)?.values() ?? []);
}

/** A layer value's colour, by the layer's registered `color`; a layer the brush does not know takes the terrain palette. */
export function layerColorFor(key, layer = "terrain") {
  return (layerSpec(layer)?.color ?? colorFor)(key);
}

/** A layer value's label, by the layer's registered `label`; a layer the brush does not know takes the terrain label. */
export function layerLabelFor(key, layer = "terrain") {
  return (layerSpec(layer)?.label ?? labelFor)(key);
}

// The two layers the country is painted in. Terrain is the map everyone sees;
// territory is the Judge's bookkeeping, named by the strings the party sheet
// already names it by, and drawn by its map mode, its regions only on the
// Regions control.
registerPaintLayer({
  key: "terrain",
  flag: TERRAIN_FLAG,
  visible: true,
  values: paintableTerrains,
  label: labelFor,
  color: colorFor,
});

registerPaintLayer({
  key: "territory",
  flag: "territory",
  regionsOnly: true,
  values: () => [...TERRITORY_KEYS],
  label: (key) => (TERRITORY_KEYS.includes(key) ? game.i18n.localize(`ACKS-FORMATION.travel.territory.${key}`) : String(key ?? "")),
  color: (key) => TERRITORY_COLORS[key] ?? colorFor(key),
});

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
 * One cell taken out of a region's shape data: out of every non-hole `grid`
 * shape that holds it, a grid shape left with no cell dropped. Other shapes
 * (a hole, a polygon a Judge drew) are passed through untouched, so a rewrite
 * of the array loses nothing it did not mean to.
 * @param {object[]} shapes the region's `shapes` as plain data
 * @param {string} key the cell's `i:j` key
 * @returns {{shapes: object[], changed: boolean}} `shapes` is empty when nothing is left of the region
 */
export function withCellRemoved(shapes, key) {
  let changed = false;
  const next = [];
  for (const shape of shapes ?? []) {
    if (shape?.type !== "grid" || shape.hole || !(shape.offsets ?? []).some((o) => hexKeyOf(o) === key)) {
      next.push(shape);
      continue;
    }
    changed = true;
    const offsets = shape.offsets.filter((o) => hexKeyOf(o) !== key);
    if (offsets.length) next.push({ ...shape, offsets });
  }
  return { shapes: changed ? next : shapes, changed };
}

/**
 * One cell added to a region's shape data: to the first non-hole `grid` shape,
 * or to a new one where the region holds none. Unchanged when a non-hole grid
 * shape already holds it.
 * @param {object[]} shapes the region's `shapes` as plain data
 * @param {string} key the cell's `i:j` key
 * @returns {{shapes: object[], changed: boolean}}
 */
export function withCellAdded(shapes, key) {
  const list = shapes ?? [];
  const held = (s) => s?.type === "grid" && !s.hole;
  if (list.some((s) => held(s) && (s.offsets ?? []).some((o) => hexKeyOf(o) === key))) return { shapes: list, changed: false };
  const [i, j] = key.split(":").map(Number);
  const at = list.findIndex(held);
  if (at < 0) return { shapes: [...list, { type: "grid", hole: false, offsets: [{ i, j }] }], changed: true };
  return {
    shapes: list.map((s, n) => (n === at ? { ...s, offsets: [...(s.offsets ?? []), { i, j }] } : s)),
    changed: true,
  };
}

/**
 * Re-key grid cells after the grid moved under them. Each cell stays where it
 * is on the map: the caller says which point of the NEW grid it lands on, and
 * the cell becomes the cell of the new grid that point lies in. Where two old
 * cells of one group land on one new cell, the one whose point is nearest the
 * new cell's centre keeps it and the other is dropped. A group is a paint
 * layer's cell shapes together (one value per hex per layer), or, for a shape
 * no layer owns (a zone's, a hole), that shape alone. A cell whose point names
 * no cell keeps its key.
 *
 * Pure: the grid arrives as two functions, so no scene is read.
 * @param {Array<{id: string, shapes: Array<{index: number, group: string|null, cells: Array<{i: number, j: number, x: number, y: number}>}>}>} regions
 *   each region's grid shapes by index with their collision group (null for a shape of its own), every cell with the point it lands on
 * @param {object} grid
 * @param {(point: {x: number, y: number}) => {i: number, j: number}|null} grid.offsetOf  the cell containing a point
 * @param {(offset: {i: number, j: number}) => {x: number, y: number}} grid.centreOf  a cell's centre
 * @returns {Array<{id: string, shapes: Array<{index: number, offsets: Array<{i: number, j: number}>}>, changed: boolean}>}
 *   one entry per region in the order given; `changed` says some shape's cells differ from what was given
 */
export function rekeyGridCells(regions, { offsetOf, centreOf }) {
  const best = new Map();
  const claimed = regions.map((region) => region.shapes.map((shape) => shape.cells.map((cell) => {
    const offset = offsetOf(cell);
    const valid = offset && Number.isFinite(offset.i) && Number.isFinite(offset.j);
    const to = valid ? centreOf(offset) : null;
    const item = {
      from: { i: cell.i, j: cell.j },
      to: valid ? { i: offset.i, j: offset.j } : { i: cell.i, j: cell.j },
      d: valid ? Math.hypot(cell.x - to.x, cell.y - to.y) : -1,
      domain: `${shape.group ?? `${region.id}#${shape.index}`}|${valid ? hexKeyOf(offset) : hexKeyOf(cell)}`,
    };
    const rival = best.get(item.domain);
    if (!rival || item.d < rival.d) best.set(item.domain, item);
    return item;
  })));
  return regions.map((region, r) => {
    let changed = false;
    const shapes = region.shapes.map((shape, s) => {
      const kept = claimed[r][s].filter((item) => best.get(item.domain) === item);
      const offsets = kept.map((item) => item.to);
      if (kept.length !== shape.cells.length || kept.some((item) => item.to.i !== item.from.i || item.to.j !== item.from.j)) changed = true;
      return { index: shape.index, offsets };
    });
    return { id: region.id, shapes, changed };
  });
}

/* -------------------------------------------------------------------- */
/*  Scene reads                                                          */
/* -------------------------------------------------------------------- */

/** Is this scene's grid one the painter works in? */
export function isHexScene(scene) {
  const type = scene?.grid?.type;
  const T = CONST.GRID_TYPES;
  return [T.HEXODDR, T.HEXEVENR, T.HEXODDQ, T.HEXEVENQ].includes(type);
}

/**
 * Every region a layer has painted on a scene, in the scene's order: one that
 * carries the layer's value flag and at least one `grid` shape. A region the
 * flag names but no grid shape backs paints nothing.
 */
export function layerRegionsOf(scene, layer = "terrain") {
  const spec = layerSpec(layer);
  if (!spec) return [];
  return (scene?.regions ?? []).filter((r) => !!r.getFlag?.(MODULE_ID, spec.flag) && (r.shapes ?? []).some((s) => s.type === "grid"));
}

/** Every terrain region of a scene. */
export function terrainRegionsOf(scene) {
  return layerRegionsOf(scene, "terrain");
}

/**
 * Every cell a layer holds on a scene: `[{key, value, region}]`, one per cell,
 * its region the first of the layer (in the scene's order) to claim it. This
 * is the one enumeration behind the map modes, the derived hexes and a
 * domain's painted hexes, and it agrees with `layerValueAt` where a hand edit
 * has left two regions claiming a cell: both answer with the first.
 */
export function layerCellsOf(scene, layer = "terrain") {
  const spec = layerSpec(layer);
  if (!spec) return [];
  const seen = new Set();
  const out = [];
  for (const region of layerRegionsOf(scene, layer)) {
    const value = region.getFlag(MODULE_ID, spec.flag);
    for (const cell of gridCellsOf(region)) {
      const key = hexKeyOf(cell);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, value, region });
    }
  }
  return out;
}

/**
 * A layer's painted value in the hex containing `point`, or null: core's
 * `testPoint` on each of the layer's non-hole `grid` shapes, the regions in the
 * scene's order, the first to claim the hex answering. Canvas-free, so the
 * journey's movement handler can ask it on any client.
 */
export function layerValueAt(scene, point, layer = "terrain") {
  const spec = layerSpec(layer);
  if (!spec || !isHexScene(scene)) return null;
  for (const region of layerRegionsOf(scene, layer)) {
    if (region.shapes.some((s) => s.type === "grid" && !s.hole && s.testPoint(point))) {
      return region.getFlag(MODULE_ID, spec.flag);
    }
  }
  return null;
}

/**
 * A country key as the layer deriving it answers at `point`: `{value, layer}`,
 * the value the hex's paint on that layer implies and the layer's key, or null
 * where no layer derives the key, the hex holds no paint on it, or the paint
 * implies nothing (a domain with no class, or one no longer in the world).
 */
export function derivedValueAt(scene, point, key) {
  const spec = derivingLayer(key);
  if (!spec) return null;
  const painted = layerValueAt(scene, point, spec.key);
  const value = painted == null ? null : (spec.derives.of(painted) ?? null);
  return value == null ? null : { value, layer: spec.key };
}

/**
 * Every hex of a scene for which a layer derives `key`: `[{key, value, layer}]`
 * by offset key, as `derivedValueAt` would answer at each, so a map mode can
 * draw them all without asking hex by hex. A hex is the layer's first claim
 * before it is derived from, so one the layer holds twice answers once.
 */
export function derivedHexes(scene, key) {
  const spec = derivingLayer(key);
  if (!spec || !isHexScene(scene)) return [];
  return layerCellsOf(scene, spec.key).flatMap((cell) => {
    const value = spec.derives.of(cell.value) ?? null;
    return value == null ? [] : [{ key: cell.key, value, layer: spec.key }];
  });
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

/* -------------------------------------------------------------------- */
/*  Scene writes                                                         */
/* -------------------------------------------------------------------- */

/** Each scene's write queue: the tail of the promise chain, which never rejects. */
const queues = new WeakMap();

/**
 * Run a write after every write queued before it on the same scene. The
 * brush fires one write per pointer move without awaiting it, and a cell's
 * write reads the regions as the last one left them: run side by side, two
 * writes each start from the same stale shapes and one cell is lost. A write
 * that throws rejects to its own caller and leaves the queue running.
 */
function serialized(scene, task) {
  const run = (queues.get(scene) ?? Promise.resolve()).then(task);
  queues.set(scene, run.catch(() => {}));
  return run;
}

/** Send a batch of region writes: updates in one call, then deletions. */
async function sendRegionWrites(scene, { updates = [], removals = [] }) {
  if (updates.length) await scene.updateEmbeddedDocuments("Region", updates);
  if (removals.length) await scene.deleteEmbeddedDocuments("Region", removals);
}

/**
 * The writes that take one cell out of a layer's regions, `except` one aside:
 * each region still holding other cells is updated with its shapes rewritten,
 * one left with nothing is deleted.
 */
function cellStrips(regions, key, except = null) {
  const updates = [];
  const removals = [];
  for (const region of regions) {
    if (region === except) continue;
    const next = withCellRemoved(region.toObject().shapes ?? [], key);
    if (!next.changed) continue;
    if (next.shapes.length) updates.push({ _id: region.id, shapes: next.shapes });
    else removals.push(region.id);
  }
  return { updates, removals };
}

/** Remove one cell from every region of one layer it appears in; the other layers keep theirs. */
async function eraseHexEverywhere(scene, key, layer = "terrain") {
  await sendRegionWrites(scene, cellStrips(layerRegionsOf(scene, layer), key));
}

/** The visibility a layer's regions are made with: everyone's, the Regions control's alone, or a GM's. */
function regionVisibilityOf(spec) {
  const V = CONST.REGION_VISIBILITY ?? {};
  if (spec.visible) return V.ALWAYS ?? 2;
  if (spec.regionsOnly) return V.LAYER ?? 0;
  return V.GAMEMASTER ?? 1;
}

/** One cell's paint, read and written as one step of the scene's queue. */
async function paintCell(scene, spec, key, value, layer) {
  const regions = layerRegionsOf(scene, layer);
  if (value == null) {
    await eraseHexEverywhere(scene, key, layer);
    return true;
  }
  const target = regions.find((r) => r.getFlag(MODULE_ID, spec.flag) === value) ?? null;
  const { updates, removals } = cellStrips(regions, key, target);
  if (target) {
    const next = withCellAdded(target.toObject().shapes ?? [], key);
    if (!next.changed && !updates.length && !removals.length) return false;
    if (next.changed) updates.push({ _id: target.id, shapes: next.shapes });
    await sendRegionWrites(scene, { updates, removals });
    return true;
  }
  await sendRegionWrites(scene, { updates, removals });
  await scene.createEmbeddedDocuments("Region", [
    {
      // The layer's label and colour functions, never the frozen maps: an
      // imported terrain has no entry in either, and TERRAIN[key].label
      // would throw on it.
      name: layerLabelFor(value, layer),
      color: layerColorFor(value, layer),
      visibility: regionVisibilityOf(spec),
      // Unlocked, so core's grid tool reaches the cells; locking is for the
      // regions an import draws.
      locked: false,
      shapes: withCellAdded([], key).shapes,
      flags: { [MODULE_ID]: { [spec.flag]: value } },
    },
  ]);
  return true;
}

/**
 * Paint the hex containing `point` with a layer's value (or erase it from that
 * layer, when `value` is null). One value per hex per layer: the cell is taken
 * out of the layer's other regions and added to the value's region, in one
 * region update, the region created on first use and tinted, and one left
 * with no cell deleted. A region is visible to everyone where its layer is
 * registered `visible` (a hex map's terrain is the map), only on the Regions
 * control where it is `regionsOnly` (a territory, which its map mode draws),
 * and for a GM otherwise. Writes to a scene run one after another, so a drag
 * that fires faster than the server answers loses no cell.
 * @returns {Promise<boolean>} whether anything was written
 */
export async function paintHexAt(scene, point, value, layer = "terrain") {
  const spec = layerSpec(layer);
  if (!spec || !game.user.isGM || !isHexScene(scene)) return false;
  if (value != null && !paintableValues(layer).includes(value)) return false;
  const key = hexKeyOf(scene.grid.getOffset(point));
  return serialized(scene, () => paintCell(scene, spec, key, value, layer));
}

/**
 * The cells of every grid shape on a scene, each as a fraction of the scene
 * rectangle: the part of Apply's re-key that has to be read BEFORE the write,
 * since the grid it names is the old one. Core's own reposition moves every
 * placed object by the same fractions and leaves a grid shape's offsets as
 * they were, so what changes under a cell is which centre lies beneath it.
 * @param {Scene} scene
 * @returns {object|null} what `rekeyPaintedHexes` takes, or null where the scene has no grid to read
 */
export function captureGridCells(scene) {
  const grid = scene?.grid;
  const d = scene?.dimensions;
  if (!grid?.getCenterPoint || grid.isGridless || !(d?.sceneWidth > 0) || !(d?.sceneHeight > 0)) return null;
  const groupOf = new Map();
  for (const key of layers.keys()) for (const region of layerRegionsOf(scene, key)) if (!groupOf.has(region.id)) groupOf.set(region.id, `layer:${key}`);
  // A hole claims no cell, so it shares no collision group with the layer's cells.
  const groupFor = (region, shape) => (shape.hole ? null : groupOf.get(region.id) ?? null);
  const regions = [];
  for (const region of scene.regions ?? []) {
    const shapes = [];
    (region.shapes ?? []).forEach((shape, index) => {
      if (shape.type !== "grid" || !shape.offsets?.length) return;
      shapes.push({
        index,
        group: groupFor(region, shape),
        cells: shape.offsets.map(({ i, j }) => {
          const c = grid.getCenterPoint({ i, j });
          return { i, j, fx: (c.x - d.sceneX) / d.sceneWidth, fy: (c.y - d.sceneY) / d.sceneHeight };
        }),
      });
    });
    if (shapes.length) regions.push({ id: region.id, shapes });
  }
  return { regions };
}

/**
 * Re-key every grid shape on a scene against the grid the scene holds now,
 * after a write that moved the grid under them: `captured` (from
 * `captureGridCells`, read before the write) says where each cell lay on the
 * map as fractions of the scene rectangle, and each becomes the cell of the new
 * grid beneath that place (`rekeyGridCells`). The paint layers' shapes and the
 * zones an import drew are the same kind of shape and are moved alike. The
 * grid is read off `scene.grid`, the instance core builds from the scene's own
 * data, so it answers the moment the update has landed, with no canvas redraw
 * behind it. The shapes are rewritten from the regions as they stand now, so
 * what core repositioned in the same write is kept. Every region that changed
 * is written in one call, and one left with no cell is deleted.
 * @returns {Promise<number>} how many regions were rewritten or deleted
 */
export async function rekeyPaintedHexes(scene, captured) {
  if (!captured?.regions?.length || !scene.grid?.getOffset || scene.grid.isGridless || !game.user.isGM) return 0;
  const d = scene.dimensions;
  if (!(d?.sceneWidth > 0) || !(d?.sceneHeight > 0)) return 0;
  const landed = captured.regions.map((region) => ({
    ...region,
    shapes: region.shapes.map((shape) => ({
      index: shape.index,
      group: shape.group,
      cells: shape.cells.map((c) => ({ i: c.i, j: c.j, x: d.sceneX + c.fx * d.sceneWidth, y: d.sceneY + c.fy * d.sceneHeight })),
    })),
  }));
  const next = rekeyGridCells(landed, {
    offsetOf: (point) => scene.grid.getOffset(point),
    centreOf: (offset) => scene.grid.getCenterPoint(offset),
  });
  return serialized(scene, async () => {
    const updates = [];
    const removals = [];
    for (const result of next) {
      if (!result.changed) continue;
      const region = [...(scene.regions ?? [])].find((r) => r.id === result.id);
      if (!region) continue;
      const shapes = region.toObject().shapes ?? [];
      for (const { index, offsets } of result.shapes) {
        if (shapes[index]?.type === "grid") shapes[index] = { ...shapes[index], offsets };
      }
      const kept = shapes.filter((s) => s.type !== "grid" || (s.offsets ?? []).length);
      if (kept.length) updates.push({ _id: result.id, shapes: kept });
      else removals.push(result.id);
    }
    await sendRegionWrites(scene, { updates, removals });
    return updates.length + removals.length;
  });
}

/* -------------------------------------------------------------------- */
/*  The paint session and its canvas catcher                            */
/* -------------------------------------------------------------------- */

class TerrainPaintSession {
  /** The brush: a value of the current layer, "erase", or null (disarmed). */
  brush = null;

  /** The layer the brush paints, a registered layer's key; this session's own, never stored. */
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
  /** Whether the pointer went down on the board itself, which is what opens a drag stroke. */
  #stroking = false;
  /** Tail of the write chain; a stroke's cell writes run one after another. */
  #paintQueue = Promise.resolve();
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
    // The shared screen-space catcher swallows canvas pointer events while the
    // brush is armed and hands a press or move over the board alone (a swatch
    // clicked with a pixel of travel, the palette dragged by its header, never
    // paint). A move paints only inside a stroke the board's own press opened.
    buildPointerCatcher(container, {
      down: (ev) => {
        this.#stroking = true;
        this.#paintAt(ev);
      },
      move: (ev) => {
        if (this.#stroking && ev.buttons & 1) this.#paintAt(ev);
      },
      up: () => {
        this.#stroking = false;
        this.#lastKey = null;
      },
    });
  }

  #teardown() {
    this.#container?.destroy({ children: true });
    this.#container = null;
    this.#lastKey = null;
    this.#stroking = false;
  }

  /**
   * Read everything the write needs from the event synchronously (PIXI may
   * reuse the event object), then queue only the write: each write reads the
   * region and rewrites it, so overlapping writes would drop cells.
   */
  #paintAt(ev) {
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
    const scene = canvas.scene;
    const value = this.brush === "erase" ? null : this.brush;
    const layer = this.layer;
    this.#paintQueue = this.#paintQueue
      .then(() => paintHexAt(scene, point, value, layer))
      .catch((err) => console.error(`${MODULE_ID} | terrain paint failed`, err));
  }
}

/** The one terrain-paint session the scene controls drive. */
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
 * The brush picker: the registered layers as pills at its head (a layer with
 * no value to paint is left out), then one swatch per value of the chosen
 * layer (grouped where the layer registers groups), and the eraser.
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
  /** The hook id of the palette's redraw on a layer whose values changed meaning (`paintLayerChanged`). */
  #layerHook = null;

  async _prepareContext() {
    const layer = terrainPaint.layer;
    const swatch = (key) => ({
      key,
      label: layerLabelFor(key, layer),
      color: layerColorFor(key, layer),
      active: terrainPaint.brush === key,
    });
    const values = paintableValues(layer);
    const by = layerSpec(layer)?.groups;
    const groups = by
      ? [...new Set(values.map((k) => by.of(k)))].map((group) => ({
        label: by.label(group),
        swatches: values.filter((k) => by.of(k) === group).map(swatch),
      }))
      : [{ label: null, swatches: values.map(swatch) }];
    return {
      layers: [...layers.values()].filter((l) => paintableValues(l.key).length).map((l) => ({
        key: l.key,
        label: game.i18n.localize(l.title ?? `${LANG_PREFIX}.terrain.layer.${l.key}`),
        active: l.key === layer,
      })),
      groups,
      erasing: terrainPaint.brush === "erase",
      armed: !!terrainPaint.brush,
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this.#unsubscribe ??= terrainPaint.onChange(() => this.render());
    // A swatch names and colours a value as its layer does now: a domain renamed redraws it.
    this.#layerHook ??= Hooks.on(PAINT_LAYER_CHANGED_HOOK, () => {
      if (this.rendered) this.render();
    });
  }

  _onClose(options) {
    super._onClose?.(options);
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    if (this.#layerHook != null) Hooks.off(PAINT_LAYER_CHANGED_HOOK, this.#layerHook);
    this.#layerHook = null;
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
