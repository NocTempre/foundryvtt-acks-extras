/* global game, ui, document, foundry, CONST, Hooks */
/**
 * Water: a river or a coast the Judge DREW, on any grid — a Wall that
 * restricts nothing, flagged as water, drawn with core's own wall tool the way
 * a road is (roads.mjs). A line answers what a hex cannot: a river runs along
 * and between cells, and a party is on it by how near its token stands to the
 * line. `move`/`sight`/`sound`/`light` are all NONE and it is not a door. The
 * hex topology takes no links from water: a river is not a road.
 *
 * See docs/battlemap/DECISIONS.md, "A river or a coast is a line."
 */
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import { elementOf, makeLoc } from "../lib/util.mjs";
import { pointSegmentDistance } from "../lib/wall-geometry.mjs";
import {
  armWallPreset,
  blocksMovement,
  controlledWalls,
  hasWallLayer,
  openWallData,
  setWallLayer,
  wallLayer,
  wallSheetFields,
  wallsFlagged,
} from "../lib/wall-layers.mjs";

const loc = makeLoc(LANG_PREFIX);

/** Flag holding a wall's water layer. Absent means "not water". */
export const WATER_FLAG = "water";

/** The kinds of water a line can be drawn as. */
export const WATER_KINDS = Object.freeze(["river", "coast"]);

/**
 * Whether a line of this kind is navigable when nobody has said: a river the
 * Judge drew at map scale is one a boat can follow, a coast is a shore. The
 * wall's own row overrides it per line.
 */
const navigableByDefault = (kind) => kind === "river";

/** A kind the module knows, or the first one. */
const kindOf = (kind) => (WATER_KINDS.includes(kind) ? kind : WATER_KINDS[0]);

/** A wall's water layer, resolved, or null when it carries none. */
export function wallWater(wall) {
  const f = wallLayer(wall, WATER_FLAG);
  if (!f) return null;
  const kind = kindOf(f.kind);
  return {
    kind,
    navigable: typeof f.navigable === "boolean" ? f.navigable : navigableByDefault(kind),
    name: f.name ?? "",
  };
}

/** Is this wall water? */
export const isWaterWall = (wall) => hasWallLayer(wall, WATER_FLAG);

/** Every water wall on a scene. */
export function waterWallsOf(scene) {
  return wallsFlagged(scene, WATER_FLAG);
}

/**
 * The whole shape of a fresh water line: a wall that obstructs nothing,
 * carrying a water layer. One function for the preset and for any wall made
 * by hand, so the two never drift; `door` is stated because the preset
 * persists, and a river armed after a secret door would otherwise inherit the
 * doorway.
 */
export function waterWallData({ kind = WATER_KINDS[0], navigable = null, name = "" } = {}) {
  const k = kindOf(kind);
  return {
    ...openWallData(),
    // `EDGE_DOOR_TYPES` is v14's name for the same numbers; the v13 spelling
    // still answers behind a deprecation proxy.
    door: (CONST.EDGE_DOOR_TYPES ?? CONST.WALL_DOOR_TYPES)?.NONE ?? 0,
    flags: {
      [MODULE_ID]: {
        [WATER_FLAG]: {
          kind: k,
          navigable: typeof navigable === "boolean" ? navigable : navigableByDefault(k),
          name: String(name ?? ""),
        },
      },
    },
  };
}

/**
 * The water line under a point, or null: the nearest within `reach`, which
 * defaults to half a grid cell — a token in the hex a river crosses is on it,
 * one a hex away is not. `navigable` considers only the lines a boat can
 * follow, so a coast nearer the point does not hide a river beside it.
 *
 * @returns {{wall: object, kind: string, navigable: boolean, name: string}|null}
 */
export function waterUnder(scene, point, reach = null, { navigable = false } = {}) {
  const limit = reach ?? (scene?.grid?.size ?? 100) / 2;
  const x = point?.x ?? 0;
  const y = point?.y ?? 0;
  let best = null;
  for (const wall of waterWallsOf(scene)) {
    const water = wallWater(wall);
    if (navigable && !water.navigable) continue;
    const dist = pointSegmentDistance(x, y, wall.c);
    if (dist <= limit && (!best || dist < best.dist)) best = { dist, wall, water };
  }
  return best ? { wall: best.wall, ...best.water } : null;
}

/** A kind's label. */
export function waterKindLabel(kind) {
  return loc(`water.${kindOf(kind)}`);
}

/* -------------------------------------------- */
/*  Drawing one                                 */
/* -------------------------------------------- */

/**
 * Make a water line of this kind the shape the wall tool draws, and hand the
 * Judge that tool. Shares core's one preset slot with the roads and the trap
 * line, so the notification names what is now armed.
 */
export async function armWaterPreset({ kind = WATER_KINDS[0], navigable = null, name = "" } = {}) {
  const armed = await armWallPreset(waterWallData({ kind, navigable, name }));
  if (armed) ui.notifications?.info(loc("water.presetArmed", { water: waterKindLabel(kind) }));
  else ui.notifications?.warn(loc("water.presetUnavailable"));
  return armed;
}

