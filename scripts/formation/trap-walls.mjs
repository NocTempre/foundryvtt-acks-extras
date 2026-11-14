/* global game, canvas, ui, fromUuid, Hooks, CONST */
import { MODULE_ID, TRAP_ITEM_TYPE } from "./constants.mjs";
import { STATES } from "./trap-rules.mjs";
import { chainWalls, pointSegmentDistance, segmentCrossing, segmentDistance } from "../lib/wall-geometry.mjs";
import {
  armWallPreset,
  clearWallLayer,
  controlledWalls,
  openWallData,
  regionFromWalls,
  setWallLayer,
  wallLayer,
  wallNear,
  wallSheetFields,
} from "../lib/wall-layers.mjs";
import { elementOf } from "../lib/util.mjs";

/**
 * Traps laid on walls: a trap is a layer over an existing wall (a door
 * included), never a wall of its own kind. A fresh trap line restricts nothing
 * and stops the party on detection instead; players see nothing while it is
 * armed and unfound, and a Judge sees a marker showing its state. `known` is
 * what the party has learned and outlives the state. See
 * docs/formation/MODEL.md, "Traps".
 *
 * The wall-layer mechanics (the dual flag read, the merge that can empty a
 * field, the all-NONE line, the drawing preset, the region a loop encloses)
 * live in `lib/wall-layers.mjs`, and the segment geometry in
 * `lib/wall-geometry.mjs`; both are re-exported here for the trap api and suite.
 */
export { chainWalls, controlledWalls, pointSegmentDistance, segmentCrossing, segmentDistance, wallNear };

/** Flag holding a wall's trap layer. Absent means "no trap on this wall". */
export const TRAP_FLAG = "trap";

/**
 * A wall's trap layer, resolved, or null when it carries none. Every field is
 * defaulted here, so a stored trap lacking a key reads the same everywhere.
 */
export function wallTrap(wall) {
  const f = wallLayer(wall, TRAP_FLAG);
  if (!f) return null;
  return {
    trapUuid: f.trapUuid ?? "",
    state: Object.values(STATES).includes(f.state) ? f.state : STATES.armed,
    repeatLock: f.repeatLock ?? {},
    // Who has spent their automatic hasty search, and at what level (`repeatLock` is Trapbreaking's).
    searchLock: f.searchLock ?? {},
    // Never inferred from the state.
    known: !!f.known,
  };
}

/** Does this wall carry a trap layer at all? */
export const isTrapWall = (wall) => !!wallTrap(wall);

/** Write the trap layer, merging the patch over what is there. */
export async function setWallTrap(wall, patch) {
  return setWallLayer(wall, TRAP_FLAG, patch);
}

/** Take the trap layer off a wall, leaving the wall itself as it was. */
export function clearWallTrap(wall) {
  return clearWallLayer(wall, TRAP_FLAG);
}

/**
 * The whole shape of a fresh tripwire: a wall that obstructs nothing, carrying
 * an armed trap layer. Shared by the wall `drawTrapWall` creates and the
 * wall-drawing preset.
 */
export function trapWallData({ trapUuid = "" } = {}) {
  return {
    ...openWallData(),
    flags: { [MODULE_ID]: { [TRAP_FLAG]: { trapUuid, state: STATES.armed, repeatLock: {} } } },
  };
}

/* -------------------------------------------- */
/*  Laying one down                             */
/* -------------------------------------------- */

/**
 * Add a trap layer to every selected wall — or, with nothing selected, arm the
 * wall-drawing tool so the next wall the Judge draws is a tripwire.
 *
 * An existing wall's movement, senses and door state are never altered. With
 * nothing selected it arms a preset and places nothing. A wall that already
 * carries a trap keeps its state; a newly named trap is still assigned.
 * See docs/formation/DECISIONS.md, "A trap is a wall PRESET, its marker is its control, and it gets no bucket".
 *
 * @param {object} [opts]
 * @param {string} [opts.trapUuid] the trap Item to assign at the same time
 * @returns {Promise<{added: number, skipped: number, armed: boolean}>}
 */
export async function layTrapOnSelection({ trapUuid = "" } = {}) {
  const walls = controlledWalls();
  if (!walls.length) {
    await armTrapPreset({ trapUuid });
    return { added: 0, skipped: 0, armed: true };
  }
  let added = 0;
  let skipped = 0;
  for (const wall of walls) {
    if (isTrapWall(wall)) {
      if (trapUuid) await setWallTrap(wall, { trapUuid });
      else skipped++;
      continue;
    }
    await setWallTrap(wall, { trapUuid, state: STATES.armed, repeatLock: {} });
    added++;
  }
  ui.notifications?.info(game.i18n.format("ACKS-FORMATION.traps.laid", { added, skipped }));
  return { added, skipped, armed: false };
}

/**
 * Make the tripwire the shape the wall tool draws, and hand the Judge that tool.
 *
 * A trap line is armed as a preset (`armWallPreset`) rather than placed. The
 * notification says whether the arming happened.
 */
