/* global game, canvas, ui, document, CONST, Hooks */
/**
 * Roads: a street the Judge DREW, on any grid.
 *
 * A road is a Wall that restricts nothing, flagged as a road. That is the whole
 * design, and it replaces a hex-only link set that could not be drawn on a city
 * map at all. Three things fall out of it:
 *
 *  - **It is drawn with core's own wall tool**, so snapping is core's snapping:
 *    a hex grid offers vertices, side midpoints and centres — the thirteen
 *    nodes the hex topology already addresses — a square grid offers its
 *    vertices and midpoints, and a gridless map offers the free hand. Nothing
 *    here reimplements any of that.
 *  - **A bend is measured along its legs.** Distance between two points is
 *    taken over the road GRAPH, so a party that follows a curving street pays
 *    for the street and not for the chord across the block it went round.
 *  - **Where the party is standing is read off the map.** A road says whether
 *    it is an avenue or an alley, so the city's `where` is a fact rather than a
 *    picker the Judge has to keep in step with the token.
 *
 * A road never blocks anything: `move`, `sight`, `sound` and `light` are all
 * NONE and it is not a door. A wall that gained a movement restriction after
 * being flagged is a street the party cannot walk down, which is why the wall
 * sheet says so rather than silently correcting it — the Judge may have meant
 * the wall and forgotten the flag.
 *
 * What a surface is WORTH is printed and imported (the `travel` document's
 * `roads` table, which the vehicles derivation reads). A wall carries the KEY.
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
 * Every surface a road may carry HERE: the structural list above, plus whatever
 * this world's imported road table names.
 *
 * A reader whose book prints a surface this build never heard of drew a real
 * street with it, and the wall sheet has to be able to say so. The toolbar
 * still offers the structural few, because a tool per imported key would
 * rebuild the toolbar from the registry.
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
 * The street a road drawn on this scene is assumed to be.
 *
 * A city map's streets are avenues unless the Judge says otherwise, because
 * that is what most of a city is; anywhere else a road has no street at all —
 * a highway between two towns is neither an avenue nor an alley, and giving it
 * one would put the city's cadence on a road in open country.
 */
export function defaultStreet(scene) {
  return sceneTravelSystem(scene) === "settlement" ? "avenue" : null;
}

/* -------------------------------------------- */
/*  The network                                 */
/* -------------------------------------------- */

/**
 * How close two road ends must be to count as joined, in pixels.
 *
 * A DRAWING tolerance, not a rule: core's snapping puts consecutive ends within
 * a pixel or two, and a free hand on a large-scale map is further out. It grows
 * with the grid because a map drawn at 400 pixels to the block is dragged with
 * the same hand as one drawn at 50.
 */
export function joinTolerance(scene) {
  return Math.max(8, Math.round((scene?.grid?.size ?? 100) / 10));
}

/** Built networks by scene id, dropped whole when any wall on that scene changes. */
const graphs = new Map();

/**
 * The road network of a scene, as a graph.
 *
 * Memoised per scene: every step of every city turn measures against it, and
 * rebuilding it from the wall table each time would rebuild it several times
 * per drag. Any wall change on the scene drops the cache — including a change
 * to a wall that is not a road, because flagging one is exactly such a change.
 *
 * **A road that still restricts movement is not in the network.** The party
 * cannot cross such a wall, so a route measured along it would credit travel
 * the token can never perform. Marking one warns the Judge; the overlay keeps
 * drawing it, so the wall the warning is about can be found and opened up.
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

/** The road segments of a scene, in the shape the hex topology derives links from. */
export function roadSegmentsOf(scene) {
  return roadGraph(scene).edges.map((e) => ({ seg: e.seg, ...(e.meta.road ?? {}) }));
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
 * How far it is along the roads from one point to another, in feet.
 *
 * Null when EITHER end is more than a cell off the roads, when the two ends are
 * on networks that do not meet, or when the scene states no scale — every one of
 * which means the caller should fall back to the straight line and say so. A
 * road measurement that quietly became a chord is the defect this exists to fix;
 * a straight-line move quietly charged as street frontage is the same defect
 * pointing the other way.
 *
 * `offRoad` is the walk to and from the lines, kept apart from `along` so a
 * Judge can see that most of a move was across a courtyard.
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
  // BOTH ends, where the geometry asks for either. A move that starts on a
  // street and ends across open ground is a walk across open ground: charging
  // it along the street plus the trek off the street costs MORE than the
  // straight line the party could have walked instead, which is the defect this
  // function exists to fix, running backwards. The geometry answers for one end
  // so a caller can price stepping onto a road or off it; a turn of travel wants
  // only the route the party actually followed.
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
 * that tool.
 *
 * **One preset slot, shared with the trap line.** Core keeps a single setting
 * for what the wall tool creates, so arming a street disarms a tripwire and the
 * other way round. The notification names the road that is now armed, which is
 * the only way the Judge can tell which of the two is live.
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
 * Re-arm the road the wall tool is already set to draw, as an alley.
 *
 * A MODIFIER on the armed preset rather than a road kind of its own: pressing
 * paved and then alley means a paved alley, which is what a Judge who pressed
 * them in that order meant. With a trap line armed instead — the two share
 * core's one preset slot — there is no surface to keep, and the plainest one
 * answers.
 */
export async function armAlleyPreset() {
  const armed = currentWallPreset();
  const surface = wallRoad({ flags: armed?.flags })?.surface ?? ROAD_SURFACES[0];
  return armRoadPreset({ surface, street: "alley" });
}

/**
 * Mark the selected walls as roads — or, with nothing selected, arm the preset.
 *
 * **An existing wall's own properties are never altered.** A road is a layer,
 * the way a trap is: a Judge who flagged the wall of a building as a street
 * meant the line, and reaching in to open it up would knock a hole in the
 * building. What it does instead is COUNT the walls that still restrict
 * movement, so the notification can say a street has been declared that the
 * party cannot walk down.
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
 * road is what it is editing.
 *
 * The invalidation is keyed on the wall's own scene, not on the viewed one: a
 * Judge editing walls on a scene they are not looking at is ordinary, and a
 * stale graph would measure the next turn against the streets as they were.
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
 * street, and what it is called.
 *
 * Hung on the generic render hook and filtered, which is how every other sheet
 * injection in this repo is done: the per-class render hooks stop firing when
 * core reshuffles an application's class hierarchy, and a wall's sheet is only
 * recognisable by what it is editing anyway.
 *
 * The fields write immediately rather than on submit, because the sheet's own
 * submit handler knows nothing about a flag this module added.
 */
function installRoadRow(app, element) {
  if (!game.user?.isGM) return;
  const wall = app?.document;
  if (wall?.documentName !== "Wall") return;
  const root = element instanceof HTMLElement ? element : element?.[0];
  if (!root) return;
  // Re-rendering appends a second copy otherwise, and the sheet re-renders on
  // every field the Judge touches.
  if (root.querySelector(".acks-extras-road-row")) return;

  const road = wallRoad(wall);
  const option = (value, label, selected) =>
    `<option value="${value}"${selected ? " selected" : ""}>${label}</option>`;
  const row = document.createElement("div");
  row.className = "form-group acks-extras-road-row";
  row.innerHTML = `<label>${loc("routes.wallLabel")}</label>
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
      <input type="text" class="acks-extras-road-name" value="${road?.name ?? ""}"
             placeholder="${loc("routes.namePlaceholder")}">
    </div>
    <p class="hint">${loc(road && blocksMovement(wall) ? "routes.wallBlocks" : "routes.wallHint")}</p>`;

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