/**
 * Mark the selected walls as water — or, with nothing selected, arm the
 * preset. A wall's own properties are never altered (water is a layer); a
 * line that still restricts movement is counted, so the notification can say
 * the party cannot cross it. A name already on a line is kept, and so is its
 * say on boats while it keeps its kind; a line changing kind takes the new
 * kind's default.
 *
 * @returns {Promise<{added: number, updated: number, blocking: number, armed: boolean}>}
 */
export async function waterFromSelection({ kind = WATER_KINDS[0] } = {}) {
  const walls = controlledWalls();
  if (!walls.length) {
    await armWaterPreset({ kind });
    return { added: 0, updated: 0, blocking: 0, armed: true };
  }
  const k = kindOf(kind);
  let added = 0;
  let updated = 0;
  let blocking = 0;
  for (const wall of walls) {
    const had = wallWater(wall);
    const navigable = had?.kind === k ? had.navigable : navigableByDefault(k);
    await setWallLayer(wall, WATER_FLAG, { kind: k, navigable });
    if (had) updated++;
    else added++;
    if (blocksMovement(wall)) blocking++;
  }
  ui.notifications?.info(loc("water.marked", { added, updated }));
  if (blocking) ui.notifications?.warn(loc("water.blocking", { count: blocking }));
  return { added, updated, blocking, armed: false };
}

/* -------------------------------------------- */
/*  The wall's own row                          */
/* -------------------------------------------- */

/** Tell the wall sheet a water line is what it is editing. */
export function registerWaterHooks() {
  Hooks.on("renderApplicationV2", (app, element) => installWaterRow(app, element));
}

/**
 * The water row on a wall's configuration sheet: which kind, whether a boat
 * can follow it, and what it is called. The road row's pattern (roads.mjs):
 * hung on the generic render hook, filtered to a wall on a scene, written the
 * moment a field changes.
 */
function installWaterRow(app, element) {
  if (!game.user?.isGM) return;
  const wall = app?.document;
  // An id makes it a wall on the SCENE, not the palette's unsaved preview.
  if (wall?.documentName !== "Wall" || !wall.id) return;
  const root = elementOf(element);
  if (!root) return;
  if (root.querySelector(".acks-extras-water-row")) return;

  const water = wallWater(wall);
  const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
  const option = (value, label, selected) =>
    `<option value="${esc(value)}"${selected ? " selected" : ""}>${esc(label)}</option>`;
  const row = document.createElement("div");
  row.className = "form-group acks-extras-water-row";
  row.innerHTML = `<label>${esc(loc("water.wallLabel"))}</label>
    <div class="form-fields">
      <select class="acks-extras-water-kind" aria-label="${esc(loc("water.wallLabel"))}">
        ${option("", loc("water.notWater"), !water)}
        ${WATER_KINDS.map((k) => option(k, waterKindLabel(k), water?.kind === k)).join("")}
      </select>
      <label class="checkbox">
        <input type="checkbox" class="acks-extras-water-navigable"${water?.navigable ? " checked" : ""}>
        ${esc(loc("water.navigable"))}
      </label>
      <input type="text" class="acks-extras-water-name" value="${esc(water?.name)}"
             aria-label="${esc(loc("water.namePlaceholder"))}" placeholder="${esc(loc("water.namePlaceholder"))}">
    </div>
    <p class="hint">${esc(loc(water && blocksMovement(wall) ? "water.wallBlocks" : "water.wallHint"))}</p>`;

  const patch = async () => {
    const kind = row.querySelector(".acks-extras-water-kind").value;
    if (!kind) {
      await wall.unsetFlag(MODULE_ID, WATER_FLAG);
    } else {
      await setWallLayer(wall, WATER_FLAG, {
        kind,
        navigable: row.querySelector(".acks-extras-water-navigable").checked,
        name: row.querySelector(".acks-extras-water-name").value,
      });
    }
    app.render(false);
  };
  for (const sel of [".acks-extras-water-kind", ".acks-extras-water-navigable", ".acks-extras-water-name"]) {
    row.querySelector(sel).addEventListener("change", () => {
      patch().catch((err) => console.error(`${MODULE_ID} | water row failed`, err));
    });
  }

  wallSheetFields(root).append(row);
}

/* -------------------------------------------- */
/*  Scene controls                              */
/* -------------------------------------------- */

/**
 * One tool on the Walls layer: make the selected walls water. It lives beside
 * the road tool for the road tool's reason — leaving the Walls layer releases
 * the selection it acts on (roads.mjs, `installRoadControls`).
 */
export function installWaterControls() {
  Hooks.on("getSceneControlButtons", (controls) => {
    const walls = controls.walls ?? controls.find?.((c) => c.name === "walls");
    if (!walls) return;
    const tool = {
      name: "acksWaterFromSelection",
      title: loc("water.toolMark"),
      icon: "fa-solid fa-water",
      order: 23,
      button: true,
      visible: game.user.isGM,
      createData: waterWallData(),
      // ONE handler: a `button: true` tool given both `onChange` and `onClick`
      // has both called for a single press.
      onChange: () => waterFromSelection(),
    };
    if (Array.isArray(walls.tools)) walls.tools.push(tool);
    else walls.tools[tool.name] = tool;
  });
}