export async function armTrapPreset({ trapUuid = "" } = {}) {
  const armed = await armWallPreset(trapWallData({ trapUuid }));
  if (armed) ui.notifications?.info(game.i18n.localize("ACKS-FORMATION.traps.presetArmed"));
  else ui.notifications?.warn(game.i18n.localize("ACKS-FORMATION.traps.presetUnavailable"));
}

/**
 * Place a fresh non-blocking tripwire across the middle of the view.
 *
 * One grid square wide, horizontal, snapped to the grid. The scene control arms
 * the drawing preset instead; this is the api's way to place one from a macro.
 */
export async function drawTrapWall({ trapUuid = "" } = {}) {
  const scene = canvas?.scene;
  if (!scene) return null;
  const gs = scene.grid.size;
  const c = canvas.stage.pivot;
  const x = Math.round((c?.x ?? scene.width / 2) / gs) * gs;
  const y = Math.round((c?.y ?? scene.height / 2) / gs) * gs;

  const [wall] = await scene.createEmbeddedDocuments("Wall", [
    { c: [x, y, x + gs, y], ...trapWallData({ trapUuid }) },
  ]);
  canvas.walls.get(wall.id)?.control({ releaseOthers: true });
  // Hand back the select tool: a drawing tool left active turns the next drag
  // into a fully blocking wall over the tripwire.
  ui.controls?.activate?.({ control: "walls", tool: "select" });
  ui.notifications?.info(game.i18n.localize("ACKS-FORMATION.traps.drew"));
  return wall;
}

/* -------------------------------------------- */
/*  Turning lines into an area                  */
/* -------------------------------------------- */

/**
 * Build a Trap Zone Region from the selected walls' outline.
 *
 * Works from any selected walls, trapped or not: they are the shape of the
 * area. The region restricts nothing; the Trap Zone behavior blocks no movement.
 *
 * @returns {Promise<RegionDocument|null>}
 */
export async function regionFromSelection({ trapUuid = "", name = "" } = {}) {
  const walls = controlledWalls();
  const { region, created, reason } = await regionFromWalls(walls, {
    name: name || game.i18n.localize("ACKS-FORMATION.traps.regionName"),
    color: "#a3312c",
    // The default shows a region to any player who opens the Regions control.
    visibility: CONST.REGION_VISIBILITY.GAMEMASTER,
    behaviorType: `${MODULE_ID}.trapZone`,
    behaviors: [
      {
        type: `${MODULE_ID}.trapZone`,
        name: game.i18n.localize("ACKS-FORMATION.traps.behaviorName"),
        system: { trapUuid, state: STATES.armed, repeatLock: {} },
      },
    ],
  });
  if (!region) {
    if (reason === "selectLoop" || reason === "notClosed") {
      ui.notifications?.warn(game.i18n.localize(`ACKS-FORMATION.traps.${reason}`));
    }
    return null;
  }
  // A reused region keeps running the tool twice harmless; a newly named trap is assigned.
  if (!created && trapUuid) {
    const behavior = region.behaviors.find((b) => b.type === `${MODULE_ID}.trapZone`);
    await behavior?.update({ "system.trapUuid": trapUuid });
  }

  // The trap moves from the lines to the area; left on both it would spring twice.
  let lifted = 0;
  for (const wall of walls) {
    if (!isTrapWall(wall)) continue;
    await clearWallTrap(wall);
    lifted++;
  }

  ui.notifications?.info(
    game.i18n.format(created ? "ACKS-FORMATION.traps.regionMade" : "ACKS-FORMATION.traps.regionReused", { lifted }),
  );
  return region;
}

/* -------------------------------------------- */
/*  Crossing one                                */
/* -------------------------------------------- */

/**
 * Every armed trap wall the party crossed on this move, nearest crossing first
 * (the order the party meets them; the first to go off stops it).
 */
export function trapWallsCrossed(scene, from, to) {
  const hits = [];
  for (const wall of scene?.walls ?? []) {
    const trap = wallTrap(wall);
    if (!trap || trap.state !== STATES.armed) continue;
    const at = segmentCrossing(from, to, wall.c);
    if (at) hits.push({ wall, trap, at });
  }
  return hits.sort((a, b) => a.at.t - b.at.t);
}

/* -------------------------------------------- */
/*  Assigning a trap by dragging one            */
/* -------------------------------------------- */

/**
 * The trap Item behind a drag payload, or null if the drop was something else.
 *
 * Takes the payload, so every drop target (a wall, its sheet, a region's
 * behavior sheet) asks the same question.
 */
export async function trapFromDrop(data) {
  if (data?.type !== "Item" || !data?.uuid) return null;
  const item = await fromUuid(data.uuid);
  return item?.type === TRAP_ITEM_TYPE ? item : null;
}

/**
 * Assign a trap to a wall, laying the trap layer if the wall has none; a drop
 * onto an untrapped wall does the whole job.
 */
