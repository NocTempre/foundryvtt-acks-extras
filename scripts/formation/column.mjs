/**
 * The marching column: where every body of a party stands on the map, laid
 * along the ground its token walked.
 *
 * The party token is the head of the column (rank 0, file 0). Rank r stands on
 * the cell the head stood on r cells ago, read off the token's trail; files
 * spread along the right hand of the way the column walks at that rank. Past
 * the end of the trail the column runs on straight, away from the trail's
 * oldest step, or behind the heading when the trail holds no step at all, so
 * a party that has walked nowhere stands exactly as `formationOffset` lays it.
 *
 * No Foundry dependency: grid size, bounds and the trail come in as arguments,
 * so the offline suite drives every case.
 *
 * Points are cell TOP-LEFT corners in scene pixels, the position a 1×1 token
 * stores; a centre is `cellCentre`.
 */
import { cellBodies, formationBodies, getFrontage, HEADINGS, partyDepth, sceneBounds, snapHeading } from "./formation-model.mjs";
import { FLAG_TRAIL, MODULE_ID } from "./constants.mjs";
import { isExpeditionScale } from "../lib/distance-units.mjs";

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
 * How many cells a party's trail keeps: one per rank behind the head, and the
 * cell before the oldest, so the last rank still knows which way it walked.
 */
export function trailBound(formation) {
  return partyDepth(formation) + 1;
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

/**
 * The spine of the column: one cell per rank, rank 0 the head, and the heading
 * the column walks at each.
 * @returns {{cell: {x: number, y: number}, heading: string}[]}
 */
function spine(trail, ranks, heading, gs) {
  const out = [];
  // Past the trail's end: straight on, away from its oldest step.
  const n = trail.length;
  const tailHeading = n >= 2 ? headingOf(trail[n - 2].x - trail[n - 1].x, trail[n - 2].y - trail[n - 1].y, heading) : heading;
  const back = HEADINGS[tailHeading].forward;
  for (let r = 0; r < ranks; r++) {
    if (r < n) {
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
    } else {
      const k = r - (n - 1);
      out.push({ cell: { x: trail[n - 1].x - k * back.x * gs, y: trail[n - 1].y - k * back.y * gs }, heading: tailHeading });
    }
  }
  return out;
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
 *   the corners a 1×1 token may occupy; each body is pinned inside
 * @param {number} [opts.count] bodies to place; the whole formation by default
 * @returns {{x: number, y: number}[]}
 */
export function columnCells(formation, { anchor, trail = null, heading = "south", gs, bounds = null, count } = {}) {
  if (!(gs > 0) || !anchor) return [];
  const facing = HEADINGS[heading] ? heading : snapHeading(heading);
  const bodies = count ?? formationBodies(formation);
  const frontage = getFrontage(formation);
  const ranks = Math.max(1, Math.ceil(Math.max(bodies, 1) / frontage));
  const walked = trail?.length && sameCell(trail[0], anchor) ? trail : [anchor];
  const ranksAt = spine(walked, ranks, facing, gs);
  const out = [];
  for (let i = 0; i < bodies; i++) {
    const { cell, heading: local } = ranksAt[Math.floor(i / frontage)];
    const right = HEADINGS[local].right;
    const file = i % frontage;
    out.push(pin({ x: cell.x + file * right.x * gs, y: cell.y + file * right.y * gs }, bounds));
  }
  return out;
}

/** A corner pinned inside `bounds`; no bounds, unchanged. */
function pin(point, bounds) {
  if (!bounds) return point;
  return {
    x: Math.min(Math.max(point.x, bounds.minX), bounds.maxX),
    y: Math.min(Math.max(point.y, bounds.minY), bounds.maxY),
  };
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
  const cells = columnCells(formation, { anchor: head, trail, heading: snapHeading(src.rotation), gs, bounds: sceneBounds(scene) });
  return { head, cells, column: true };
}

/**
 * Where a deploy or a restore lays each marching-order cell: the column's
 * cells, by member index (`memberCells`), when the party token stands at the
 * head of a walked trail on a column scene; else null, and the caller lays
 * the straight block (`blockOrigin`), which a column with no trail equals
 * and which shifts whole onto the scene instead of pinning each body.
 * @param {object} formation the record
 * @param {TokenDocument} tokenDoc the linked party token, read at its stored position
 * @returns {{x: number, y: number}[][]|null}
 */
export function columnPlacement(formation, tokenDoc) {
  const scene = tokenDoc?.parent;
  if (!sceneHasColumn(scene)) return null;
  const gs = Number(scene.grid.size);
  const head = cellUnder(tokenDoc._source ?? tokenDoc, gs);
  if (usableTrail(tokenDoc.getFlag?.(MODULE_ID, FLAG_TRAIL) ?? null, head, scene.id).length < 2) return null;
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
