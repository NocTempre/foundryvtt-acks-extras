/**
 * Encounter-table assembly: the raw JJ/RR reads → the engine-shaped
 * `encounters` ruledata tables acks-extras declares (its formation
 * encounter chain reads them via `expectTables`). The raw tables keep the
 * pages' shapes — outcome rows across five columns, 2-point d100 bands,
 * dice-and-average cells, captured prose windows; this step turns them into
 * bracket bands per column, parses each cell's dice and figures, repairs
 * the small-caps welds in creature names, and reads the printed numbers out
 * of every window — judgments the recipes must not make and the reader must
 * not repeat. Like every binding here, no value ships.
 */
import { MODULE_ID } from "./constants.mjs";
import * as services from "../lib/services.mjs";
import { hasDoc, getDoc, PRIORITY } from "../lib/tables.mjs";

/** The engine doc both halves agree on (acks-extras `expectTables`). */
export const ENCOUNTERS_DOC_ID = "encounters";

/** Raw monster tables → the engine's sub-table keys. */
export const MONSTER_RAW_KEYS = Object.freeze({
  monstersBarrensRockyRaw: "barrensRocky",
  monstersBarrensTundraRaw: "barrensTundra",
  monstersDesertRaw: "desert",
  monstersForestDeciduousRaw: "forestDeciduous",
  monstersForestTaigaRaw: "forestTaiga",
  monstersGrasslandFarmRaw: "grasslandFarm",
  monstersGrasslandSavannaRaw: "grasslandSavanna",
  monstersGrasslandSteppeRaw: "grasslandSteppe",
  monstersHillsRaw: "hills",
  monstersJungleRaw: "jungle",
  monstersMountainsForestedRaw: "mountainsForested",
  monstersMountainsSnowyRaw: "mountainsSnowy",
  monstersMountainsVolcanicRaw: "mountainsVolcanic",
  monstersRiverLandRaw: "riverLand",
  monstersRiverDesertJungleRaw: "riverDesertJungle",
  monstersScrublandSparseRaw: "scrublandSparse",
  monstersScrublandDenseRaw: "scrublandDense",
  monstersSwampRaw: "swamp",
});

/** The stacked civilized grids' columns → the engine's column groups. */
export const CIVILIZED_GROUPS = Object.freeze({
  upper: { g1: "desertBarrens", g2: "grasslandScrubSparse", g3: "savannaJungleRiver", g4: "forestScrubDense" },
  lower: { g1: "taiga", g2: "hillsMountains", g3: "jungle", g4: "swamp" },
});

/* ------------------------------------------------------------------ */
/*  Cell parsers                                                       */
/* ------------------------------------------------------------------ */

/** "2 – 11" → {min:2,max:11}; "18" → {min:18,max:18}; "-" → null. */
export function parseBand(cell) {
  const s = String(cell ?? "").trim();
  if (!s || s === "-" || s === "–") return null;
  const range = /^(\d+)\s*[–—-]\s*(\d+)$/.exec(s);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const one = /^(\d+)$/.exec(s);
  return one ? { min: Number(one[1]), max: Number(one[1]) } : null;
}

/** A row key like "01-02" or "99-00" or "96-100" → its d100 bounds. */
export function bandFromKey(key) {
  const m = /^(\d+)-(\d+)$/.exec(String(key));
  if (!m) return null;
  const min = Number(m[1]);
  let max = Number(m[2]);
  if (max < min) max = 100; // "99-00" prints the wrap
  return { min, max };
}

/**
 * A creature name out of the text layer. Small-caps welds arrive as a
 * stranded single letter ("c amel", "Herd a nimal") — the letter folds
 * into the word that follows it; a glued comma gets its space back; then
 * the case the layer dropped rises at the name's joints — the first
 * letter and each letter after ", ". Mid-name capitals the small caps
 * flattened ("Herd animal") stay flat: the fold is cosmetic and the
 * name-form matching downstream is case-blind.
 */
export function repairName(cell) {
  let s = String(cell ?? "").replace(/\s+/g, " ").trim();
  if (!s || s === "-" || s === "–") return null;
  s = s.replace(/(^|[\s,(/])([A-Za-z]) (?=[a-z])/g, "$1$2");
  s = s.replace(/,(?=\S)/g, ", ");
  return s
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/, ./g, (c) => c.toUpperCase());
}

