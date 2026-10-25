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
 * Terrain is one LAYER of a registry (`registerPaintLayer`): territory is
 * painted the same way into regions of its own, under flags of its own, one
 * value per hex per layer, and a feature adds a layer of its own by
 * registering it. A layer may DERIVE a country key — a hex painted into a
 * domain takes the domain's class as its territory — which the territory
 * painted on the hex overrides. The climate is no layer: it is the map's,
 * never a hex's. The terrain names below keep their meaning; each
 * layer-aware form takes a trailing `layer`, "terrain" by default.
 *
 * See docs/battlemap/DECISIONS.md, "Terrain paints as regions, and the
 * cell key is the identity."
 */
import { MODULE_ID, LANG_PREFIX, FLAG_BATTLEMAP } from "./constants.mjs";
import { writeSceneSetup } from "./scene-setup.mjs";
import { TERRAIN, readTable, TRAVEL_DOC } from "../vehicles/vehicle-speed.mjs";
import { ENCOUNTER_TERRAINS } from "../formation/encounter-terrains.mjs";
import { TERRITORY_KEYS } from "../formation/country-keys.mjs";
import { CLIMATES } from "../formation/weather.mjs";
import { lighten } from "../lib/color.mjs";

/** Region flags: the terrain kind, and the painted cells as offset keys. */
export const TERRAIN_FLAG = "terrain";
export const HEXES_FLAG = "terrainHexes";

/**
 * Every registered layer's entry, by key, in registration order. A layer is a
 * pair of region flags (the value a region paints, and its painted cells as
 * offset keys) and the functions that say what its brush may lay down. A hex
 * holds one value per layer, and a layer's write never touches another's
 * regions: a terrain and a territory answer different questions about the
 * same hex.
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
 * The registered layers' region flags, `{flag, hexesFlag}` by layer key: a live
 * read-only view of the registry, so a layer registered later appears in it. It
 * answers `Object.keys`, `Object.hasOwn` and a key read as a plain map of the
 * pairs would; every write is refused, since a layer joins only through
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
 * Register a layer for the country brush. The key and both flags are the
 * layer's alone: a key or a flag another layer holds is refused with a throw,
 * since two layers on one flag would read and erase each other's regions.
 * @param {object} layer
 * @param {string} layer.key          the layer's name, as the palette and `openCountryBrush` give it
 * @param {string} layer.flag         the module flag a region carries to name its value
 * @param {string} layer.hexesFlag    the module flag holding the painted cells as offset keys
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
  key, flag, hexesFlag, values, label, color, visible = false, regionsOnly = false, title = null, groups = null,
  derives = null,
} = {}) {
  const refuse = (why) => {
    throw new Error(`${MODULE_ID} | paint layer "${key}" refused: ${why}`);
  };
  for (const [name, text] of Object.entries({ key, flag, hexesFlag })) {
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
  if (flag === hexesFlag) refuse("flag and hexesFlag must differ");
  if (visible && regionsOnly) refuse("visible and regionsOnly cannot both hold");
  const held = [...layers.values()].flatMap((l) => [l.flag, l.hexesFlag]);
  if ([flag, hexesFlag].some((f) => held.includes(f))) refuse("a flag is shared with another layer");
  const entry = Object.freeze({
    key, flag, hexesFlag, values, label, color, visible: !!visible, regionsOnly: !!regionsOnly, title, groups,
    derives: derives ? Object.freeze({ key: derives.key, of: derives.of }) : null,
    pair: Object.freeze({ flag, hexesFlag }),
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
  hexesFlag: HEXES_FLAG,
  visible: true,
  values: paintableTerrains,
  label: labelFor,
  color: colorFor,
});

registerPaintLayer({
  key: "territory",
  flag: "territory",
  hexesFlag: "territoryHexes",
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
 * draw them all without asking hex by hex.
 */
export function derivedHexes(scene, key) {
  const spec = derivingLayer(key);
  if (!spec || !isHexScene(scene)) return [];
  return layerRegionsOf(scene, spec.key).flatMap((region) => {
    const value = spec.derives.of(region.getFlag(MODULE_ID, spec.flag)) ?? null;
    if (value == null) return [];
    return (region.getFlag(MODULE_ID, spec.hexesFlag) ?? []).map((hex) => ({ key: hex, value, layer: spec.key }));
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

/** The visibility a layer's regions are made with: everyone's, the Regions control's alone, or a GM's. */
function regionVisibilityOf(spec) {
  const V = CONST.REGION_VISIBILITY ?? {};
  if (spec.visible) return V.ALWAYS ?? 2;
  if (spec.regionsOnly) return V.LAYER ?? 0;
  return V.GAMEMASTER ?? 1;
}

/**
 * Move a scene's regions on a `regionsOnly` layer that were painted to be
 * drawn for a GM onto the Regions control alone, once. A scene holding any
 * region of such a layer is marked `regionsSettled` in its setup record and
 * never settled again, so a visibility the Judge sets by hand afterwards
 * stands; a scene holding none is not written.
 * @returns {Promise<number>} how many regions moved
 */
export async function settleRegionsOnly(scene) {
  if (scene?.getFlag?.(MODULE_ID, FLAG_BATTLEMAP)?.regionsSettled) return 0;
  const regions = [...layers.values()].filter((l) => l.regionsOnly).flatMap((l) => layerRegionsOf(scene, l.key));
  if (!regions.length) return 0;
  const gm = CONST.REGION_VISIBILITY?.GAMEMASTER ?? 1;
  const updates = regions
    .filter((r) => r.visibility === gm)
    .map((r) => ({ _id: r.id, visibility: regionVisibilityOf({ regionsOnly: true }) }));
  if (updates.length) await scene.updateEmbeddedDocuments("Region", updates);
  await writeSceneSetup(scene, { regionsSettled: true });
  return updates.length;
}

/**
 * Paint the hex containing `point` with a layer's value (or erase it from that
 * layer, when `value` is null). One value per hex per layer; the region is
 * created on first use and tinted. A region is visible to everyone where its
 * layer is registered `visible` (a hex map's terrain is the map), only on the
 * Regions control where it is `regionsOnly` (a territory, which its map mode
 * draws), and for a GM otherwise.
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
    const visibility = regionVisibilityOf(spec);
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

/**
 * Whether a pointer event happened over the board canvas itself rather than
 * over a window, the sidebar or any other element in front of it. Read off
 * the native event's target, which is the element under the pointer.
 */
export function onBoard(ev, board = canvas?.app?.view) {
  return !!board && ev?.nativeEvent?.target === board;
}

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
    // PIXI hears `pointermove` on the whole document and `pointerdown` on the
    // board alone, so a move over a window — a swatch clicked with a pixel of
    // travel, the palette dragged by its header — still reaches this
    // full-screen catcher. A move paints only inside a stroke the board's own
    // pointerdown opened, and only while the pointer is over the board.
    catcher.on("pointerdown", (ev) => {
      if (!onBoard(ev)) return;
      this.#stroking = true;
      this.#paintAt(ev);
    });
    catcher.on("pointermove", (ev) => {
      if (this.#stroking && ev.buttons & 1 && onBoard(ev)) this.#paintAt(ev);
    });
    const endStroke = () => {
      this.#stroking = false;
      this.#lastKey = null;
    };
    catcher.on("pointerup", endStroke);
    catcher.on("pointerupoutside", endStroke);
  }

  #teardown() {
    this.#container?.destroy({ children: true });
    this.#container = null;
    this.#lastKey = null;
    this.#stroking = false;
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
