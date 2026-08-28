/**
 * The wilderness encounter chain: what a journey's throw finds, how far away
 * it starts, and whether the party can slip away.
 *
 * STRUCTURE ships here; the printed content does not. What ships: the
 * chain's ORDER (territory throw → civilized draw, or rarity throw → the
 * terrain-and-rarity monster draw, or a terrain-encounter kind → its d12),
 * the column-selection rules (a road or navigable river uses the territory's
 * "+ Road" column; night in settled country shifts one column right; a
 * Column Shift result shifts right and re-rolls), the resting/known-route
 * downgrade of terrain encounters, the distance procedure (terrain dice
 * capped by visibility; each side's own terrain when they differ, the longer
 * roll detecting; flyers may open at altitude), the detection hand-off to
 * core's own Surprise Matrix (which owns the matrix, the rolls and the
 * evade permission — nothing here re-derives them), the evasion throw's
 * modifier VOCABULARY, and the aftermath (a flight leg, a clock direction,
 * a navigation throw). What imports (the `encounters` registered document,
 * from the reader's own book): every d20/d100 band, every creature name,
 * every distance die, every visibility figure, every evasion target and
 * modifier size, and the terrain-encounter lists. A missing table resolves
 * to a "draw from your book" line, never a guess.
 *
 * Everything here is arithmetic over plain objects plus registry reads —
 * Node-evaluable, no documents, no Foundry.
 */

import { bracketRow } from "../lib/tables.mjs";
import { readTable } from "../vehicles/vehicle-speed.mjs";
import { TERRITORY_KEYS } from "./travel.mjs";

/** The registered ruledata document the chain reads. */
export const ENCOUNTERS_DOC = "encounters";

/**
 * The territory table's five columns, left to right. The MAPPING from a
 * party's territory and road to a column is the rule's own: each column
 * serves a roaded territory and the next-wilder unroaded one.
 */
export const ENCOUNTER_COLUMNS = Object.freeze([
  "civilizedRoad",
  "civilizedOrBorderlandsRoad",
  "borderlandsOrOutlandsRoad",
  "outlandsOrUnsettledRoad",
  "unsettled",
]);

/** What a territory throw can land on. The terrain kinds share their flag. */
export const ENCOUNTER_OUTCOMES = Object.freeze({
  columnShift: { label: "ACKS-FORMATION.travel.enc.outcome.columnShift" },
  none: { label: "ACKS-FORMATION.travel.enc.outcome.none" },
  civilized: { label: "ACKS-FORMATION.travel.enc.outcome.civilized" },
  monster: { label: "ACKS-FORMATION.travel.enc.outcome.monster" },
  dangerousTerrain: { label: "ACKS-FORMATION.travel.enc.outcome.dangerousTerrain", terrainKind: "dangerous" },
  valuableTerrain: { label: "ACKS-FORMATION.travel.enc.outcome.valuableTerrain", terrainKind: "valuable" },
  uniqueTerrain: { label: "ACKS-FORMATION.travel.enc.outcome.uniqueTerrain", terrainKind: "unique" },
});

/** The four monster rarities, common to every terrain sub-table. */
export const RARITIES = Object.freeze(["common", "uncommon", "rare", "veryRare"]);

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
 * answers for by default.
 */
