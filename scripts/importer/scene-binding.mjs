/**
 * Scenes in a settlement book — the Foundry-free half of standing a printed
 * map up as a play surface.
 *
 * A scene recipe is GEOMETRY over one page, in page points with a top-left
 * origin: the crop that becomes the picture, the quarter turns that stand it
 * upright, how many feet one point is worth, each quarter's outline, and where
 * each keyed place stands. It names every place, quarter and table by cookbook
 * id and carries no printed word, so what it draws pays out only over the
 * Judge's own copy of the page.
 *
 * A recipe may also carry a `grid`: one drawn cell's lattice, box and centre,
 * measured off the page like the rest, and what one cell spans. Such a map is
 * built on a Foundry grid whose cells are the drawn ones. A zone row
 * (`kind.sceneZone`) lays one book's rule over another book's recipe as an
 * outline on the target page.
 *
 * Everything here is arithmetic and data shapes. The importer supplies the
 * documents (the world's places, the imported tables, the uploaded picture)
 * and does the writing; the compiler and the tests read the same frame and the
 * same checks, so a recipe that drifted from its page fails before a Judge
 * meets it.
 */
import { MODULE_ID } from "./constants.mjs";
import { SCENE_LINK_FLAG } from "../location/constants.mjs";
import { isPoiEntry, isRegionSite, poiGroupOf } from "./poi-binding.mjs";
import { hash36 } from "./printed-name.mjs";
import { gridTypeFor } from "../battlemap/constants.mjs";
import { DISTANCE_UNITS } from "../lib/distance-units.mjs";

/** The register kind a scene recipe is filed under. */
export const SCENE_KIND = "kind.scene";

/** The register kind a zone laid over a scene recipe is filed under. */
export const SCENE_ZONE_KIND = "kind.sceneZone";

/** The grid a scene is given: gridless, one cell to a hundred feet. A grid recipe's cell defaults to the same size. */
const GRID_PIXELS = 100;

/** The lattices a recipe's `grid` may name, as the map stands upright. */
export const RECIPE_GRID_FAMILIES = Object.freeze(["hexCols", "hexRows", "square"]);

/** The smallest Foundry cell, in pixels, a recipe's `grid.pixels` may ask for. */
const MIN_GRID_PIXELS = 50;

/** How far apart a probe's two axes may put the scale, as a fraction of the larger, before the fit is refused. */
const SCALE_AGREEMENT = 0.02;

/** The values an encounter zone's `journeyCadence` takes; blank inherits. */
export const ZONE_CADENCES = Object.freeze(["", "entry", "periods"]);

/** Core's `REGION_VISIBILITY.GAMEMASTER`, spelled out because this file loads without Foundry. */
const REGION_VISIBILITY_GAMEMASTER = 1;

/** The Region behaviour type formation registers as its encounter zone (`encounter-zone.mjs`). */
const ZONE_BEHAVIOR_TYPE = `${MODULE_ID}.encounterZone`;

/** How far a seat's image placement may sit from the recipe's, in points, and still be the same page. */
export const PLACEMENT_TOLERANCE = 1.5;

/** How wide a place's token is drawn, in grid cells. Half a cell reads as a pin, not a building. */
export const PLACE_TOKEN_SIZE = 0.5;

/** Core's `DOCUMENT_OWNERSHIP_LEVELS.NONE`, spelled out because this file loads without Foundry. */
const OWNERSHIP_NONE = 0;

/** Whether a cookbook scene row carries a recipe a seat can build. */
export const isSceneRecipe = (row) => row?.kind === SCENE_KIND && !!row?.scene?.crop;

/** Whether a cookbook scene row is a zone laid over a recipe rather than a recipe. */
export const isZoneRow = (row) => row?.kind === SCENE_ZONE_KIND && typeof row?.zone?.scene === "string" && !!row.zone.scene;

/** The Foundry cell size a recipe is built on, in pixels: its grid's `pixels`, else the gridless default. */
const cellPixels = (recipe) => (Number.isInteger(recipe?.grid?.pixels) && recipe.grid.pixels > 0 ? recipe.grid.pixels : GRID_PIXELS);

/**
 * One drawn cell's size across its flats, in points — the extent Foundry's
 * `grid.size` spans: the box's height for flat-topped `hexCols`, its width for
 * pointy-topped `hexRows` and for `square`.
 */
const acrossFlats = (grid) => Number(grid?.family === "hexCols" ? grid?.box?.h : grid?.box?.w);

/**
 * How many feet one page point is worth: the recipe's `feetPerPoint` when it
 * states one, else what its grid implies (the cell's distance in feet over
 * its across-flats size in points). NaN when neither says.
 */
