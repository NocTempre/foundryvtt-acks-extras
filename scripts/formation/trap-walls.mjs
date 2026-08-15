/* global game, canvas, ui, fromUuid, Hooks, CONST */
import { MODULE_ID, TRAP_ITEM_TYPE } from "./constants.mjs";
import { STATES } from "./trap-rules.mjs";

/**
 * Traps laid on WALLS: a tripwire across a corridor, a scything blade in a 10'
 * line, a needle in a door handle.
 *
 * A trap is a **layer over an existing wall**, never a wall of its own kind.
 * That is the whole design: the Judge draws the corridor once, and a trap goes
 * onto the segment that is already there — including a door, which is where the
 * book puts its most famous trap. Nothing about the wall's own job changes.
 *
 * **Non-blocking by default.** A trap line the Judge drew fresh restricts
 * nothing: movement, sight and sound pass through it exactly as they did
 * before, because a tripwire is not a barrier. What it does instead is STOP the
 * party when it is detected — the crossing is the event, and the party halts on
 * it rather than walking on obliviously.
 *
 * **Seen the way a secret door is seen.** Players are shown nothing at all
 * while the trap is armed and unfound; a Judge sees a marker for it, and that
 * marker says which state it is in — armed, found, disarmed, spent — the same
 * way a discovered secret door goes on to show whether it is open or shut.
 */

/** Flag holding a wall's trap layer. Absent means "no trap on this wall". */
export const TRAP_FLAG = "trap";

/**
 * A wall's trap layer, or null when it carries none.
 *
 * Read raw as well as through `getFlag`, matching the door helper: `getFlag`
 * throws for an inactive scope while the data it wrote persists on the wall.
 */
export function wallTrap(wall) {
  const f = wall?.getFlag?.(MODULE_ID, TRAP_FLAG) ?? wall?.flags?.[MODULE_ID]?.[TRAP_FLAG] ?? null;
  if (!f) return null;
  return {
    trapUuid: f.trapUuid ?? "",
    state: Object.values(STATES).includes(f.state) ? f.state : STATES.armed,
    repeatLock: f.repeatLock ?? {},
    // The restrictions laying the trap suppressed, to be put back when it goes.
    restore: f.restore ?? null,
  };
}

/** Does this wall carry a trap layer at all? */
export const isTrapWall = (wall) => !!wallTrap(wall);

/** Write the trap layer, merging over what is there. */
export async function setWallTrap(wall, patch) {
  return wall.setFlag(MODULE_ID, TRAP_FLAG, { ...(wallTrap(wall) ?? {}), ...patch });
}

/**
 * Take the trap layer off a wall, putting back whatever the trap suppressed.
 *
 * A trap line the Judge drew is a wall that was opened up to lay the trap on
 * (below); removing the trap has to close it again, or the corridor keeps a
 * silent hole where a trap used to be.
 */
export async function clearWallTrap(wall) {
  const restore = wallTrap(wall)?.restore;
  if (restore) await wall.update(restore);
  return wall.unsetFlag(MODULE_ID, TRAP_FLAG);
}

/**
 * Open a wall up so the trap on it obstructs nothing.
 *
 * A tripwire is not a barrier. The Judge draws a wall segment because that is
 * the only way to say "across here", and the trap tool then has to undo the
 * one thing a wall does — otherwise laying a trap across a corridor walls the
 * corridor off, and the party cannot reach the trap to spring it.
 *
 * **A door is left exactly as it is.** The book's most famous trap is a needle
 * in a door handle, and a trapped door has to go on being a door: it still
 * blocks, still opens, still takes a bash. The trap rides along.
 *
 * What was suppressed is recorded so `clearWallTrap` can put it back — a wall
 * quietly stripped of its restrictions and never restored is a hole nobody
 * knows they made.
 */
function openingPatch(wall) {
  if (Number(wall.door) > 0) return null; // a door keeps every restriction
  const none = CONST.WALL_SENSE_TYPES.NONE;
  const patch = {};
  const restore = {};
  for (const [key, value] of Object.entries({
    move: CONST.WALL_MOVEMENT_TYPES.NONE,
    sight: none,
    sound: none,
    light: none,
  })) {
    if (wall[key] !== value) {
      patch[key] = value;
      restore[key] = wall[key];
    }
  }
  return Object.keys(patch).length ? { patch, restore } : null;
}