/** "4d6 × 30' (420')" → {dice:"4d6", mult:30, avg:420}; junk → null. */
export function parseDistanceCell(cell) {
  const s = String(cell ?? "");
  const m = /(\d+\s*d\s*\d+)\s*[×x]\s*(\d+)[^(]*\(\s*([\d,]+)/.exec(s);
  if (!m) return null;
  return { dice: m[1].replace(/\s+/g, ""), mult: Number(m[2]), avg: Number(m[3].replace(/,/g, "")) };
}

/** "12+" → 12; junk → null. */
export function parseTarget(cell) {
  const m = /(\d+)\s*\+/.exec(String(cell ?? ""));
  return m ? Number(m[1]) : null;
}

/** The size header window "…6- 7 to 14 15 to 30 31 to 60 61+" → [6,14,30,60]. */
export function parseSizeEdges(window) {
  const s = String(window ?? "").toLowerCase();
  const first = /(\d+)\s*-/.exec(s);
  const pairs = [...s.matchAll(/\d+\s*to\s*(\d+)/g)].map((m) => Number(m[1]));
  if (!first || pairs.length < 3) return null;
  return [Number(first[1]), ...pairs.slice(0, 3)];
}

const WORD_FRACTIONS = { half: 0.5, third: 1 / 3, quarter: 0.25 };

/* ------------------------------------------------------------------ */
/*  Assembly                                                           */
/* ------------------------------------------------------------------ */

/** Outcome-rows-with-band-cells → per-column bracket rows for the engine. */
export function assembleColumns(raw, cellKeys, field) {
  const out = {};
  for (const column of cellKeys) {
    const bands = [];
    for (const [rowKey, cells] of Object.entries(raw ?? {})) {
      const band = parseBand(cells?.[column]);
      if (band) bands.push({ ...band, [field]: rowKey });
    }
    if (bands.length) out[column] = bands.sort((a, b) => a.min - b.min);
  }
  return out;
}

/**
 * One raw name grid → per-column [{min,max,name}]. A row's band comes from
 * its labelPattern fields (the monster grids, whose band widths vary per
 * table) or from its key (the civilized grids, keyed by the printed band).
 */
function assembleNameGrid(raw, columns) {
  const out = {};
  for (const column of Object.keys(columns)) {
    const bands = [];
    for (const [rowKey, cells] of Object.entries(raw ?? {})) {
      const band = Number.isFinite(cells?.min) && Number.isFinite(cells?.max)
        ? { min: cells.min, max: cells.max }
        : bandFromKey(rowKey);
      const name = repairName(cells?.[column]);
      if (band && name) bands.push({ min: band.min, max: Math.min(band.max, 100), name });
    }
    if (bands.length) out[columns[column]] = bands.sort((a, b) => a.min - b.min);
  }
  return out;
}

/**
 * The engine tables from the raw ones. Pure — the committed tests feed it
 * invented cells. Each half assembles independently, so a partial import
 * (one monster batch, the grids without the prose) still yields what its
 * pages held.
 */
export function assembleEncounterTables(raw = {}) {
  const out = {};

  if (raw.territoryRaw) {
    const columns = assembleColumns(
      raw.territoryRaw,
      ["civilizedRoad", "civilizedOrBorderlandsRoad", "borderlandsOrOutlandsRoad", "outlandsOrUnsettledRoad", "unsettled"],
      "outcome",
    );
    if (Object.keys(columns).length) out.territory = columns;
  }

  if (raw.rarityRaw) {
    const columns = assembleColumns(raw.rarityRaw, ["civilized", "borderlands", "outlands", "unsettled"], "rarity");
    if (Object.keys(columns).length) out.rarity = columns;
  }

  const civilized = {
    ...assembleNameGrid(raw.civilizedUpperRaw, CIVILIZED_GROUPS.upper),
    ...assembleNameGrid(raw.civilizedLowerRaw, CIVILIZED_GROUPS.lower),
  };
  if (Object.keys(civilized).length) out.civilized = civilized;

  const RARITY_COLUMNS = { common: "common", uncommon: "uncommon", rare: "rare", veryRare: "veryRare" };
  for (const [rawKey, tableKey] of Object.entries(MONSTER_RAW_KEYS)) {
    if (!raw[rawKey]) continue;
    const grid = assembleNameGrid(raw[rawKey], RARITY_COLUMNS);
    if (Object.keys(grid).length) out[`monsters.${tableKey}`] = grid;
  }

  if (raw.distanceRaw) {
    const distance = {};
    for (const [terrain, cells] of Object.entries(raw.distanceRaw)) {
      const row = parseDistanceCell(cells?.cell);
      if (row) distance[terrain] = row;
    }
    if (Object.keys(distance).length) out.distance = distance;
  }

  if (raw.evasionRaw) {
    const edges = parseSizeEdges(raw.evasionSizeProse?.bands);
    if (edges) {
      const bounds = [
        { min: null, max: edges[0] },
        { min: edges[0] + 1, max: edges[1] },
        { min: edges[1] + 1, max: edges[2] },
        { min: edges[2] + 1, max: edges[3] },
        { min: edges[3] + 1, max: null },
      ];
      const evasion = {};
      for (const [terrain, cells] of Object.entries(raw.evasionRaw)) {
        const bands = [];
        ["s1", "s2", "s3", "s4", "s5"].forEach((k, i) => {
          const target = parseTarget(cells?.[k]);
          if (target != null) bands.push({ ...bounds[i], target });
        });
        if (bands.length) evasion[terrain] = bands;
      }
      if (Object.keys(evasion).length) out.evasion = evasion;
    }
  }

  const vis = raw.visibilityProse;
  if (vis) {
    const visibility = {};
    const light = String(vis.light ?? "").toLowerCase();
    const lightVal = (re) => {
      const m = re.exec(light);
      return m ? Number(m[1]) : null;
    };
    const day = lightVal(/(\d+)[’']?\s*in\s*daylight/);
    const full = lightVal(/(\d+)[’']?\s*in\s*full/);
    const half = lightVal(/(\d+)[’']?\s*in\s*half/);
    const star = lightVal(/(\d+)[’']?\s*in\s*starlight/);
    if (day != null) visibility.daylight = day;
    if (full != null) visibility.fullMoon = full;
    if (half != null) visibility.halfMoon = half;
    if (star != null) visibility.starlight = star;

    const scaleRow = (window) => {
      const s = String(window ?? "");
      const band = /\((\d+)\s*[–—-]\s*(\d+)\s*men\)/.exec(s);
      const open = /\((\d+)\+\s*men\)/.exec(s);
      const pct = /\+\s*(\d+)\s*%/.exec(s);
      if (!pct) return null;
      if (band) return { min: Number(band[1]), max: Number(band[2]), pct: Number(pct[1]) };
      if (open) return { min: Number(open[1]), max: null, pct: Number(pct[1]) };
      return null;
    };
    const rows = [vis.party, vis.platoon, vis.company, vis.battalion].map(scaleRow).filter(Boolean);
    if (rows.length) {
      // Below the smallest printed band the formation is ordinary men: ×1.
      const floor = Math.min(...rows.map((r) => r.min)) - 1;
      visibility.formationScale = [{ min: null, max: floor, pct: 0 }, ...rows.sort((a, b) => a.min - b.min)];
    }

    // The window opens AFTER its find ("count each mounted man…"), so the
    // first figure is the mounted/large count with its lead-in cut off.
    const heads = String(vis.heads ?? "").toLowerCase();
    const head = (re) => {
      const m = re.exec(heads);
      return m ? Number(m[1]) : null;
    };
    const mountedLarge = head(/(?:or large creature )?as (\d+)/);
    const counts = {
      mounted: mountedLarge,
      large: mountedLarge,
      huge: head(/huge creature as (\d+)/),
      gigantic: head(/gigantic creature as (\d+)/),
      colossal: head(/colossal creature as (\d+)/),
    };
    const kept = Object.fromEntries(Object.entries(counts).filter(([, v]) => v != null));
    if (Object.keys(kept).length) visibility.headCounts = kept;

    const alt = /one-?\s*(half|third|quarter)/.exec(String(vis.altitude ?? "").toLowerCase());
    if (alt) visibility.altitudeFraction = WORD_FRACTIONS[alt[1]];

    if (Object.keys(visibility).length) out.visibility = visibility;
  }

  const mods = raw.evasionModsProse;
  if (mods) {
    // The executor keys valueBlocks results by block id; flatten every
    // block back to the sentence keys (top-level keys ride for tests).
    const flat = Object.assign(
      {},
      ...Object.values(mods).filter((v) => v && typeof v === "object"),
      mods,
    );
    const modifiers = {};
    for (const key of ["aerial", "explorer", "forlornHope", "movement"]) {
      const v = Number(flat[key]);
      if (Number.isFinite(v)) modifiers[key] = Math.abs(v);
    }
    const nav = Number(flat.aftermathNavigation);
    if (Number.isFinite(nav)) modifiers.aftermathNavigation = nav;
    if (Object.keys(modifiers).length) out.evasionModifiers = modifiers;
  }

  const lists = {};
  for (const [rawKey, kind] of [["valuableTerrainRaw", "valuable"], ["dangerousTerrainRaw", "dangerous"], ["uniqueTerrainRaw", "unique"]]) {
    const rows = raw[rawKey];
    if (!rows) continue;
    const list = Array.from({ length: 12 }, (_, i) => repairName(rows[String(i + 1)]?.name)).filter(Boolean);
    if (list.length === 12) lists[kind] = list;
  }
  if (Object.keys(lists).length) out.terrainEncounters = lists;

  return out;
}

/**
 * Merge the engine-shaped tables into the imported `encounters` doc — the
 * travel-binding pattern: raw tables stay beside the assembled ones, so a
 * re-import or a later monster batch grows the doc instead of replacing it.
 */
export async function applyEncountersImport() {
  const svc = services.get("ruledata-import");
  if (!svc || !hasDoc(ENCOUNTERS_DOC_ID)) return { assembled: [] };
  const doc = getDoc(ENCOUNTERS_DOC_ID);
  const engine = assembleEncounterTables(doc.tables ?? {});
  if (!Object.keys(engine).length) return { assembled: [] };
  await svc.importDoc(
    { id: ENCOUNTERS_DOC_ID, source: doc.source, tables: { ...(doc.tables ?? {}), ...engine } },
    { priority: PRIORITY.WORLD, source: MODULE_ID },
  );
  return { assembled: Object.keys(engine) };
}