export const ENCOUNTER_TERRAINS = Object.freeze({
  barrensRocky: { label: "ACKS-FORMATION.travel.enc.terrain.barrensRocky", ground: "barrens", civilized: "desertBarrens", monsters: "barrensRocky", distance: "barrens", evasion: "barrens" },
  barrensTundra: { label: "ACKS-FORMATION.travel.enc.terrain.barrensTundra", civilized: "desertBarrens", monsters: "barrensTundra", distance: "barrens", evasion: "barrens" },
  desertRocky: { label: "ACKS-FORMATION.travel.enc.terrain.desertRocky", civilized: "desertBarrens", monsters: "desert", distance: "desertRocky", evasion: "desertRocky" },
  desertSandy: { label: "ACKS-FORMATION.travel.enc.terrain.desertSandy", ground: "desert", civilized: "desertBarrens", monsters: "desert", distance: "desertSandy", evasion: "desertSandy" },
  forestDeciduous: { label: "ACKS-FORMATION.travel.enc.terrain.forestDeciduous", ground: "forest", closed: true, civilized: "forestScrubDense", monsters: "forestDeciduous", distance: "forestDeciduous", evasion: "forestDeciduous" },
  forestTaiga: { label: "ACKS-FORMATION.travel.enc.terrain.forestTaiga", closed: true, civilized: "taiga", monsters: "forestTaiga", distance: "forestTaiga", evasion: "forestTaiga" },
  grassland: { label: "ACKS-FORMATION.travel.enc.terrain.grassland", ground: "grassland", civilized: "grasslandScrubSparse", monsters: "grasslandFarm", distance: "grassland", evasion: "grassland" },
  grasslandSavanna: { label: "ACKS-FORMATION.travel.enc.terrain.grasslandSavanna", civilized: "savannaJungleRiver", monsters: "grasslandSavanna", distance: "grassland", evasion: "grassland" },
  grasslandSteppe: { label: "ACKS-FORMATION.travel.enc.terrain.grasslandSteppe", civilized: "grasslandScrubSparse", monsters: "grasslandSteppe", distance: "grasslandSteppe", evasion: "grasslandSteppe" },
  hillsForested: { label: "ACKS-FORMATION.travel.enc.terrain.hillsForested", closed: true, civilized: "hillsMountains", monsters: "hills", distance: "hillsForested", evasion: "hillsForested" },
  hillsRocky: { label: "ACKS-FORMATION.travel.enc.terrain.hillsRocky", ground: "hills", civilized: "hillsMountains", monsters: "hills", distance: "hillsRocky", evasion: "hillsRocky" },
  jungle: { label: "ACKS-FORMATION.travel.enc.terrain.jungle", ground: "jungle", closed: true, civilized: "jungle", monsters: "jungle", distance: "jungle", evasion: "jungle" },
  mountainsForested: { label: "ACKS-FORMATION.travel.enc.terrain.mountainsForested", closed: true, civilized: "hillsMountains", monsters: "mountainsForested", distance: "mountainsForested", evasion: "mountainsForested" },
  mountainsRocky: { label: "ACKS-FORMATION.travel.enc.terrain.mountainsRocky", ground: "mountains", civilized: "hillsMountains", monsters: "mountainsForested", distance: "mountainsRocky", evasion: "mountainsRocky" },
  mountainsSnowy: { label: "ACKS-FORMATION.travel.enc.terrain.mountainsSnowy", civilized: "hillsMountains", monsters: "mountainsSnowy", distance: "mountainsRocky", evasion: "mountainsRocky" },
  mountainsVolcanic: { label: "ACKS-FORMATION.travel.enc.terrain.mountainsVolcanic", civilized: "hillsMountains", monsters: "mountainsVolcanic", distance: "mountainsRocky", evasion: "mountainsRocky" },
  riverLand: { label: "ACKS-FORMATION.travel.enc.terrain.riverLand", civilized: "grasslandScrubSparse", monsters: "riverLand", distance: null, evasion: null },
  riverDesertJungle: { label: "ACKS-FORMATION.travel.enc.terrain.riverDesertJungle", civilized: "savannaJungleRiver", monsters: "riverDesertJungle", distance: null, evasion: null },
  scrublandSparse: { label: "ACKS-FORMATION.travel.enc.terrain.scrublandSparse", ground: "scrubland", civilized: "grasslandScrubSparse", monsters: "scrublandSparse", distance: "scrublandSparse", evasion: "scrublandSparse" },
  scrublandDense: { label: "ACKS-FORMATION.travel.enc.terrain.scrublandDense", closed: true, civilized: "forestScrubDense", monsters: "scrublandDense", distance: "scrublandDense", evasion: "scrublandDense" },
  swampMarshy: { label: "ACKS-FORMATION.travel.enc.terrain.swampMarshy", ground: "swamp", closed: true, civilized: "swamp", monsters: "swamp", distance: "swampMarshy", evasion: "swampMarshy" },
  swampScrubby: { label: "ACKS-FORMATION.travel.enc.terrain.swampScrubby", closed: true, civilized: "swamp", monsters: "swamp", distance: "swampScrubby", evasion: "swampScrubby" },
  swampForested: { label: "ACKS-FORMATION.travel.enc.terrain.swampForested", closed: true, civilized: "swamp", monsters: "swamp", distance: "swampForested", evasion: "swampForested" },
});

