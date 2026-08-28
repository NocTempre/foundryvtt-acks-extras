/**
 * How fast a vehicle actually goes today — the question with the most inputs
 * in the whole ruleset, and the reason vehicles are not just containers.
 *
 * A galley's printed speed is the speed of a galley with every oar manned, a
 * fed crew, a stepped mast and a moderate wind. Take any of those away and the
 * number changes, and the rules for each live in a different section of the
 * book. This module gathers them into one derivation so a sheet can show the
 * real number and say what reduced it.
 *
 * WHAT MOVES A VESSEL (RR ch. 7):
 *  - **missing rowers** reduce rowing speed IN PROPORTION to the shortfall —
 *    half the rowers is half the speed, not a step on a table;
 *  - **an underfed crew** moves at ½ speed under oar or sail; a starving or
 *    dehydrated one at ⅓ (and starts rolling morale, which is a mutiny problem
 *    rather than a speed one);
 *  - **wind** multiplies sail speed from ×0 in a dead calm through ×3/2 in a
 *    strong wind, and above that it starts costing the oars too;
 *  - **a stowed mast** costs the bigger galleys 30' of oar sprint and cruise,
 *    because there is no room to work the oars.
 *
 * WHAT MOVES A CART is simpler and stranger: the printed rows pair a LOAD with
 * a SPEED — "up to 80 stone at 60', or up to 120 stone at 30'" — so a cart
 * does not have a speed and a capacity, it has a speed that depends on how
 * much it is carrying. Loading one more sack can halve the day's travel.
 *
 * Every function here is arithmetic over plain objects: no documents, no dice.
 */

import { getTable, hasDoc, bracketRow } from "../lib/tables.mjs";

/** The registered ruledata documents this module's ground and wind read. */
export const TRAVEL_DOC = "travel";
export const VOYAGES_DOC = "voyages";
export const WEATHER_DOC = "weather";

/** A registered table, or null — absent doc and absent table read the same. */
export function readTable(docId, tableId) {
  try {
    return hasDoc(docId) ? getTable(docId, tableId) : null;
  } catch {
    return null;
  }
}

/**
 * Ground: the STRUCTURAL half only — which terrains exist, which of them
 * refuse wheels without a road, which turn to mud under rain (`mudProne`),
 * and each one's label. What each terrain is WORTH is printed, and arrives
 * through the `travel` registered tables from the reader's own book; absent
 * tables read as ×1 and say so.
 */
export const TERRAIN = Object.freeze({
  grassland: { label: "ACKS-VEHICLES.terrain.grassland", mudProne: true },
  scrubland: { label: "ACKS-VEHICLES.terrain.scrubland", mudProne: true },
  barrens: { label: "ACKS-VEHICLES.terrain.barrens" },
  desert: { label: "ACKS-VEHICLES.terrain.desert", wheelsNeedRoad: true },
  hills: { label: "ACKS-VEHICLES.terrain.hills" },
  forest: { label: "ACKS-VEHICLES.terrain.forest", wheelsNeedRoad: true },
  jungle: { label: "ACKS-VEHICLES.terrain.jungle" },
  mountains: { label: "ACKS-VEHICLES.terrain.mountains", wheelsNeedRoad: true },
  swamp: { label: "ACKS-VEHICLES.terrain.swamp", wheelsNeedRoad: true },
  mud: { label: "ACKS-VEHICLES.terrain.mud" },
  snow: { label: "ACKS-VEHICLES.terrain.snow" },
});

/** The roads a party can be following. Their worth lives in the tables. */
export const ROAD_KINDS = Object.freeze(["none", "earth", "gravel", "paved"]);