export function recipeFeetPerPoint(recipe) {
  if (recipe?.feetPerPoint !== undefined || !recipe?.grid) return Number(recipe?.feetPerPoint);
  const feet = Number(recipe.grid.distance) * (DISTANCE_UNITS[recipe.grid.units]?.feet ?? NaN);
  const flats = acrossFlats(recipe.grid);
  return feet > 0 && flats > 0 ? feet / flats : NaN;
}

/**
 * Pixels per page point that make one drawn cell one Foundry cell of the
 * recipe's `grid.pixels`, or null when the recipe has no usable grid.
 *
 * Both answers are one ratio, Foundry's cell extent over the drawn cell's:
 * - with a live `probe` (`hexProbe`'s `{refW, refH, refSize}`) the extents are
 *   measured, `pixels * refW / refSize` over `box.w` and `pixels * refH /
 *   refSize` over `box.h`; the across-flats axis is returned, and the fit is
 *   refused (null) when the two axes disagree by more than 2%;
 * - with no probe (offline, a square lattice, or a test) Foundry's `size` IS
 *   the across-flats extent, so the ratio is `pixels` over the drawn cell's
 *   across-flats size — the probe's across-flats axis exactly.
 *
 * @param {object} recipe a compiled scene recipe
 * @param {{refW: number, refH: number, refSize: number}|null} [probe]
 * @returns {number|null}
 */
export function gridScale(recipe, probe = null) {
  const grid = recipe?.grid;
  const w = Number(grid?.box?.w);
  const h = Number(grid?.box?.h);
  if (!grid || !RECIPE_GRID_FAMILIES.includes(grid.family) || !(w > 0) || !(h > 0)) return null;
  const pixels = cellPixels(recipe);
  if (probe && grid.family !== "square") {
    const x = (pixels * (probe.refW / probe.refSize)) / w;
    const y = (pixels * (probe.refH / probe.refSize)) / h;
    if (!(x > 0) || !(y > 0) || Math.abs(x - y) > SCALE_AGREEMENT * Math.max(x, y)) return null;
    return grid.family === "hexCols" ? y : x;
  }
  return pixels / acrossFlats(grid);
}

/**
 * The frame a recipe is drawn in: the picture's size in pixels and the map
 * from a page point to a scene pixel.
 *
 * `pixelsPerPoint`, when given, IS the scale (`gridScale` for a grid recipe).
 * Otherwise one point is `recipeFeetPerPoint` feet and one pixel is
 * `1 / pixelsPerFoot` feet, so the picture is rendered at their product in
 * pixels to the point. The crop is cut first and turned second; the rounded
 * pixel sizes are the ones the renderer cuts to, so a point lands on the same
 * pixel here as in the picture. `gridPixels` is the Foundry cell size the
 * recipe is built on.
 *
 * @param {object} recipe a compiled scene recipe
 * @returns {{scale: number, cut: {w: number, h: number}, width: number,
 *   height: number, turn: number, gridPixels: number,
 *   toScene: (x: number, y: number) => [number, number]}}
 */
export function sceneFrame(recipe, { pixelsPerFoot = 1, pixelsPerPoint } = {}) {
  const { crop } = recipe;
  const scale = pixelsPerPoint > 0 ? Number(pixelsPerPoint) : recipeFeetPerPoint(recipe) * pixelsPerFoot;
  const turn = (((Number(recipe.turn) || 0) % 4) + 4) % 4;
  const w = Math.round(crop.w * scale);
  const h = Math.round(crop.h * scale);
  const sideways = turn % 2 === 1;
  const toScene = (x, y) => {
    const u = (x - crop.x) * scale;
    const v = (y - crop.y) * scale;
    // Counter-clockwise quarter turns, as seen on screen.
    if (turn === 1) return [v, w - u];
    if (turn === 2) return [w - u, h - v];
    if (turn === 3) return [h - v, u];
    return [u, v];
  };
  return { scale, cut: { w, h }, width: sideways ? h : w, height: sideways ? w : h, turn, gridPixels: cellPixels(recipe), toScene };
}

/**
 * The canvas transform that turns the cut picture the way `toScene` turns a
 * point, as `setTransform`'s six numbers. The renderer draws the cut through
 * it, so the picture and everything set down over it are turned by one rule.
 * @returns {[number, number, number, number, number, number]}
 */
export function turnMatrix(frame) {
  const { w, h } = frame.cut;
  if (frame.turn === 1) return [0, -1, 1, 0, 0, w];
  if (frame.turn === 2) return [-1, 0, 0, -1, w, h];
  if (frame.turn === 3) return [0, 1, -1, 0, h, 0];
  return [1, 0, 0, 1, 0, 0];
}