/** The eighteen monster sub-tables the picks above draw from. */
export const MONSTER_TABLE_KEYS = Object.freeze([
  ...new Set(Object.values(ENCOUNTER_TERRAINS).map((t) => t.monsters)),
]);

/** The default encounter terrain for a travel ground, or "" (Judge's pick). */
export function encounterTerrainFor(ground) {
  for (const [key, cfg] of Object.entries(ENCOUNTER_TERRAINS)) if (cfg.ground === ground) return key;
  return "";
}

/** The registered table ids the chain reads (expectTables declares these). */
export const ENCOUNTER_TABLE_IDS = Object.freeze([
  "territory",
  "rarity",
  "civilized",
  "distance",
  "visibility",
  "evasion",
  "evasionModifiers",
  "terrainEncounters",
  ...MONSTER_TABLE_KEYS.map((t) => `monsters.${t}`),
]);

/* -------------------------------------------------------------------- */
/*  Dice                                                                */
/* -------------------------------------------------------------------- */

const die = (faces, rng) => 1 + Math.floor(rng() * faces);
export const d20 = (rng) => die(20, rng);
export const d100 = (rng) => die(100, rng);
export const d12 = (rng) => die(12, rng);

/** "4d6" rolled; junk → null. Multipliers ride separately in the table. */
export function rollDice(expr, rng) {
  const m = /^(\d+)\s*d\s*(\d+)$/i.exec(String(expr ?? "").trim());
  if (!m) return null;
  let total = 0;
  for (let i = 0; i < Number(m[1]); i++) total += die(Number(m[2]), rng);
  return total;
}

/* -------------------------------------------------------------------- */
/*  The chain                                                           */
/* -------------------------------------------------------------------- */

/**
 * Which column of the territory table this party rolls on: the territory's
 * own column, its "+ Road" neighbour when following a road or navigable
 * river, and one column right at night in settled country (unsettled
 * already stands at the wall). Shifts clamp at the last column.
 */
export function encounterColumnFor({ territory = "borderlands", road = false, night = false } = {}) {
  const t = TERRITORY_KEYS.includes(territory) ? territory : "borderlands";
  let index = TERRITORY_KEYS.indexOf(t) + 1; // unroaded: one right of its own road column
  if (road) index -= 1;
  if (night && t !== "unsettled") index += 1;
  return ENCOUNTER_COLUMNS[Math.min(Math.max(index, 0), ENCOUNTER_COLUMNS.length - 1)];
}

/**
 * The territory throw: 1d20 on the party's column, following Column Shift
 * results one column right (bounded by the table's edge — the wall shifts
 * no further). Returns every roll made, so the card can show its work.
 */
