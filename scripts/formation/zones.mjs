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