/**
 * What the ground does to a vehicle's speed.
 *
 * ORDER MATTERS and the book says so: the road multiplier is applied AFTER
 * the terrain it passes through — the road makes bad country passable, it
 * does not make it good country. A road row may name conditions that null it
 * (`ineffectiveIf`: an earthen road in heavy rain is worth nothing, exactly
 * when a caravan wishes it were), and a driver with Driving is worth the
 * row's better rate — on a road, and nowhere else.
 *
 * Values come from the `travel` registered tables (`terrainMultipliers`:
 * terrain key → factor; `roads`: road kind → {multiplier, drivingMultiplier,
 * ineffectiveIf[]}) and — for the sky — from the `weather` document's
 * `conditionSpeed` table (condition key → factor, cumulative, per JJ ch. 2).
 * With no tables imported every factor is ×1 and ONE `tablesMissing` part
 * says why the ground and the weather are not counting.
 *
 * @param {object} o
 * @param {string} o.terrain a key of TERRAIN
 * @param {string|boolean} o.road a ROAD_KINDS key; `true` (legacy callers)
 *   reads as an earth road
 * @param {boolean} o.driverProficient the reins are held by someone with Driving
 * @param {boolean} o.raining / @param {boolean} o.snowing the legacy manual
 *   flags; a road row naming them in `ineffectiveIf` is nulled by them
 * @param {string[]} [o.conditions] active weather-condition keys (the
 *   formation's `conditionsOf`); each multiplies by its imported factor, and
 *   a road row may name any of them in `ineffectiveIf`. A muddy footing is
 *   lifted by a paved road — the one carve-out the mud rule states.
 */
export function travelMultiplier({ terrain = "grassland", road = "none", driverProficient = false, raining = false, snowing = false, conditions = null } = {}) {
  const ground = TERRAIN[terrain] ?? TERRAIN.grassland;
  const parts = [];
  let multiplier = 1;
  let missing = false;

  const terrains = readTable(TRAVEL_DOC, "terrainMultipliers");
  const t = Number(terrains?.[terrain]);
  if (Number.isFinite(t) && t > 0) {
    multiplier *= t;
    parts.push({ key: `terrain.${terrain}`, factor: t });
  } else {
    missing = true;
  }

  // The words a road row's `ineffectiveIf` can match: the legacy manual
  // flags and every active condition key, one vocabulary.
  const active = new Set(conditions ?? []);
  if (raining || active.has("rainy")) active.add("raining");
  if (snowing || active.has("snowy")) active.add("snowing");

  const roadKind = road === true ? "earth" : road;
  let pavedHolds = false;
  if (roadKind && roadKind !== "none" && ROAD_KINDS.includes(roadKind)) {
    const row = readTable(TRAVEL_DOC, "roads")?.[roadKind];
    if (row) {
      const nulledBy = row.ineffectiveIf ?? [];
      const washedOut = nulledBy.some((k) => active.has(k));
      pavedHolds = roadKind === "paved" && !washedOut;
      const factor = washedOut ? 1 : Number(driverProficient ? (row.drivingMultiplier ?? row.multiplier) : row.multiplier) || 1;
      multiplier *= factor;
      // A washed-out road contributes ×1 but must still SAY so — `note`
      // marks the parts that render despite a silent factor.
      parts.push({ key: washedOut ? "roadWashedOut" : driverProficient ? "roadDriver" : "road", factor, ...(washedOut ? { note: true } : {}) });
    } else {
      missing = true;
    }
  }

  // Each condition is worth what the imported table says, cumulatively.
  // Mud alone yields to pavement: a paved road that still holds lifts the
  // muddy factor (and says so), while snow cares for no road.
  if (active.size) {
    const factors = readTable(WEATHER_DOC, "conditionSpeed");
    if (factors) {
      for (const key of conditions ?? []) {
        const f = Number(factors[key]);
        if (!Number.isFinite(f) || f <= 0 || f === 1) continue;
        if (key === "muddy" && pavedHolds) {
          parts.push({ key: "mudPaved", factor: 1, note: true });
          continue;
        }
        multiplier *= f;
        parts.push({ key: `condition.${key}`, factor: f });
      }
    } else if ((conditions ?? []).length) {
      missing = true;
    }
  }

  if (missing) parts.push({ key: "tablesMissing", factor: 1, missing: true, note: true });
  return { multiplier, parts, ground, missing };
}

/**
 * Wind: the STRUCTURAL half — which strengths exist, their labels, and the
 * rules keyed to a band's IDENTITY (strong and worse forbid tacking except
 * to a master mariner; a gale may set her adrift; still air turns drizzle
 * to mist and rain to fog on land, `stills`; the top two bands impose the
 * windy and stormy weather CONDITIONS, `condition`). The 2d6 band edges and
 * the sail/oar factors are printed, and read from the `voyages` registered
 * table `windStrength` (rows {key, min, max, sail, oar, nextDay}). Land and
 * sea share this one ladder — the weather generator writes the same keys
 * `seaSpeeds` reads.
 */