export function territoryThrow({ territory, road = false, night = false, rng = Math.random } = {}) {
  const table = readTable(ENCOUNTERS_DOC, "territory");
  if (!table) return { ok: false, missing: "territory" };
  let column = encounterColumnFor({ territory, road, night });
  const rolls = [];
  for (let guard = 0; guard < ENCOUNTER_COLUMNS.length; guard++) {
    const roll = d20(rng);
    const outcome = bracketRow(table[column] ?? [], roll)?.outcome ?? "none";
    rolls.push({ column, roll, outcome });
    if (outcome !== "columnShift") return { ok: true, column, roll, outcome, rolls };
    const next = ENCOUNTER_COLUMNS.indexOf(column) + 1;
    if (next >= ENCOUNTER_COLUMNS.length) return { ok: true, column, roll, outcome: "none", rolls };
    column = ENCOUNTER_COLUMNS[next];
  }
  return { ok: true, column, roll: rolls.at(-1).roll, outcome: "none", rolls };
}

/** The rarity throw: 1d20 against the territory's rarity bands. */
export function rarityThrow({ territory = "borderlands", rng = Math.random } = {}) {
  const table = readTable(ENCOUNTERS_DOC, "rarity");
  const bands = table?.[territory];
  if (!bands) return { ok: false, missing: "rarity" };
  const roll = d20(rng);
  const rarity = bracketRow(bands, roll)?.rarity ?? null;
  return rarity ? { ok: true, roll, rarity } : { ok: true, roll, rarity: RARITIES[0] };
}

/** The terrain-and-rarity monster draw: 1d100 → a creature's printed name. */
export function monsterDraw({ terrain, rarity, rng = Math.random } = {}) {
  const tableKey = ENCOUNTER_TERRAINS[terrain]?.monsters ?? terrain;
  const bands = readTable(ENCOUNTERS_DOC, `monsters.${tableKey}`)?.[rarity];
  if (!bands) return { ok: false, missing: `monsters.${tableKey}` };
  const roll = d100(rng);
  const name = bracketRow(bands, roll)?.name ?? null;
  return { ok: !!name, ...(name ? { roll, name } : { missing: `monsters.${tableKey}` }) };
}

/** The civilized draw: 1d100 on the terrain's column group. */
export function civilizedDraw({ terrain, rng = Math.random } = {}) {
  const group = ENCOUNTER_TERRAINS[terrain]?.civilized;
  const bands = readTable(ENCOUNTERS_DOC, "civilized")?.[group];
  if (!bands) return { ok: false, missing: "civilized" };
  const roll = d100(rng);
  const name = bracketRow(bands, roll)?.name ?? null;
  return { ok: !!name, ...(name ? { roll, name, group } : { missing: "civilized" }) };
}

/**
 * A terrain-encounter draw: 1d12 on the kind's list. Resting or retracing a
 * known route downgrades the whole outcome to none BEFORE this is rolled —
 * that judgment is the caller's (`runEncounter` applies it).
 */
export function terrainEncounterDraw({ kind, rng = Math.random } = {}) {
  const list = readTable(ENCOUNTERS_DOC, "terrainEncounters")?.[kind];
  if (!Array.isArray(list) || !list.length) return { ok: false, missing: "terrainEncounters" };
  const roll = d12(rng);
  const name = list[roll - 1] ?? null;
  return { ok: !!name, ...(name ? { roll, name } : { missing: "terrainEncounters" }) };
}

/**
 * Encounter distance for one side's terrain: the terrain's dice times its
 * multiplier. The AVERAGE rides along for the card; the cap against
 * visibility is `detection`'s business.
 */
export function encounterDistance({ terrain, rng = Math.random } = {}) {
  const key = ENCOUNTER_TERRAINS[terrain] ? ENCOUNTER_TERRAINS[terrain].distance : terrain;
  // null mapping = the book prints no row for this pick (a river) — a
  // different truth from an unimported table, and the card says which.
  if (!key) return { ok: false, noRow: true };
  const row = readTable(ENCOUNTERS_DOC, "distance")?.[key];
  if (!row) return { ok: false, missing: "distance" };
  const rolled = rollDice(row.dice, rng);
  if (rolled == null) return { ok: false, missing: "distance" };
  return { ok: true, feet: rolled * (Number(row.mult) || 1), dice: row.dice, mult: Number(row.mult) || 1, avg: row.avg ?? null };
}

