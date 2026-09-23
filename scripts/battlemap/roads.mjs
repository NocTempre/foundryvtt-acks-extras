/* global game, canvas, ui, document, foundry, CONST, Hooks */
/**
 * Roads: a street the Judge DREW, on any grid — a Wall that restricts
 * nothing, flagged as a road. Drawn with core's own wall tool (its own
 * snapping); a bend is measured along the road GRAPH, not the chord; the
 * street type (avenue/alley) is read off the wall, not a separate picker.
 * `move`/`sight`/`sound`/`light` are all NONE and it is not a door — a wall
 * that gained a restriction after being flagged is reported, never silently
 * corrected. What a surface is WORTH is printed and imported (`travel`
 * document's `roads` table); a wall carries only the KEY.
 *
 * See docs/battlemap/DECISIONS.md, "A road is a wall, on every grid."
 */
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import { makeLoc, locOr } from "../lib/util.mjs";
import { sceneFeetPerCell } from "../lib/distance-units.mjs";
import { joinSegments, pathLengthAlong } from "../lib/wall-geometry.mjs";
import {
  armWallPreset,
  blocksMovement,
  controlledWalls,
  currentWallPreset,
  hasWallLayer,
  openWallData,
  setWallLayer,
  wallLayer,
  wallNear,
  wallSheetFields,
  wallsFlagged,
} from "../lib/wall-layers.mjs";
import { ROAD_KINDS, TRAVEL_DOC, readTable } from "../vehicles/vehicle-speed.mjs";
import { sceneTravelSystem } from "./scene-setup.mjs";

const loc = makeLoc(LANG_PREFIX);

/** Flag holding a wall's road layer. Absent means "not a road". */
export const ROAD_FLAG = "road";

/**
 * The surfaces a road can be drawn as.
 *
 * The vehicles feature's own list, less `none` — which is the ABSENCE of a
 * road and cannot be a road's surface. A world whose imported `roads` table
 * names others may use those too (`roadSurfaceKeys`); these are the ones the
 * toolbar offers.
 */
export const ROAD_SURFACES = Object.freeze(ROAD_KINDS.filter((k) => k !== "none"));

/**
 * Every surface a road may carry HERE: the structural list above, plus
 * whatever this world's imported road table names — the wall sheet must be
 * able to name a surface the toolbar itself only offers the structural few of.
 */
export function roadSurfaceKeys() {
  const imported = Object.keys(readTable(TRAVEL_DOC, "roads") ?? {}).filter((k) => k && k !== "none");
  return [...new Set([...ROAD_SURFACES, ...imported])];
}

/** A surface's label: translated where the module names it, the key itself otherwise. */
export function roadSurfaceLabel(key) {
  return locOr(`${LANG_PREFIX}.routes.${key}`, key);
}

/**
 * The two kinds of street a road can be.
 *
 * The city's own `where` vocabulary owns what each MEANS — how often the street
 * throws, what an alley does to a reaction. A road only says which it is.
 */
export const ROAD_STREETS = Object.freeze(["avenue", "alley"]);

/**
 * A wall's road layer, resolved, or null when it carries none.
 *
 * An unknown surface is kept rather than corrected: a world that imported road
 * kinds this build does not list still drew real streets, and silently calling
 * one earthen would price it wrong.
 */
export function wallRoad(wall) {
  const f = wallLayer(wall, ROAD_FLAG);
  if (!f) return null;
  return {
    surface: f.surface || ROAD_SURFACES[0],
    street: ROAD_STREETS.includes(f.street) ? f.street : null,
    name: f.name ?? "",
  };
}

/** Is this wall a road? */
export const isRoadWall = (wall) => hasWallLayer(wall, ROAD_FLAG);

/** Every road wall on a scene. */
export function roadWallsOf(scene) {
  return wallsFlagged(scene, ROAD_FLAG);
}

/**
 * The whole shape of a fresh road: a wall that obstructs nothing, carrying a
 * road layer.
 *
 * One function because it is wanted in two places that must not drift — the
 * wall a conversion creates itself, and the drawing PRESET the Judge draws
 * with. `door` is stated because the preset persists: a road armed after a
 * secret door was would otherwise inherit the doorway.
 */
export function roadWallData({ surface = ROAD_SURFACES[0], street = null, name = "" } = {}) {
  return {
    ...openWallData(),
    // `EDGE_DOOR_TYPES` is v14's name for the same numbers; the v13 spelling
    // still answers behind a deprecation proxy.
    door: (CONST.EDGE_DOOR_TYPES ?? CONST.WALL_DOOR_TYPES)?.NONE ?? 0,
    flags: { [MODULE_ID]: { [ROAD_FLAG]: { surface, street, name } } },
  };
}

