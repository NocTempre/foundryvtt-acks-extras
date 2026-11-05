/**
 * The marching column: where every body of a party stands on the map, laid
 * along the ground its token walked.
 *
 * The party token is the head of the column (rank 0, file 0). Rank r stands on
 * the cell the head stood on r cells ago, read off the token's trail; files
 * spread along the right hand of the way the column walks at that rank. Past
 * the end of the trail the column runs on straight, away from the trail's
 * oldest step, or behind the heading when the trail holds no step at all, so
 * a party that has walked nowhere in the open stands exactly as
 * `formationOffset` lays it.
 *
 * A body never stands across a wall or off the scene from the body it steps
 * out of. A file the right hand cannot reach takes the left; one neither hand
 * reaches goes to the next rank, so a column squeezed by its passage runs
 * deeper. Past the trail the column turns a quarter where its way back is shut.
 *
 * No Foundry dependency in the layout: grid size, bounds, the trail and the
 * wall test come in as arguments, so the offline suite drives every case.
 *
 * Points are cell TOP-LEFT corners in scene pixels, the position a 1×1 token
 * stores; a centre is `cellCentre`.
 */
import { cellBodies, formationBodies, getFrontage, HEADING_QUADRANTS, HEADINGS, sceneBounds, snapHeading } from "./formation-model.mjs";
import { FLAG_TRAIL, MODULE_ID } from "./constants.mjs";
import { isExpeditionScale } from "../lib/distance-units.mjs";
import { segmentCrossing } from "../lib/wall-geometry.mjs";

/** A step's sign along one axis: -1, 0 or 1. */
const sign = (n) => (n > 0 ? 1 : n < 0 ? -1 : 0);

/** Same cell, by top-left corner. */
const sameCell = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y;

/**
 * The cell a token of `width`×`height` cells stands over, by its centre: the
 * top-left corner of the cell under the centre. For a 1×1 token on the grid
 * that is the token's own corner.
 */
export function cellUnder({ x, y, width = 1, height = 1 }, gs) {
  return {
    x: Math.floor((Number(x) + (Number(width) * gs) / 2) / gs) * gs,
    y: Math.floor((Number(y) + (Number(height) * gs) / 2) / gs) * gs,
  };
}

/** A cell's centre point. */
export function cellCentre(cell, gs) {
  return { x: cell.x + gs / 2, y: cell.y + gs / 2 };
}

/**
 * The cells a walk passes through between two cells, `from` excluded and `to`
 * included, one grid step at a time (a diagonal step where both axes still
 * differ). Waypoints a move records are already one step apart; this fills a
 * gap a scripted move leaves.
 */
export function stepCells(from, to, gs) {
  const out = [];
  let x = from.x;
  let y = from.y;
  while (x !== to.x || y !== to.y) {
    x += sign(to.x - x) * gs;
    y += sign(to.y - y) * gs;
    out.push({ x, y });
  }
  return out;
}

/**
 * The cells of a walked path, in walk order, from its waypoints: each snapped
 * to the cell under it, gaps filled, repeats dropped.
 * @param {{x: number, y: number, width?: number, height?: number}[]} waypoints
 */
export function pathCells(waypoints, gs) {
  const cells = [];
  for (const point of waypoints ?? []) {
    const cell = cellUnder(point, gs);
    const last = cells.at(-1);
    if (!last) cells.push(cell);
    else cells.push(...stepCells(last, cell, gs));
  }
  return cells;
}

/**
 * How many cells a party's trail keeps: one per body behind the head, since a
 * column squeezed to single file is that deep, and the cell before the oldest,
 * so the last rank still knows which way it walked.
 */
export function trailBound(formation) {
  return formationBodies(formation) + 1;
}

/**
 * The trail after walking `cells` (in walk order), newest first, at most
 * `bound` long. A cell already on the trail cuts it there: the head turned back
 * over its own column, and the ranks behind the cut no longer follow it.
 * @param {{x: number, y: number}[]} trail newest first
 */
export function extendTrail(trail, cells, bound) {
  let out = [...(trail ?? [])];
  for (const cell of cells ?? []) {
    if (sameCell(out[0], cell)) continue;
    const seen = out.findIndex((c) => sameCell(c, cell));
    out = [cell, ...(seen === -1 ? out : out.slice(0, seen))];
  }
  return out.slice(0, Math.max(1, bound));
}

