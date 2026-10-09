/**
 * The encounter terrains a Judge can stand a party in — the UNION of the
 * grains the book's tables are printed at, because they differ: the monster
 * sub-tables split by weather biome (tundra barrens, three mountain skies,
 * two rivers), while distance and evasion split by cover and rivers have no
 * row at all. Each pick maps itself onto every consumer: `monsters` names
 * its sub-table, `distance`/`evasion` its RR row (null = the book prints
 * none — the card hands those steps back), `civilized` its column group.
 * `closed` marks the country that shelters a party from flyers (the aerial
 * evasion exemption); `ground` is the coarse travel-ground key the pick
 * stands on (null for a river, which runs through whatever ground the party
 * keeps) and `groundDefault` marks the pick a bare ground answers for;
 * `treasure` and `ruin` name the terrain-group row the pick reads in each
 * terrain lookup; `lairs` names the row the pick reads in the lairs-per-hex
 * table (null = the book prints no row for it).
 *
 * A leaf: the encounter chain and the battlemap's brush both read the
 * register, and neither imports the other for it. Plain objects, no Foundry.
 */
export const ENCOUNTER_TERRAINS = Object.freeze({
  barrensRocky: { label: "ACKS-FORMATION.travel.enc.terrain.barrensRocky", lairs: "barrens", ground: "barrens", groundDefault: true, civilized: "desertBarrens", monsters: "barrensRocky", distance: "barrens", evasion: "barrens", treasure: "hillsBarrenSwamp", ruin: "jungleSwampOceanDesertBarren" },
  barrensTundra: { label: "ACKS-FORMATION.travel.enc.terrain.barrensTundra", lairs: "barrens", ground: "barrens", civilized: "desertBarrens", monsters: "barrensTundra", distance: "barrens", evasion: "barrens", treasure: "hillsBarrenSwamp", ruin: "jungleSwampOceanDesertBarren" },
  desertRocky: { label: "ACKS-FORMATION.travel.enc.terrain.desertRocky", lairs: "desertRocky", ground: "desert", civilized: "desertBarrens", monsters: "desert", distance: "desertRocky", evasion: "desertRocky", treasure: "desertMountain", ruin: "jungleSwampOceanDesertBarren" },
  desertSandy: { label: "ACKS-FORMATION.travel.enc.terrain.desertSandy", lairs: "desertSandy", ground: "desert", groundDefault: true, civilized: "desertBarrens", monsters: "desert", distance: "desertSandy", evasion: "desertSandy", treasure: "desertMountain", ruin: "jungleSwampOceanDesertBarren" },
  forestDeciduous: { label: "ACKS-FORMATION.travel.enc.terrain.forestDeciduous", lairs: "forest", ground: "forest", groundDefault: true, closed: true, civilized: "forestScrubDense", monsters: "forestDeciduous", distance: "forestDeciduous", evasion: "forestDeciduous", treasure: "forest", ruin: "hillsMountainsForestRiver" },
  forestTaiga: { label: "ACKS-FORMATION.travel.enc.terrain.forestTaiga", lairs: "forest", ground: "forest", closed: true, civilized: "taiga", monsters: "forestTaiga", distance: "forestTaiga", evasion: "forestTaiga", treasure: "forest", ruin: "hillsMountainsForestRiver" },
  grassland: { label: "ACKS-FORMATION.travel.enc.terrain.grassland", lairs: "grassland", ground: "grassland", groundDefault: true, civilized: "grasslandScrubSparse", monsters: "grasslandFarm", distance: "grassland", evasion: "grassland", treasure: "clearGrassScrub", ruin: "clearGrassScrub" },
  grasslandSavanna: { label: "ACKS-FORMATION.travel.enc.terrain.grasslandSavanna", lairs: "grassland", ground: "grassland", civilized: "savannaJungleRiver", monsters: "grasslandSavanna", distance: "grassland", evasion: "grassland", treasure: "clearGrassScrub", ruin: "clearGrassScrub" },
  grasslandSteppe: { label: "ACKS-FORMATION.travel.enc.terrain.grasslandSteppe", lairs: "grasslandSteppe", ground: "grassland", civilized: "grasslandScrubSparse", monsters: "grasslandSteppe", distance: "grasslandSteppe", evasion: "grasslandSteppe", treasure: "clearGrassScrub", ruin: "clearGrassScrub" },
  hillsForested: { label: "ACKS-FORMATION.travel.enc.terrain.hillsForested", lairs: "hillsForested", ground: "hills", closed: true, civilized: "hillsMountains", monsters: "hills", distance: "hillsForested", evasion: "hillsForested", treasure: "hillsBarrenSwamp", ruin: "hillsMountainsForestRiver" },
  hillsRocky: { label: "ACKS-FORMATION.travel.enc.terrain.hillsRocky", lairs: "hillsRocky", ground: "hills", groundDefault: true, civilized: "hillsMountains", monsters: "hills", distance: "hillsRocky", evasion: "hillsRocky", treasure: "hillsBarrenSwamp", ruin: "hillsMountainsForestRiver" },
  jungle: { label: "ACKS-FORMATION.travel.enc.terrain.jungle", lairs: "jungle", ground: "jungle", groundDefault: true, closed: true, civilized: "jungle", monsters: "jungle", distance: "jungle", evasion: "jungle", treasure: "jungle", ruin: "jungleSwampOceanDesertBarren" },
  mountainsForested: { label: "ACKS-FORMATION.travel.enc.terrain.mountainsForested", lairs: "mountainsForested", ground: "mountains", closed: true, civilized: "hillsMountains", monsters: "mountainsForested", distance: "mountainsForested", evasion: "mountainsForested", treasure: "desertMountain", ruin: "hillsMountainsForestRiver" },
  mountainsRocky: { label: "ACKS-FORMATION.travel.enc.terrain.mountainsRocky", lairs: "mountainsRocky", ground: "mountains", groundDefault: true, civilized: "hillsMountains", monsters: "mountainsForested", distance: "mountainsRocky", evasion: "mountainsRocky", treasure: "desertMountain", ruin: "hillsMountainsForestRiver" },
  mountainsSnowy: { label: "ACKS-FORMATION.travel.enc.terrain.mountainsSnowy", lairs: "mountainsRocky", ground: "mountains", civilized: "hillsMountains", monsters: "mountainsSnowy", distance: "mountainsRocky", evasion: "mountainsRocky", treasure: "desertMountain", ruin: "hillsMountainsForestRiver" },
  mountainsVolcanic: { label: "ACKS-FORMATION.travel.enc.terrain.mountainsVolcanic", lairs: "mountainsRocky", ground: "mountains", civilized: "hillsMountains", monsters: "mountainsVolcanic", distance: "mountainsRocky", evasion: "mountainsRocky", treasure: "desertMountain", ruin: "hillsMountainsForestRiver" },
  riverLand: { label: "ACKS-FORMATION.travel.enc.terrain.riverLand", lairs: null, ground: null, civilized: "grasslandScrubSparse", monsters: "riverLand", distance: null, evasion: null, treasure: "river", ruin: "hillsMountainsForestRiver" },
  riverDesertJungle: { label: "ACKS-FORMATION.travel.enc.terrain.riverDesertJungle", lairs: null, ground: null, civilized: "savannaJungleRiver", monsters: "riverDesertJungle", distance: null, evasion: null, treasure: "river", ruin: "hillsMountainsForestRiver" },
  scrublandSparse: { label: "ACKS-FORMATION.travel.enc.terrain.scrublandSparse", lairs: "scrublandSparse", ground: "scrubland", groundDefault: true, civilized: "grasslandScrubSparse", monsters: "scrublandSparse", distance: "scrublandSparse", evasion: "scrublandSparse", treasure: "clearGrassScrub", ruin: "clearGrassScrub" },
  scrublandDense: { label: "ACKS-FORMATION.travel.enc.terrain.scrublandDense", lairs: "scrublandDense", ground: "scrubland", closed: true, civilized: "forestScrubDense", monsters: "scrublandDense", distance: "scrublandDense", evasion: "scrublandDense", treasure: "clearGrassScrub", ruin: "clearGrassScrub" },
  swampMarshy: { label: "ACKS-FORMATION.travel.enc.terrain.swampMarshy", lairs: "swamp", ground: "swamp", groundDefault: true, closed: true, civilized: "swamp", monsters: "swamp", distance: "swampMarshy", evasion: "swampMarshy", treasure: "hillsBarrenSwamp", ruin: "jungleSwampOceanDesertBarren" },
  swampScrubby: { label: "ACKS-FORMATION.travel.enc.terrain.swampScrubby", lairs: "swamp", ground: "swamp", closed: true, civilized: "swamp", monsters: "swamp", distance: "swampScrubby", evasion: "swampScrubby", treasure: "hillsBarrenSwamp", ruin: "jungleSwampOceanDesertBarren" },
  swampForested: { label: "ACKS-FORMATION.travel.enc.terrain.swampForested", lairs: "swamp", ground: "swamp", closed: true, civilized: "swamp", monsters: "swamp", distance: "swampForested", evasion: "swampForested", treasure: "hillsBarrenSwamp", ruin: "jungleSwampOceanDesertBarren" },
});

/** The eighteen monster sub-tables the picks above draw from. */
export const MONSTER_TABLE_KEYS = Object.freeze([
  ...new Set(Object.values(ENCOUNTER_TERRAINS).map((t) => t.monsters)),
]);

/**
 * The encounter terrain a bare travel ground answers for — the pick marked
 * `groundDefault` for it, or "" when no pick stands on that ground (the
 * Judge's pick, then).
 */
export function encounterTerrainFor(ground) {
  for (const [key, cfg] of Object.entries(ENCOUNTER_TERRAINS)) if (cfg.groundDefault && cfg.ground === ground) return key;
  return "";
}