/**
 * The street a road drawn on this scene is assumed to be: avenue on a
 * settlement-mode scene, else none — a highway in open country is neither.
 */
export function defaultStreet(scene) {
  return sceneTravelSystem(scene) === "settlement" ? "avenue" : null;
}

/* -------------------------------------------- */
/*  The network                                 */
/* -------------------------------------------- */

/**
 * How close two road ends must be to count as joined, in pixels — a DRAWING
 * tolerance, not a rule. Grows with the grid size, since a free hand is
 * further out on a large-scale map than a small one.
 */
export function joinTolerance(scene) {
  return Math.max(8, Math.round((scene?.grid?.size ?? 100) / 10));
}

/** Built networks by scene id, dropped whole when any wall on that scene changes. */
const graphs = new Map();

/**
 * The road network of a scene, as a graph. Memoised per scene (any wall
 * change drops the cache, including a non-road wall — flagging one is such a
 * change). Excludes a road that still restricts movement — the party cannot
 * cross it, so measuring along it would credit travel it cannot perform; the
 * overlay still draws it so the Judge can find and open it up.
 */
export function roadGraph(scene) {
  if (!scene?.id) return joinSegments([], 8);
  const cached = graphs.get(scene.id);
  if (cached) return cached;
  const graph = joinSegments(
    roadWallsOf(scene)
      .filter((wall) => !blocksMovement(wall))
      .map((wall) => ({ c: wall.c, road: wallRoad(wall), wallId: wall.id })),
    joinTolerance(scene),
  );
  graphs.set(scene.id, graph);
  return graph;
}

/** Forget a scene's built network, or every scene's. */
export function invalidateRoadGraph(sceneId = null) {
  if (sceneId) graphs.delete(sceneId);
  else graphs.clear();
}

/**
 * A graph's roads as the LINES they were drawn as — one entry per drawn
 * line, each carrying that line whole.
 *
 * Joining cuts a line at every junction, so one street stands in `edges`
 * once per stretch; its pieces share a single `meta` object (identity is
 * that OBJECT, never a field on it — `joinSegments` guarantees the
 * reference, not an id). Reassembled here rather than downstream: a hex
 * crossing reads consecutive samples along one line, and pieces stepped from
 * their own ends derive a different run of hexes than the whole line would;
 * a street reported once per piece is also several streets to a caller
 * counting them. An entry with no whole line (`meta` empty) stands as the
 * edge it already is.
 *
 * @param {object} graph from `joinSegments`
 * @returns {Array<{seg: number[], surface?: string, street?: string|null,
 *   name?: string}>}
 */
export function roadSegmentsFromGraph(graph) {
  const segments = [];
  const seen = new Set();
  for (const edge of graph?.edges ?? []) {
    const meta = edge?.meta;
    if (meta?.c) {
      if (seen.has(meta)) continue;
      seen.add(meta);
      segments.push({ seg: meta.c, ...(meta.road ?? {}) });
    } else {
      segments.push({ seg: edge?.seg, ...(meta?.road ?? {}) });
    }
  }
  return segments;
}

/** The road segments of a scene, in the shape the hex topology derives links from. */
export function roadSegmentsOf(scene) {
  return roadSegmentsFromGraph(roadGraph(scene));
}

/**
 * The road under a point, or null.
 *
 * `reach` defaults to half a grid cell: standing in the middle of a street
 * counts as being on it, standing a block away does not.
 */
export function roadUnder(scene, point, reach = null) {
  const limit = reach ?? (scene?.grid?.size ?? 100) / 2;
  const wall = wallNear(scene, point?.x ?? 0, point?.y ?? 0, limit, ROAD_FLAG);
  if (!wall) return null;
  return { wall, ...wallRoad(wall) };
}

/** Feet per pixel on this scene, or 0 when the scene states no scale. */
function feetPerPixel(scene) {
  const size = scene?.grid?.size;
  const feet = sceneFeetPerCell(scene);
  return size > 0 && feet > 0 ? feet / size : 0;
}

/**
 * How far it is along the roads from one point to another, in feet. Null
 * when either end is more than a cell off the roads, the two ends are on
 * networks that do not meet, or the scene states no scale — the caller then
 * falls back to the straight line. `offRoad` (the walk to/from the lines) is
 * kept apart from `along` so a Judge can see how much of a move crossed
 * open ground.
 *
 * @returns {{feet: number, along: number, offRoad: number, roads: string[],
 *   street: string|null}|null}
 */