/**
 * The trail a column reads: the stored points, newest first, when they were
 * written on this scene and start under the head; else just the head.
 * @param {{sceneId?: string, points?: {x: number, y: number}[]}|null} stored
 * @param {{x: number, y: number}} head the head's cell
 * @param {string} sceneId the token's scene
 */
export function usableTrail(stored, head, sceneId) {
  const points = Array.isArray(stored?.points) ? stored.points : [];
  if (stored?.sceneId !== sceneId || !points.length || !sameCell(points[0], head)) return [head];
  return points;
}

/**
 * What a party-token update does to its trail:
 * - `keep`: a resize the module made, or nothing that moves the head;
 * - `reset`: the head arrived without walking (a priced walk to a point of
 *   interest, a step onto a lost party's true position, a teleport), or turned
 *   on the spot, which is the Judge aiming the column;
 * - `extend`: the head walked, a trap's halt included, since the party did
 *   walk that ground.
 * @param {object} what the update, as flags
 * @returns {"keep"|"reset"|"extend"}
 */
export function trailDecision({ moved = false, rotated = false, resize = false, halt = false, travel = false, truth = false, teleport = false } = {}) {
  if (resize) return "keep";
  if (moved && (travel || truth || teleport)) return "reset";
  if (moved || halt) return "extend";
  if (rotated) return "reset";
  return "keep";
}

/**
 * The trail to store after an update, or null to leave the stored one alone.
 *
 * @param {{sceneId?: string, points?: {x: number, y: number}[]}|null} stored
 * @param {object} opts
 * @param {"keep"|"reset"|"extend"} opts.decision from `trailDecision`
 * @param {{x: number, y: number, width?: number, height?: number}} opts.origin
 *   where the move started
 * @param {{x: number, y: number, width?: number, height?: number}[]} [opts.waypoints]
 *   the path walked, in walk order
 * @param {{x: number, y: number, width?: number, height?: number}} opts.head
 *   where the token now stands
 * @param {string} opts.sceneId the token's scene
 * @param {number} opts.gs grid size
 * @param {number} opts.bound `trailBound`
 * @returns {{sceneId: string, points: {x: number, y: number}[]}|null}
 */
export function nextTrail(stored, { decision, origin, waypoints = [], head, sceneId, gs, bound }) {
  if (decision === "keep" || !(gs > 0)) return null;
  const headCell = cellUnder(head, gs);
  if (decision === "reset") return { sceneId, points: [headCell] };
  const start = cellUnder(origin ?? head, gs);
  const walked = pathCells([origin ?? head, ...waypoints, head], gs);
  const points = extendTrail(usableTrail(stored, start, sceneId), walked, bound);
  return { sceneId, points };
}

/** The cardinal a step points along: the larger axis, the vertical on a tie. */
function headingOf(dx, dy, fallback) {
  if (!dx && !dy) return fallback;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "east" : "west";
  return dy > 0 ? "south" : "north";
}

/** A cell as a set key. */
const cellKey = (c) => `${c.x},${c.y}`;

/** The cell `steps` cells from `cell` along a unit vector. */
const along = (cell, unit, steps, gs) => ({ x: cell.x + steps * unit.x * gs, y: cell.y + steps * unit.y * gs });

/** The two headings a quarter turn from `heading`, right hand first. */
function quarterTurns(heading) {
  const i = HEADING_QUADRANTS.indexOf(heading);
  return [HEADING_QUADRANTS[(i + 1) % 4], HEADING_QUADRANTS[(i + 3) % 4]];
}

/**
 * The spine of the column: one cell per rank, rank 0 the head, and the heading
 * the column walks at each. Ranks on the trail stand where the head stood.
 * Past its end the column runs on straight, away from the oldest step, and
 * turns a quarter where `open` refuses that step or the cell is already the
 * column's; where every way is shut, the ranks left stand on the last cell
 * reached.
 * @param {(from: {x: number, y: number}, to: {x: number, y: number}) => boolean} open
 * @returns {{cell: {x: number, y: number}, heading: string}[]}
 */