export async function assignTrapToWall(wall, trap) {
  const existing = wallTrap(wall);
  await setWallTrap(wall, {
    trapUuid: trap.uuid,
    // Reassigning keeps a spent trap's state.
    state: existing?.state ?? STATES.armed,
    repeatLock: existing?.repeatLock ?? {},
  });
  ui.notifications?.info(game.i18n.format("ACKS-FORMATION.traps.assigned", { trap: trap.name }));
}

/**
 * Dropping a trap onto the map assigns it to the wall under the cursor.
 *
 * The hook always returns true: the handler is async, and a returned promise
 * would read as a truthy "handled" to core.
 */
export function installTrapDrop() {
  Hooks.on("dropCanvasData", (canvasRef, data) => {
    if (data?.type !== "Item" || !data?.uuid) return true;
    // Work is kicked off and the hook answers at once.
    (async () => {
      const trap = await trapFromDrop(data);
      if (!trap) return;
      const scene = canvasRef.scene;
      const reach = scene.grid.size;
      const wall = wallNear(scene, data.x, data.y, reach);
      if (!wall) {
        ui.notifications?.warn(game.i18n.localize("ACKS-FORMATION.traps.dropNoWall"));
        return;
      }
      await assignTrapToWall(wall, trap);
    })().catch((err) => console.error(`${MODULE_ID} | trap drop failed`, err));
    return true;
  });

  /**
   * The same drop on a wall's configuration sheet, which also shows the
   * assigned trap. Hung on `renderApplicationV2` and filtered by the document
   * edited, since a WallConfig is recognisable only by what it edits.
   */
  Hooks.on("renderApplicationV2", (app, element) => {
    if (!game.user.isGM) return;
    const wall = app?.document;
    // The wall palette renders this sheet over an unsaved preview wall with a
    // null id, which a trap write cannot land on.
    if (wall?.documentName !== "Wall" || !wall.id) return;
    const root = elementOf(element);
    if (!root) return;
    // The sheet re-renders on every field touched; do not append a second copy.
    if (root.querySelector(".acks-extras-trap-drop")) return;

    const trap = wallTrap(wall);
    const row = document.createElement("div");
    row.className = "form-group acks-extras-trap-drop";
    row.innerHTML = `<label>${game.i18n.localize("ACKS-FORMATION.traps.wallTrapLabel")}</label>
      <div class="form-fields"><span class="acks-extras-trap-drop-target">${
        trap?.trapUuid
          ? game.i18n.format("ACKS-FORMATION.traps.wallTrapSet", { state: game.i18n.localize(`ACKS-FORMATION.traps.state.${trap.state}`) })
          : game.i18n.localize("ACKS-FORMATION.traps.wallTrapNone")
      }</span></div>
      <p class="hint">${game.i18n.localize("ACKS-FORMATION.traps.wallTrapHint")}</p>`;

    row.addEventListener("dragover", (event) => event.preventDefault());
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      let data;
      try {
        data = JSON.parse(event.dataTransfer.getData("text/plain"));
      } catch {
        return;
      }
      trapFromDrop(data)
        .then((dropped) => (dropped ? assignTrapToWall(wall, dropped) : null))
        .then(() => app.render(false))
        .catch((err) => console.error(`${MODULE_ID} | trap drop failed`, err));
    });

    wallSheetFields(root).append(row);
  });
}

/* -------------------------------------------- */
/*  Scene controls                              */
/* -------------------------------------------- */

/**
 * Two tools on the Walls layer, beside the door helper: lay a trap along the
 * selected walls, or enclose the selected walls as a trap area. `createData`
 * makes the line tool a wall preset whose pip lights while it is armed.
 * See docs/formation/DECISIONS.md, "A trap is a wall PRESET, its marker is its control, and it gets no bucket".
 */
export function installTrapControls() {
  Hooks.on("getSceneControlButtons", (controls) => {
    const walls = controls.walls ?? controls.find?.((c) => c.name === "walls");
    if (!walls) return;
    const tools = walls.tools;
    const add = (tool) => {
      // Core 13+ keys tools by name; an array is still accepted.
      if (Array.isArray(tools)) tools.push(tool);
      else tools[tool.name] = tool;
    };
    // One handler per tool: a `button: true` tool given both `onChange` and
    // `onClick` fires both on a single press. `order` is set past core's tools
    // (an absent one sorts as NaN).
    add({
      name: "acksTrapLine",
      title: game.i18n.localize("ACKS-FORMATION.traps.toolLine"),
      icon: "fa-solid fa-triangle-exclamation",
      order: 20,
      button: true,
      visible: game.user.isGM,
      createData: trapWallData(),
      onChange: () => layTrapOnSelection(),
    });
    add({
      name: "acksTrapRegion",
      title: game.i18n.localize("ACKS-FORMATION.traps.toolRegion"),
      icon: "fa-solid fa-draw-polygon",
      order: 21,
      button: true,
      visible: game.user.isGM,
      onChange: () => regionFromSelection(),
    });
  });
}
