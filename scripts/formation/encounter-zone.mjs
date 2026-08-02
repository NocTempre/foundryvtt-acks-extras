/* global foundry, CONFIG */
import { MODULE_ID } from "./constants.mjs";
import { getPartyToken } from "./formation-model.mjs";

/**
 * "Encounter Zone" scene-region behavior: draw a Region over part of a map and
 * attach this behavior to key wandering-monster encounters to that zone — a
 * custom RollTable and, optionally, overrides for the throw cadence and target
 * value (0 = inherit the module settings). When the party token stands inside
 * the region, the zone's configuration wins over the formation's default table
 * and the world settings.
 */

export const ENCOUNTER_ZONE_TYPE = `${MODULE_ID}.encounterZone`;

/**
 * NOTE: region behavior sub-types MUST extend RegionBehaviorType, not plain
 * TypeDataModel — core token pathfinding calls `_getTerrainEffects()` on every
 * enabled behavior in a region (Token#createTerrainMovementPath), and a plain
 * data model breaks all movement through any region carrying this behavior.
 */
export class EncounterZoneBehavior extends foundry.data.regionBehaviors.RegionBehaviorType {
  static LOCALIZATION_PREFIXES = ["ACKS-FORMATION.ENCOUNTER_ZONE"];

  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      tableUuid: new fields.DocumentUUIDField({ type: "RollTable" }),
      encounterEvery: new fields.NumberField({ required: true, initial: 0, min: 0, max: 24, integer: true }),
      encounterTarget: new fields.NumberField({ required: true, initial: 0, min: 0, max: 6, integer: true }),
    };
  }
}

/** Register the behavior subtype (called from the init hook). */
export function registerEncounterZone() {
  CONFIG.RegionBehavior.dataModels[ENCOUNTER_ZONE_TYPE] = EncounterZoneBehavior;
  if (CONFIG.RegionBehavior.typeIcons) CONFIG.RegionBehavior.typeIcons[ENCOUNTER_ZONE_TYPE] = "fa-solid fa-dice-d6";
}

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
 * RegionDocument#testPoint takes a single ElevatedPoint {x, y, elevation} and
 * works without the canvas (geometry lives on the document). Shape math
 * remains as a fallback.
 */
function regionContains(regionDoc, point, elevation) {
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
 * The encounter zone the party token currently stands in, if any.
 * @returns {{region: RegionDocument, behavior: RegionBehavior}|null}
 */
export function findEncounterZone(formation) {
  const token = getPartyToken(formation);
  if (!token) return null;
  const scene = token.parent;
  const gs = scene.grid.size;
  const point = { x: token.x + (token.width * gs) / 2, y: token.y + (token.height * gs) / 2 };
  const elevation = token.elevation ?? 0;

  for (const region of scene.regions) {
    const behavior = region.behaviors.find((b) => b.type === ENCOUNTER_ZONE_TYPE && !b.disabled);
    if (!behavior) continue;
    if (regionContains(region, point, elevation)) return { region, behavior };
  }
  return null;
}