function spine(trail, ranks, heading, gs, open) {
  const out = [];
  const n = trail.length;
  for (let r = 0; r < Math.min(ranks, n); r++) {
    // The way the column walks here: from the cell behind into this one,
    // else from this one into the cell ahead.
    const behind = trail[r + 1];
    const ahead = trail[r - 1];
    const local = behind
      ? headingOf(trail[r].x - behind.x, trail[r].y - behind.y, heading)
      : ahead
        ? headingOf(ahead.x - trail[r].x, ahead.y - trail[r].y, heading)
        : heading;
    out.push({ cell: trail[r], heading: local });
  }
  let walking = n >= 2 ? headingOf(trail[n - 2].x - trail[n - 1].x, trail[n - 2].y - trail[n - 1].y, heading) : heading;
  let cell = trail[n - 1];
  const taken = new Set(trail.map(cellKey));
  for (let r = n; r < ranks; r++) {
    for (const way of [walking, ...quarterTurns(walking)]) {
      const next = along(cell, HEADINGS[way].forward, -1, gs);
      if (taken.has(cellKey(next)) || !open(cell, next)) continue;
      cell = next;
      walking = way;
      taken.add(cellKey(cell));
      break;
    }
    out.push({ cell, heading: walking });
  }
  return out;
}

/**
 * The cells one rank's bodies stand on, at most `frontage`: the spine cell,
 * then file by file along its right hand while `open` lets each step through,
 * then along its left hand the same way.
 */
function rankSlots(cell, heading, frontage, gs, open) {
  const slots = [cell];
  const right = HEADINGS[heading].right;
  for (const side of [1, -1]) {
    let from = cell;
    for (let k = 1; slots.length < frontage; k++) {
      const next = along(cell, right, side * k, gs);
      if (!open(from, next)) break;
      slots.push(next);
      from = next;
    }
  }
  return slots;
}

/**
 * Where every body of the column stands, in body order (rank by rank, file by
 * file), as cell top-left corners.
 *
 * @param {object} formation the record (frontage and members)
 * @param {object} opts
 * @param {{x: number, y: number}} opts.anchor the head's cell
 * @param {{x: number, y: number}[]} [opts.trail] newest first, from `usableTrail`
 * @param {string|number} [opts.heading] a HEADINGS key, or a token rotation
 * @param {number} opts.gs grid size in pixels
 * @param {{minX: number, minY: number, maxX: number, maxY: number}|null} [opts.bounds]
 *   the corners a 1×1 token may occupy; a cell outside is shut like a wall
 * @param {((from: {x: number, y: number}, to: {x: number, y: number}) => boolean)|null} [opts.blocked]
 *   whether a wall stands between two cells (`wallTest`); none, nothing does
 * @param {number} [opts.count] bodies to place; the whole formation by default
 * @returns {{x: number, y: number}[]}
 */
export function columnCells(formation, { anchor, trail = null, heading = "south", gs, bounds = null, blocked = null, count } = {}) {
  if (!(gs > 0) || !anchor) return [];
  const facing = HEADINGS[heading] ? heading : snapHeading(heading);
  const bodies = count ?? formationBodies(formation);
  const frontage = getFrontage(formation);
  const inside = (c) => !bounds || (c.x >= bounds.minX && c.x <= bounds.maxX && c.y >= bounds.minY && c.y <= bounds.maxY);
  const open = (from, to) => inside(to) && !blocked?.(from, to);
  const walked = trail?.length && sameCell(trail[0], anchor) ? trail : [anchor];
  // A squeezed rank holds fewer than the frontage, so the column may need a
  // rank per body; the spine is laid that deep and read as far as it is used.
  const ranksAt = spine(walked, Math.max(1, bodies), facing, gs, open);
  const out = [];
  for (let r = 0; out.length < bodies; r++) {
    const { cell, heading: local } = ranksAt[Math.min(r, ranksAt.length - 1)];
    for (const slot of rankSlots(cell, local, frontage, gs, open)) {
      if (out.length >= bodies) break;
      out.push(slot);
    }
  }
  return out;
}

/* -------------------------------------------- */
/*  Walls                                       */
/* -------------------------------------------- */