export function roadDistance(scene, from, to) {
  const perPixel = feetPerPixel(scene);
  if (!perPixel) return null;
  const graph = roadGraph(scene);
  if (!graph.edges.length) return null;
  // Reach is one grid cell: a party within a cell of a street is on it. That is
  // geometry — how big a cell is here is the map's business.
  const reach = scene.grid.size;
  const walk = pathLengthAlong(graph, { from, to, reach });
  if (!walk) return null;
  // BOTH ends, where the geometry asks for either: a move from a street across
  // open ground must not charge the street plus the trek off it. The geometry
  // itself answers for one end, for a caller pricing just stepping on/off a road.
  if (walk.offRoadFrom > reach || walk.offRoadTo > reach) return null;

  const offRoad = walk.offRoadFrom + walk.offRoadTo;
  const roads = walk.edges.map((e) => graph.edges[e]?.meta?.road?.surface).filter(Boolean);
  // The street the walk ENDED on, because that is where the party now stands.
  const last = graph.edges[walk.edges[walk.edges.length - 1]]?.meta?.road;
  return {
    feet: (walk.along + offRoad) * perPixel,
    along: walk.along * perPixel,
    offRoad: offRoad * perPixel,
    roads: [...new Set(roads)],
    street: last?.street ?? null,
  };
}

/* -------------------------------------------- */
/*  Drawing one                                 */
/* -------------------------------------------- */

/**
 * Make a road of this kind the shape the wall tool draws, and hand the Judge
 * that tool. Shares core's one preset slot with the trap line — arming a
 * street disarms a tripwire — so the notification names what is now armed.
 */
export async function armRoadPreset({ surface = ROAD_SURFACES[0], street = undefined, name = "" } = {}) {
  const scene = canvas?.scene;
  const armed = await armWallPreset(
    roadWallData({ surface, street: street === undefined ? defaultStreet(scene) : street, name }),
  );
  const label = roadSurfaceLabel(surface);
  if (armed) ui.notifications?.info(loc("routes.presetArmed", { road: label }));
  else ui.notifications?.warn(loc("routes.presetUnavailable"));
  return armed;
}

/**
 * Re-arm the road the wall tool is already set to draw, as an alley — a
 * MODIFIER on the armed preset (paved, then alley, means a paved alley).
 * With a trap line armed instead, there is no surface to keep and the
 * plainest one answers.
 */
export async function armAlleyPreset() {
  const armed = currentWallPreset();
  const surface = wallRoad({ flags: armed?.flags })?.surface ?? ROAD_SURFACES[0];
  return armRoadPreset({ surface, street: "alley" });
}

/**
 * Mark the selected walls as roads — or, with nothing selected, arm the
 * preset. An existing wall's own properties are never altered (a road is a
 * layer, like a trap); it counts walls that still restrict movement instead,
 * so the notification can warn of a street the party cannot walk down.
 *
 * @returns {Promise<{added: number, updated: number, blocking: number, armed: boolean}>}
 */
export async function roadFromSelection({ surface = ROAD_SURFACES[0], street = undefined } = {}) {
  const walls = controlledWalls();
  if (!walls.length) {
    await armRoadPreset({ surface, street });
    return { added: 0, updated: 0, blocking: 0, armed: true };
  }
  const scene = canvas?.scene;
  const chosen = street === undefined ? defaultStreet(scene) : street;
  let added = 0;
  let updated = 0;
  let blocking = 0;
  for (const wall of walls) {
    const had = isRoadWall(wall);
    await setWallLayer(wall, ROAD_FLAG, { surface, street: chosen });
    if (had) updated++;
    else added++;
    if (blocksMovement(wall)) blocking++;
  }
  ui.notifications?.info(loc("routes.marked", { added, updated }));
  if (blocking) ui.notifications?.warn(loc("routes.blocking", { count: blocking }));
  return { added, updated, blocking, armed: false };
}

/* -------------------------------------------- */
/*  Keeping the network current                 */
/* -------------------------------------------- */

/**
 * Drop the built network whenever a wall changes, and tell the wall sheet a
 * road is what it is editing. Keyed on the wall's own scene, not the viewed
 * one — a Judge may edit walls on a scene they are not looking at.
 */
export function registerRoadHooks() {
  for (const hook of ["createWall", "updateWall", "deleteWall"]) {
    Hooks.on(hook, (doc) => invalidateRoadGraph(doc?.parent?.id ?? null));
  }
  // A scene's walls are replaced wholesale by an import or a reset, and the
  // canvas is redrawn for it without a per-wall hook firing.
  Hooks.on("canvasReady", () => invalidateRoadGraph());
  Hooks.on("renderApplicationV2", (app, element) => installRoadRow(app, element));
}