/* -------------------------------------------- */
/*  Laying one down                             */
/* -------------------------------------------- */

/** The walls the Judge currently has selected, as documents. */
export function controlledWalls() {
  return (canvas?.walls?.controlled ?? []).map((w) => w.document).filter(Boolean);
}

/**
 * Add a trap layer to every selected wall.
 *
 * Deliberately indiscriminate about what kind of wall it is: an ordinary
 * segment becomes a tripwire, a door becomes a trapped door, and a wall that
 * already carries a trap is left as it is rather than being reset to armed —
 * re-running the tool must not re-arm a trap the party already dealt with.
 *
 * @param {object} [opts]
 * @param {string} [opts.trapUuid] the trap Item to assign at the same time
 * @returns {Promise<{added: number, skipped: number}>}
 */
export async function layTrapOnSelection({ trapUuid = "" } = {}) {
  const walls = controlledWalls();
  if (!walls.length) {
    ui.notifications?.warn(game.i18n.localize("ACKS-FORMATION.traps.selectWalls"));
    return { added: 0, skipped: 0 };
  }
  let added = 0;
  let skipped = 0;
  for (const wall of walls) {
    if (isTrapWall(wall)) {
      // Already trapped. Assigning a NEW trap to it is a deliberate act and is
      // honoured; re-running the tool with nothing to assign is not.
      if (trapUuid) await setWallTrap(wall, { trapUuid });
      else skipped++;
      continue;
    }
    const opening = openingPatch(wall);
    if (opening) await wall.update(opening.patch);
    await setWallTrap(wall, {
      trapUuid,
      state: STATES.armed,
      repeatLock: {},
      restore: opening?.restore ?? null,
    });
    added++;
  }
  ui.notifications?.info(game.i18n.format("ACKS-FORMATION.traps.laid", { added, skipped }));
  return { added, skipped };
}

/* -------------------------------------------- */
/*  Turning lines into an area                  */
/* -------------------------------------------- */

/**
 * Chain wall segments into the outline they draw.
 *
 * Walls are unordered segments; a Region needs a ring of points in order. The
 * chaining walks from each segment to whichever unused segment shares its
 * endpoint, which is what makes a hand-drawn loop usable without asking the
 * Judge to have drawn it in sequence.
 *
 * Endpoints are compared with a tolerance because a loop closed by eye is
 * closed to within a pixel or two, not exactly.
 *
 * @param {Array<{c: number[]}>} walls
 * @param {number} [tolerance] pixels within which two endpoints are the same
 * @returns {{points: number[], closed: boolean}} flat [x,y,x,y,…]
 */
export function chainWalls(walls, tolerance = 8) {
  const segments = (walls ?? [])
    .map((w) => w.c)
    .filter((c) => Array.isArray(c) && c.length >= 4)
    .map((c) => [
      { x: c[0], y: c[1] },
      { x: c[2], y: c[3] },
    ]);
  if (!segments.length) return { points: [], closed: false };

  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;
  const used = new Array(segments.length).fill(false);

  used[0] = true;
  const ring = [segments[0][0], segments[0][1]];

  // Grow from the tail until nothing else connects. One pass per segment is
  // enough: each iteration consumes one, or there is nothing left to consume.
  for (let guard = 0; guard < segments.length; guard++) {
    const tail = ring[ring.length - 1];
    let advanced = false;
    for (let i = 0; i < segments.length; i++) {
      if (used[i]) continue;
      const [a, b] = segments[i];
      if (near(tail, a)) {
        ring.push(b);
        used[i] = true;
        advanced = true;
        break;
      }
      if (near(tail, b)) {
        ring.push(a);
        used[i] = true;
        advanced = true;
        break;
      }
    }
    if (!advanced) break;
  }

  const closed = ring.length > 3 && near(ring[0], ring[ring.length - 1]);
  // A closed ring repeats its first point at the end; a Region polygon does
  // not want the duplicate.
  const pts = closed ? ring.slice(0, -1) : ring;
  return { points: pts.flatMap((p) => [p.x, p.y]), closed };
}