/**
 * The walls that stop a body walking on `level`, as `{c, dir}`: every wall
 * that restricts movement, but an open door, and only those standing on the
 * level (a wall naming no level stands on every one). Core's constants are
 * read at call time; the numbers beside them are v14's, for the offline suite.
 * @param {Iterable<object>} walls wall documents, or their data
 * @param {string|null} [level] the party token's level id
 * @returns {{c: number[], dir: number}[]}
 */
export function movementWalls(walls, level = null) {
  const none = globalThis.CONST?.WALL_MOVEMENT_TYPES?.NONE ?? 0;
  const open = globalThis.CONST?.WALL_DOOR_STATES?.OPEN ?? 1;
  const out = [];
  for (const wall of walls ?? []) {
    if (!Array.isArray(wall?.c) || wall.c.length !== 4) continue;
    if ((wall.move ?? none) === none) continue;
    if (wall.door && wall.ds === open) continue;
    const levels = wall.levels ? [...wall.levels] : [];
    if (levels.length && level && !levels.includes(level)) continue;
    out.push({ c: wall.c, dir: Number(wall.dir) || 0 });
  }
  return out;
}

/** Which side of a wall's line a point is on, as core names it: 0 on it, 1 left, 2 right. */
function sideOf(c, p) {
  const o = (c[1] - p.y) * (c[2] - p.x) - (c[0] - p.x) * (c[3] - p.y);
  return o === 0 ? 0 : o < 0 ? 1 : 2;
}

/**
 * Whether a straight step between two points crosses one of `walls`, decided
 * as core's movement collision decides it: a wall whose line runs through the
 * start is passed, and a one-way wall stops only a step from its shut side.
 * @param {{c: number[], dir: number}[]} walls from `movementWalls`
 */
export function stepCrosses(walls, from, to) {
  for (const { c, dir } of walls) {
    if (!segmentCrossing(from, to, c)) continue;
    const side = sideOf(c, from);
    if (!side) continue;
    if (dir && side === dir) continue;
    return true;
  }
  return false;
}

/**
 * The column's wall test over a scene's walls on one level: whether a step
 * from one cell's centre to another's crosses a wall that stops movement.
 * Only walls within `reach` pixels of `near` are read, so a column on a map of
 * thousands of segments tests the few around it. Null where no wall is near.
 * @returns {((from: {x: number, y: number}, to: {x: number, y: number}) => boolean)|null}
 */
export function wallTest(walls, { level = null, gs, near, reach }) {
  const inReach = (c) => Math.min(c[0], c[2]) <= near.x + reach && Math.max(c[0], c[2]) >= near.x - reach
    && Math.min(c[1], c[3]) <= near.y + reach && Math.max(c[1], c[3]) >= near.y - reach;
  const close = movementWalls(walls, level).filter((w) => inReach(w.c));
  if (!close.length) return null;
  return (from, to) => stepCrosses(close, cellCentre(from, gs), cellCentre(to, gs));
}

/**
 * Whether a scene lays a party out as a column: a square grid at a scale where
 * a cell is a body's ground. A hex map, a gridless one and a mile-scale map
 * have none, and every body there stands at the head.
 */
export function sceneHasColumn(scene) {
  const square = globalThis.CONST?.GRID_TYPES?.SQUARE ?? 1;
  return !!scene && Number(scene.grid?.type) === square && Number(scene.grid?.size) > 0 && !isExpeditionScale(scene);
}

/**
 * The trail as it stands this moment: the stored one, carried on to where the
 * head is now. During a move the head runs ahead of the stored trail, which is
 * written once the step ends; `path` is the move's cells in walk order, when
 * this client was told them, and the head's progress along it is taken whole.
 * Without a path the gap is filled one step at a time.
 * @param {{sceneId?: string, points?: {x: number, y: number}[]}|null} stored
 * @param {object} opts
 * @param {{x: number, y: number}[]|null} [opts.path] the move's cells, origin first
 * @param {{x: number, y: number}} opts.head the head's cell now
 * @param {string} opts.sceneId
 * @param {number} opts.gs
 * @param {number} opts.bound
 * @returns {{x: number, y: number}[]} newest first
 */
export function liveTrail(stored, { path = null, head, sceneId, gs, bound }) {
  const points = stored?.sceneId === sceneId && Array.isArray(stored.points) && stored.points.length ? stored.points : null;
  if (!points) return [head];
  if (sameCell(points[0], head)) return points.slice(0, bound);
  const at = path ? path.findIndex((c) => sameCell(c, head)) : -1;
  const walked = at > 0 && sameCell(path[0], points[0]) ? path.slice(1, at + 1) : stepCells(points[0], head, gs);
  return extendTrail(points, walked, bound);
}