/**
 * The road row on a wall's own configuration sheet: which surface, which
 * street, and what it is called. Hung on the generic render hook and
 * filtered — the family's standard sheet-injection pattern, since a wall's
 * sheet is only recognisable by what it is editing. Fields write immediately;
 * the sheet's own submit handler knows nothing about a flag this module added.
 */
function installRoadRow(app, element) {
  if (!game.user?.isGM) return;
  const wall = app?.document;
  // An id makes it a wall on the SCENE, not the palette's unsaved preview
  // document (id null) — writing a flag there throws and the picker springs
  // back on the next re-render.
  if (wall?.documentName !== "Wall" || !wall.id) return;
  const root = element instanceof HTMLElement ? element : element?.[0];
  if (!root) return;
  // Re-rendering appends a second copy otherwise, and the sheet re-renders on
  // every field the Judge touches.
  if (root.querySelector(".acks-extras-road-row")) return;

  const road = wallRoad(wall);
  // Assembled as markup, so everything interpolated is escaped — a name
  // holding a quote character must not close the attribute early. Imported
  // surface keys and their labels are no more trusted than a typed name.
  const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
  const option = (value, label, selected) =>
    `<option value="${esc(value)}"${selected ? " selected" : ""}>${esc(label)}</option>`;
  const row = document.createElement("div");
  row.className = "form-group acks-extras-road-row";
  row.innerHTML = `<label>${esc(loc("routes.wallLabel"))}</label>
    <div class="form-fields">
      <select class="acks-extras-road-surface">
        ${option("", loc("routes.notARoad"), !road)}
        ${roadSurfaceKeys().map((k) => option(k, roadSurfaceLabel(k), road?.surface === k)).join("")}
      </select>
      <select class="acks-extras-road-street">
        ${option("", loc("routes.streetNone"), !road?.street)}
        ${ROAD_STREETS.map((k) =>
    option(k, loc(`routes.street.${k}`), road?.street === k)).join("")}
      </select>
      <input type="text" class="acks-extras-road-name" value="${esc(road?.name)}"
             placeholder="${esc(loc("routes.namePlaceholder"))}">
    </div>
    <p class="hint">${esc(loc(road && blocksMovement(wall) ? "routes.wallBlocks" : "routes.wallHint"))}</p>`;

  const patch = async () => {
    const surface = row.querySelector(".acks-extras-road-surface").value;
    if (!surface) {
      await wall.unsetFlag(MODULE_ID, ROAD_FLAG);
    } else {
      await setWallLayer(wall, ROAD_FLAG, {
        surface,
        street: row.querySelector(".acks-extras-road-street").value || null,
        name: row.querySelector(".acks-extras-road-name").value,
      });
    }
    app.render(false);
  };
  for (const sel of [".acks-extras-road-surface", ".acks-extras-road-street", ".acks-extras-road-name"]) {
    row.querySelector(sel).addEventListener("change", () => {
      patch().catch((err) => console.error(`${MODULE_ID} | road row failed`, err));
    });
  }

  wallSheetFields(root).append(row);
}

/* -------------------------------------------- */
/*  Scene controls                              */
/* -------------------------------------------- */

/**
 * One tool on the Walls layer: make the selected walls roads.
 *
 * **The Walls layer is where it lives**, beside the trap tools and for the same
 * reason: leaving a placeables layer releases everything selected on it, so a
 * Roads control of its own would empty the wall selection at the moment it
 * opened — and a selected wall is what this tool acts on. The road PRESETS live
 * on the battlemap group with the rest of map preparation, because arming one
 * is map prep rather than an edit to a wall that already exists.
 */
export function installRoadControls() {
  Hooks.on("getSceneControlButtons", (controls) => {
    const walls = controls.walls ?? controls.find?.((c) => c.name === "walls");
    if (!walls) return;
    const tool = {
      name: "acksRoadFromSelection",
      title: loc("routes.toolMark"),
      icon: "fa-solid fa-road",
      order: 22,
      button: true,
      visible: game.user.isGM,
      createData: roadWallData(),
      // ONE handler. A `button: true` tool given both `onChange` and `onClick`
      // has both called for a single press.
      onChange: () => roadFromSelection(),
    };
    // v13+ hands the tools over as an object keyed by name; older builds as an
    // array. Both shapes are still in the wild across the family's worlds.
    if (Array.isArray(walls.tools)) walls.tools.push(tool);
    else walls.tools[tool.name] = tool;
  });
}
