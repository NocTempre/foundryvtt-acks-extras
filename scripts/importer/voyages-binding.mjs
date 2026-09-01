/**
 * Voyage-table assembly: the raw RR ch. 7 reads → the engine-shaped
 * `voyages` ruledata tables acks-extras declares (its sea speed, navigation,
 * hazard and hull-damage derivations read them via `expectTables`). The raw
 * tables keep the pages' shapes — the wind grid's factor cells and band
 * spreads, prose windows around each printed figure; this step turns them
 * into the wind rows `seaSpeeds` brackets on, the navigation and hazard
 * targets and bonuses, each hazard's dice and rates, and the hull damage
 * shares — judgments the recipes must not make and the reader must not
 * repeat. Like every binding here, no value ships.
 */
import { MODULE_ID } from "./constants.mjs";
import * as services from "../lib/services.mjs";
import { hasDoc, getDoc, PRIORITY } from "../lib/tables.mjs";
import { parseMultiplier } from "./travel-binding.mjs";

/** The engine doc both halves agree on (acks-extras `expectTables`). */
export const VOYAGES_DOC_ID = "voyages";

/* ------------------------------------------------------------------ */
/*  Parsers                                                            */
/* ------------------------------------------------------------------ */

/** "+1" | "-2" | "0" → the signed number; junk → null. */
export function parseSigned(cell) {
  const m = /([+-]?\d+)/.exec(String(cell ?? ""));
  return m ? Number(m[1]) : null;
}

/** "11+" (in a short window) → 11; junk → null. */
export function parseTargetPlus(window) {
  const m = /(\d+)\s*\+/.exec(String(window ?? ""));
  return m ? Number(m[1]) : null;
}

/** A signed bonus out of a prose window ("gains a +4 bonus…"). */
export function parseBonus(window) {
  const m = /([+-]\s*\d+)/.exec(String(window ?? ""));
  return m ? Number(m[1].replace(/\s+/g, "")) : null;
}

/** The first NdM in a window; junk → null. */
export function parseDice(window) {
  const m = /(\d+\s*d\s*\d+)/i.exec(String(window ?? ""));
  return m ? m[1].replace(/\s+/g, "").toLowerCase() : null;
}

/** The first fraction-or-number in a window ("1/10", "×1/3"). */
export function parseShare(window) {
  return parseMultiplier(String(window ?? ""));
}

/* ------------------------------------------------------------------ */
/*  Assembly                                                           */
/* ------------------------------------------------------------------ */

/**
 * The engine tables from the raw ones. Pure — the committed tests feed it
 * invented cells. Each half assembles independently, so partial coverage
 * still yields what its pages held.
 */
