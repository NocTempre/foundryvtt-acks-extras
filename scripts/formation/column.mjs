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
 * Two layouts share the spine of cells the trail gives. `columnCells` stands
 * one body per cell, the layout of a world with no frontage figures imported.
 * `columnPoints` spaces the bodies as the book spaces them (RR ch. 6, "Combatant
 * Frontage and Interval"): rank r stands r intervals along the line through the
 * spine's cell centres, and files spread either side of that point at the sum
 * of their half-frontages. `columnFor` answers both: `cells` is always the
 * one-per-cell layout, `points` the centres the bodies stand on, which are the
 * cells' centres while nothing is spaced.
 *
 * Cells are TOP-LEFT corners in scene pixels, the position a 1×1 token stores;
 * a centre is `cellCentre`. Points are centres.
 */
import { cellBodies, formationBodies, getFrontage, getMemberActor, HEADING_QUADRANTS, HEADINGS, sceneBounds, snapHeading } from "./formation-model.mjs";
import { FLAG_TRAIL, MODULE_ID, formationValue } from "./constants.mjs";
import { isExpeditionScale, sceneFeetPerCell } from "../lib/distance-units.mjs";
import { segmentCrossing, segmentTouchesRect } from "../lib/wall-geometry.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";

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
 * The figures that space a column on `scene`, in feet as imported and in pixels
 * at the scene's scale, or null: the spacing needs all three frontage figures
 * and a scene that says what a cell is worth, and without either the column
 * stands one body per cell.
 * @returns {{march: number, wide: number, interval: number, feetPerCell: number,
 *   marchPx: number, widePx: number, intervalPx: number}|null}
 */
export function columnSpacing(scene) {
  const march = Number(formationValue("marchFrontageFeet"));
  const wide = Number(formationValue("wideFrontageFeet"));
  const interval = Number(formationValue("rankIntervalFeet"));
  const feetPerCell = sceneFeetPerCell(scene);
  const gs = Number(scene?.grid?.size);
  if (!(march > 0 && wide > 0 && interval > 0 && feetPerCell > 0 && gs > 0)) return null;
  const px = (feet) => (feet / feetPerCell) * gs;
  return { march, wide, interval, feetPerCell, marchPx: px(march), widePx: px(wide), intervalPx: px(interval) };
}

/**
 * How many cells the spine of a spaced column needs to reach its last rank: the
 * ranks' span along the line, in cells, and the cell it ends on.
 */
function spineCells(bodies, spacing, gs) {
  return Math.max(1, Math.ceil((Math.max(0, bodies - 1) * spacing.intervalPx) / gs) + 1);
}

/**
 * How many cells a party's trail keeps: one per body behind the head, since a
 * column squeezed to single file is that deep, and the cell before the oldest,
 * so the last rank still knows which way it walked. Where `scene` spaces the
 * column, a rank interval wider than a cell stretches the column past one cell
 * per body, and the trail keeps the cells that reach.
 * @param {object} formation
 * @param {object|null} [scene] the party token's scene
 */
export function trailBound(formation, scene = null) {
  const bodies = formationBodies(formation);
  const spacing = scene ? columnSpacing(scene) : null;
  if (!spacing) return bodies + 1;
  return Math.ceil((bodies * Math.max(spacing.interval, spacing.feetPerCell)) / spacing.feetPerCell) + 1;
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
export function columnCells(formation, opts = {}) {
  return layCells(formation, opts).cells;
}

/**
 * `columnCells` with each body's seat: the rank it stands in and its file
 * within that rank, in laying order.
 * @returns {{cells: {x: number, y: number}[], seats: {rank: number, file: number}[]}}
 */
function layCells(formation, { anchor, trail = null, heading = "south", gs, bounds = null, blocked = null, count } = {}) {
  if (!(gs > 0) || !anchor) return { cells: [], seats: [] };
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
  const seats = [];
  for (let r = 0; out.length < bodies; r++) {
    const { cell, heading: local } = ranksAt[Math.min(r, ranksAt.length - 1)];
    let file = 0;
    for (const slot of rankSlots(cell, local, frontage, gs, open)) {
      if (out.length >= bodies) break;
      out.push(slot);
      seats.push({ rank: r, file: file++ });
    }
  }
  return { cells: out, seats };
}

/**
 * Whether a member stands wide: an individual whose equipped melee weapon is
 * large and deals bludgeoning or slashing damage, and none that pierces. Read
 * off the weapon's own fields; an actor with no such weapon, a blank and a
 * stack's bodies march.
 * @param {Actor|null} actor
 */
export function isWideBearer(actor) {
  for (const item of actor?.items ?? []) {
    const system = item?.system;
    if (item?.type !== ITEM_TYPE.weapon || !system?.equipped || !system?.melee || system.size !== "large") continue;
    const types = new Set([...(system.damage?.base?.types ?? []), ...(system.damage?.alternate?.types ?? [])]);
    if ((types.has("bludgeoning") || types.has("slashing")) && !types.has("piercing")) return true;
  }
  return false;
}

/**
 * Whether each body of the formation stands wide, in body order: a stack's
 * bodies and a blank march, an individual by `isWideBearer`.
 * @returns {boolean[]}
 */
export function bodyWides(formation) {
  const out = [];
  for (const member of formation?.members ?? []) {
    const n = cellBodies(member);
    const wide = n === 1 && !member?.blank && !!member?.actorId && isWideBearer(getMemberActor(member));
    for (let i = 0; i < n; i++) out.push(wide);
  }
  return out;
}

/**
 * The line through a spine's cell centres, read by distance from its head:
 * the point at `distance`, and the cardinal the column walks there (rank 0
 * toward the cell ahead of it, every later stretch into the cell it leaves).
 * Past the line's end the last point stands.
 */
function lineAlong(spineCellsList, gs, fallback) {
  const centres = spineCellsList.map(({ cell }) => cellCentre(cell, gs));
  const heads = centres.slice(0, -1).map((c, k) => headingOf(c.x - centres[k + 1].x, c.y - centres[k + 1].y, spineCellsList[k].heading ?? fallback));
  return (distance) => {
    if (centres.length < 2) return { point: centres[0], heading: spineCellsList[0]?.heading ?? fallback };
    let rest = Math.max(0, distance);
    for (let k = 0; k < centres.length - 1; k++) {
      const a = centres[k];
      const b = centres[k + 1];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (rest < length || k === centres.length - 2) {
        const t = length ? Math.min(rest, length) / length : 0;
        return { point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, heading: heads[k] };
      }
      rest -= length;
    }
    return { point: centres.at(-1), heading: heads.at(-1) };
  };
}

/**
 * Where every body of the column stands when the book spaces it, in body order
 * (rank by rank, file by file), as centres in scene pixels.
 *
 * Rank r stands at r × interval along the line through the spine's cell
 * centres from the head. A rank's first body stands on that point; the files
 * after it go to the right hand, then the left, each centred a half-frontage
 * past the body before it. A file is open when its far edge stays on the scene
 * and no wall that stops movement lies between the body before it and that
 * edge; a body no hand reaches goes to the next rank. At most `frontage` bodies
 * stand to a rank.
 *
 * @param {object} formation the record (frontage and members)
 * @param {object} opts
 * @param {{x: number, y: number}} opts.anchor the head's cell
 * @param {{x: number, y: number}[]} [opts.trail] newest first, from `usableTrail`
 * @param {string|number} [opts.heading] a HEADINGS key, or a token rotation
 * @param {number} opts.gs grid size in pixels
 * @param {{minX: number, minY: number, maxX: number, maxY: number}|null} [opts.bounds]
 *   the corners a 1×1 token may occupy; the scene's rectangle follows from it
 * @param {((from: {x: number, y: number}, to: {x: number, y: number}) => boolean)|null} [opts.blocked]
 *   the cell wall test the spine turns by
 * @param {{c: number[], dir: number}[]} [opts.walls] the movement walls near the column (`movementWalls`)
 * @param {{marchPx: number, widePx: number, intervalPx: number}} opts.spacing `columnSpacing`
 * @param {boolean[]} [opts.wide] whether each body stands wide (`bodyWides`)
 * @param {number} [opts.count] bodies to place; the whole formation by default
 * @returns {{x: number, y: number}[]}
 */
export function columnPoints(formation, opts = {}) {
  return layPoints(formation, opts).points;
}

/**
 * `columnPoints` with each body's seat: the rank it stands in and its file
 * within that rank, in laying order.
 * @returns {{points: {x: number, y: number}[], seats: {rank: number, file: number}[]}}
 */
function layPoints(formation, { anchor, trail = null, heading = "south", gs, bounds = null, blocked = null, walls = [], spacing, wide = [], count } = {}) {
  if (!(gs > 0) || !anchor || !spacing) return { points: [], seats: [] };
  const facing = HEADINGS[heading] ? heading : snapHeading(heading);
  const bodies = count ?? formationBodies(formation);
  const frontage = getFrontage(formation);
  const onScene = (p) => !bounds || (p.x >= bounds.minX && p.x <= bounds.maxX + gs && p.y >= bounds.minY && p.y <= bounds.maxY + gs);
  const inside = (c) => !bounds || (c.x >= bounds.minX && c.x <= bounds.maxX && c.y >= bounds.minY && c.y <= bounds.maxY);
  const open = (from, to) => inside(to) && !blocked?.(from, to);
  const walked = trail?.length && sameCell(trail[0], anchor) ? trail : [anchor];
  const line = lineAlong(spine(walked, spineCells(bodies, spacing, gs), facing, gs, open), gs, facing);
  const half = (body) => (wide[body] ? spacing.widePx : spacing.marchPx) / 2;
  const out = [];
  const seats = [];
  for (let rank = 0; out.length < bodies; rank++) {
    const { point, heading: local } = line(rank * spacing.intervalPx);
    const right = HEADINGS[local].right;
    out.push(point);
    seats.push({ rank, file: 0 });
    let inRank = 1;
    for (const side of [1, -1]) {
      let from = point;
      let edge = half(out.length - inRank);
      while (inRank < frontage && out.length < bodies) {
        const h = half(out.length);
        const along = edge + h;
        const far = { x: point.x + side * right.x * (along + h), y: point.y + side * right.y * (along + h) };
        if (!onScene(far) || stepCrosses(walls, from, far)) break;
        from = { x: point.x + side * right.x * along, y: point.y + side * right.y * along };
        out.push(from);
        seats.push({ rank, file: inRank });
        inRank += 1;
        edge = along + h;
      }
    }
  }
  return { points: out, seats };
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
  const close = nearWalls(walls, { level, near, reach });
  if (!close.length) return null;
  return (from, to) => stepCrosses(close, cellCentre(from, gs), cellCentre(to, gs));
}

/**
 * The walls that stop movement on `level` whose bounding box lies within `reach`
 * pixels of `near`, as `movementWalls` gives them.
 */
export function nearWalls(walls, { level = null, near, reach }) {
  const inReach = (c) => Math.min(c[0], c[2]) <= near.x + reach && Math.max(c[0], c[2]) >= near.x - reach
    && Math.min(c[1], c[3]) <= near.y + reach && Math.max(c[1], c[3]) >= near.y - reach;
  return movementWalls(walls, level).filter((w) => inReach(w.c));
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
 * @returns {{head: {x: number, y: number}, cells: {x: number, y: number}[],
 *   points: {x: number, y: number}[], sizes: number[],
 *   seats: {rank: number, file: number}[], rankFeet: number|null, column: boolean}|null}
 *   `cells` is the one-per-cell layout; `points` the centres the bodies stand
 *   on and `sizes` the width of the square each is drawn in, which are the
 *   cells' centres and one cell while the scene is not spaced (`columnSpacing`).
 *   `seats` is each body's rank and file in the layout that `points` follows;
 *   `rankFeet` the rank interval in feet where the scene is spaced, else null.
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
    const cells = Array.from({ length: formationBodies(formation) }, () => head);
    return { head, cells, points: cells.map((c) => cellCentre(c, gs)), sizes: cells.map(() => gs), seats: cells.map(() => ({ rank: 0, file: 0 })), rankFeet: null, column: false };
  }
  const spacing = columnSpacing(scene);
  const trail = liveTrail(tokenDoc.getFlag?.(MODULE_ID, FLAG_TRAIL) ?? null, { path, head, sceneId: scene.id, gs, bound: trailBound(formation, scene) });
  const { close, blocked } = columnWalls(formation, scene, tokenDoc, head, gs, spacing);
  const heading = snapHeading(src.rotation);
  const bounds = sceneBounds(scene);
  const { cells, seats: cellSeats } = layCells(formation, { anchor: head, trail, heading, gs, bounds, blocked });
  if (!spacing) return { head, cells, points: cells.map((c) => cellCentre(c, gs)), sizes: cells.map(() => gs), seats: cellSeats, rankFeet: null, column: true };
  const wide = bodyWides(formation);
  const { points, seats } = layPoints(formation, { anchor: head, trail, heading, gs, bounds, blocked, walls: close, spacing, wide });
  return { head, cells, points, sizes: points.map((_, i) => (wide[i] ? spacing.widePx : spacing.marchPx)), seats, rankFeet: spacing.interval, column: true };
}

/**
 * The movement walls a party's column reads on its scene, on the party token's
 * level, over the ground a column of the whole party could reach from `head`,
 * and the cell wall test over them (null where none is near).
 */
function columnWalls(formation, scene, tokenDoc, head, gs, spacing) {
  const cells = spacing ? spineCells(formationBodies(formation), spacing, gs) : 0;
  const reach = (Math.max(formationBodies(formation), cells) + 2) * gs;
  const close = nearWalls(scene.walls, { level: tokenDoc.level ?? tokenDoc._source?.level ?? null, near: cellCentre(head, gs), reach });
  const blocked = close.length ? (from, to) => stepCrosses(close, cellCentre(from, gs), cellCentre(to, gs)) : null;
  return { close, blocked };
}

/**
 * Where a deploy or a restore lays each marching-order cell, by member index
 * (`memberCells`): one `{point, cell}` per body, the centre the column stands
 * it on (null where the scene is not spaced) and the cell the column's
 * one-per-cell layout gives it, which a body takes when its token does not fit
 * at its point (`deploySpot`).
 *
 * Without spacing: the cells when the party token stands at the head of a
 * walked trail on a column scene, or when a wall cuts the column it would lay
 * without one; else null, and the caller lays the straight block
 * (`blockOrigin`), which a column with no trail in the open equals and which
 * shifts whole onto the scene where the column turns at its edge. With spacing,
 * always the column, for the points have no block to fall back to.
 * @param {object} formation the record
 * @param {TokenDocument} tokenDoc the linked party token, read at its stored position
 * @returns {{point: {x: number, y: number}|null, cell: {x: number, y: number}}[][]|null}
 */
export function columnPlacement(formation, tokenDoc) {
  const scene = tokenDoc?.parent;
  if (!sceneHasColumn(scene)) return null;
  const gs = Number(scene.grid.size);
  const src = tokenDoc._source ?? tokenDoc;
  const head = cellUnder(src, gs);
  const spacing = columnSpacing(scene);
  if (!spacing && usableTrail(tokenDoc.getFlag?.(MODULE_ID, FLAG_TRAIL) ?? null, head, scene.id).length < 2) {
    const { blocked } = columnWalls(formation, scene, tokenDoc, head, gs, null);
    if (!blocked) return null;
    const heading = snapHeading(src.rotation);
    const walled = columnCells(formation, { anchor: head, heading, gs, blocked });
    const open = columnCells(formation, { anchor: head, heading, gs });
    if (walled.every((cell, i) => sameCell(cell, open[i]))) return null;
  }
  const at = columnFor(formation, tokenDoc);
  if (!at) return null;
  return memberCells(formation, at.cells.map((cell, i) => ({ point: spacing ? at.points[i] : null, cell })));
}

/**
 * Where a token of `w`×`h` cells goes for one placement: centred on the spot's
 * point when its footprint, shrunk a pixel so a token flush against a wall
 * fits, passes `fits`; else on the spot's own cell, which is how a token stands
 * where no point is given or none fits. Positions are whole pixels.
 * @param {{point: {x: number, y: number}|null, cell: {x: number, y: number}}} spot
 * @param {object} opts
 * @param {number} [opts.w] the token's width in cells
 * @param {number} [opts.h] the token's height in cells
 * @param {number} opts.gs grid size in pixels
 * @param {((box: {minX: number, minY: number, maxX: number, maxY: number}) => boolean)|null} [opts.fits]
 *   whether a footprint stands clear of the walls and on the scene (`spotFits`)
 * @returns {{x: number, y: number}}
 */
export function deploySpot(spot, { w = 1, h = 1, gs, fits = null } = {}) {
  const { point, cell } = spot;
  if (!point || !(gs > 0) || typeof fits !== "function") return { x: cell.x, y: cell.y };
  const halfW = (Math.max(1, Number(w) || 1) * gs) / 2;
  const halfH = (Math.max(1, Number(h) || 1) * gs) / 2;
  const box = { minX: point.x - halfW + 1, minY: point.y - halfH + 1, maxX: point.x + halfW - 1, maxY: point.y + halfH - 1 };
  return fits(box) ? { x: Math.round(point.x - halfW), y: Math.round(point.y - halfH) } : { x: cell.x, y: cell.y };
}

/**
 * The footprint test a deploy from `tokenDoc`'s column answers by: whether a
 * rectangle lies on the scene and no wall that stops movement touches it. An
 * open door does not stop movement, and a one-way wall stops by its line alone.
 * @param {object} formation
 * @param {TokenDocument} tokenDoc the linked party token
 * @returns {(box: {minX: number, minY: number, maxX: number, maxY: number}) => boolean}
 */
export function spotFits(formation, tokenDoc) {
  const scene = tokenDoc?.parent;
  const gs = Number(scene?.grid?.size);
  const head = cellUnder(tokenDoc._source ?? tokenDoc, gs);
  const { close } = columnWalls(formation, scene, tokenDoc, head, gs, columnSpacing(scene));
  const bounds = sceneBounds(scene);
  return (box) => (!bounds || (box.minX >= bounds.minX && box.minY >= bounds.minY && box.maxX <= bounds.maxX + gs && box.maxY <= bounds.maxY + gs))
    && !close.some((wall) => segmentTouchesRect(wall.c, box));
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
