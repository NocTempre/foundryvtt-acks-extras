/**
 * Lattice alignment: the shift that lays Foundry's grid over a drawn cell.
 *
 * The one owner of that answer. A caller names a drawn cell's centre in scene
 * pixels (the scene's padded origin included) and gets back the shift that
 * puts the nearest Foundry cell centre on it; the scene may be saved or not,
 * since only `clone` is asked of it.
 *
 * Document methods only — no canvas, no `game` — so it runs on any client and
 * under a mock in Node.
 */

/**
 * The `shiftX`/`shiftY` that put a Foundry cell centre exactly on a drawn
 * cell's centre, or null when the grid cannot answer.
 *
 * It asks a zero-shift CLONE of the scene carrying the target size and grid
 * for the cell centre nearest the point, because a phase cannot express the
 * row or column offset hex packing needs; the clone is never saved. With the
 * shift zeroed, the clone's `sceneX`/`sceneY` are the pre-shift padded
 * origin, so a caller whose point is measured from the picture's corner
 * passes `point` as a function of the clone's dimensions and the one clone
 * answers both.
 *
 * @param {Scene} scene a saved or unsaved Scene document
 * @param {object} p
 * @param {number} p.width the scene width the shift is solved for
 * @param {number} p.height
 * @param {number} p.gridSize the Foundry `grid.size`
 * @param {number} p.type the Foundry grid type
 * @param {{x: number, y: number}|((dims: object) => {x: number, y: number})} p.point
 *   the drawn centre in scene pixels, padding included, or a function of the
 *   clone's `getDimensions()` that returns it
 * @returns {{shiftX: number, shiftY: number}|null}
 */
export function hexAlignment(scene, { width, height, gridSize, type, point }) {
  const clone = scene.clone({ width, height, shiftX: 0, shiftY: 0, "grid.size": gridSize, "grid.type": type }, { keepId: true });
  const at = typeof point === "function" ? point(clone.getDimensions()) : point;
  const centre = clone.grid?.getCenterPoint?.(at);
  const shiftX = Number.isFinite(centre?.x) ? Math.round(at.x - centre.x) : null;
  const shiftY = Number.isFinite(centre?.y) ? Math.round(at.y - centre.y) : null;
  return shiftX === null || shiftY === null ? null : { shiftX, shiftY };
}