/**
 * How many "men" a side counts as for visibility and evasion: every printed
 * size rides the imported `headCounts` ladder; a missing ladder counts every
 * body as one and says nothing it cannot back.
 */
export function headEquivalents({ men = 0, mounted = 0, large = 0, huge = 0, gigantic = 0, colossal = 0 } = {}) {
  const ladder = readTable(ENCOUNTERS_DOC, "visibility")?.headCounts ?? {};
  const per = (k, fallback) => Number(ladder[k]) || fallback;
  return (
    men +
    mounted * per("mounted", 1) +
    large * per("large", 1) +
    huge * per("huge", 1) +
    gigantic * per("gigantic", 1) +
    colossal * per("colossal", 1)
  );
}

/**
 * The farthest a side of `heads` men can be SEEN under the given light —
 * the base light figure scaled by the formation-size ladder. Null when the
 * visibility table is not imported (open country then never caps).
 */
export function visibilityMax({ light = "daylight", heads = 1 } = {}) {
  const vis = readTable(ENCOUNTERS_DOC, "visibility");
  const base = Number(vis?.[light]);
  if (!Number.isFinite(base)) return null;
  const scale = bracketRow(vis?.formationScale ?? [], heads)?.pct ?? 0;
  return Math.round(base * (1 + scale / 100));
}

/**
 * Where the two sides actually stand when the encounter begins, and who saw
 * whom: each side rolls its OWN terrain's distance when they differ and the
 * encounter opens at the greater, the greater side detecting; the start is
 * then capped by how far each side can actually be seen. A side whose cap
 * hid it counts as undetected — the detection states the Judge feeds core's
 * Surprise Matrix. Flyers may open at altitude up to the imported fraction
 * of the distance.
 */
export function detection({ partyTerrain, monsterTerrain = null, partyHeads = 1, monsterHeads = 1, light = "daylight", rng = Math.random } = {}) {
  const partyRoll = encounterDistance({ terrain: partyTerrain, rng });
  const monsterRoll = monsterTerrain && monsterTerrain !== partyTerrain
    ? encounterDistance({ terrain: monsterTerrain, rng })
    : null;
  if (!partyRoll.ok) return { ok: false, missing: partyRoll.missing };

  let feet = partyRoll.feet;
  let farSide = null; // who rolled the greater range across terrains
  if (monsterRoll?.ok) {
    farSide = monsterRoll.feet > partyRoll.feet ? "monsters" : "party";
    feet = Math.max(partyRoll.feet, monsterRoll.feet);
  }

  // Each side is visible out to its OWN cap; a side beyond its cap is unseen.
  const partyVisibleAt = visibilityMax({ light, heads: partyHeads });
  const monstersVisibleAt = visibilityMax({ light, heads: monsterHeads });
  const start = Math.min(feet, Math.max(partyVisibleAt ?? feet, monstersVisibleAt ?? feet));
  const partySees = monstersVisibleAt == null || start <= monstersVisibleAt;
  const monstersSee = partyVisibleAt == null || start <= partyVisibleAt;
  const altitudeFraction = Number(readTable(ENCOUNTERS_DOC, "visibility")?.altitudeFraction) || null;

  return {
    ok: true,
    feet: start,
    rolled: feet,
    partyRoll,
    monsterRoll,
    farSide,
    partySees: farSide ? farSide === "party" || partySees : partySees,
    monstersSee: farSide ? farSide === "monsters" || monstersSee : monstersSee,
    altitude: altitudeFraction ? Math.round(start * altitudeFraction) : null,
  };
}

/**
 * The evasion throw's target for this terrain and party size, from the
 * imported per-terrain size bands.
 */
