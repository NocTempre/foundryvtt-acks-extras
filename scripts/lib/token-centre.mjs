/**
 * Where a token's centre is: the ONE reading, for every surface that measures,
 * lights or maps from a token's middle (light, mapping, the turn clock, the
 * journey, a trap's crossing, a place's reach). Foundry-free.
 *
 * A token document with `getCenterPoint` answers for itself, which is what keeps
 * a hex scene right: a hex cell is not `grid.size` pixels on both axes, so a
 * footprint read as `width * grid.size` lands off the cell's middle. A document
 * without it (a plain `{x, y, width, height}`, a token kept as data) gets the
 * same footprint worked from the grid's own `sizeX` / `sizeY`, which a square
 * grid states as `size` on both.
 *
 * The centre is read as an OFFSET from the corner, so it can be asked of a
 * corner other than the document's own (where a move began or ended) and be
 * measured from the same part of the token at each end. `tokenCorner` is the
 * inverse for a caller holding a centre it must write back as a position.
 */

/** The footprint of a token in pixels, one axis at a time, from the grid it stands on. */
function footprint(doc, scene) {
  const grid = scene?.grid;
  const sizeX = Number(grid?.sizeX ?? grid?.size) || 0;
  const sizeY = Number(grid?.sizeY ?? grid?.size) || 0;
  return { w: (Number(doc?.width ?? 1) || 0) * sizeX, h: (Number(doc?.height ?? 1) || 0) * sizeY };
}

/**
 * The offset from a token's top-left corner to its centre, in pixels.
 *
 * @param {object} doc    a token document, or `{width, height}` in grid units
 * @param {object} [scene]  the scene whose grid sizes the footprint (default `doc.parent`)
 * @returns {{dx: number, dy: number}}
 */
export function centreOffset(doc, scene = doc?.parent) {
  if (typeof doc?.getCenterPoint === "function") {
    const c = doc.getCenterPoint();
    if (Number.isFinite(c?.x) && Number.isFinite(c?.y)) return { dx: c.x - doc.x, dy: c.y - doc.y };
  }
  const { w, h } = footprint(doc, scene);
  return { dx: w / 2, dy: h / 2 };
}

/**
 * A token's centre in scene pixels, with its corner at `at` (default: where the
 * document stands).
 *
 * @param {object} doc
 * @param {object} [scene]  default `doc.parent`
 * @param {{x: number, y: number}} [at]  the top-left corner to measure from
 * @returns {{x: number, y: number}}
 */
export function tokenCentre(doc, scene = doc?.parent, at = doc) {
  const { dx, dy } = centreOffset(doc, scene);
  return { x: at.x + dx, y: at.y + dy };
}

/**
 * The top-left corner of a token whose centre is at `centre`: what to write to
 * `x` / `y` to put the token's middle there. The inverse of `tokenCentre`.
 *
 * @returns {{x: number, y: number}}
 */
export function tokenCorner(centre, doc, scene = doc?.parent) {
  const { dx, dy } = centreOffset(doc, scene);
  return { x: centre.x - dx, y: centre.y - dy };
}