/**
 * Build a Trap Zone Region from the selected walls' outline.
 *
 * Works from ANY selected walls, trapped or not: the Judge is describing an
 * AREA here — the mouth of a pit, the spread of a collapsing ceiling — and the
 * walls are the shape of it, not necessarily traps themselves.
 *
 * The region it creates restricts nothing. A Region in Foundry does not block
 * movement unless a behavior makes it, and the Trap Zone behavior does not: the
 * party walks in, and what stops them is the trap going off.
 *
 * @returns {Promise<RegionDocument|null>}
 */
export async function regionFromSelection({ trapUuid = "", name = "" } = {}) {
  const walls = controlledWalls();
  if (walls.length < 3) {
    ui.notifications?.warn(game.i18n.localize("ACKS-FORMATION.traps.selectLoop"));
    return null;
  }
  const { points, closed } = chainWalls(walls);
  if (!closed || points.length < 6) {
    ui.notifications?.warn(game.i18n.localize("ACKS-FORMATION.traps.notClosed"));
    return null;
  }

  const scene = canvas.scene;
  const [region] = await scene.createEmbeddedDocuments("Region", [
    {
      name: name || game.i18n.localize("ACKS-FORMATION.traps.regionName"),
      color: "#a3312c",
      shapes: [{ type: "polygon", points, hole: false }],
      behaviors: [
        {
          type: `${MODULE_ID}.trapZone`,
          name: game.i18n.localize("ACKS-FORMATION.traps.behaviorName"),
          system: { trapUuid, state: STATES.armed, repeatLock: {} },
        },
      ],
    },
  ]);
  ui.notifications?.info(game.i18n.localize("ACKS-FORMATION.traps.regionMade"));
  return region ?? null;
}

/* -------------------------------------------- */
/*  Crossing one                                */
/* -------------------------------------------- */

/**
 * Where a movement path crosses a segment, or null.
 *
 * Returns the POINT rather than a yes/no because the party is halted at the
 * crossing when the trap springs — walking on to the far side and then being
 * told a tripwire was stepped over three squares back is not the event the
 * rules describe.
 */
export function segmentCrossing(from, to, seg) {
  const [x1, y1, x2, y2] = seg;
  const rx = to.x - from.x;
  const ry = to.y - from.y;
  const sx = x2 - x1;
  const sy = y2 - y1;
  const denom = rx * sy - ry * sx;
  if (!denom) return null; // parallel, including both degenerate
  const t = ((x1 - from.x) * sy - (y1 - from.y) * sx) / denom;
  const u = ((x1 - from.x) * ry - (y1 - from.y) * rx) / denom;
  // `t > 0`, not `t >= 0`: a party STARTING on the line has not crossed it by
  // stepping away. Without this, a party halted at a trap springs it again on
  // its next move, in either direction, forever.
  if (t <= 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: from.x + t * rx, y: from.y + t * ry, t };
}

/**
 * Every armed trap wall the party crossed on this move, nearest crossing first.
 *
 * Nearest first because the party meets them in that order, and the first one
 * that goes off is where they stop.
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
 * Accepts the payload rather than the item so every drop target — a wall, a
 * wall's sheet, a region's behavior sheet — asks the same question once.
 */
export async function trapFromDrop(data) {
  if (data?.type !== "Item" || !data?.uuid) return null;
  const item = await fromUuid(data.uuid);
  return item?.type === TRAP_ITEM_TYPE ? item : null;
}