export const WIND = Object.freeze({
  still: { label: "ACKS-VEHICLES.wind.still", stills: true },
  gentle: { label: "ACKS-VEHICLES.wind.gentle" },
  moderate: { label: "ACKS-VEHICLES.wind.moderate" },
  strong: { label: "ACKS-VEHICLES.wind.strong", noTack: true },
  veryStrong: { label: "ACKS-VEHICLES.wind.veryStrong", noTack: true, condition: "windy" },
  gale: { label: "ACKS-VEHICLES.wind.gale", noTack: true, mayDrift: true, condition: "stormy" },
});

/** The registered wind row for a strength key, or null. */
export function windSpec(key) {
  const rows = readTable(VOYAGES_DOC, "windStrength");
  if (!Array.isArray(rows)) return null;
  return rows.find((r) => r?.key === key) ?? null;
}

/** The wind a 2d6 (plus a winter +2) landed on; moderate when no table is in. */
export function windFor(roll) {
  const rows = readTable(VOYAGES_DOC, "windStrength");
  if (!Array.isArray(rows)) return "moderate";
  const row = bracketRow(rows, Number(roll) || 0);
  return WIND[row?.key] ? row.key : "moderate";
}

/**
 * What the crew's belly does to every speed. Starving outranks underfed — a
 * crew is not both a half and a third.
 */
export function conditionMultiplier({ underfed = false, starving = false } = {}) {
  if (starving) return 1 / 3;
  if (underfed) return 1 / 2;
  return 1;
}

/**
 * How completely a vessel is manned, as a fraction, counting only the roles
 * that actually drive it. Marines do not row.
 *
 * A vessel with no motive role defined at all is treated as fully manned:
 * absence of a crew requirement is a rowboat, not a ghost ship.
 */
export function crewFraction(roles = []) {
  const motive = roles.filter((r) => r.motive && Number(r.required) > 0);
  if (!motive.length) return 1;
  // The WORST-manned role governs. A galley with every sailor and half its
  // rowers is a half-speed galley; the full sail crew cannot row for them.
  return motive.reduce((worst, r) => {
    const have = Math.min(Number(r.aboard) || 0, Number(r.required) || 0);
    return Math.min(worst, have / Number(r.required));
  }, 1);
}

/**
 * A sea vessel's speeds as they actually are right now.
 *
 * @param {object} vehicle the vehicle's `system` data
 * @param {object} [o]
 * @param {string} [o.wind] a key of WIND; omitted means moderate (the printed case)
 * @param {object[]} [o.roles] the EFFECTIVE crew rows (typed hands plus named
 *   attachments), when the caller can see the attached crew this arithmetic
 *   cannot; omitted, the typed rows stand
 * @returns {{oarSprint, oarCruise, oarSlow, sail, voyageOar, voyageSail, reasons: object[]}}
 */