/**
 * Where every body of a party stands right now, with the head's cell.
 *
 * @param {object} formation the record
 * @param {TokenDocument} tokenDoc the linked party token
 * @param {object} [opts]
 * @param {boolean} [opts.live] read the token's animated position (a client
 *   drawing the move) instead of its stored one
 * @param {{x: number, y: number}[]|null} [opts.path] the move's cells (`liveTrail`)
 * @returns {{head: {x: number, y: number}, cells: {x: number, y: number}[], column: boolean}|null}
 *   `column` false where the scene lays no column (`sceneHasColumn`): every
 *   body then stands at the head.
 */
export function columnFor(formation, tokenDoc, { live = false, path = null } = {}) {
  const scene = tokenDoc?.parent;
  const gs = Number(scene?.grid?.size);
  if (!(gs > 0)) return null;
  const src = live ? tokenDoc : (tokenDoc._source ?? tokenDoc);
  const head = cellUnder(src, gs);
  if (!sceneHasColumn(scene)) {
    return { head, cells: Array.from({ length: formationBodies(formation) }, () => head), column: false };
  }
  const trail = liveTrail(tokenDoc.getFlag?.(MODULE_ID, FLAG_TRAIL) ?? null, { path, head, sceneId: scene.id, gs, bound: trailBound(formation) });
  const blocked = columnWalls(formation, scene, tokenDoc, head, gs);
  const cells = columnCells(formation, { anchor: head, trail, heading: snapHeading(src.rotation), gs, bounds: sceneBounds(scene), blocked });
  return { head, cells, column: true };
}

/**
 * The wall test a party's column reads on its scene, on the party token's
 * level, over the walls a column of the whole party could reach from `head`.
 */
function columnWalls(formation, scene, tokenDoc, head, gs) {
  const reach = (formationBodies(formation) + 2) * gs;
  return wallTest(scene.walls, { level: tokenDoc.level ?? tokenDoc._source?.level ?? null, gs, near: cellCentre(head, gs), reach });
}

/**
 * Where a deploy or a restore lays each marching-order cell: the column's
 * cells, by member index (`memberCells`), when the party token stands at the
 * head of a walked trail on a column scene, or when a wall cuts the column it
 * would lay without one; else null, and the caller lays the straight block
 * (`blockOrigin`), which a column with no trail in the open equals and which
 * shifts whole onto the scene where the column turns at its edge.
 * @param {object} formation the record
 * @param {TokenDocument} tokenDoc the linked party token, read at its stored position
 * @returns {{x: number, y: number}[][]|null}
 */
export function columnPlacement(formation, tokenDoc) {
  const scene = tokenDoc?.parent;
  if (!sceneHasColumn(scene)) return null;
  const gs = Number(scene.grid.size);
  const src = tokenDoc._source ?? tokenDoc;
  const head = cellUnder(src, gs);
  if (usableTrail(tokenDoc.getFlag?.(MODULE_ID, FLAG_TRAIL) ?? null, head, scene.id).length < 2) {
    const blocked = columnWalls(formation, scene, tokenDoc, head, gs);
    if (!blocked) return null;
    const heading = snapHeading(src.rotation);
    const walled = columnCells(formation, { anchor: head, heading, gs, blocked });
    const open = columnCells(formation, { anchor: head, heading, gs });
    if (walled.every((cell, i) => sameCell(cell, open[i]))) return null;
  }
  const at = columnFor(formation, tokenDoc);
  return at ? memberCells(formation, at.cells) : null;
}

/**
 * The cells each marching-order cell occupies, by member index: one for an
 * individual or a blank, one per body for a stack.
 * @param {object} formation
 * @param {{x: number, y: number}[]} cells `columnCells` for the whole formation
 * @returns {{x: number, y: number}[][]}
 */
export function memberCells(formation, cells) {
  const out = [];
  let body = 0;
  for (const member of formation?.members ?? []) {
    const n = cellBodies(member);
    out.push(cells.slice(body, body + n));
    body += n;
  }
  return out;
}
