/**
 * The country under a point, read off the map: what the brush painted on its
 * layers, the lines drawn through it, and what the scene says of the rest —
 * the climate always, since a map holds one. ONE reader: the journey's trace,
 * the seat on arrival, the Judge's refresh and the encounter context all ask
 * here, so a hex never reads two ways. No canvas: it reads the scene document
 * and what a registered layer derives from the world (a domain's class), so any
 * client holding both can ask.
 *
 * See docs/battlemap/MODEL.md, "Country layers".
 */
import { derivedValueAt, layerValueAt, terrainAtPoint } from "./terrain-paint.mjs";
import { roadUnder, roadWallsOf } from "./roads.mjs";
import { waterUnder, waterWallsOf } from "./water.mjs";
import { sceneCountry } from "./scene-setup.mjs";
import { ENCOUNTER_TERRAINS, encounterTerrainFor } from "../formation/encounter-terrains.mjs";
import { TERRITORY_KEYS } from "../formation/country-keys.mjs";

/** The country's six keys: what the map, the scene default and the Judge each answer. */
export const COUNTRY_KEYS = Object.freeze(["ground", "encounterTerrain", "territory", "climate", "road", "following"]);

/** The grounds whose rivers read the desert-and-jungle table rather than the land one. */
const DESERT_OR_JUNGLE = Object.freeze(["desert", "jungle"]);

/** The river table for the ground a water line runs through. */
export function riverTableFor(ground) {
  return DESERT_OR_JUNGLE.includes(ground) ? "riverDesertJungle" : "riverLand";
}

/**
 * A terrain brush value read the way a painted hex reads: the ground it
 * stands on, and the encounter table it names (a fine key names itself; a
 * bare ground names its default table). Nulls where it names neither.
 */
function readBrushValue(key) {
  if (!key) return { ground: null, encounterTerrain: null };
  const fine = ENCOUNTER_TERRAINS[key];
  if (fine) return { ground: fine.ground ?? null, encounterTerrain: key };
  return { ground: key, encounterTerrain: encounterTerrainFor(key) || null };
}

/**
 * Read the country at a point.
 *
 * Each key answers from the map where the map says something — a painted hex,
 * a drawn line — and from the scene's default where it does not; the climate
 * is the scene's alone, never painted per hex; `source`
 * names which, per key: "map", "scene", or null where neither answered and the
 * value is null. The territory has a source between the two: a hex with no
 * territory painted takes the one a layer DERIVES for it (a domain's class),
 * and `source` names that layer by its key ("domain"); a territory painted on
 * the hex is the Judge's word over it. A drawn layer speaks only on a scene that has one: `road` is
 * read where the scene has road walls and `following` where it has water
 * lines (a navigable one under the point is "river"), and each is null
 * elsewhere — silence the next source answers, not a "none" the map never
 * said. A painted hex that names no encounter table leaves it null rather
 * than borrowing the scene default's, which describes other country.
 *
 * `waterBorne` is the party moving on the water: while it holds and any water
 * line is under the point, the encounter table is the river's for the ground
 * (`riverTableFor`). The formation does not pass it: it caches the reading
 * with its `water` and applies the same rule at resolution, so the option
 * serves a caller asking the scene directly.
 *
 * @returns {{ground: string|null, encounterTerrain: string|null,
 *   territory: string|null, climate: string|null, road: string|null,
 *   following: string|null, water: {kind: string, navigable: boolean}|null,
 *   source: Record<string, string|null>}} `source` is "map", "scene", null, or
 *   for the territory the key of the layer that derived it
 */
export function countryAt(scene, point, { waterBorne = false } = {}) {
  const fallback = sceneCountry(scene);
  const paintedKey = terrainAtPoint(scene, point);
  const painted = readBrushValue(paintedKey);
  const defaulted = readBrushValue(fallback.ground);
  const source = {};
  const pick = (key, mapValue, sceneValue) => {
    source[key] = mapValue != null ? "map" : sceneValue != null ? "scene" : null;
    return mapValue ?? sceneValue ?? null;
  };

  const ground = pick("ground", painted.ground, defaulted.ground);
  const near = waterUnder(scene, point);
  let encounterTerrain;
  if (waterBorne && near) {
    encounterTerrain = riverTableFor(ground);
    source.encounterTerrain = "map";
  } else {
    encounterTerrain = pick("encounterTerrain", painted.encounterTerrain, paintedKey ? null : defaulted.encounterTerrain);
  }

  const painting = (layer, valid) => {
    const value = layerValueAt(scene, point, layer);
    return valid(value) ? value : null;
  };
  const paintedTerritory = painting("territory", (v) => TERRITORY_KEYS.includes(v));
  const derived = paintedTerritory ? null : derivedValueAt(scene, point, "territory");
  let territory;
  if (!paintedTerritory && TERRITORY_KEYS.includes(derived?.value)) {
    territory = derived.value;
    source.territory = derived.layer;
  } else {
    territory = pick("territory", paintedTerritory, fallback.territory);
  }
  const climate = pick("climate", null, fallback.climate);
  const road = pick("road", roadWallsOf(scene).length ? (roadUnder(scene, point)?.surface ?? "none") : null, null);
  const following = pick(
    "following",
    waterWallsOf(scene).length ? (waterUnder(scene, point, null, { navigable: true }) ? "river" : "none") : null,
    null,
  );

  return {
    ground,
    encounterTerrain,
    territory,
    climate,
    road,
    following,
    water: near ? { kind: near.kind, navigable: near.navigable } : null,
    source,
  };
}