export function seaSpeeds(vehicle, { wind = "moderate", roles = null } = {}) {
  // Seafaring taken three times is a master mariner (RR ch. 3), and that is
  // the rank the wind rules care about.
  const masterMariner = (Number(vehicle?.seafaringRank) || 0) >= 3;
  const s = vehicle?.speeds ?? {};
  const key = WIND[wind] ? wind : "moderate";
  const w = WIND[key];
  const spec = windSpec(key);
  // No wind table imported: the wind neither helps nor hinders, and the one
  // tablesMissing reason says why the weather is not counting.
  const sailF = Number.isFinite(Number(spec?.sail)) ? Number(spec.sail) : 1;
  const oarF = Number.isFinite(Number(spec?.oar)) ? Number(spec.oar) : 1;
  const crew = crewFraction(roles ?? vehicle?.crew?.roles ?? []);
  const cond = conditionMultiplier(vehicle?.condition);
  const reasons = [];
  if (crew < 1) reasons.push({ key: "shortCrew", factor: crew });
  if (cond < 1) reasons.push({ key: vehicle?.condition?.starving ? "starving" : "underfed", factor: cond });
  if (!spec) reasons.push({ key: "tablesMissing", factor: 1, missing: true });
  if (sailF !== 1) reasons.push({ key: `wind.${key}`, factor: sailF, appliesTo: "sail" });
  if (oarF !== 1) reasons.push({ key: `wind.${key}`, factor: oarF, appliesTo: "oar" });

  // A stowed mast leaves the rowers no room: a flat 30' off sprint and cruise
  // rather than a multiplier, so it comes off before anything scales.
  const stow = vehicle?.mastStowed ? 30 : 0;
  const oar = (base) => Math.max(0, ((Number(base) || 0) - stow)) * crew * cond * oarF;
  const plain = (base) => Math.max(0, Number(base) || 0) * crew * cond * oarF;

  // What tacking is worth is printed with the points of sail and read from
  // the same voyages document; without it a master mariner still MAY tack in
  // a strong wind (the permission is structural), with no rate to show.
  const tackFactor = Number(readTable(VOYAGES_DOC, "tacking")?.multiplier);

  return {
    oarSprint: round5(oar(s.oarSprint)),
    oarCruise: round5(oar(s.oarCruise)),
    oarSlow: round5(plain(s.oarSlow)),
    sail: round5((Number(s.sail) || 0) * cond * sailF),
    // Voyage speed under oar takes the crew shortfall the same way; under sail
    // the wind governs and the rowers are irrelevant.
    voyageOar: round1((Number(s.voyageOar) || 0) * crew * cond * oarF),
    voyageSail: round1((Number(s.voyageSail) || 0) * cond * sailF),
    reasons,
    becalmed: !!spec && sailF === 0,
    // Strong and worse forbid tacking to everyone EXCEPT a master mariner.
    // That is not a small thing: it is the difference between beating upwind
    // slowly and not at all.
    canTack: !w.noTack || masterMariner,
    tackSpeed:
      w.noTack && masterMariner && Number.isFinite(tackFactor)
        ? round5((Number(s.sail) || 0) * cond * tackFactor)
        : null,
    masterMariner,
  };
}

/**
 * A land vehicle's speed for the load it is carrying.
 *
 * The printed tiers are pairs of (load, speed) for a given team. The vehicle
 * moves at the speed of the FASTEST tier whose load it is still under — carry
 * 80 stone on a one-horse cart and it makes 60'; add a stone and it drops to
 * the 120-stone row at 30'; pass 120 and it does not move at all.
 *
 * @param {object} vehicle the vehicle's `system` data
 * @param {number} loadStone what is aboard right now
 * @param {object} [ground] terrain/road/rain, for `travelMultiplier`
 * @param {object} [o]
 * @param {number} [o.pull] the team's real pull, when the caller can see the
 *   harnessed ATTACHMENTS this arithmetic cannot (occupants.mjs `draftPullOf`);
 *   omitted, only the abstract team rows count
 * @returns {{feetPerTurn, tier, overloaded, pull, reasons: object[]}}
 */
export function landSpeed(vehicle, loadStone = 0, ground = null, { pull: statedPull = null } = {}) {
  const pull = statedPull ?? draftPull(vehicle);
  const reasons = [];
  // Only the rows this team can actually pull are on the table.
  const usable = (vehicle?.speeds?.tiers ?? [])
    .filter((t) => (Number(t.team) || 0) <= pull + 1e-9)
    .sort((a, b) => (Number(b.feetPerTurn) || 0) - (Number(a.feetPerTurn) || 0));

  if (!pull) return { feetPerTurn: 0, tier: null, overloaded: false, pull, reasons: [{ key: "noTeam" }] };
  if (!usable.length) return { feetPerTurn: 0, tier: null, overloaded: false, pull, reasons: [{ key: "noTier" }] };

  // Fastest row whose load limit still covers what is aboard.
  const tier = usable.find((t) => loadStone <= (Number(t.maxLoadStone) || 0)) ?? null;
  if (!tier) {
    const heaviest = usable.reduce((m, t) => Math.max(m, Number(t.maxLoadStone) || 0), 0);
    return { feetPerTurn: 0, tier: null, overloaded: true, pull, reasons: [{ key: "overloaded", over: loadStone - heaviest }] };
  }
  if (usable[0] !== tier) reasons.push({ key: "heavyLoad", factor: (Number(tier.feetPerTurn) || 0) / (Number(usable[0].feetPerTurn) || 1) });

  const cond = conditionMultiplier(vehicle?.condition);
  if (cond < 1) reasons.push({ key: vehicle?.condition?.starving ? "starving" : "underfed", factor: cond });

  // The ground, and whoever is holding the reins. Driving is worth nothing off
  // a road — it buys a better road, not better country.
  const terrain = ground
    ? travelMultiplier({ ...ground, driverProficient: !!vehicle?.driverProficient })
    : { multiplier: 1, parts: [] };
  // A ×1 factor is silence — except the NOTE parts (a washed-out road, the
  // tablesMissing line), which exist to say why something is not counting.
  // A note's ×1 is not a figure worth printing, so its factor goes out null.
  for (const p of terrain.parts) {
    if (p.factor !== 1 || p.note) {
      reasons.push({ key: p.key, factor: p.note && p.factor === 1 ? null : p.factor, ...(p.missing ? { missing: true } : {}) });
    }
  }

  return {
    feetPerTurn: round5((Number(tier.feetPerTurn) || 0) * cond * terrain.multiplier),
    tier,
    overloaded: false,
    pull,
    terrain: terrain.multiplier,
    reasons,
  };
}

