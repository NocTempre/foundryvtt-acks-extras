/**
 * Walls are traced off a plan's picture, and a correction says what a cell,
 * an edge or an island IS.
 *
 * Every plan here is drawn by the suite on a lattice of its own, so no page
 * is read and nothing printed is reproduced. What this guards is what a Judge
 * would meet as a dungeon whose rooms do not join: a lattice read a cell off,
 * a throat's door read as open, an asserted door that a traced wall still
 * runs through, a correction cap that lets a tracing ship as corrections, a
 * double door read as one, a secret door standing in one mouth of its cell, a
 * wall the crop's own edge draws across a room, a raised structure a token
 * walks through, and walls that land in the scene a frame away from the
 * picture under them.
 */
import {
  CORRECTION_SHARE, TRACE_PITCH, WALL_MODES, correctionCap, traceWalls, wallLattice, wallsProblems,
} from "../../scripts/importer/wall-trace.mjs";
import { recipeProblems, sceneData, sceneFrame, wallSources } from "../../scripts/importer/scene-binding.mjs";
import { withWorldIds } from "../../scripts/importer/adventure-binding.mjs";

let failed = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    console.error(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`);
    failed++;
  }
};
const ok = (name, cond, detail = "") => {
  if (!cond) {
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
};

/* ---------------- an invented plan ---------------- */

// A 20x15 lattice of 10-point cells over a 200x150 crop at (30, 40); the
// render is TRACE_PITCH pixels to the cell.
const CELL = 10;
const crop = { x: 30, y: 40, w: 200, h: 150 };
const grid = { family: "square", box: { w: CELL, h: CELL }, centre: [crop.x + CELL / 2, crop.y + CELL / 2], distance: 10, units: "ft" };
const scale = TRACE_PITCH / CELL;
const W = crop.w * scale, H = crop.h * scale;
const recipeOf = (walls, extra = {}) => ({ page: 1, crop, grid, walls, ...extra });

/** A gray canvas and the pens the plans are drawn with. */
function canvas(fill) {
  const g = new Uint8Array(W * H).fill(fill);
  const rect = (x0, y0, x1, y1, v) => {
    for (let y = Math.max(0, Math.round(y0)); y < Math.min(H, Math.round(y1)); y++) {
      for (let x = Math.max(0, Math.round(x0)); x < Math.min(W, Math.round(x1)); x++) g[y * W + x] = v;
    }
  };
  const cells = (c0, r0, c1, r1, v) => rect(c0 * TRACE_PITCH, r0 * TRACE_PITCH, (c1 + 1) * TRACE_PITCH, (r1 + 1) * TRACE_PITCH, v);
  return { gray: g, width: W, height: H, rect, cells };
}

// Rock is dark; two rooms and a three-cell corridor are light, ruled with a
// faint grid; the corridor's middle cell holds a door drawn as two lines
// across the gap. A 2x2 island of floor stands apart from both rooms.
const floorMap = new Set();
const markFloor = (c0, r0, c1, r1) => {
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) floorMap.add(`${c},${r}`);
};
function dungeon() {
  const p = canvas(60);
  const rooms = [[2, 2, 6, 6], [7, 4, 9, 4], [10, 3, 15, 9], [17, 11, 18, 12]];
  for (const [c0, r0, c1, r1] of rooms) {
    p.cells(c0, r0, c1, r1, 255);
    markFloor(c0, r0, c1, r1);
  }
  for (const [c0, r0, c1, r1] of rooms) {
    for (let c = c0; c <= c1 + 1; c++) p.rect(c * TRACE_PITCH, r0 * TRACE_PITCH, c * TRACE_PITCH + 1, (r1 + 1) * TRACE_PITCH, 110);
    for (let r = r0; r <= r1 + 1; r++) p.rect(c0 * TRACE_PITCH, r * TRACE_PITCH, (c1 + 1) * TRACE_PITCH, r * TRACE_PITCH + 1, 110);
  }
  const mid = 8.5 * TRACE_PITCH;
  for (const dx of [-6, 5]) p.rect(mid + dx, 4 * TRACE_PITCH + 2, mid + dx + 1, 5 * TRACE_PITCH - 2, 0);
  return p;
}
const plan = dungeon();
const boundaryEdges = (floor) => {
  let n = 0;
  for (let r = -1; r <= 15; r++) {
    for (let c = -1; c <= 20; c++) {
      const here = floor.has(`${c},${r}`);
      if (here !== floor.has(`${c + 1},${r}`)) n++;
      if (here !== floor.has(`${c},${r + 1}`)) n++;
    }
  }
  return n;
};
const lengthOf = (walls) => walls.reduce((sum, s) => sum + Math.hypot(s.c[2] - s.c[0], s.c[3] - s.c[1]), 0);
const wallLength = (walls) => lengthOf(walls.filter((s) => !s.door && !s.terrain));
const near = (a, b, tol = 1e-6) => a.length === b.length && a.every((v, k) => Math.abs(v - b[k]) < tol);

/* ---------------- the lattice and the checks ---------------- */

check("the lattice starts at the crop's corner cell and counts whole cells", wallLattice(recipeOf({ mode: "grid", threshold: 160 })), {
  x0: 30, y0: 40, px: 10, py: 10, cols: 20, rows: 15,
});
check("a crop cutting a cell starts the lattice at the next line", (() => {
  const L = wallLattice({ crop: { x: 33, y: 40, w: 200, h: 150 }, grid });
  return [L.x0, L.cols];
})(), [40, 19]);
check("the cap is a share of the cells, rounded down", correctionCap(wallLattice(recipeOf({}))), Math.floor(CORRECTION_SHARE * 300));
check("three modes", WALL_MODES, ["grid", "contour", "stroke"]);

const fine = { mode: "grid", threshold: 160 };
check("a plain walls block holds", wallsProblems(fine, recipeOf(fine)), []);
ok("a hex grid cannot be traced", wallsProblems(fine, { crop, grid: { ...grid, family: "hexCols" } }).some((p) => /square grid/.test(p)));
ok("an unknown mode is refused", wallsProblems({ ...fine, mode: "hatch" }, recipeOf(fine)).some((p) => /walls.mode/.test(p)));
ok("a threshold must be a gray level", wallsProblems({ ...fine, threshold: 300 }, recipeOf(fine)).some((p) => /threshold/.test(p)));
ok("an unknown key is named", wallsProblems({ ...fine, walls: [] }, recipeOf(fine)).some((p) => /unknown key "walls"/.test(p)));
const overCap = Array.from({ length: correctionCap(wallLattice(recipeOf(fine))) + 1 }, (_, i) => ({ cell: [i % 20, Math.floor(i / 20)], is: "floor" }));
ok("corrections past the cap are refused", wallsProblems({ ...fine, corrections: overCap }, recipeOf(fine)).some((p) => /over the cap/.test(p)));
check("corrections at the cap hold", wallsProblems({ ...fine, corrections: overCap.slice(1) }, recipeOf(fine)), []);
ok("a cell off the lattice is refused", wallsProblems({ ...fine, corrections: [{ cell: [20, 0], is: "floor" }] }, recipeOf(fine)).some((p) => /outside/.test(p)));
ok("the last row's north edge is on the lattice", !wallsProblems({ ...fine, corrections: [{ edge: [0, 15, "n"], is: "wall" }] }, recipeOf(fine)).length);
ok("an edge past the last column is refused", wallsProblems({ ...fine, corrections: [{ edge: [20, 0, "n"], is: "wall" }] }, recipeOf(fine)).some((p) => /outside/.test(p)));
ok("stroke mode asserts no floor", wallsProblems({ mode: "stroke", threshold: 200, corrections: [{ cell: [1, 1], is: "floor" }] }, recipeOf(fine)).some((p) => /stroke mode/.test(p)));
ok("a cell asserted twice is refused", wallsProblems({ ...fine, corrections: [{ cell: [1, 1], is: "floor" }, { cell: [1, 1], is: "solid" }] }, recipeOf(fine)).some((p) => /second time/.test(p)));
ok("a correction names one target", wallsProblems({ ...fine, corrections: [{ cell: [1, 1], edge: [1, 1, "n"], is: "open" }] }, recipeOf(fine)).some((p) => /exactly one/.test(p)));
ok("an island point must be inside the crop", wallsProblems({ ...fine, corrections: [{ at: [0, 0], drop: "island" }] }, recipeOf(fine)).some((p) => /outside the crop/.test(p)));
const dropDoor = [{ at: [crop.x + 5, crop.y + 5], drop: "door" }];
ok("grid mode drops no door by its point", wallsProblems({ ...fine, corrections: dropDoor }, recipeOf(fine)).some((p) => /drop must be "island" in grid mode/.test(p)));
check("contour mode drops a door by its point", wallsProblems({ mode: "contour", threshold: 160, corrections: dropDoor }, recipeOf(fine)), []);
ok("recipeProblems carries the walls checks", recipeProblems({ ...recipeOf({ ...fine, mode: "hatch" }) }).some((p) => /walls.mode/.test(p)));

const boxOf = (box, is = "terrain") => ({ ...fine, corrections: [{ box, is }] });
check("a terrain box holds", wallsProblems(boxOf([2, 2, 6, 6]), recipeOf(fine)), []);
check("a box may close on the lattice's last lines", wallsProblems(boxOf([0, 0, 20, 15]), recipeOf(fine)), []);
ok("a box must run from a line to a later one", wallsProblems(boxOf([6, 2, 6, 6]), recipeOf(fine)).some((p) => /later one/.test(p)));
ok("a box past the lattice is refused", wallsProblems(boxOf([2, 2, 21, 6]), recipeOf(fine)).some((p) => /later one/.test(p)));
ok("a box names four lattice lines", wallsProblems(boxOf([2, 2, 6]), recipeOf(fine)).some((p) => /box must be/.test(p)));
ok("a box is terrain", wallsProblems(boxOf([2, 2, 6, 6], "wall"), recipeOf(fine)).some((p) => /for a box/.test(p)));
// Three boxes weigh twelve; with three cells the list sits at the cap of 15.
const heavy = [[1, 1, 3, 3], [5, 1, 7, 3], [9, 1, 11, 3]].map((box) => ({ box, is: "terrain" }))
  .concat([0, 1, 2].map((c) => ({ cell: [c, 10], is: "floor" })));
check("boxes weigh four against the cap", wallsProblems({ ...fine, corrections: heavy }, recipeOf(fine)), []);
ok("a box past the cap is refused by its weight", wallsProblems({ ...fine, corrections: [...heavy, { cell: [3, 10], is: "floor" }] }, recipeOf(fine))
  .some((p) => /weigh 16 \(a box 4\), over the cap of 15/.test(p)));

/* ---------------- grid mode ---------------- */

const traced = traceWalls(plan, recipeOf(fine), scale);
const d = traced.digest;
check("grid: the floor is the drawn rooms, cell for cell", d.floorCells, floorMap.size);
check("grid: the rooms join through the corridor; the island stands apart", [d.regions, d.largestRegion], [2, floorMap.size - 4]);
check("grid: the drawn door is read as a door, the corridor's other cells as open", d.throats, { door: 1, symbol: 0, secret: 0, open: 2 });
check("grid: one door wall", d.doors, 1);
ok("grid: wall length is every boundary edge", Math.abs(wallLength(traced.walls) - boundaryEdges(floorMap) * CELL) < 1e-6, `${wallLength(traced.walls)} vs ${boundaryEdges(floorMap) * CELL}`);
const door = traced.walls.find((s) => s.door);
check("grid: the door stands across the corridor's middle, in page points", door.c, [crop.x + 8.5 * CELL, crop.y + 4 * CELL, crop.x + 8.5 * CELL, crop.y + 5 * CELL]);
ok("grid: every plain wall lies on a lattice line", traced.walls.filter((s) => !s.door).every(({ c }) => c.every((v, k) => Number.isInteger(Math.round((v - (k % 2 ? crop.y : crop.x)) / CELL * 1e6) / 1e6))));

const fixed = traceWalls(plan, recipeOf({
  ...fine,
  corrections: [
    { cell: [4, 4], is: "solid" },
    { cell: [7, 4], is: "secret" },
    { edge: [2, 2, "n"], is: "door" },
    { at: [crop.x + 17.5 * CELL, crop.y + 11.5 * CELL], drop: "island" },
  ],
}), scale);
check("grid: a cell asserted solid leaves the floor", fixed.digest.floorCells, floorMap.size - 1 - 4);
check("grid: the dropped island leaves one region", fixed.digest.regions, 1);
check("grid: the island's point is dropped, not refused", [fixed.digest.islandsDropped, fixed.digest.islandsRefused], [1, 0]);
for (const [what, at] of [["the plan's floor", [4.5, 4.5]], ["the rock framing it", [0.5, 0.5]]]) {
  const kept = traceWalls(plan, recipeOf({ ...fine, corrections: [{ at: [crop.x + at[0] * CELL, crop.y + at[1] * CELL], drop: "island" }] }), scale);
  check(`grid: a point on ${what} is refused and the plan stands`,
    [kept.digest.islandsDropped, kept.digest.islandsRefused, kept.digest.floorCells, kept.walls.length], [0, 1, d.floorCells, traced.walls.length]);
}
check("grid: an open throat asserted secret is a secret door on each of its mouths", fixed.walls.filter((s) => s.door === 2).map((s) => s.c),
  [[crop.x + 7 * CELL, crop.y + 4 * CELL, crop.x + 7 * CELL, crop.y + 5 * CELL], [crop.x + 8 * CELL, crop.y + 4 * CELL, crop.x + 8 * CELL, crop.y + 5 * CELL]]);
check("grid: an edge asserted a door is one, on the edge", fixed.walls.filter((s) => s.door === 1).map((s) => s.c).sort((a, b) => a[0] - b[0])[0], [crop.x + 2 * CELL, crop.y + 2 * CELL, crop.x + 3 * CELL, crop.y + 2 * CELL]);
const opened = traceWalls(plan, recipeOf({ ...fine, corrections: [{ edge: [2, 2, "n"], is: "open" }, { cell: [8, 4], is: "open" }] }), scale);
ok("grid: an edge asserted open loses its wall", Math.abs(wallLength(opened.walls) - (boundaryEdges(floorMap) - 1) * CELL) < 1e-6);
check("grid: a door asserted open is gone", opened.digest.doors, 0);

{
  // Two rooms either side of a one-cell rock band, a door drawn inside the
  // band: the band reads as rock, and the drawn door makes its cell a door.
  const band = canvas(60);
  band.cells(2, 2, 6, 4, 255);
  band.cells(2, 6, 6, 8, 255);
  band.rect(4.2 * TRACE_PITCH, 5.4 * TRACE_PITCH, 4.8 * TRACE_PITCH, 5.6 * TRACE_PITCH, 255);
  const drawn = traceWalls(band, recipeOf(fine), scale);
  check("grid: a door drawn inside a rock band is found and joins the rooms", [drawn.digest.doors, drawn.digest.regions], [1, 1]);
  const flankOpened = traceWalls(band, recipeOf({ ...fine, corrections: [{ cell: [3, 5], is: "floor" }] }), scale);
  check("grid: a drawn door whose flank is asserted floor is no door", [flankOpened.digest.doors, flankOpened.digest.regions], [0, 1]);
}

{
  // The corridor's door box split by a bar across its middle is a double
  // door: a door on each of the box's long lines. A bar at the box's end,
  // where its lines close, splits nothing.
  const mid = 8.5 * TRACE_PITCH;
  const split = dungeon();
  split.rect(mid - 6, 4.5 * TRACE_PITCH, mid + 6, 4.5 * TRACE_PITCH + 2, 0);
  const out = traceWalls(split, recipeOf(fine), scale);
  const doors = out.walls.filter((s) => s.door === 1).map((s) => s.c);
  ok("grid: a split box is a door on each long line, the cell's whole width",
    out.digest.splitBoxes === 1 && doors.length === 2
      && near(doors[0], [crop.x + (mid - 6) / scale, crop.y + 4 * CELL, crop.x + (mid - 6) / scale, crop.y + 5 * CELL])
      && near(doors[1], [crop.x + (mid + 5) / scale, crop.y + 4 * CELL, crop.x + (mid + 5) / scale, crop.y + 5 * CELL]), JSON.stringify(doors));
  const capped = dungeon();
  capped.rect(mid - 6, 4 * TRACE_PITCH + 12, mid + 6, 4 * TRACE_PITCH + 14, 0);
  const one = traceWalls(capped, recipeOf(fine), scale);
  check("grid: a bar near a box's end is no split", [one.digest.splitBoxes, one.digest.doors], [0, 1]);
  // A box drawn half the passage long, asserted a door: its closed end lies
  // mid-opening with the box's lines on one side only.
  const short = canvas(60);
  for (const [c0, r0, c1, r1] of [[2, 2, 6, 6], [7, 4, 9, 4], [10, 3, 15, 9]]) short.cells(c0, r0, c1, r1, 255);
  for (const dx of [-6, 5]) short.rect(mid + dx, 4 * TRACE_PITCH + 2, mid + dx + 1, 4.5 * TRACE_PITCH, 0);
  short.rect(mid - 6, 4.5 * TRACE_PITCH, mid + 6, 4.5 * TRACE_PITCH + 2, 0);
  const closed = traceWalls(short, recipeOf({ ...fine, corrections: [{ cell: [8, 4], is: "door" }] }), scale);
  check("grid: a box's closed end mid-opening is no split", [closed.digest.splitBoxes, closed.digest.doors], [0, 1]);
}

{
  // Two cells of a rock band opened and asserted doors are one opening; the
  // box across both, split on the cells' shared line, is a door on each long
  // line the opening's whole length. Unsplit, each cell has its own door.
  const P = TRACE_PITCH;
  const pair = canvas(60);
  pair.cells(2, 2, 6, 4, 255);
  pair.cells(2, 6, 6, 8, 255);
  pair.cells(3, 5, 4, 5, 255);
  for (const y of [5.3 * P, 5.7 * P]) pair.rect(3 * P + 3, y, 5 * P - 3, y + 2, 0);
  for (const x of [3 * P + 3, 5 * P - 5]) pair.rect(x, 5.3 * P, x + 2, 5.7 * P + 2, 0);
  const asserted = recipeOf({ ...fine, corrections: [{ cell: [3, 5], is: "door" }, { cell: [4, 5], is: "door" }] });
  const unsplit = traceWalls(pair, asserted, scale).walls.filter((s) => s.door).map((s) => s.c);
  check("grid: an unsplit box over two asserted cells is a door across each", unsplit,
    [[crop.x + 3 * CELL, crop.y + 5.5 * CELL, crop.x + 4 * CELL, crop.y + 5.5 * CELL], [crop.x + 4 * CELL, crop.y + 5.5 * CELL, crop.x + 5 * CELL, crop.y + 5.5 * CELL]]);
  pair.rect(4 * P - 1, 5.3 * P, 4 * P + 1, 5.7 * P + 2, 0);
  const out = traceWalls(pair, asserted, scale);
  const doors = out.walls.filter((s) => s.door).map((s) => s.c);
  ok("grid: a box split on two cells' shared line is a door on each long line across both",
    out.digest.splitBoxes === 1 && doors.length === 2
      && near(doors[0], [crop.x + 3 * CELL, crop.y + 265.5 / scale, crop.x + 5 * CELL, crop.y + 265.5 / scale])
      && near(doors[1], [crop.x + 3 * CELL, crop.y + 285.5 / scale, crop.x + 5 * CELL, crop.y + 285.5 / scale]), JSON.stringify(doors));
}

{
  // A terrain box stands where no traced wall does: inside a room it is four
  // sides of terrain; an edge asserted open cuts one side; along a room's
  // wall the wall stays.
  const terrainOf = (o) => o.walls.filter((s) => s.terrain);
  const inside = traceWalls(plan, recipeOf({ ...fine, corrections: [{ box: [11, 4, 14, 7], is: "terrain" }] }), scale);
  check("grid: a terrain box in a room is its four sides, apart from the walls",
    [inside.digest.terrain, lengthOf(terrainOf(inside)), inside.digest.walls, wallLength(inside.walls)], [4, 12 * CELL, d.walls, wallLength(traced.walls)]);
  const ramp = traceWalls(plan, recipeOf({ ...fine, corrections: [{ box: [11, 4, 14, 7], is: "terrain" }, { edge: [12, 7, "n"], is: "open" }] }), scale);
  check("grid: an edge asserted open cuts a box side", [ramp.digest.terrain, lengthOf(terrainOf(ramp))], [5, 11 * CELL]);
  const along = traceWalls(plan, recipeOf({ ...fine, corrections: [{ box: [10, 3, 12, 5], is: "terrain" }] }), scale);
  check("grid: a box side along a traced wall stays a wall", [lengthOf(terrainOf(along)), wallLength(along.walls)], [5 * CELL, wallLength(traced.walls)]);
}

{
  // The crop's partial strip past the lattice decides a border wall. The
  // crop starts 0.7 cell before the lattice's first column and 0.15 cell
  // above its first row, and ends 0.3 cell past its last column and 0.85
  // cell below its last row.
  const P = TRACE_PITCH;
  const crop2 = { x: 33, y: 38.5, w: 200, h: 150 };
  const ox = (40 - crop2.x) * scale, oy = (40 - crop2.y) * scale;
  const edged = canvas(60);
  const at = (c0, r0, c1, r1, v) => edged.rect(ox + c0 * P, oy + r0 * P, ox + (c1 + 1) * P, oy + (r1 + 1) * P, v);
  at(0, 3, 3, 6, 255);
  at(6, 0, 9, 2, 255);
  at(12, 11, 15, 13, 255);
  edged.rect(ox + 12 * P, oy + 14 * P, ox + 16 * P, H, 255);
  at(16, 6, 18, 8, 255);
  const out = traceWalls(edged, { page: 1, crop: crop2, grid, walls: fine }, scale);
  const on = (pred) => out.walls.filter(({ c }) => pred(c)).map(({ c }) => c);
  check("grid: a room against a deep rock strip is walled on the border",
    [on((c) => c[0] === c[2] && Math.abs(c[0] - 40) < 1e-6), on((c) => c[0] === c[2] && Math.abs(c[0] - 230) < 1e-6)].map((l) => l.map((c) => c.map((v) => +v.toFixed(6)))),
    [[[40, 70, 40, 110]], [[230, 100, 230, 130]]]);
  check("grid: a strip under a quarter cell, or of floor, walls nothing",
    [on((c) => c[1] === c[3] && Math.abs(c[1] - 40) < 1e-6).length, on((c) => c[1] === c[3] && Math.abs(c[1] - 180) < 1e-6).length], [0, 0]);
}

/* ---------------- contour mode ---------------- */

{
  const cave = canvas(50);
  const cx = 10 * TRACE_PITCH, cy = 7.5 * TRACE_PITCH, R = 4 * TRACE_PITCH;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.hypot(x - cx, y - cy) <= R) cave.gray[y * W + x] = 250;
  const out = traceWalls(cave, recipeOf({ mode: "contour", threshold: 160 }), scale);
  check("contour: one outline", out.digest.loops, 1);
  const off = out.walls.flatMap(({ c }) => [[c[0], c[1]], [c[2], c[3]]])
    .map(([x, y]) => Math.abs(Math.hypot((x - crop.x) * scale - cx, (y - crop.y) * scale - cy) - R) / TRACE_PITCH);
  ok("contour: the outline follows the cave within a sixth of a cell", Math.max(...off) < 1 / 6, `max ${Math.max(...off).toFixed(3)} cell`);
  ok("contour: the outline is not a lattice staircase", out.walls.length > 12);
  const withDoor = traceWalls(cave, recipeOf({ mode: "contour", threshold: 160, corrections: [{ cell: [10, 3], is: "door" }] }), scale);
  check("contour: a door asserted on a cell is there", withDoor.digest.doors, 1);

  // A room drawn two pixels inside its cells still walls on the lattice; its
  // corners are chamfered by the box mean, its sides are not.
  const room = canvas(50);
  room.rect(3 * TRACE_PITCH + 2, 3 * TRACE_PITCH + 2, 9 * TRACE_PITCH - 2, 7 * TRACE_PITCH - 2, 250);
  const snapped = traceWalls(room, recipeOf({ mode: "contour", threshold: 160 }), scale);
  const onLine = (v, origin) => Math.abs(((v - origin) / CELL) - Math.round((v - origin) / CELL)) < 1e-9;
  const sides = snapped.walls.filter(({ c }) => Math.hypot(c[2] - c[0], c[3] - c[1]) > CELL);
  check("contour: the room's four sides are traced", sides.length, 4);
  ok("contour: a side near a grid line is snapped onto it", sides.every(({ c }) => (c[0] === c[2] && onLine(c[0], crop.x)) || (c[1] === c[3] && onLine(c[1], crop.y))));

  // A floor island holding a rock blob: once the island is dropped, the blob
  // is part of the rock framing the plan, so a second point on it is refused.
  const islanded = canvas(50);
  islanded.cells(2, 2, 8, 6, 250);
  islanded.cells(12, 3, 14, 5, 250);
  islanded.rect(12.8 * TRACE_PITCH, 3.8 * TRACE_PITCH, 13.6 * TRACE_PITCH, 4.6 * TRACE_PITCH, 50);
  const roomOnly = canvas(50);
  roomOnly.cells(2, 2, 8, 6, 250);
  const both = traceWalls(islanded, recipeOf({ mode: "contour", threshold: 160, corrections: [
    { at: [crop.x + 12.3 * CELL, crop.y + 3.3 * CELL], drop: "island" },
    { at: [crop.x + 13.2 * CELL, crop.y + 4.2 * CELL], drop: "island" },
  ] }), scale);
  check("contour: a blob an earlier drop joined to the framing rock is refused",
    [both.digest.islandsDropped, both.digest.islandsRefused, wallLength(both.walls).toFixed(6)],
    [1, 1, wallLength(traceWalls(roomOnly, recipeOf({ mode: "contour", threshold: 160 }), scale).walls).toFixed(6)]);
}

{
  // A door drawn across a corridor between two rooms, and a light sliver
  // between a room's west wall and a grid line beside it, closed at both ends
  // by rock: both are light rectangles with rock at their ends, and only the
  // door has floor beyond both long sides.
  // Drawn once as described and once mirrored across the diagonal, so a door
  // across a corridor running either way is read.
  const P = TRACE_PITCH;
  const drawPlan = (flip) => {
    const p = canvas(50);
    const R = (x0, y0, x1, y1, v) => (flip ? p.rect(y0, x0, y1, x1, v) : p.rect(x0, y0, x1, y1, v));
    const C = (c0, r0, c1, r1, v) => R(c0 * P, r0 * P, (c1 + 1) * P, (r1 + 1) * P, v);
    C(3, 3, 8, 6, 250);
    C(3, 4, 3, 4, 50);
    R(3.2 * P, 3 * P, 3.2 * P + 1, 4 * P, 110);
    C(9, 5, 11, 5, 250);
    C(12, 3, 15, 7, 250);
    R(10.35 * P, 5 * P, 10.4 * P, 6 * P, 0);
    R(10.6 * P, 5 * P, 10.65 * P, 6 * P, 0);
    return p;
  };
  const plan = drawPlan(false);
  const rec = { mode: "contour", threshold: 160 };
  const out = traceWalls(plan, recipeOf(rec), scale);
  const doorsOf = (o) => o.walls.filter((s) => s.door).map((s) => [((s.c[0] + s.c[2]) / 2 - crop.x) / CELL, ((s.c[1] + s.c[3]) / 2 - crop.y) / CELL]);
  const found = doorsOf(out);
  ok("contour: the door in the corridor is read, the sliver beside the wall is not",
    found.length === 1 && Math.abs(found[0][0] - 10.5) < 0.1 && Math.abs(found[0][1] - 5.5) < 0.1, JSON.stringify(found));
  const across = doorsOf(traceWalls(drawPlan(true), recipeOf(rec), scale));
  ok("contour: mirrored, the door is still read and the sliver still is not",
    across.length === 1 && Math.abs(across[0][0] - 5.5) < 0.1 && Math.abs(across[0][1] - 10.5) < 0.1, JSON.stringify(across));
  // The point lies nearer the corridor's wall than the door; the door goes.
  const dropped = traceWalls(plan, recipeOf({ ...rec, corrections: [{ at: [crop.x + 10.8 * CELL, crop.y + 5.05 * CELL], drop: "door" }] }), scale);
  check("contour: a door dropped by a point near it is gone", [doorsOf(dropped).length, dropped.digest.doorsDropped], [0, 1]);
  check("contour: dropping a door cuts no wall", wallLength(dropped.walls), wallLength(out.walls));
  const missed = traceWalls(plan, recipeOf({ ...rec, corrections: [{ at: [crop.x + 13.5 * CELL, crop.y + 4.5 * CELL], drop: "door" }] }), scale);
  check("contour: a point with no door within half a cell drops nothing", [doorsOf(missed).length, missed.digest.doorsDropped], [1, 0]);
}

{
  // Two rooms joined by a two-cell corridor.
  const pair = canvas(50);
  pair.cells(2, 3, 6, 7, 250);
  pair.cells(7, 5, 8, 5, 250);
  pair.cells(9, 3, 13, 7, 250);
  const rec = { mode: "contour", threshold: 160 };
  const hid = traceWalls(pair, recipeOf({ ...rec, corrections: [{ cell: [7, 5], is: "secret" }] }), scale);
  const mids = hid.walls.filter((s) => s.door === 2).map(({ c }) => [((c[0] + c[2]) / 2 - crop.x) / CELL, ((c[1] + c[3]) / 2 - crop.y) / CELL]);
  ok("contour: a secret asserted on a cell stands on both its mouths",
    mids.length === 2 && near(mids.map((m) => m[0]).sort(), [7, 8], 0.05) && mids.every((m) => Math.abs(m[1] - 5.5) < 0.05), JSON.stringify(mids));

  const boxed = traceWalls(pair, recipeOf({ ...rec, corrections: [{ box: [9, 3, 12, 6], is: "terrain" }, { edge: [10, 6, "n"], is: "open" }] }), scale);
  const terrain = boxed.walls.filter((s) => s.terrain);
  check("contour: a terrain box's sides survive an edge cut as terrain", [boxed.digest.terrain, lengthOf(terrain).toFixed(6)], [5, (11 * CELL).toFixed(6)]);

  // The crop's own edge is no wall: a room running off the crop is walled on
  // its other three sides only.
  const edge = canvas(50);
  edge.cells(0, 3, 5, 7, 250);
  const cut = traceWalls(edge, recipeOf(rec), scale);
  ok("contour: no wall runs along the crop's edge", !cut.walls.some(({ c }) => c[0] === crop.x && c[2] === crop.x));
  check("contour: a room the crop cuts keeps its other three sides", cut.walls.filter(({ c }) => Math.hypot(c[2] - c[0], c[3] - c[1]) > CELL).length, 3);
}

/* ---------------- stroke mode ---------------- */

{
  const house = canvas(40);
  const t = Math.round(0.1 * TRACE_PITCH);
  const line = (c0, r0, c1, r1) => house.rect(c0 * TRACE_PITCH - t / 2, r0 * TRACE_PITCH - t / 2, c1 * TRACE_PITCH + t / 2, r1 * TRACE_PITCH + t / 2, 255);
  line(3, 3, 12, 3);
  line(3, 10, 12, 10);
  line(3, 3, 3, 10);
  line(12, 3, 12, 10);
  house.rect(6 * TRACE_PITCH, 6.2 * TRACE_PITCH, 6.8 * TRACE_PITCH, 6.32 * TRACE_PITCH, 255); // a bench: long enough to thin to a path, too short to be a wall
  const rec = { mode: "stroke", threshold: 200 };
  const out = traceWalls(house, recipeOf(rec), scale);
  const len = wallLength(out.walls);
  ok("stroke: the walls run the drawn outline's length", Math.abs(len - 32 * CELL) < 0.08 * 32 * CELL, `${len.toFixed(1)} vs ${32 * CELL}`);
  const nearOutline = ([x, y]) => {
    const u = (x - crop.x) / CELL, v = (y - crop.y) / CELL;
    return (Math.abs(u - 3) < 0.15 || Math.abs(u - 12) < 0.15 || Math.abs(v - 3) < 0.15 || Math.abs(v - 10) < 0.15);
  };
  ok("stroke: every wall end lies on the drawn outline", out.walls.every(({ c }) => nearOutline([c[0], c[1]]) && nearOutline([c[2], c[3]])));
  ok("stroke: a compact mark is no wall", !out.walls.some(({ c }) => Math.abs((c[0] - crop.x) / CELL - 6.4) < 0.6 && Math.abs((c[1] - crop.y) / CELL - 6.26) < 0.3));

  const doored = traceWalls(house, recipeOf({ ...rec, corrections: [{ edge: [3, 5, "w"], is: "door" }] }), scale);
  const doors = doored.walls.filter((s) => s.door);
  check("stroke: an edge asserted a door is one cell of door", doors.map((s) => s.c), [[crop.x + 3 * CELL, crop.y + 5 * CELL, crop.x + 3 * CELL, crop.y + 6 * CELL]]);
  const throughDoor = doored.walls.filter((s) => !s.door && Math.abs(s.c[0] - (crop.x + 3 * CELL)) < 2 && Math.abs(s.c[2] - (crop.x + 3 * CELL)) < 2)
    .some((s) => Math.min(s.c[1], s.c[3]) < crop.y + 5.5 * CELL && Math.max(s.c[1], s.c[3]) > crop.y + 5.5 * CELL);
  ok("stroke: no traced wall still runs through the asserted door", !throughDoor);
  ok("stroke: the cut keeps the wall either side of the door", Math.abs(wallLength(doored.walls) - (len - CELL)) < 0.05 * CELL * 32);

  const gap = traceWalls(house, recipeOf({ ...rec, corrections: [{ cell: [7, 3], is: "open" }] }), scale);
  ok("stroke: a cell asserted open cuts the wall crossing it", wallLength(gap.walls) < len - 0.5 * CELL);
  const outlineKept = traceWalls(house, recipeOf({ ...rec, corrections: [{ at: [crop.x + 3 * CELL, crop.y + 6 * CELL], drop: "island" }] }), scale);
  check("stroke: a point on the outline is refused, for the outline is the plan",
    [outlineKept.digest.islandsRefused, outlineKept.walls.length], [1, out.walls.length]);
  line(5, 12, 9, 12); // a separate stroke, long enough to trace
  const fenced = wallLength(traceWalls(house, recipeOf(rec), scale).walls);
  ok("stroke: a separate stroke traces as walls", fenced > len + 3 * CELL, `${fenced.toFixed(1)} vs ${len.toFixed(1)}`);
  const markDropped = traceWalls(house, recipeOf({ ...rec, corrections: [{ at: [crop.x + 7 * CELL, crop.y + 12 * CELL], drop: "island" }] }), scale);
  check("stroke: a point on the separate stroke drops it alone", [markDropped.digest.islandsDropped, wallLength(markDropped.walls).toFixed(6)], [1, len.toFixed(6)]);
  const raised = traceWalls(house, recipeOf({ ...rec, corrections: [{ box: [5, 5, 8, 8], is: "terrain" }] }), scale);
  check("stroke: a terrain box is its four sides", [raised.digest.terrain, lengthOf(raised.walls.filter((s) => s.terrain))], [4, 12 * CELL]);
}

/* ---------------- refusals ---------------- */

let threw = "";
try {
  traceWalls(plan, recipeOf({ mode: "grid", threshold: 0 }), scale);
} catch (err) {
  threw = err.message;
}
ok("a recipe the checks refuse is not traced", /threshold/.test(threw));
threw = "";
try {
  traceWalls({ gray: new Uint8Array(10), width: W, height: H }, recipeOf(fine), scale);
} catch (err) {
  threw = err.message;
}
ok("a render of the wrong size is not traced", /stated size/.test(threw));

/* ---------------- into the scene ---------------- */

{
  // Turned a quarter, the walls turn with the picture: a point on the crop's
  // top-right corner lands at the picture's top-left.
  const recipe = recipeOf(fine, { turn: 1 });
  const frame = sceneFrame(recipe, { pixelsPerPoint: 10 });
  const rows = wallSources([{ c: [crop.x + crop.w, crop.y, crop.x + crop.w, crop.y + CELL], door: 2 }, { c: [crop.x, crop.y, crop.x + 0.01, crop.y], door: 0 }], frame);
  check("walls are carried through the picture's frame and rounded", rows, [{ c: [0, 0, 100, 0], door: 2 }]);
  check("a terrain wall carries core's terrain senses and no door",
    wallSources([{ c: [crop.x + crop.w, crop.y, crop.x + crop.w, crop.y + CELL], door: 0, terrain: true }], frame),
    [{ c: [0, 0, 100, 0], door: 0, light: 10, sight: 10, sound: 10, move: 20 }]);

  const level = { id: "levelAAAAAAAAAAA", name: "Level" };
  const walled = sceneData({ id: "zz1.map", book: "zz1", name: "Map", recipe, src: "a.webp", level, walls: rows, pixelsPerPoint: 10 });
  check("a walled map turns vision on under global light", [walled.tokenVision, walled.environment?.globalLight?.enabled, walled.walls.length], [true, true, 1]);
  const bare = sceneData({ id: "zz1.map", book: "zz1", name: "Map", recipe, src: "a.webp", level, pixelsPerPoint: 10 });
  check("a map without walls keeps sight off and states no light", [bare.tokenVision, bare.environment, bare.walls], [false, undefined, []]);

  const first = withWorldIds({ walls: [{ c: [0, 0, 100, 0], door: 0 }, { c: [0, 0, 100, 0], door: 0 }] }, null, "zz1.adventure");
  const ids = first.walls.map((w) => w._id);
  ok("each wall takes an id, two equal walls two ids", ids.every((id) => /^[A-Za-z0-9]{16}$/.test(id)) && ids[0] !== ids[1]);
  check("the ids are the same on a rebuild", withWorldIds({ walls: [{ c: [0, 0, 100, 0], door: 0 }, { c: [0, 0, 100, 0], door: 0 }] }, null, "zz1.adventure").walls.map((w) => w._id), ids);
  const held = { _id: "heldSceneAAAAAAA", walls: [{ _id: "heldWallAAAAAAAA", c: [0, 0, 100, 0], door: 0 }] };
  check("a wall the world copy holds keeps that copy's id", withWorldIds({ walls: [{ c: [0, 0, 100, 0], door: 0 }] }, held, "zz1.adventure").walls[0]._id, "heldWallAAAAAAAA");
}

if (failed) {
  console.error(`\nwall-trace: ${failed} failure(s)`);
  process.exit(1);
}
console.error("wall-trace: OK");