export function assembleVoyageTables(raw = {}) {
  const out = {};

  const wind = raw.windStrengthRaw;
  if (wind) {
    const rows = [];
    for (const [key, cells] of Object.entries(wind)) {
      // The spread rides the row from the label (spreadBand labelPattern).
      const sail = parseMultiplier(cells?.sail);
      const oar = parseMultiplier(cells?.oar);
      const row = {
        key,
        ...(Number.isFinite(cells?.min) ? { min: cells.min } : {}),
        max: Number.isFinite(cells?.max) ? cells.max : null,
        ...(sail != null ? { sail } : {}),
        ...(oar != null ? { oar } : {}),
      };
      const next = parseSigned(cells?.nextDay);
      if (next != null) row.nextDay = next;
      if (sail != null || oar != null) rows.push(row);
    }
    if (rows.length) {
      rows.sort((a, b) => (a.min ?? 0) - (b.min ?? 0));
      // Winter's +2 can push a roll past the printed top: the last band
      // opens upward, the bracket convention everywhere else.
      rows[rows.length - 1].max = null;
      out.windStrength = rows;
    }
  }

  const prose = raw.voyagesProse ?? {};
  const flat = Object.assign({}, ...Object.values(prose).filter((v) => v && typeof v === "object"), prose);

  const tackRate = parseShare(flat.tackRate);
  if (tackRate != null) out.tacking = { multiplier: tackRate };

  const berth = Number(flat.berthStone);
  if (Number.isFinite(berth) && berth > 0) out.berth = { stone: berth };

  if (raw.navigationRaw) {
    const targets = {};
    for (const [water, cells] of Object.entries(raw.navigationRaw)) {
      const t = parseTargetPlus(cells?.target);
      if (t != null) targets[water] = t;
    }
    const nav = { ...(Object.keys(targets).length ? { targets } : {}) };
    // One sentence prices both arts: the first bonus is one art's, the
    // second is both together.
    const bonuses = [...String(flat.oneArt ?? "").matchAll(/([+-]\s*\d+)/g)].map((m) => Math.abs(Number(m[1].replace(/\s+/g, ""))));
    if (bonuses[0] != null) nav.oneArt = bonuses[0];
    if (bonuses[1] != null) nav.bothArts = bonuses[1];
    if (Object.keys(nav).length) out.navigation = nav;
  }

  {
    // One sentence carries the captain's target and the master mariner's
    // parenthetical: the first N+ is the captain's, the second the master's.
    const throwTable = {};
    const targets = [...String(flat.captain ?? "").matchAll(/(\d+)\s*\+/g)].map((m) => Number(m[1]));
    if (targets[0] != null) throwTable.captain = targets[0];
    if (targets[1] != null) throwTable.masterMariner = targets[1];
    const half = parseBonus(flat.halfSpeed);
    const shallow = parseBonus(flat.shallowDraft);
    if (half != null) throwTable.halfSpeed = Math.abs(half);
    if (shallow != null) throwTable.shallowDraft = Math.abs(shallow);
    if (Object.keys(throwTable).length) out.hazardThrow = throwTable;
  }

  {
    const hazards = {};
    const kelpDice = parseDice(flat.kelpFree);
    const kelpTons = /(\d+)\s*tons/i.exec(String(flat.kelpFree ?? ""));
    if (kelpDice) {
      hazards.kelpForest = {
        freeFormula: kelpDice,
        ...(kelpTons ? { hoursPerTons: 1, perTons: Number(kelpTons[1]) } : {}),
      };
    }
    const rock = parseDice(flat.rockDamage);
    if (rock) hazards.rockReefWreck = { damage: rock };
    const shoal = parseDice(flat.shoalDamage);
    if (shoal) {
      const refloat = parseDice(flat.refloat);
      const perStone = /(\d+)\s*st/i.exec(String(flat.lightenStone ?? ""));
      const pct = /(\d+)\s*%/.exec(String(flat.lighten ?? ""));
      const unload = /(\d+)\s*st/i.exec(String(flat.unloadStone ?? ""));
      hazards.sandbarShoal = {
        damage: shoal,
        ...(refloat ? { freeFormula: refloat } : {}),
        ...(pct && perStone ? { escapePctPerStone: Number(pct[1]) / 100, perStone: Number(perStone[1]) } : {}),
        ...(unload ? { unloadStonePerTurn: Number(unload[1]) } : {}),
      };
    }
    if (Object.keys(hazards).length) out.hazards = hazards;
  }

  {
    const WORD_INTS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    const WORD_FRACTIONS = { half: 0.5, third: 1 / 3, quarter: 0.25 };
    const repair = {};
    const crewM = new RegExp(`(${Object.keys(WORD_INTS).join("|")}|\\d+)\\s*crew`).exec(String(flat.repairCrew ?? "").toLowerCase());
    if (crewM) repair.crewPerPoint = WORD_INTS[crewM[1]] ?? Number(crewM[1]);
    const fracM = /(half|third|quarter)/.exec(String(flat.seaHalf ?? "").toLowerCase());
    if (fracM) repair.seaFraction = WORD_FRACTIONS[fracM[1]];
    if (Object.keys(repair).length) out.repair = repair;

    const rounding = {};
    const vRound = /(\d+)/.exec(String(flat.roundVoyage ?? ""));
    const cRound = /(\d+)/.exec(String(flat.roundCombat ?? ""));
    if (vRound) rounding.voyageMiles = Number(vRound[1]);
    if (cRound) rounding.combatFeet = Number(cRound[1]);
    if (Object.keys(rounding).length) out.rounding = rounding;
  }

  {
    const shares = {};
    const light = parseShare(flat.lightBallista);
    const third = parseShare(flat.heavyThird);
    const spells = parseShare(flat.spells);
    const divisor = Number(flat.aoeDivisor);
    if (light != null) shares.lightBallista = light;
    if (third != null) shares.heavyThird = third;
    if (spells != null) shares.spells = spells;
    if (Number.isFinite(divisor)) shares.aoeDivisor = divisor;
    const sink = parseDice(flat.sinkDice);
    if (sink) shares.sinkDice = sink;
    if (Object.keys(shares).length) out.damageShares = shares;
  }

  return out;
}

/**
 * Merge the engine-shaped tables into the imported `voyages` doc — the
 * travel-binding pattern: raw tables stay beside the assembled ones, so a
 * re-import grows the doc instead of replacing it.
 */
export async function applyVoyagesImport() {
  const svc = services.get("ruledata-import");
  if (!svc || !hasDoc(VOYAGES_DOC_ID)) return { assembled: [] };
  const doc = getDoc(VOYAGES_DOC_ID);
  const engine = assembleVoyageTables(doc.tables ?? {});
  if (!Object.keys(engine).length) return { assembled: [] };
  await svc.importDoc(
    { id: VOYAGES_DOC_ID, source: doc.source, tables: { ...(doc.tables ?? {}), ...engine } },
    { priority: PRIORITY.WORLD, source: MODULE_ID },
  );
  return { assembled: Object.keys(engine) };
}