/** Heavy-horse equivalents in harness, from plain data (no document needed). */
export function draftPull(vehicle, equivalents = null) {
  const table = equivalents ?? { heavyHorse: 1, ox: 1, mediumHorse: 0.5, mule: 0.5, donkey: 0.5 };
  // A row stands for `count` animals of its kind — see the model. An older
  // row carries no count and is one animal, which is what it always was.
  return (vehicle?.team?.animals ?? [])
    .filter((a) => a.pulling !== false)
    .reduce((sum, a) => sum + (table[a.kind] ?? 0) * Math.max(1, Number(a.count) || 1), 0);
}

/**
 * Whether this vehicle can enter a terrain at all. Wheels need a road through
 * desert, mountains, forest and swamp; snow on the ground stops them
 * everywhere, and mud stops them off pavement (RR ch. 6). A vessel is not
 * asked, and neither is a carried vehicle — a palanquin goes where its
 * bearers walk.
 *
 * @param {object} [o]
 * @param {string|boolean} [o.road] a ROAD_KINDS key; `true` reads as earth
 * @param {string} [o.mud] the footing's mud state ("none"|"muddy"|"frozen")
 * @param {boolean} [o.snow] snow lies on the ground
 */
export function canEnter(vehicle, terrain, { road = false, mud = "none", snow = false } = {}) {
  if (vehicle?.kind !== "land") return { ok: true };
  if (vehicle?.carriage && vehicle.carriage !== "pulled") return { ok: true };
  if (snow) return { ok: false, reason: "snowbound" };
  const roadKind = road === true ? "earth" : road;
  if (mud === "muddy" && roadKind !== "paved") return { ok: false, reason: "mudBound" };
  const gated = !!TERRAIN[String(terrain)]?.wheelsNeedRoad;
  if (gated && (!roadKind || roadKind === "none")) return { ok: false, reason: "needsRoad" };
  return { ok: true };
}

/**
 * Cargo left, in stone, once passengers have taken their share. An unnamed
 * passenger rides at the vessel's own typed rate, else the imported general
 * berth — and the same rate runs the other way, so a vessel may carry that
 * much more for each crew member it does without.
 */
export function cargoRemaining(vehicle, loadStone = 0, namedStone = 0) {
  const cap = Number(vehicle?.cargo?.capacityStone) || 0;
  const per = Number(vehicle?.cargo?.passengerStone) || Number(readTable(VOYAGES_DOC, "berth")?.stone) || 0;
  // Unnamed passengers cost the book's flat berth; named ones cost what they
  // actually cost, which the caller has already weighed.
  const riders = (Number(vehicle?.cargo?.passengers) || 0) * per + Math.max(0, Number(namedStone) || 0);
  return { capacity: cap, used: loadStone + riders, free: cap - loadStone - riders, passengerStone: riders };
}

/* Speeds in feet are always printed in fives; miles per day in whole numbers. */
const round5 = (n) => Math.max(0, Math.round(n / 5) * 5);
const round1 = (n) => Math.max(0, Math.round(n));