/** Perpendicular distance from a point to a wall segment. */
function distanceToWall(wall, x, y) {
  const [x1, y1, x2, y2] = wall.c;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

/** The wall nearest a canvas point, within `reach` pixels. */
export function wallNear(scene, x, y, reach) {
  let best = null;
  for (const wall of scene?.walls ?? []) {
    const dist = distanceToWall(wall, x, y);
    if (dist <= reach && (!best || dist < best.dist)) best = { wall, dist };
  }
  return best?.wall ?? null;
}

/**
 * Assign a trap to a wall, laying the trap layer if the wall has none.
 *
 * Dropping a trap onto an untrapped wall is how most traps will actually be
 * placed — it is one gesture instead of "select, press the tool, then find the
 * field" — so the drop does the whole job rather than refusing a wall that is
 * not yet a trap wall.
 */
export async function assignTrapToWall(wall, trap) {
  const existing = wallTrap(wall);
  // A wall that is only now becoming a trap is opened up, exactly as the tool
  // opens it; one that already carried a trap keeps whatever it kept.
  const opening = existing ? null : openingPatch(wall);
  if (opening) await wall.update(opening.patch);
  await setWallTrap(wall, {
    trapUuid: trap.uuid,
    // Re-arm only when this wall was not already a trap: reassigning the trap
    // on a spent one is the Judge correcting the definition, not resetting it.
    state: existing?.state ?? STATES.armed,
    repeatLock: existing?.repeatLock ?? {},
    restore: existing?.restore ?? opening?.restore ?? null,
  });
  ui.notifications?.info(game.i18n.format("ACKS-FORMATION.traps.assigned", { trap: trap.name }));
}

/**
 * Dropping a trap onto the map assigns it to the wall under the cursor.
 *
 * Returning false stops core's own drop handling, which would otherwise try to
 * make an item pile or a token out of it.
 */
export function installTrapDrop() {
  Hooks.on("dropCanvasData", (canvasRef, data) => {
    if (data?.type !== "Item" || !data?.uuid) return true;
    // The handler is async and the hook is not, so the work is kicked off and
    // the hook answers immediately. Resolving the item first would mean
    // returning a promise, which core reads as a truthy "handled".
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
   * The same drop, on a wall's own configuration sheet — where a Judge editing
   * one wall already is, and where the assigned trap is worth SHOWING.
   *
   * Hung on `renderApplicationV2` and filtered, which is how every other sheet
   * injection in this repo is done: the per-class render hooks are the ones
   * that stop firing when core reshuffles an application's class hierarchy, and
   * a WallConfig is only recognisable by what it is editing anyway.
   */
  Hooks.on("renderApplicationV2", (app, element) => {
    if (!game.user.isGM) return;
    const wall = app?.document;
    if (wall?.documentName !== "Wall") return;
    const root = element instanceof HTMLElement ? element : element?.[0];
    if (!root) return;
    // Re-rendering appends a second copy otherwise, and the sheet re-renders
    // on every field the Judge touches.
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

    (root.querySelector(".window-content form") ?? root).append(row);
  });
}

/* -------------------------------------------- */
/*  Scene controls                              */
/* -------------------------------------------- */

/**
 * Two tools on the Walls layer, beside the door helper: lay a trap along the
 * selected walls, or enclose the selected walls as a trap area.
 */
export function installTrapControls() {
  Hooks.on("getSceneControlButtons", (controls) => {
    const walls = controls.walls ?? controls.find?.((c) => c.name === "walls");
    if (!walls) return;
    const tools = walls.tools;
    const add = (tool) => {
      // v13+ hands these over as an object keyed by name; older builds as an
      // array. Both shapes are still in the wild across the family's worlds.
      if (Array.isArray(tools)) tools.push(tool);
      else tools[tool.name] = tool;
    };
    add({
      name: "acksTrapLine",
      title: game.i18n.localize("ACKS-FORMATION.traps.toolLine"),
      icon: "fa-solid fa-triangle-exclamation",
      button: true,
      visible: game.user.isGM,
      onChange: () => layTrapOnSelection(),
      onClick: () => layTrapOnSelection(),
    });
    add({
      name: "acksTrapRegion",
      title: game.i18n.localize("ACKS-FORMATION.traps.toolRegion"),
      icon: "fa-solid fa-draw-polygon",
      button: true,
      visible: game.user.isGM,
      onChange: () => regionFromSelection(),
      onClick: () => regionFromSelection(),
    });
  });
}