export function evasionTarget({ terrain, partySize = 1 } = {}) {
  const key = ENCOUNTER_TERRAINS[terrain] ? ENCOUNTER_TERRAINS[terrain].evasion : terrain;
  if (!key) return { ok: false, noRow: true };
  const bands = readTable(ENCOUNTERS_DOC, "evasion")?.[key];
  if (!bands) return { ok: false, missing: "evasion" };
  const target = bracketRow(bands, partySize)?.target ?? null;
  return target != null ? { ok: true, target } : { ok: false, missing: "evasion" };
}

/**
 * The evasion modifiers that apply, each its own line: flying monsters over
 * open country, an explorer guiding familiar ground, a forlorn hope holding
 * the rear, and the speed comparison. Which modifiers EXIST is the rule's
 * shape; what each is worth is the imported `evasionModifiers` table. A
 * party that can fly over walkers simply evades — the caller short-circuits
 * on `autoEvade`.
 */
export function evasionModifiers({ terrain, monstersFly = false, partyFlies = false, monstersWalk = true, explorerGuide = false, forlornHope = false, fasterMonsters = false, slowerMonsters = false } = {}) {
  const mods = readTable(ENCOUNTERS_DOC, "evasionModifiers") ?? {};
  const parts = [];
  const add = (key, value, sign) => {
    const v = Number(value);
    if (Number.isFinite(v) && v !== 0) parts.push({ key, value: sign === "-" ? -Math.abs(v) : Math.abs(v) });
  };
  if (partyFlies && monstersWalk) return { autoEvade: true, parts: [] };
  if (monstersFly && !ENCOUNTER_TERRAINS[terrain]?.closed) add("aerial", mods.aerial, "-");
  if (explorerGuide) add("explorer", mods.explorer, "+");
  if (forlornHope) add("forlornHope", mods.forlornHope, "+");
  if (fasterMonsters) add("movement", mods.movement, "-");
  else if (slowerMonsters) add("movement", mods.movement, "+");
  return { autoEvade: false, parts };
}

/**
 * The aftermath of a successful evasion: a flight leg rolled on the same
 * distance table, a clock direction, and the navigation throw (at the
 * imported penalty) to learn whether the party is now lost.
 */
export function aftermath({ terrain, rng = Math.random } = {}) {
  const leg = encounterDistance({ terrain, rng });
  const nav = Number(readTable(ENCOUNTERS_DOC, "evasionModifiers")?.aftermathNavigation);
  return {
    ok: leg.ok,
    ...(leg.ok ? { feet: leg.feet } : { missing: leg.missing }),
    clock: d12(rng),
    navPenalty: Number.isFinite(nav) ? nav : null,
  };
}

/**
 * One whole encounter throw, composed in the rules' order. Pure: the caller
 * supplies territory/road/night/terrain and the flags the rules key on
 * (resting or retracing a known route downgrades terrain encounters), and
 * receives every step with its rolls — or the name of the first table the
 * registry could not answer, where the book takes over.
 */
export function runEncounter({ territory, road = false, night = false, terrain, restingOrKnownRoute = false, rng = Math.random } = {}) {
  const chain = { territory: territoryThrow({ territory, road, night, rng }) };
  if (!chain.territory.ok) return chain;
  let outcome = chain.territory.outcome;

  const kind = ENCOUNTER_OUTCOMES[outcome]?.terrainKind;
  if (kind && restingOrKnownRoute) {
    chain.downgraded = outcome;
    outcome = "none";
  }
  chain.outcome = outcome;
  if (outcome === "none") return chain;

  if (outcome === "civilized") {
    chain.creature = civilizedDraw({ terrain, rng });
  } else if (outcome === "monster") {
    chain.rarity = rarityThrow({ territory, rng });
    if (chain.rarity.ok) chain.creature = monsterDraw({ terrain, rarity: chain.rarity.rarity, rng });
  } else if (kind) {
    chain.terrainEncounter = terrainEncounterDraw({ kind, rng });
  }

  if (outcome === "civilized" || outcome === "monster") {
    chain.distance = encounterDistance({ terrain, rng });
  }
  return chain;
}
