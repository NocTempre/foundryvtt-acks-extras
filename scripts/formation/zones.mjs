/* global foundry */
import { getPartyToken } from "./formation-model.mjs";

/**
 * Where the party token is standing, in region terms.
 *
 * Shared by every scene-region behavior this feature defines (Encounter Zones,
 * Trap Zones): they differ in what they DO when the party is inside one and not
 * at all in how "inside" is decided, so the geometry lives here once.
 *
 * NOTE for anyone adding a behavior: region behavior sub-types MUST extend
 * `RegionBehaviorType`, not a plain `TypeDataModel`. Core token pathfinding
 * calls `_getTerrainEffects()` on every enabled behavior in a region
 * (`Token#createTerrainMovementPath`), and a plain data model breaks all
 * movement through any region carrying the behavior.
 */

/* -------------------------------------------- */
/*  Point-in-region testing                     */
/* -------------------------------------------- */

function rotateInto(px, py, cx, cy, degrees) {
  if (!degrees) return [px, py];
  const rad = (-degrees * Math.PI) / 180;
  const dx = px - cx;
  const dy = py - cy;
  return [cx + dx * Math.cos(rad) - dy * Math.sin(rad), cy + dx * Math.sin(rad) + dy * Math.cos(rad)];
}

function pointInPolygon(points, px, py) {
  let inside = false;
  for (let i = 0, j = points.length - 2; i < points.length; j = i, i += 2) {
    const xi = points[i];
    const yi = points[i + 1];
    const xj = points[j];
    const yj = points[j + 1];
    const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInShape(shape, px, py) {
  switch (shape.type) {
    case "rectangle": {
      const cx = shape.x + shape.width / 2;
      const cy = shape.y + shape.height / 2;
      const [rx, ry] = rotateInto(px, py, cx, cy, shape.rotation ?? 0);
      return rx >= shape.x && rx <= shape.x + shape.width && ry >= shape.y && ry <= shape.y + shape.height;
    }
    case "circle": {
      const dx = px - shape.x;
      const dy = py - shape.y;
      return dx * dx + dy * dy <= shape.radius * shape.radius;
    }
    case "ellipse": {
      const [rx, ry] = rotateInto(px, py, shape.x, shape.y, shape.rotation ?? 0);
      if (!shape.radiusX || !shape.radiusY) return false;
      const nx = (rx - shape.x) / shape.radiusX;
      const ny = (ry - shape.y) / shape.radiusY;
      return nx * nx + ny * ny <= 1;
    }
    case "polygon":
      return pointInPolygon(shape.points ?? [], px, py);
    default:
      return false;
  }
}

/**
 * Does a region contain the point? Prefers the core implementation — on v14,
 * `RegionDocument#testPoint` takes a single ElevatedPoint {x, y, elevation} and
 * works without the canvas (geometry lives on the document). Shape math
 * remains as a fallback.
 */
export function regionContains(regionDoc, point, elevation) {
  const bottom = regionDoc.elevation?.bottom;
  const top = regionDoc.elevation?.top;
  if (typeof bottom === "number" && elevation < bottom) return false;
  if (typeof top === "number" && elevation > top) return false;

  try {
    if (typeof regionDoc.testPoint === "function") {
      return regionDoc.testPoint({ x: point.x, y: point.y, elevation });
    }
  } catch (err) {
    // fall through to manual testing
  }

  let inside = false;
  for (const shape of regionDoc.shapes ?? []) {
    if (shape.hole) continue;
    if (pointInShape(shape, point.x, point.y)) {
      inside = true;
      break;
    }
  }
  if (!inside) return false;
  for (const shape of regionDoc.shapes ?? []) {
    if (shape.hole && pointInShape(shape, point.x, point.y)) return false;
  }
  return true;
}

/* -------------------------------------------- */
/*  Region outlines                             */
/* -------------------------------------------- */

/** A circle or ellipse as a closed ring of points. */
function ellipseRing(cx, cy, rx, ry, rotation = 0, steps = 24) {
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const [x, y] = rotateInto(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, cx, cy, -(rotation ?? 0));
    pts.push(x, y);
  }
  return pts;
}

/**
 * A region's solid shapes as closed rings of `[x, y, x, y, …]` canvas pixels.
 *
 * Containment is all Foundry's own geometry answers, and the trap sweep needs
 * to know how FAR away a region is: a pit two squares off the line of march is
 * within the reach of a searching thief and never contains anybody. Curves are
 * approximated by a 24-gon, which at dungeon scale is wrong by a fraction of a
 * pixel — far below the "within a square or two" the answer is used for.
 *
 * Holes are left out: they subtract from the inside of a shape, and the sweep
 * measures to the outside of one.
 */
export function regionOutlines(regionDoc) {
  const rings = [];
  for (const shape of regionDoc?.shapes ?? []) {
    if (shape.hole) continue;
    switch (shape.type) {
      case "rectangle": {
        const cx = shape.x + shape.width / 2;
        const cy = shape.y + shape.height / 2;
        const corners = [
          [shape.x, shape.y],
          [shape.x + shape.width, shape.y],
          [shape.x + shape.width, shape.y + shape.height],
          [shape.x, shape.y + shape.height],
        ];
        rings.push(corners.flatMap(([x, y]) => rotateInto(x, y, cx, cy, -(shape.rotation ?? 0))));
        break;
      }
      case "circle":
        rings.push(ellipseRing(shape.x, shape.y, shape.radius, shape.radius));
        break;
      case "ellipse":
        rings.push(ellipseRing(shape.x, shape.y, shape.radiusX, shape.radiusY, shape.rotation));
        break;
      case "polygon":
        if ((shape.points?.length ?? 0) >= 6) rings.push([...shape.points]);
        break;
      default:
        break;
    }
  }
  return rings;
}

/** Every edge of a region's outlines, as `[x1, y1, x2, y2]` segments. */
export function regionEdges(regionDoc) {
  const edges = [];
  for (const ring of regionOutlines(regionDoc)) {
    const n = ring.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      edges.push([ring[i * 2], ring[i * 2 + 1], ring[j * 2], ring[j * 2 + 1]]);
    }
  }
  return edges;
}

/* -------------------------------------------- */
/*  Zone lookup                                 */
/* -------------------------------------------- */

/**
 * The zone of a given behavior type the party token currently stands in.
 *
 * The token's CENTRE is the test point, not its corner: a party token is
 * usually larger than a square, and its top-left corner sits outside a region
 * the party is plainly standing in.
 *
 * @param {object} formation the formation whose party token is placed
 * @param {string} type the region behavior sub-type to look for
 * @returns {{region: RegionDocument, behavior: RegionBehavior}|null}
 */
export function findZone(formation, type) {
  const token = getPartyToken(formation);
  if (!token) return null;
  const scene = token.parent;
  const gs = scene.grid.size;
  const point = { x: token.x + (token.width * gs) / 2, y: token.y + (token.height * gs) / 2 };
  const elevation = token.elevation ?? 0;

  for (const region of scene.regions) {
    const behavior = region.behaviors.find((b) => b.type === type && !b.disabled);
    if (!behavior) continue;
    if (regionContains(region, point, elevation)) return { region, behavior };
  }
  return null;
}