/**
 * A short key for the PICTURE a recipe draws — its page, crop, turn and scale,
 * and for a grid recipe every grid field the scale and lattice are read from,
 * and nothing else. It names the uploaded file, so a recipe whose picture
 * changed is rendered again instead of being laid over a stale file whose
 * pixels no longer agree with the outlines. A recipe without a grid keys
 * exactly as it always has, so its uploaded file is still found.
 */
export function pictureKey(recipe) {
  const c = recipe?.crop ?? {};
  const parts = [recipe?.page, c.x, c.y, c.w, c.h, (((Number(recipe?.turn) || 0) % 4) + 4) % 4, recipe?.feetPerPoint];
  const g = recipe?.grid;
  if (g) parts.push(g.family, !!g.even, g.box?.w, g.box?.h, g.centre?.[0], g.centre?.[1], g.pixels);
  return hash36(JSON.stringify(parts));
}

/** A flat `[x, y, x, y, …]` ring carried through a frame, rounded to whole pixels. */
export function ringToScene(ring, frame) {
  const out = [];
  for (let i = 0; i + 1 < ring.length; i += 2) {
    const [x, y] = frame.toScene(ring[i], ring[i + 1]);
    out.push(Math.round(x), Math.round(y));
  }
  return out;
}

/** Whether a point lies inside a flat `[x, y, …]` ring (even-odd). */
export function pointInRing(x, y, ring) {
  let inside = false;
  const n = Math.floor((ring?.length ?? 0) / 2);
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2];
    const yi = ring[i * 2 + 1];
    const xj = ring[j * 2];
    const yj = ring[j * 2 + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * The grid offsets whose cell centre lies inside a ring — how a zone's outline
 * is snapped to whole cells. Ring and centres are both in scene pixels; the
 * centres are the live grid's, supplied by the caller.
 * @param {number[]} ring flat `[x, y, …]`
 * @param {{i: number, j: number, x: number, y: number}[]} cells
 * @returns {{i: number, j: number}[]}
 */
export function offsetsInside(ring, cells) {
  return (cells ?? []).filter((c) => pointInRing(c.x, c.y, ring)).map(({ i, j }) => ({ i, j }));
}

/**
 * The stretch of a city's list that defers to the quarter, read off the row
 * section that names it (`r89-100`), or null when the pointer names no range.
 * @returns {{from: number, to: number}|null}
 */
export function bandOfSection(section) {
  const m = /^r0*(\d+)(?:-0*(\d+))?$/.exec(String(section ?? ""));
  if (!m) return null;
  const from = Number(m[1]);
  const to = m[2] ? Number(m[2]) : from;
  return from >= 1 && to >= from ? { from, to } : null;
}

/** The most a plain dice formula can total (`1d100`, `2d6+1`), or null for anything else. */
export function formulaMax(formula) {
  const m = /^\s*(\d*)d(\d+)\s*(?:([+-])\s*(\d+))?\s*$/i.exec(String(formula ?? ""));
  if (!m) return null;
  const dice = (Number(m[1]) || 1) * Number(m[2]);
  return dice + (m[3] ? (m[3] === "-" ? -1 : 1) * Number(m[4]) : 0);
}

/**
 * What a list adds once it is dark, read from its own shape: a list whose rows
 * run past what its die can throw can only reach them by an addition, and that
 * addition is how far past they run. Zero for a list its die covers, or whose
 * formula is not a plain throw.
 * @param {number[][]} ranges each row's `[low, high]`
 */
export function afterDarkShift(ranges, formula) {
  const top = formulaMax(formula);
  if (top == null) return 0;
  const highest = Math.max(0, ...(ranges ?? []).map((r) => Number(r?.[1]) || 0));
  return Math.max(0, highest - top);
}

/** Whether one of a page's image placements is the recipe's own, within tolerance. */
export function placementMatches(placements, anchor, tolerance = PLACEMENT_TOLERANCE) {
  if (!anchor) return false;
  return (placements ?? []).some((p) => ["x", "y", "w", "h"].every((k) => Math.abs(Number(p?.[k]) - Number(anchor[k])) <= tolerance));
}

/**
 * The image a crop is cut from: the smallest placement on the page that holds
 * the whole crop, or null when none does. Twin placements of one box (a picture
 * and its mask) are one answer.
 * @returns {{x: number, y: number, w: number, h: number}|null}
 */
export function placementHolding(placements, crop, slack = 0.5) {
  const holds = (p) =>
    p.x - slack <= crop.x && p.y - slack <= crop.y && p.x + p.w + slack >= crop.x + crop.w && p.y + p.h + slack >= crop.y + crop.h;
  const found = (placements ?? []).filter(holds).sort((a, b) => a.w * a.h - b.w * b.h)[0];
  if (!found) return null;
  const round = (n) => Math.round(n * 100) / 100;
  return { x: round(found.x), y: round(found.y), w: round(found.w), h: round(found.h) };
}

/**
 * What the recipe checks read of a book's compiled entries: each one's kind and
 * group, and for a list the row sections it carries. The compiler, the lint and
 * the verifier all build the view here, so they cannot disagree about it.
 * @param {Record<string, object>} entries a cookbook's `entries`
 */
export function recipeContext(entries) {
  return Object.fromEntries(
    Object.entries(entries ?? {}).map(([id, e]) => [
      id,
      { kind: e?.kind, meta: e?.meta, sections: e?.kind === "kind.rolltable" ? (e.fields?.rows?.paras ?? []).map((para) => para.section) : undefined },
    ]),
  );
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** Whether a page point lies inside a crop, edges included. */
const inCropOf = (crop) => (x, y) => x >= crop.x && x <= crop.x + crop.w && y >= crop.y && y <= crop.y + crop.h;

/**
 * Everything wrong with a recipe's `grid` block, as sentences; empty when it
 * holds together. The centre is checked against the crop only when a crop is
 * given, so the lint can ask before the crop itself is known to be sound.
 * @param {object} grid the recipe's `grid`
 * @param {{x: number, y: number, w: number, h: number}|null} [crop]
 */
export function gridProblems(grid, crop = null) {
  if (!grid || typeof grid !== "object" || Array.isArray(grid)) return ["grid must be an object"];
  const out = [];
  if (!RECIPE_GRID_FAMILIES.includes(grid.family)) out.push(`grid.family must be ${RECIPE_GRID_FAMILIES.join(", ")}`);
  if (grid.even !== undefined && typeof grid.even !== "boolean") out.push("grid.even must be true or false when given");
  if (!isNum(grid.box?.w) || !isNum(grid.box?.h) || !(grid.box.w > 0) || !(grid.box.h > 0)) out.push("grid.box needs positive w and h");
  const c = grid.centre;
  if (!Array.isArray(c) || c.length !== 2 || !c.every(isNum)) out.push("grid.centre must be [x, y]");
  else if (crop && !inCropOf(crop)(c[0], c[1])) out.push(`grid.centre (${c[0]}, ${c[1]}) lies outside the crop`);
  if (!isNum(grid.distance) || !(grid.distance > 0)) out.push("grid.distance must be a positive number");
  if (!Object.hasOwn(DISTANCE_UNITS, String(grid.units))) out.push(`grid.units must be one of ${Object.keys(DISTANCE_UNITS).join(", ")}`);
  if (grid.pixels !== undefined && !(Number.isInteger(grid.pixels) && grid.pixels >= MIN_GRID_PIXELS)) out.push(`grid.pixels must be a whole number of at least ${MIN_GRID_PIXELS} when given`);
  return out;
}

/**
 * Everything wrong with a recipe, as sentences; empty when it holds together.
 *
 * Asked by the compiler, the lint and the verifier over `recipeContext` of a
 * book's compiled entries — `{id: {kind, meta, sections?}}` is all the checks
 * read. On a map with quarters a place must stand inside the quarter its own
 * group names, because the quarter under a place is found by geometry at the
 * table and a place drawn over its neighbour would be priced as the
 * neighbour's; a map with no quarters has none to check. A place is a keyed
 * point of interest or a region site. `feetPerPoint` is required only of a
 * recipe with no `grid`.
 *
 * @param {object} recipe the row's `scene` block
 * @param {Record<string, {kind?: string, meta?: object, sections?: string[]}>} entries
 */
export function recipeProblems(recipe, entries = {}) {
  const out = [];
  const num = isNum;
  const crop = recipe?.crop ?? {};
  const cropOk = ["x", "y", "w", "h"].every((k) => num(crop[k])) && crop.w > 0 && crop.h > 0;
  if (!cropOk) out.push("crop needs numeric x, y and positive w, h");
  if ((recipe?.grid === undefined || recipe?.feetPerPoint !== undefined) && !(recipe?.feetPerPoint > 0)) out.push("feetPerPoint must be a positive number");
  if (recipe?.grid !== undefined) out.push(...gridProblems(recipe.grid, cropOk ? crop : null));
  if (recipe?.turn !== undefined && ![0, 1, 2, 3].includes(recipe.turn)) out.push("turn must be 0, 1, 2 or 3 quarter turns");
  if (recipe?.blockFeet !== undefined && !(recipe.blockFeet > 0)) out.push("blockFeet must be a positive number when given");
  if (out.length) return out;

  const inCrop = inCropOf(crop);
  const quarterOf = (id) => poiGroupOf(entries[id]?.meta?.group)?.district ?? null;

  const table = recipe.incidents?.table;
  if (table !== undefined) {
    if (entries[table]?.kind !== "kind.rolltable") out.push(`incidents.table "${table}" is not a roll table of this book`);
    const band = recipe.incidents?.band;
    if (band !== undefined) {
      if (!bandOfSection(band)) out.push(`incidents.band "${band}" names no range`);
      else if (entries[table]?.sections && !entries[table].sections.includes(band)) out.push(`incidents.band "${band}" is not a row of ${table}`);
    }
  }

  const districts = Array.isArray(recipe.districts) ? recipe.districts : [];
  const seenQuarters = new Set();
  districts.forEach((d, i) => {
    const where = `districts[${i}]`;
    const quarter = quarterOf(d?.place);
    if (!quarter || poiGroupOf(entries[d.place]?.meta?.group)?.kind !== "overview") out.push(`${where}.place "${d?.place}" is not a quarter's overview entry`);
    else if (seenQuarters.has(quarter)) out.push(`${where}.place "${d.place}" repeats a quarter`);
    else seenQuarters.add(quarter);
    if (d?.special !== undefined && entries[d.special]?.kind !== "kind.rolltable") out.push(`${where}.special "${d.special}" is not a roll table of this book`);
    if (d?.color !== undefined && !/^#[0-9a-f]{6}$/i.test(d.color)) out.push(`${where}.color must be a #rrggbb colour`);
    const ring = d?.outline;
    if (!Array.isArray(ring) || ring.length < 6 || ring.length % 2 || !ring.every(num)) out.push(`${where}.outline needs at least three numeric points`);
    else {
      for (let k = 0; k < ring.length; k += 2) {
        if (!inCrop(ring[k], ring[k + 1])) {
          out.push(`${where}.outline leaves the crop at (${ring[k]}, ${ring[k + 1]})`);
          break;
        }
      }
    }
  });

  const seenPlaces = new Set();
  (Array.isArray(recipe.places) ? recipe.places : []).forEach((p, i) => {
    const where = `places[${i}]`;
    const entry = entries[p?.id];
    const keyed = !!entry && ((isPoiEntry(entry) && poiGroupOf(entry.meta.group).kind !== "overview") || isRegionSite(entry));
    if (!keyed) return void out.push(`${where}.id "${p?.id}" is not a keyed place of this book`);
    if (seenPlaces.has(p.id)) return void out.push(`${where}.id "${p.id}" is placed twice`);
    seenPlaces.add(p.id);
    if (!Array.isArray(p.at) || p.at.length !== 2 || !p.at.every(num)) return void out.push(`${where}.at must be [x, y]`);
    if (!inCrop(p.at[0], p.at[1])) return void out.push(`${where} "${p.id}" stands outside the crop`);
    if (!districts.length) return;
    const own = quarterOf(p.id);
    const under = districts.filter((d) => Array.isArray(d?.outline) && pointInRing(p.at[0], p.at[1], d.outline)).map((d) => quarterOf(d.place));
    if (under.length !== 1 || under[0] !== own) {
      out.push(`${where} "${p.id}" belongs to ${own} and stands in ${under.length ? under.join(" and ") : "no quarter"}`);
    }
  });
  return out;
}

/**
 * Scene data for a recipe — the WHOLE map, as one create. Without a `grid` the
 * scene is gridless at one cell to a hundred feet, so a pixel is a foot and
 * every measure on the map reads in the book's own unit, and it is set up for
 * settlement travel. With one, the scene carries Foundry's lattice of that
 * family at the grid's cell size, distance and units, the shift that lays it
 * over the drawn cells, and is set up for journey travel; the picture is
 * scaled by `pixelsPerPoint` (`gridScale` of the grid unless the caller
 * measured one live). Sight and fog are off either way, because a printed map
 * is a plan the party reads and not a place its tokens see from. It is kept
 * out of the navigation bar: a map that arrives with a book is for the Judge
 * to put in front of a table, not something a running session finds added to
 * its bar.
 *
 * Three things here are forced by how core creates a scene. The picture goes
 * in as the scene's first LEVEL, spelled out: the older top-level `background`
 * is stripped from creation data before core's own carry-over reads it.
 * `active` is stated, because core activates a scene that does not say when
 * the world has none active — and an activated scene is drawn at once, under
 * whatever is still being written to it. And the quarters and places ride in
 * the same create, already linked, so there is no second write for a draw to
 * race.
 *
 * @param {object} p
 * @param {string} p.id cookbook id of the recipe
 * @param {string} p.book
 * @param {string} p.name what the scene is called in this world
 * @param {object} p.recipe the compiled recipe
 * @param {string} p.src path of the uploaded picture
 * @param {{tableUuid: string, afterDark: number, band: {from: number, to: number}|null}|null} [p.incidents]
 * @param {string} [p.locationUuid] the world place this map IS
 * @param {{id: string, name: string}} [p.level] core's id and name for a scene's first level
 * @param {object[]} [p.regions] `districtRegionData` rows
 * @param {object[]} [p.tokens] token sources, already placed
 * @param {object|null} [p.grid] the recipe's `grid`, unless the caller passes another
 * @param {number|null} [p.pixelsPerPoint] a grid recipe's scale, measured live
 * @param {number} [p.shiftX] the lattice shift, a grid recipe only
 * @param {number} [p.shiftY]
 * @param {string|null} [p.mapSystem] the travel system the map declares;
 *   `journey` for a grid recipe and `settlement` otherwise when not given
 */
export function sceneData({
  id, book, name, recipe, src, incidents = null, folderId = null, locationUuid = "", level = { id: "defaultLevel0000", name: "Level" },
  regions = [], tokens = [], grid = recipe?.grid ?? null, pixelsPerPoint = null, shiftX = 0, shiftY = 0, mapSystem = null,
}) {
  const frame = grid ? sceneFrame({ ...recipe, grid }, { pixelsPerPoint: pixelsPerPoint ?? gridScale({ grid }) }) : sceneFrame(recipe);
  return {
    name,
    folder: folderId,
    active: false,
    navigation: false,
    width: frame.width,
    height: frame.height,
    padding: 0,
    levels: [{ _id: level.id, name: level.name, background: { src, color: "#ffffff" } }],
    initialLevel: level.id,
    ...(grid
      ? {
        grid: {
          type: gridTypeFor(grid.family, !!grid.even),
          size: frame.gridPixels,
          distance: Number(grid.distance),
          units: DISTANCE_UNITS[grid.units]?.abbr ?? grid.units,
        },
        shiftX: Number(shiftX) || 0,
        shiftY: Number(shiftY) || 0,
      }
      : { grid: { type: 0, size: GRID_PIXELS, distance: GRID_PIXELS, units: "ft" } }),
    tokenVision: false,
    fog: { mode: 0 },
    regions,
    tokens: tokens.map((token) => ({ ...token, level: level.id })),
    flags: {
      [MODULE_ID]: {
        cookbook: { id, book, kind: SCENE_KIND },
        ...(locationUuid ? { [SCENE_LINK_FLAG]: locationUuid } : {}),
        battlemap: {
          calibrated: true,
          distance: grid ? Number(grid.distance) : GRID_PIXELS,
          autoScale: false,
          mapSystem: mapSystem ?? (grid ? "journey" : "settlement"),
          blockFeet: recipe.blockFeet > 0 ? recipe.blockFeet : null,
          ...(incidents?.tableUuid
            ? {
              incidents: {
                tableUuid: incidents.tableUuid,
                afterDark: incidents.afterDark || null,
                bandFrom: incidents.band?.from ?? null,
                bandTo: incidents.band?.to ?? null,
              },
            }
            : {}),
        },
      },
    },
  };
}

/**
 * Region data for one quarter: its outline carried into the frame, shown to
 * everyone in its own colour and locked against a stray drag, carrying the
 * District behaviour with the quarter's own list when the world holds it, and
 * linked to the quarter's place when the world holds that.
 *
 * @param {object} district one row of the recipe's `districts`
 * @param {object} frame `sceneFrame(recipe)`
 * @param {object} p
 * @param {string} p.name the quarter's name in this world
 * @param {string} p.districtType the District behaviour's sub-type id
 * @param {string} [p.specialTableUuid]
 * @param {number} [p.specialAfterDark] what the special list adds after dark
 *   (`afterDarkShift` of its own rows); written as stated, zero included, so
 *   the behaviour never shows a blank the map step would fill again
 * @param {string} [p.locationUuid] the world place this quarter IS
 */
export function districtRegionData(district, frame, {
  name, districtType, specialTableUuid = "", specialAfterDark = 0, locationUuid = "", visibility = 2,
}) {
  return {
    name,
    ...(district.color ? { color: district.color } : {}),
    visibility,
    locked: true,
    shapes: [{ type: "polygon", points: ringToScene(district.outline, frame), hole: false }],
    behaviors: [{
      type: districtType,
      name,
      system: specialTableUuid ? { specialTableUuid, specialAfterDark: Number(specialAfterDark) || 0 } : {},
    }],
    flags: { [MODULE_ID]: { cookbook: { place: district.place }, ...(locationUuid ? { [SCENE_LINK_FLAG]: locationUuid } : {}) } },
  };
}

/**
 * Where a place's token goes: its top-left corner, so that the token's middle
 * is the recipe's point. `size` is in cells of `gridPixels`, the frame's own
 * cell size unless given, so a pin is half a cell on any recipe's grid.
 * @returns {{x: number, y: number, width: number, height: number}}
 */
export function placeTokenAt(at, frame, { size = PLACE_TOKEN_SIZE, gridPixels = frame.gridPixels ?? GRID_PIXELS } = {}) {
  const [cx, cy] = frame.toScene(at[0], at[1]);
  const half = (size * gridPixels) / 2;
  return { x: Math.round(cx - half), y: Math.round(cy - half), width: size, height: size };
}

/** The boxes a zone row may lay over its printed figures, and the field and pattern each compiles to. */
export const ZONE_FIGURES = Object.freeze([
  Object.freeze({ at: "targetAt", field: "target", pattern: "throw" }),
  Object.freeze({ at: "dayAt", field: "dayThrows", pattern: "countWord" }),
  Object.freeze({ at: "nightAt", field: "nightThrows", pattern: "countWord" }),
]);

/**
 * Everything wrong with a zone row's `zone` block, as sentences; empty when it
 * holds together. `entries` is `recipeContext` of the ZONE'S OWN book: its
 * table must be one of that book's lists, while the scene it lies over may be
 * any book's and is resolved where every cookbook is in view.
 * @param {object} zone the row's `zone` block
 * @param {Record<string, {kind?: string}>} [entries]
 */
export function zoneProblems(zone, entries = {}) {
  const out = [];
  if (typeof zone?.scene !== "string" || !zone.scene) out.push("scene must name a scene recipe by id");
  if (zone?.table !== undefined && entries[zone.table]?.kind !== "kind.rolltable") out.push(`table "${zone?.table}" is not a roll table of this book`);
  const ring = zone?.outline;
  if (!Array.isArray(ring) || ring.length < 6 || ring.length % 2 || !ring.every(isNum)) out.push("outline needs at least three numeric points");
  if (zone?.cadence !== undefined && !ZONE_CADENCES.includes(zone.cadence)) out.push(`cadence must be one of ${ZONE_CADENCES.map((c) => JSON.stringify(c)).join(", ")}`);
  for (const { at } of ZONE_FIGURES) {
    const b = zone?.[at];
    if (b === undefined) continue;
    const edges = ["x0", "x1", "y0", "y1"].every((k) => isNum(b?.[k]));
    if (!Number.isInteger(b?.page) || b.page < 1 || !edges || !(b.x0 < b.x1) || !(b.y0 < b.y1)) out.push(`${at} needs a page and a box with x0 < x1 and y0 < y1`);
  }
  return out;
}

/** A hex's vertices, as `{x, y}` points or a flat list, flattened to whole pixels. */
const flatVertices = (vertices) => (vertices ?? []).flatMap((v) => (typeof v === "number" ? [v] : [v?.x, v?.y])).map((n) => Math.round(Number(n)));

/**
 * Region data for one zone: visible to the Judge only and locked against a
 * stray drag, carrying the encounter-zone behaviour with the zone's list and
 * figures, and flagged with the zone it answers to and the cells it covers.
 *
 * Its shapes are one polygon per snapped cell when `hexes` are given — the
 * offsets `offsetsInside` kept, with `cells` holding each one's vertices in
 * scene pixels, index for index, from the live grid — else the outline carried
 * through the frame.
 *
 * @param {object} zone the compiled row's `zone` block
 * @param {object} frame `sceneFrame` of the recipe it lies over
 * @param {object} p
 * @param {string} p.name the zone's name in this world
 * @param {string} [p.tableUuid] the imported list, when the world holds it
 * @param {number} [p.target] the encounter target read off the page
 * @param {string} [p.cadence] defaults to the row's own
 * @param {number} [p.dayThrows] read off the page; 0 inherits
 * @param {number} [p.nightThrows]
 * @param {{i: number, j: number}[]} [p.hexes]
 * @param {Array<{x: number, y: number}[]|number[]>} [p.cells]
 * @param {string} p.book the zone's book
 * @param {string} p.id the zone's cookbook id
 */
export function zoneRegionData(zone, frame, {
  name, tableUuid = "", target = 0, cadence = zone?.cadence ?? "", dayThrows = 0, nightThrows = 0, hexes = [], cells = [], book, id,
}) {
  const snapped = (hexes ?? []).map((h, k) => ({ i: h.i, j: h.j, points: flatVertices(cells?.[k]) }))
    .filter((h) => h.points.length >= 6 && h.points.every(Number.isFinite));
  const shapes = snapped.length
    ? snapped.map((h) => ({ type: "polygon", points: h.points, hole: false }))
    : [{ type: "polygon", points: ringToScene(zone.outline, frame), hole: false }];
  return {
    name,
    visibility: REGION_VISIBILITY_GAMEMASTER,
    locked: true,
    shapes,
    behaviors: [{
      type: ZONE_BEHAVIOR_TYPE,
      name,
      system: {
        tableUuid: tableUuid || null,
        encounterTarget: Number(target) || 0,
        journeyCadence: ZONE_CADENCES.includes(cadence) ? cadence : "",
        dayThrows: Number(dayThrows) || 0,
        nightThrows: Number(nightThrows) || 0,
      },
    }],
    flags: { [MODULE_ID]: { cookbook: { zone: id, book }, zoneHexes: snapped.map(({ i, j }) => ({ i, j })) } },
  };
}

/**
 * A compendium actor's source, made ready to be created again in the world.
 *
 * A scene link, a region link and a token all need a WORLD actor, while the
 * library keeps what it imports in compendiums, so the places and
 * organisations a scene stands on are brought across. Every reference to a
 * document that is in the world, or on its way there, is rewritten to the
 * world's form, so a quarter still sits inside its city and an organisation is
 * still seated in its quarter; a reference to anything staying behind (a person
 * on a roster) is left pointing at the library. The `worldCopy` flag tells a
 * copy from a document the Judge made, and `compendiumSource` says what it
 * is a copy of, exactly as a drag out of the compendium would.
 *
 * A copy is owned by NOBODY, and says so: a keyed place's notes are the
 * Judge's page, and a place that arrives with no ownership of its own is
 * shared with the table by the rule every new place is made under. The caller
 * must keep what is stated here (`fromCompendium`'s `clearOwnership: false`).
 *
 * @param {object} source the document's `toObject()`; not changed
 * @param {Map<string, string>} worldIds library id to world id, for every
 *   document that is in the world or on its way there — the same id when the
 *   copy keeps it, another when the world already held its own
 * @param {object} [p]
 * @param {string|null} [p.folderId] the world folder the copy is filed in
 * @param {string} [p.sourceUuid] the library document's uuid
 */
export function worldCopySource(source, worldIds, { folderId = null, sourceUuid = "" } = {}) {
  const remap = (uuid) => {
    const m = /^Compendium\.[^.]+\.[^.]+\.Actor\.([A-Za-z0-9]{16})$/.exec(String(uuid ?? ""));
    const to = m ? worldIds.get(m[1]) : null;
    return to ? `Actor.${to}` : (uuid ?? "");
  };
  const copy = JSON.parse(JSON.stringify(source ?? {}));
  copy.folder = folderId;
  copy.ownership = { default: OWNERSHIP_NONE };
  copy.flags = { ...(copy.flags ?? {}), [MODULE_ID]: { ...(copy.flags?.[MODULE_ID] ?? {}), worldCopy: true } };
  if (sourceUuid) copy._stats = { ...(copy._stats ?? {}), compendiumSource: sourceUuid };
  const sys = copy.system ?? {};
  for (const key of ["parentUuid", "seatUuid"]) {
    if (typeof sys[key] === "string" && sys[key]) sys[key] = remap(sys[key]);
  }
  for (const key of ["holdings", "relations"]) {
    if (Array.isArray(sys[key])) sys[key] = sys[key].map((row) => ({ ...row, uuid: remap(row?.uuid) }));
  }
  return copy;
}

/**
 * Is this world document a copy of an imported one, rather than an import? A
 * copy keeps the cookbook flag it was copied with, so the flag alone cannot
 * tell. A scene's copy carries `worldCopy`; a drag out of a world compendium
 * carries Foundry's `compendiumSource` into one; a sidebar duplicate carries
 * `duplicateSource`. The importer writes none of these on an import.
 */
export function isWorldCopy(doc) {
  if (doc?.flags?.[MODULE_ID]?.worldCopy) return true;
  const stats = doc?._stats ?? {};
  return String(stats.compendiumSource ?? "").startsWith("Compendium.world.") || !!stats.duplicateSource;
}
