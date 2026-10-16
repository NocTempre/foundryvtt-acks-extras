/* global game, Roll */
/**
 * The overland MODE: a formation that knows what ground it is crossing, how
 * the day is being spent, and where the days went.
 *
 * State lives on the formation RECORD (a `travel` subtree), written only
 * through the ledger's own lock — the alternatives were all rejected in
 * docs/formation/DECISIONS.md: scene flags (travel is party-scoped and
 * crosses scenes), a second world setting (a parallel store re-invents the
 * lock and drifts from the roster), vehicle-sheet state (per-sheet and
 * unshared). The subtree is ADDITIVE: a record without one is a party that
 * has never journeyed, and `travelOf` answers for it without a migration.
 *
 * A journey is counted in miles and spent in hours: the day owns a budget of
 * marching hours (one dedicated day-kind plus the ancillary activity slots
 * the wilderness rules budget — RR ch. 6: a forced march spends every
 * ancillary activity), the world clock runs by the hours the miles take, and
 * the dungeon turn tracker stays out of it. Ending the day advances the
 * world clock to the next dawn through the module's one world-time switch,
 * appends the day to an append-only log, and hands the entry back for the
 * panel to show.
 *
 * The activity taxonomy carries each activity's encounter-frequency KIND —
 * per hex entered, per hour, per attempt, per period — because that is the
 * structural half of the wilderness encounter system (JJ ch. 2): WHICH
 * cadence an activity uses is the rule's shape; how often each cadence fires
 * per territory is a printed table and arrives through the registry.
 *
 * Pure derivations (defaults, the day board, the log) are exported for the
 * committed tests; everything that writes goes through `patchFormation`.
 */
import { MODULE_ID } from "../lib/constants.mjs";
import { isPrimaryGM } from "../lib/util.mjs";
import { patchFormation, getFormation, getFormations, getPartyToken, realMembers, getMemberActor, hasAbility } from "./formation-model.mjs";
import { hasCapability } from "./ability-bridge.mjs";
import { mayAdvanceWorldTime, untilNextDawn, calendarDay, calendarSeason } from "../lib/world-time.mjs";
import { TRAVEL_PACE } from "../lib/movement-scales.mjs";
import { isExpeditionScale } from "../lib/distance-units.mjs";
import { hexLabelFromOffset, isHexScene } from "../battlemap/terrain-paint.mjs";
import { sceneTravelSystem } from "../battlemap/scene-setup.mjs";
import { COUNTRY_KEYS, countryAt, riverTableFor } from "../battlemap/country.mjs";
import { FOLLOWING_KINDS, TERRITORY_KEYS } from "./country-keys.mjs";
import { TRAVEL_MODES } from "../lib/vocab.mjs";
import { marchBudget, marchIsSpent } from "./march.mjs";
import { sceneHasDistrict } from "./district-find.mjs";
import {
  CLIMATES,
  PRECIPITATION_KINDS,
  SEASONS,
  SETTING_SEASON_MAP,
  TEMPERATURE_BANDS,
  WIND_BANDS,
  advanceGround,
  conditionsOf,
  freshFooting,
  generateDay,
  seasonKeyFor,
  terrainMudProne,
} from "./weather.mjs";

/** World setting: how many day entries a formation's travel log keeps. */
export const SETTING_TRAVEL_LOG_CAP = "travelLogCap";

/** A day in seconds: what a travel day ends on when the clock keeps no calendar to read a dawn from. */
export const DAY_SECONDS = 24 * 60 * 60;

/** How many ancillary activities a day budgets (RR ch. 6). */
export const ANCILLARY_SLOTS = 4;

/**
 * How the DAY itself is spent — the dedicated activity. A forced march buys
 * its half-again distance by spending every ancillary slot on the road; camp
 * is a day that goes nowhere on purpose.
 */
export const DAY_KINDS = Object.freeze({
  march: { label: "ACKS-FORMATION.travel.day.march", pace: "dedicated", travels: true },
  forced: { label: "ACKS-FORMATION.travel.day.forced", pace: "forced", travels: true, consumesAncillary: true },
  camp: { label: "ACKS-FORMATION.travel.day.camp", pace: null, travels: false },
});

/**
 * What an ancillary hour can be spent on, and the encounter cadence each
 * activity answers to. The KIND is structure (JJ ch. 2 keys its frequency
 * table on exactly these activities); the frequencies themselves are printed
 * and arrive through the registry.
 */
export const ANCILLARY_ACTIVITIES = Object.freeze({
  travel: { label: "ACKS-FORMATION.travel.activity.travel", frequency: "perHex" },
  hunt: { label: "ACKS-FORMATION.travel.activity.hunt", frequency: "perAttempt" },
  forage: { label: "ACKS-FORMATION.travel.activity.forage", frequency: "perAttempt" },
  search: { label: "ACKS-FORMATION.travel.activity.search", frequency: "perHour" },
  rest: { label: "ACKS-FORMATION.travel.activity.rest", frequency: "perPeriod" },
  other: { label: "ACKS-FORMATION.travel.activity.other", frequency: "perPeriod" },
  // Managing traps is declared as a COUNT on the day (`day.traps`), not spent
  // in a slot, so the slot picker leaves it out.
  traps: { label: "ACKS-FORMATION.travel.activity.traps", frequency: "perAttempt", declared: true },
});

/** The road vocabulary is the vehicles feature's; re-exported for callers. */
export { ROAD_KINDS } from "../vehicles/vehicle-speed.mjs";
import { ROAD_KINDS, readTable, TRAVEL_DOC } from "../vehicles/vehicle-speed.mjs";
import { settlementOf, reenterSettlement, carryStay, sceneStamp, HOUR_MODES } from "./settlement.mjs";
import { withHunt } from "./hunt.mjs";
import { skyFor, skyFrom, readSkyCache, writeSkyCache, priorSky } from "./sky.mjs";
import { runProvisionDay } from "./provision-day.mjs";
import { forcedMarchBar, warnForcedMarchBarred, announceBarOverridden } from "./march-bar.mjs";
import { postNavigationThrow } from "./navigation-card.mjs";
import { isMode } from "../lib/movement-modes.mjs";
import { FLIGHT_LOADS } from "./flight.mjs";
import { lostOf } from "./lost.mjs";
import { weatherEffects, throwPenalty } from "./weather-effects.mjs";

/**
 * The three things a formation can be doing, re-exported so this feature's
 * consumers keep one import path. A `journey` is the one that stops the turn
 * clock — a delve and a city are both timed in turns the party walks off;
 * a SCENE may declare which of them applies on it (`docs/battlemap/MODEL.md`),
 * which is why the list itself lives in `lib/vocab.mjs`.
 */
export { TRAVEL_MODES };

/** The country's own vocabularies live in a leaf the battlemap reads too; re-exported for callers. */
export { FOLLOWING_KINDS, TERRITORY_KEYS };

/** A declared count as a whole number of at least zero. */
const trapCount = (n) => Math.max(0, Math.floor(Number(n) || 0));

/** A fresh, unspent day board. */
export function freshDay(kind = "march") {
  const spec = DAY_KINDS[kind] ? kind : "march";
  return {
    kind: spec,
    activities: Array.from({ length: ANCILLARY_SLOTS }, () => null),
    hexesEntered: 0,
    // Extra distance the day's bends cost over straight crossings, in hexes.
    winding: 0,
    // What the day has spent, unrounded: miles walked, the hours those miles
    // took (the march's hours, which the budget is measured against — a
    // resolved ancillary slot is not among them), the miles and the seconds
    // not yet worth a cadence unit or a whole second (`spendMarch`), and the
    // seconds the world clock has advanced for the day so far, slots included.
    miles: 0,
    hours: 0,
    cadenceCarry: 0,
    carrySeconds: 0,
    secondsAdvanced: 0,
    // Which ancillary slots have been resolved (a search hour, a forage).
    done: Array.from({ length: ANCILLARY_SLOTS }, () => false),
    /**
     * Whether the party has already been asked to call this day done. Deliberately
     * NOT carried across a kind change: pushing on buys more distance, so the
     * question becomes worth asking again when that is spent too.
     */
    offered: false,
    // The day's own declarations: how many traps the order managed, and
    // whether the order goes without sleep tonight. Both end with the day.
    traps: 0,
    noSleep: false,
  };
}

/**
 * Apply a day-kind to a board. A forced march CONSUMES the ancillary budget
 * (every slot becomes the march itself); stepping back down returns a fresh
 * budget rather than resurrecting whatever the forced march overwrote.
 *
 * What the day has already WALKED survives every kind change: the ground is
 * crossed whatever the party decides to do with the rest of the day, and only
 * ending the day (`withDayKind(null, …)`) puts the tally back to nothing.
 */
export function withDayKind(day, kind) {
  const next = freshDay(kind);
  if (DAY_KINDS[next.kind]?.consumesAncillary) {
    next.activities = next.activities.map(() => "travel");
  } else if (day && !DAY_KINDS[day.kind]?.consumesAncillary) {
    next.activities = [...(day.activities ?? next.activities)];
  }
  if (day) {
    next.hexesEntered = day.hexesEntered ?? 0;
    next.winding = day.winding ?? 0;
    next.miles = day.miles ?? 0;
    next.hours = day.hours ?? 0;
    next.cadenceCarry = day.cadenceCarry ?? 0;
    next.carrySeconds = day.carrySeconds ?? 0;
    next.secondsAdvanced = day.secondsAdvanced ?? 0;
    next.done = Array.from({ length: ANCILLARY_SLOTS }, (_, n) => !!day.done?.[n]);
    next.traps = trapCount(day.traps);
    next.noSleep = !!day.noSleep;
  }
  return next;
}

/**
 * The hours the day's march may spend, and the miles that is at this speed:
 * the day kind's pace plus one hour per ancillary slot set to travel (unless
 * the pace already consumes the slots). A camp day marches only its travel
 * slots.
 * @param {object} travel         a `travelOf` result
 * @param {number} milesPerHour   the readout's speed
 * @returns {{hours: number, miles: number}}
 */
export function dayBudget(travel, milesPerHour) {
  const kind = DAY_KINDS[travel?.day?.kind] ?? DAY_KINDS.march;
  return marchBudget({
    pace: kind.pace,
    travelSlots: (travel?.day?.activities ?? []).filter((a) => a === "travel").length,
    paceConsumesSlots: !!kind.consumesAncillary,
    milesPerHour,
  });
}

/**
 * Has the day's march been walked?
 *
 * The day is spent when the hours it has taken reach the budget, or when the
 * step just taken was after dusk (`dark`). A budget nobody could price never
 * announces the day over by hours alone.
 *
 * @param {object} day              the day board (`travel.day`)
 * @param {{hours: number}} budget  from `dayBudget`
 * @param {object} [o]
 * @param {boolean} [o.dark]        the step just taken was after dusk
 */
export function dayIsSpent(day, budget, { dark = false } = {}) {
  return marchIsSpent(day, budget, { dark });
}

/**
 * What each country key answers when no source says anything: the module's
 * own defaults, the last source `travelOf` consults.
 */
export const COUNTRY_DEFAULTS = Object.freeze({
  ground: "grassland",
  encounterTerrain: "",
  territory: "borderlands",
  climate: "",
  road: "none",
  following: "none",
});

/**
 * Which values each country key may take, from any source. An encounter
 * terrain is checked against its own vocabulary at use, by the encounter
 * engine, so travel takes any non-empty key without importing it.
 */
const COUNTRY_VALID = Object.freeze({
  ground: (v) => typeof v === "string" && v !== "",
  encounterTerrain: (v) => typeof v === "string" && v !== "",
  territory: (v) => TERRITORY_KEYS.includes(v),
  climate: (v) => typeof v === "string" && Object.hasOwn(CLIMATES, v),
  road: (v) => ROAD_KINDS.includes(v),
  following: (v) => FOLLOWING_KINDS.includes(v),
});

/** Is `value` one a country key may take? */
export const countryValueValid = (key, value) => !!COUNTRY_VALID[key]?.(value);

/** The movement mode that carries a party on the water (`MOVEMENT_MODES.vessel`). */
const WATER_BORNE = "vessel";

/**
 * The map's cached reading (`travel.map`) where it still describes the party:
 * written on the scene the party's token stands on now. Anywhere else, or with
 * no party token, the map says nothing.
 */
function mapReadingOf(formation, t) {
  const map = t.map;
  if (!map || typeof map !== "object") return null;
  if (!map.sceneId || map.sceneId !== formation?.sceneId || !formation?.tokenId) return null;
  return map;
}

/**
 * The six country keys resolved, each by the first source that answers it:
 * the Judge's override (`travel.override`), the map's reading of the party's
 * hex (`travel.map`, whose own `source` says whether the hex or the scene's
 * default answered), the declared record (the six keys as an older record
 * stores them), then the module's default. A declared value equal to the
 * default reads as the default: a stored default says nothing about what was
 * declared.
 *
 * While the party moves on the water and a water line runs under it, the map's
 * encounter terrain is the river's table for the ground. An overridden ground
 * takes the table with it: the map's and the record's tables describe the
 * ground they were read with, so neither answers, and the ground's own table
 * (`encounterTerrainFor`) does wherever the table is consulted. The river's
 * table is the water's and stands.
 *
 * `mapValues` is what the map alone answers for each key — the hex's own or
 * the scene default's, null where it says nothing — whether or not a source
 * above it won.
 *
 * @returns {{values: Record<string, string>, provenance: Record<string,
 *   "override"|"map"|"scene"|"declared"|"default">,
 *   mapValues: Record<string, string|null>, map: object|null}}
 */
function resolveCountry(formation, t, movementMode) {
  const map = mapReadingOf(formation, t);
  const override = t.override && typeof t.override === "object" ? t.override : {};
  const declared = {
    ground: t.ground ?? formation?.ground,
    encounterTerrain: t.encounterTerrain,
    territory: t.territory,
    climate: t.weather?.climate,
    road: t.road,
    following: t.following,
  };
  const waterBorne = movementMode === WATER_BORNE && !!map?.water;
  const values = {};
  const provenance = {};
  const mapValues = {};
  for (const key of COUNTRY_KEYS) {
    const valid = COUNTRY_VALID[key];
    // `ground` comes first in COUNTRY_KEYS, so the river's table is read for
    // the ground already resolved.
    const river = key === "encounterTerrain" && waterBorne;
    const fromMap = river ? riverTableFor(values.ground) : map?.[key];
    mapValues[key] = valid(fromMap) ? fromMap : null;
    if (valid(override[key])) {
      values[key] = override[key];
      provenance[key] = "override";
      continue;
    }
    // A table read with another ground is not the overridden ground's.
    const grounded = key === "encounterTerrain" && !river && provenance.ground === "override";
    if (mapValues[key] != null && !grounded) {
      values[key] = fromMap;
      provenance[key] = !river && map.source?.[key] === "scene" ? "scene" : "map";
      continue;
    }
    if (!grounded && valid(declared[key]) && declared[key] !== COUNTRY_DEFAULTS[key]) {
      values[key] = declared[key];
      provenance[key] = "declared";
      continue;
    }
    values[key] = COUNTRY_DEFAULTS[key];
    provenance[key] = "default";
  }
  return { values, provenance, mapValues, map };
}

/**
 * The country under the party as `travelOf` resolves it — `values`,
 * `provenance` — with what the map alone answers beside it (`mapValues`):
 * the party sheet's chips are the difference between the two.
 */
export function countryOf(formation) {
  return resolveCountry(formation, formation?.travel ?? {}, travelBase(formation).movement.mode);
}

/**
 * The travel subtree with every key but the country's answered: what
 * `travelOf` resolves the country over, and `storedTravelOf` keeps it raw in.
 */
function travelBase(formation) {
  const t = formation?.travel ?? {};
  return {
    mode: TRAVEL_MODES.includes(t.mode) ? t.mode : "delve",
    pace: TRAVEL_PACE[t.pace] ? t.pace : "dedicated",
    weather: {
      raining: false,
      snowing: false,
      auto: false,
      fronts: false,
      climate: "",
      season: "spring",
      temperature: "",
      temperatureNight: "",
      precipitation: "",
      wind: "",
      rolls: null,
      ...(t.weather ?? {}),
      footing: { ...freshFooting(), ...(t.weather?.footing ?? {}) },
    },
    // Where day-or-night comes from (`HOUR_MODES`): the world clock unless the
    // Judge says otherwise.
    hour: Object.hasOwn(HOUR_MODES, t.hour ?? "") ? t.hour : "clock",
    hex: { label: "", note: "", i: null, j: null, ...(t.hex ?? {}) },
    // A record from before the day counted miles reads as a day with nothing
    // walked; `done` is always one boolean per ancillary slot.
    day: {
      ...freshDay(),
      ...(t.day ?? {}),
      done: Array.from({ length: ANCILLARY_SLOTS }, (_, n) => !!t.day?.done?.[n]),
      traps: trapCount(t.day?.traps),
      noSleep: !!t.day?.noSleep,
    },
    // The camp's declarations, each a plain yes or no: the Judge's word that
    // the party takes what is not its own, that water is at hand, and that the
    // order sleeps armoured.
    camp: { steal: !!t.camp?.steal, water: !!t.camp?.water, sleepInArmour: !!t.camp?.sleepInArmour },
    // Traps declared on a day that did not make a whole batch, carried to the
    // next; and the runs the sky has kept a condition, keyed by condition
    // (written by the night, carried here untouched).
    trapsCarry: trapCount(t.trapsCarry),
    weatherRuns: { ...(t.weatherRuns ?? {}) },
    dayCount: Number(t.dayCount) || 0,
    lost: lostOf(t),
    // HOW the order moves, which decides which factors it meets at all. Named
    // `movement` rather than `mode`, because `mode` above is already the kind
    // of adventuring (delve / journey / settlement) and the two are
    // independent: a party can fly a journey or walk one.
    movement: {
      mode: isMode(t.movement?.mode) ? t.movement.mode : "foot",
      hoursAloft: Math.max(0, Number(t.movement?.hoursAloft) || 0),
      // How long the travelling day was. Declared, never assumed: how many
      // hours a day's travel takes is printed, and a flier that spent part of
      // the day aloft is priced on the SHARE. Left at zero it means the whole
      // travelling day was spent flying, which is the ordinary case.
      dayHours: Math.max(0, Number(t.movement?.dayHours) || 0),
      load: FLIGHT_LOADS[t.movement?.load] ? t.movement.load : "normal",
    },
    // How long the order stood in the weather, and whether anything was done
    // about it. The COUNT is the Judge's — a march is not automatically a day
    // spent unprotected, and guessing the hours would charge a party for
    // shelter it actually had.
    exposure: {
      hours: Math.max(0, Number(t.exposure?.hours) || 0),
      atHeatSource: !!t.exposure?.atHeatSource,
      wet: !!t.exposure?.wet,
    },
    settlement: settlementOf(t),
    log: Array.isArray(t.log) ? t.log : [],
  };
}

/**
 * The travel subtree, defaults answered and the country resolved — never
 * mutates the record. The six country keys (`ground`, `encounterTerrain`,
 * `territory`, `road`, `following`, and the climate at `weather.climate`)
 * are each the first answer of override → map → scene default → declared →
 * default (`resolveCountry`), and `provenance` names which source answered
 * each. `map` and `override` are the record's own, as stored. This is the
 * READER's view: a writer spreads `storedTravelOf`, or the resolved values
 * would be written back as the Judge's declaration.
 */
export function travelOf(formation) {
  const t = formation?.travel ?? {};
  const base = travelBase(formation);
  const { values, provenance } = resolveCountry(formation, t, base.movement.mode);
  return {
    ...base,
    ground: values.ground,
    road: values.road,
    following: values.following,
    territory: values.territory,
    encounterTerrain: values.encounterTerrain,
    weather: { ...base.weather, climate: values.climate },
    ...(t.map !== undefined ? { map: t.map } : {}),
    ...(t.override !== undefined ? { override: t.override } : {}),
    provenance,
  };
}

/**
 * The travel subtree as a WRITER spreads it: every key `travelOf` defaults is
 * defaulted the same way, and the country keys are left exactly as stored —
 * absent where the record holds none — with `map` and `override` carried. A
 * patch built on this writes back what it changed and nothing the map or the
 * override only lent the reader.
 */
export function storedTravelOf(formation) {
  const t = formation?.travel ?? {};
  const stored = travelBase(formation);
  for (const key of ["ground", "road", "following", "territory", "encounterTerrain", "map", "override"]) {
    if (t[key] !== undefined) stored[key] = t[key];
  }
  return stored;
}

/**
 * One finished day as a log row. Append-only and newest-first; the cap keeps
 * a seasons-long campaign from growing the settings blob without bound, and
 * trimming eats the OLDEST rows.
 */
export function composeLogEntry(travel, { miles = null, hours = null, hexes = null, notes = "", worldTime = null } = {}) {
  return {
    day: (Number(travel.dayCount) || 0) + 1,
    worldTime,
    hex: travel.hex?.label ?? "",
    ground: travel.ground,
    road: travel.road,
    territory: travel.territory,
    dayKind: travel.day?.kind ?? "march",
    pace: DAY_KINDS[travel.day?.kind]?.pace ?? null,
    activities: (travel.day?.activities ?? []).filter(Boolean),
    // The day's declarations ride the row, because End day resets the board
    // before the day's owed throws and the night's costs are resolved.
    traps: trapCount(travel.day?.traps),
    noSleep: !!travel.day?.noSleep,
    hexesEntered: travel.day?.hexesEntered ?? 0,
    // The DISPLAY half of the weather only — the generator's working state
    // (rolls, run counters) has no business in a season of log rows.
    weather: {
      temperature: travel.weather?.temperature ?? "",
      temperatureNight: travel.weather?.temperatureNight ?? "",
      precipitation: travel.weather?.precipitation ?? "",
      wind: travel.weather?.wind ?? "",
      raining: !!travel.weather?.raining,
      snowing: !!travel.weather?.snowing,
      conditions: conditionsOf(travel.weather ?? {}),
    },
    lost: !!travel.lost?.active,
    miles,
    // The hours the day took, beside the miles: the day's own tally unless
    // the caller states another.
    hours: hours ?? Math.round((Number(travel.day?.hours) || 0) * 100) / 100,
    hexes,
    notes,
  };
}

/** Newest-first push under the cap. */
export function pushLog(log, entry, cap) {
  const capped = Math.max(1, Number(cap) || 1);
  return [entry, ...(log ?? [])].slice(0, capped);
}

/* -------------------------------------------------------------------- */
/*  Writers — GM window actions, through the ledger's own lock          */
/* -------------------------------------------------------------------- */

const logCap = () => {
  try {
    return game.settings.get(MODULE_ID, SETTING_TRAVEL_LOG_CAP);
  } catch {
    return 120;
  }
};

/**
 * Enter or leave a mode. A journey is timed by the world clock the miles run
 * and a delve by the turn tracker, so a mode change clears any pause and
 * re-anchors the movement baseline at the token's present position: the next
 * drag is measured from where the party stands now, never from where the
 * last mode left it. The day board is held where it stood (a dungeon on the
 * route does not reset the march).
 *
 * @param {string} formationId
 * @param {string|boolean} journey the mode to adopt (a bare boolean is the
 *   older journey/delve switch)
 * @param {string|null} [opts.sceneId] the city a settlement board is being
 *   counted in. Naming none leaves whatever stamp the board carries — a
 *   re-entry wherever the party already is. Callers that know the scene pass
 *   it: a board left unstamped is the one state the next arrival reads as
 *   foreign.
 */
export function setJourneyMode(formationId, journey, { sceneId = null } = {}) {
  // Historically a boolean; a mode string is now accepted and preferred.
  const mode = typeof journey === "string"
    ? (TRAVEL_MODES.includes(journey) ? journey : "delve")
    : (journey ? "journey" : "delve");
  return patchFormation(formationId, (record) => {
    const t = storedTravelOf(record);
    const token = getPartyToken(record);
    record.travel = {
      ...t,
      mode,
      // Entering a city asks the factions' ledgers whether anyone hunts the
      // party in the quarter it arrives in (hunt.mjs); leaving one keeps the
      // board whole.
      settlement: mode === "settlement" ? withHunt(enteredSettlement(t, sceneId), record) : t.settlement,
      // A journey begun where the party's token stands reads the country under
      // it now, not at its first step.
      ...(mode === "journey" && token?.parent
        ? { map: mapReadingAt(token.parent, tokenCentre(token), { at: game.time?.worldTime ?? null }) }
        : {}),
    };
    record.clock = {
      ...(record.clock ?? {}),
      paused: false,
      pausedBy: null,
      ...(token ? { lastPosition: { x: token.x, y: token.y } } : {}),
    };
  });
}

/**
 * The settlement board a party entering settlement mode lands on.
 *
 * Entering a settlement starts a fresh TALLY and keeps what the Judge set, so
 * stepping out to the country and back does not forget the route; leaving one
 * keeps the board whole. Arriving in ANOTHER city is an entry too, whether or
 * not the mode changed — the blocks, the turns, the hunted flag and the stay's
 * stamp were all counted in the city being left, and a party walked straight
 * from one to the next would otherwise open the panel a mile into a city it
 * has just reached and be charged the journey as a stay.
 *
 * A board reaching a NAMED city that it does not itself name is foreign, an
 * unstamped board included — see `boardIsElsewhere`.
 */
function enteredSettlement(travel, sceneId) {
  const board = travel.settlement;
  const stamp = sceneStamp(sceneId);
  if (travel.mode !== "settlement" || boardIsElsewhere(board, stamp)) return reenterSettlement(board, stamp);
  return { ...board, sceneId: stamp ?? board.sceneId };
}

/**
 * Is this board's tally counted in a city OTHER than the one being entered?
 *
 * The one test both settlement writers ask. Never spell it twice: the decision
 * to re-enter and the decision to announce that re-entry must not be able to
 * disagree, and the boards they disagree over are exactly the ones this field
 * exists for.
 *
 * An UNSTAMPED board is foreign. A board that names no city has no claim on the
 * one it is arriving in, and the stay stamp it carries was counted somewhere
 * nobody can point at; reading it as "here" is what lets a whole journey be
 * charged as a stay in the city at the end of it. `claimUnstampedSettlements`
 * is what keeps that verdict from costing a real tally: every board whose city
 * IS knowable is stamped before any of this runs, so a board still unstamped
 * here was counted nowhere that can be named, and a fresh tally is the honest
 * answer. The two errors are not the same size — a wrong reset loses blocks and
 * turns a Judge can re-enter from the panel, a wrong keep silently bills the
 * party for a month it spent on the road.
 *
 * An arrival that names no city is NOT somewhere new: there is no stamp to
 * write, so calling it foreign would wipe the tally on every call and never
 * settle.
 */
function boardIsElsewhere(board, stamp) {
  return stamp != null && board.sceneId !== stamp;
}

/**
 * Stamp every unstamped settlement board with the city its party stands in.
 * Run once, at startup.
 *
 * A board records the city its blocks were counted in; a board carried in from
 * a world that kept no such record names none. The formation's own recorded
 * scene is where its token is, so a board claimed from it is claimed by the
 * city it was actually counted in — which is why the claim belongs here, and
 * not inside `adoptSceneSystem`: the token-placement hook that calls that one
 * fires from `createEmbeddedDocuments` BEFORE the formation's `sceneId` is
 * written, so the field names the scene being LEFT on exactly the path that
 * matters most.
 *
 * Only the stamp is written, and only on a board that has none whose party is
 * in settlement mode on a scene declaring itself a city. No tally is reset and
 * no mode moves, so there is nothing to announce.
 *
 * @returns {Promise<number>} how many boards were claimed.
 */
export async function claimUnstampedSettlements() {
  let claimed = 0;
  for (const formation of Object.values(getFormations())) {
    const t = travelOf(formation);
    if (t.mode !== "settlement" || t.settlement.sceneId != null) continue;
    const sceneId = sceneStamp(formation.sceneId);
    if (!sceneId) continue;
    if (inferredTravelSystem(game.scenes?.get(sceneId)).system !== "settlement") continue;
    let wrote = false;
    // Re-read under the ledger's lock: the startup sync and every other
    // background writer hold copies of these records, and a board claimed or
    // re-entered between the read above and here is no longer ours to stamp.
    await patchFormation(formation.id, (record) => {
      const cur = storedTravelOf(record);
      if (cur.mode !== "settlement" || cur.settlement.sceneId != null) return false;
      record.travel = { ...cur, settlement: { ...cur.settlement, sceneId } };
      wrote = true;
      return record;
    });
    if (wrote) claimed += 1;
  }
  return claimed;
}

/**
 * The travel system a scene calls for, and what said so: the one the Judge
 * DECLARED (the battlemap setup tool writes it), else a journey for a map
 * whose cell is a mile or more across, else a settlement for a map with a
 * district drawn on it, else nothing. Scale outranks districts, and a
 * declaration outranks both.
 * @returns {{system: string|null, source: "declared"|"scale"|"districts"|null}}
 */
export function inferredTravelSystem(scene) {
  const declared = sceneTravelSystem(scene);
  if (declared) return { system: declared, source: "declared" };
  if (isExpeditionScale(scene)) return { system: "journey", source: "scale" };
  if (sceneHasDistrict(scene)) return { system: "settlement", source: "districts" };
  return { system: null, source: null };
}

/**
 * Take the travel system the SCENE calls for (`inferredTravelSystem`) — a
 * dungeon map runs the turn clock, a wilderness map runs the day, a
 * settlement crosses in blocks.
 *
 * Arriving on a map is the moment the question is answered, so this runs when
 * a party token lands and when the declaration itself changes. A scene that
 * says nothing and shows nothing changes nothing: silence is "nobody has
 * said", not "dungeon", and a party mid-march must not be reset by crossing
 * an unlabelled scene.
 *
 * A second CITY is an arrival even though the mode does not change: the board
 * belongs to the scene it was counted in, so a scene declaring settlement
 * while the board names a different one enters afresh — `boardIsElsewhere` is
 * the whole of that test, and is the same one the write itself asks.
 *
 * @returns {Promise<{mode: string, source: string}|null>} the mode adopted and
 *   what called for it, or null if nothing moved.
 */
export async function adoptSceneSystem(formationId, scene) {
  const { system, source } = inferredTravelSystem(scene);
  if (!system) return null;
  const formation = getFormation(formationId);
  if (!formation) return null;
  const t = travelOf(formation);
  const sceneId = sceneStamp(scene?.id);
  const elsewhere = system === "settlement" && boardIsElsewhere(t.settlement, sceneId);
  if (t.mode === system && !elsewhere) return null;
  await setJourneyMode(formationId, system, { sceneId });
  return { mode: system, source };
}

/** The settlement board's own writer: pace, where, route, hour, hunted. */
export function patchSettlement(formationId, patch = {}) {
  return patchFormation(formationId, (record) => {
    const t = storedTravelOf(record);
    const next = { ...t.settlement };
    // Every picker the panel shows, because this is the api the panel's own
    // vocabulary is reachable through: a key accepted by the form and dropped
    // here is a setting a caller can write and never see take effect.
    // `settlementOf` below is what rejects a value outside a vocabulary.
    // `days` and `holeUpSince` are deliberately absent — the world clock owns
    // the stay, and a caller writing either desynchronises it from the
    // calendar it is counted against.
    for (const key of ["pace", "where", "route", "hour", "intent", "conveyance"]) {
      if (patch[key] !== undefined) next[key] = String(patch[key]);
    }
    // The older boolean form of the hour, kept for callers written to it: a
    // tick is the Judge's word for night, a clear one their word for day.
    if (patch.night !== undefined && patch.hour === undefined) next.hour = patch.night ? "night" : "day";
    if (patch.wanted !== undefined) {
      next.wanted = !!patch.wanted;
      // The Judge's untick outranks the ledger: the hunter's name goes with
      // the flag, and the quarter stays asked so it is not re-armed next turn.
      if (!next.wanted) next.huntedBy = "";
    }
    if (patch.blocks !== undefined) next.blocks = Number(patch.blocks) || 0;
    if (patch.turns !== undefined) next.turns = Number(patch.turns) || 0;
    if (patch.lost !== undefined) next.lost = !!patch.lost;
    if (patch.lastThrow !== undefined) next.lastThrow = patch.lastThrow;
    record.travel = { ...t, settlement: carryStay(t.settlement, settlementOf({ settlement: next })) };
  });
}

/**
 * The record's own declarations: ground, road, territory, pace, weather flags,
 * hex note. The country keys written here are the DECLARED record — the
 * fallback under the map and the scene default — not the Judge's override,
 * which is `applyTravelForm`'s `override` group.
 */
export function patchTravel(formationId, patch = {}) {
  return patchFormation(formationId, (record) => {
    const t = storedTravelOf(record);
    const next = { ...t };
    if (patch.ground !== undefined) next.ground = String(patch.ground);
    if (patch.road !== undefined && ROAD_KINDS.includes(patch.road)) next.road = patch.road;
    if (patch.territory !== undefined && TERRITORY_KEYS.includes(patch.territory)) next.territory = patch.territory;
    if (patch.pace !== undefined && TRAVEL_PACE[patch.pace]) next.pace = patch.pace;
    if (patch.hour !== undefined && Object.hasOwn(HOUR_MODES, patch.hour)) next.hour = patch.hour;
    if (patch.weather !== undefined) next.weather = { ...t.weather, ...patch.weather };
    if (patch.hex !== undefined) next.hex = { ...t.hex, ...patch.hex };
    record.travel = next;
  });
}

/**
 * Retire an older record's declaration of one country key: the key's default
 * is written over it (`travel.weather.climate` for the climate), so the map
 * or the module's default answers again. The Judge's override is cleared by
 * `applyTravelForm` with a blank; this never touches it. Null for a key that
 * is not one of the six.
 */
export function clearDeclaredCountry(formationId, key) {
  if (!COUNTRY_KEYS.includes(key)) return Promise.resolve(null);
  return patchFormation(formationId, (record) => {
    const t = storedTravelOf(record);
    record.travel = key === "climate"
      ? { ...t, weather: { ...t.weather, climate: COUNTRY_DEFAULTS.climate } }
      : { ...t, [key]: COUNTRY_DEFAULTS[key] };
  });
}

/**
 * Does the Judge's seat override a barred forced march? `override` is a
 * request; only a Gamemaster's seat is heard.
 */
const overrides = (override) => override === true && !!game.user?.isGM;

/**
 * Choose how the day is spent. Forced marches consume the ancillary budget.
 *
 * Changing INTO a forced march is refused while a marching member's survival
 * state bars one (`forcedMarchBar`): the seat is warned, naming them, and the
 * kind stays. The Judge's seat passes `{ override: true }` to set it anyway,
 * which whispers the Judges who was barred. A day already forced is not asked
 * again.
 *
 * @returns the record written, or `false` when the bar refused the kind
 */
export async function setDayKind(formationId, kind, { override = false } = {}) {
  let barred = [];
  let refused = false;
  const result = await patchFormation(formationId, (record) => {
    const t = storedTravelOf(record);
    if (kind === "forced" && t.day.kind !== "forced") {
      barred = forcedMarchBar(record);
      if (barred.length && !overrides(override)) {
        refused = true;
        return false;
      }
    }
    record.travel = { ...t, day: withDayKind(t.day, kind) };
  });
  if (refused) {
    warnForcedMarchBarred(barred);
    return false;
  }
  if (barred.length && result) await announceBarOverridden(result, barred);
  return result;
}

/** Fill one ancillary slot (null clears it). Refused under a forced march. */
export function setAncillary(formationId, slot, activity) {
  return patchFormation(formationId, (record) => {
    const t = storedTravelOf(record);
    if (DAY_KINDS[t.day?.kind]?.consumesAncillary) return false;
    const i = Number(slot);
    if (!Number.isInteger(i) || i < 0 || i >= ANCILLARY_SLOTS) return false;
    if (activity != null && !ANCILLARY_ACTIVITIES[activity]) return false;
    const activities = [...(t.day.activities ?? freshDay().activities)];
    activities[i] = activity ?? null;
    record.travel = { ...t, day: { ...t.day, activities } };
  });
}

/**
 * Record a hex entered: the label updates and the day counts it. Spends no
 * miles and moves no clock — the trace alone; `nextHex` (journey.mjs) is the
 * Judge's override that also spends a cadence unit.
 */
export function enterHex(formationId, label) {
  return patchFormation(formationId, (record) => {
    const t = storedTravelOf(record);
    record.travel = {
      ...t,
      hex: { ...t.hex, label: String(label ?? "").trim() },
      day: { ...t.day, hexesEntered: (t.day.hexesEntered ?? 0) + 1 },
    };
  });
}

/** The centre of a token document on its scene, read off the document alone (no canvas). */
export function tokenCentre(tokenDoc, scene = tokenDoc?.parent) {
  const sizeX = scene?.grid?.sizeX ?? scene?.grid?.size ?? 0;
  const sizeY = scene?.grid?.sizeY ?? scene?.grid?.size ?? 0;
  return {
    x: tokenDoc.x + ((tokenDoc.width ?? 1) * sizeX) / 2,
    y: tokenDoc.y + ((tokenDoc.height ?? 1) * sizeY) / 2,
  };
}

/**
 * The map's reading at a point, in the shape `travel.map` caches it:
 * `countryAt`'s six keys with their `source` and the `water` under the point,
 * plus the scene and the hex they were read on (`i`/`j` null off a hex grid)
 * and the world time `at` which they were read.
 */
export function mapReadingAt(scene, point, { at = null } = {}) {
  const reading = countryAt(scene, point);
  const offset = isHexScene(scene) ? scene.grid.getOffset(point) : null;
  return {
    sceneId: scene?.id ?? null,
    i: offset?.i ?? null,
    j: offset?.j ?? null,
    at,
    ...Object.fromEntries(COUNTRY_KEYS.map((key) => [key, reading[key] ?? null])),
    source: { ...reading.source },
    water: reading.water ?? null,
  };
}

/**
 * Do two map readings say the same thing about the same place? `at` is not
 * compared: a re-read that found nothing new is not a change worth a write.
 */
export function sameReading(a, b) {
  if (!a || !b) return a === b;
  if (a.sceneId !== b.sceneId || (a.i ?? null) !== (b.i ?? null) || (a.j ?? null) !== (b.j ?? null)) return false;
  for (const key of COUNTRY_KEYS) {
    if ((a[key] ?? null) !== (b[key] ?? null) || (a.source?.[key] ?? null) !== (b.source?.[key] ?? null)) return false;
  }
  return (a.water?.kind ?? null) === (b.water?.kind ?? null) && !!a.water?.navigable === !!b.water?.navigable;
}

/**
 * The reading a trace step carries, at the step's offset: its `map` (a
 * `mapReadingAt` result), with any of `ground`, `encounterTerrain` and `road`
 * the step names laid over it as the map's own answer — the journey's road
 * walked between two hexes, or a caller tracing by hand, whose reading is of
 * the step's `sceneId` (else the last reading's scene). Null when the step
 * reads nothing at all.
 */
function stepReading(previous, { map, i, j, sceneId, ground, encounterTerrain, road }) {
  const told = Object.entries({ ground, encounterTerrain, road }).filter(([, v]) => v !== undefined);
  if (!map && !told.length) return null;
  const base = map ?? { sceneId: sceneId ?? previous?.sceneId ?? null, at: null, water: null, source: {} };
  const reading = { ...base, i, j, source: { ...(base.source ?? {}) } };
  for (const key of COUNTRY_KEYS) reading[key] ??= null;
  for (const [key, value] of told) {
    reading[key] = value == null || value === "" ? null : String(value);
    reading.source[key] = reading[key] == null ? null : "map";
  }
  return reading;
}

/**
 * One step of the hex trace, pure: the party's token stands in the hex at
 * offset (`i`, `j`). The offset is the identity, the label its name, and the
 * map's reading of it is cached as `travel.map` — the country keys themselves
 * are never written here, so the map stays a source under the Judge's
 * override and over the declared record (`travelOf`). The first arrival (no
 * prior offset) NAMES the hex without counting it (you do not enter the hex
 * you were already standing in). A repeat of the same offset counts nothing:
 * it returns the very object it was given unless the step reads the hex
 * differently (the same offset on another scene), and then only the reading
 * changes. A crossing whose step read nothing leaves no reading, so the last
 * hex's is never taken for this one's.
 *
 * @param {object} travel  a `storedTravelOf` result
 * @param {object} step    `{label, i, j, map, sceneId, ground,
 *   encounterTerrain, road, winding}`; `map` is `mapReadingAt`'s; `road` is
 *   the road the step walked along, `undefined` when no network says, so the
 *   map's own reading stands; `sceneId` names the scene a step traced by hand
 *   (no `map`) was read on
 * @returns {{travel: object, crossed: 0|1}}  `crossed` is 1 for a hex entered
 */
export function traceStep(travel, { label = "", i = null, j = null, map = null, sceneId = null, ground = undefined, encounterTerrain = undefined, road = undefined, winding = 1 } = {}) {
  const hex = travel.hex ?? {};
  const had = hex.i != null && hex.j != null;
  const reading = stepReading(travel.map, { map, i, j, sceneId, ground, encounterTerrain, road });
  if (had && hex.i === i && hex.j === j) {
    if (!reading || sameReading(travel.map, reading)) return { travel, crossed: 0 };
    return { travel: { ...travel, map: reading }, crossed: 0 };
  }
  return {
    crossed: had ? 1 : 0,
    travel: {
      ...travel,
      hex: { ...hex, label: String(label ?? "").trim(), i, j },
      map: reading,
      day: had
        ? {
            ...travel.day,
            hexesEntered: (travel.day.hexesEntered ?? 0) + 1,
            // Only the EXCESS is banked: a straight crossing costs nothing
            // extra, so a road with no bends never shows a tax.
            winding: (travel.day.winding ?? 0) + Math.max(0, (Number(winding) || 1) - 1),
          }
        : travel.day,
    },
  };
}

/**
 * Write one step of the hex trace (`traceStep`) to the record, alone — no
 * miles, no clock. A step traced by hand is read on the party's own scene.
 * Writes nothing when the step changes nothing.
 */
export function autoEnterHex(formationId, step = {}) {
  return patchFormation(formationId, (record) => {
    const t = storedTravelOf(record);
    const { travel } = traceStep(t, { sceneId: record.sceneId ?? null, ...step });
    if (travel === t) return false;
    record.travel = travel;
  });
}

/**
 * Seat a journeying party under a token that was set down rather than walked
 * — stepped onto its true position — so the hex and the map's reading of it
 * change and nothing is counted: no hex entered, no road step. Off a hex grid
 * there is no hex to name, and only the reading is written. A formation not
 * on a journey changes nothing.
 */
export function seatJourneyHex(tokenDoc, formationId) {
  const scene = tokenDoc?.parent;
  if (!scene) return Promise.resolve(null);
  const reading = mapReadingAt(scene, tokenCentre(tokenDoc, scene), { at: game.time?.worldTime ?? null });
  const hexed = reading.i != null && reading.j != null;
  return patchFormation(formationId, (record) => {
    const t = storedTravelOf(record);
    if (t.mode !== "journey") return false;
    const moved = hexed && !(t.hex.i === reading.i && t.hex.j === reading.j);
    if (!moved && sameReading(t.map, reading)) return false;
    record.travel = {
      ...t,
      ...(moved ? { hex: { ...t.hex, label: hexLabelFromOffset(reading), i: reading.i, j: reading.j } } : {}),
      map: reading,
    };
  });
}

/**
 * Re-read the map under every journeying party standing on a scene, and cache
 * what changed (`travel.map`): the Judge painted the hex a party stands in,
 * drew a river through it, or set the scene's default country, and the party
 * has not moved. With `walls` false nothing drawn changed, so a reading of
 * the same hex keeps its cached road, route and water — the road may be the
 * one the last step walked, which a re-read at the token cannot see.
 *
 * @returns {Promise<string[]>} the ids of the formations whose reading changed
 */
export async function refreshCountryOn(sceneId, { walls = true } = {}) {
  const changed = [];
  for (const formation of Object.values(getFormations())) {
    if (!sceneId || formation.sceneId !== sceneId || !formation.tokenId) continue;
    if (storedTravelOf(formation).mode !== "journey") continue;
    const token = getPartyToken(formation);
    const scene = token?.parent;
    if (!token || !scene) continue;
    const fresh = mapReadingAt(scene, tokenCentre(token, scene), { at: game.time?.worldTime ?? null });
    let wrote = false;
    await patchFormation(formation.id, (record) => {
      const t = storedTravelOf(record);
      if (t.mode !== "journey" || record.sceneId !== sceneId) return false;
      const held = t.map;
      const sameHex = !!held && fresh.i != null && held.sceneId === fresh.sceneId && held.i === fresh.i && held.j === fresh.j;
      const reading = !walls && sameHex
        ? {
            ...fresh,
            road: held.road ?? null,
            following: held.following ?? null,
            water: held.water ?? null,
            source: { ...fresh.source, road: held.source?.road ?? null, following: held.source?.following ?? null },
          }
        : fresh;
      if (sameReading(held, reading)) return false;
      record.travel = { ...t, map: reading };
      wrote = true;
    });
    if (wrote) changed.push(formation.id);
  }
  return changed;
}

/**
 * A debounced trigger for `refreshCountryOn`, one per client: each call names
 * a scene and whether a Wall changed on it, and one re-read runs per scene
 * per burst, `wait` milliseconds after its last call. Only the active GM's
 * client runs any (`isPrimaryGM`, the guard the world-time watcher's writers
 * use); `then` receives the ids whose reading changed. `schedule`/`cancel`
 * are the timers, replaceable by a test.
 *
 * @param {object} [o]
 * @param {number} [o.wait]  quiet milliseconds before a burst is read
 * @param {Function} [o.then]  called with the changed formation ids
 * @param {Function} [o.schedule]  `setTimeout`'s shape
 * @param {Function} [o.cancel]  `clearTimeout`'s shape
 * @param {Function} [o.primary]  whether this client runs the automation
 * @returns {(sceneId: string, opts?: {walls?: boolean}) => void}
 */
export function countryRefresher({ wait = 250, then = null, schedule = setTimeout, cancel = clearTimeout, primary = isPrimaryGM } = {}) {
  const pending = new Map();
  return (sceneId, { walls = false } = {}) => {
    if (!sceneId || !primary()) return;
    const held = pending.get(sceneId);
    if (held) cancel(held.timer);
    const burst = { walls: walls || !!held?.walls, timer: null };
    burst.timer = schedule(() => {
      pending.delete(sceneId);
      refreshCountryOn(sceneId, { walls: burst.walls })
        .then((changed) => then?.(changed))
        .catch((err) => console.error(`${MODULE_ID} | the country under a party could not be re-read`, err));
    }, wait);
    pending.set(sceneId, burst);
  };
}

/**
 * Who in the marching order can find the way.
 *
 * Two separate competences: the Navigation proficiency and the Pathfinding
 * class power. Holding EITHER helps and holding BOTH helps more — that
 * asymmetry is the rule and lives here. What each is worth is printed, so the
 * two figures are read from the travel document's `navigationBonus` row and a
 * world with nothing imported gets no bonus rather than an invented one.
 */
export function navigationCompetence(formation) {
  const members = realMembers(formation);
  let navigation = false;
  let pathfinding = false;
  for (const m of members) {
    const actor = getMemberActor(m);
    if (!actor) continue;
    if (!navigation && (hasCapability(actor, "kw:navigation") || hasAbility(actor, /navigation/i))) navigation = true;
    if (!pathfinding && (hasCapability(actor, "kw:pathfinding") || hasAbility(actor, /pathfinding/i))) pathfinding = true;
    if (navigation && pathfinding) break;
  }
  const row = readTable(TRAVEL_DOC, "navigationBonus");
  const one = Number(row?.either);
  const both = Number(row?.both);
  let bonus = 0;
  let unpriced = false;
  if (navigation && pathfinding) {
    if (Number.isFinite(both)) bonus = both; else unpriced = true;
  } else if (navigation || pathfinding) {
    if (Number.isFinite(one)) bonus = one; else unpriced = true;
  }
  return { navigation, pathfinding, bonus, unpriced };
}

/**
 * The day's navigation prospect, before any dice.
 *
 * `throws` is false on a road or a navigable river — a party following an
 * established route does not lose its way, which is structural and needs no
 * table. Otherwise the target is the terrain's, from the imported
 * `gettingLost` row, and a null target means UNIMPORTED, never "no target".
 *
 * This deliberately stops short of the consequence. What a failure does is the
 * Lost ruling (`docs/formation/DECISIONS.md`, 2026-08-29, "Lost: the players
 * hold the reckoning"): the throw reports, the Judge opens the episode by
 * hand, and a success restores no position. This returns only what is decided
 * before the dice.
 */
export function landNavigationSpec(formation) {
  const t = travelOf(formation);
  if (t.road && t.road !== "none") return { throws: false, reason: "road" };
  if (t.following && t.following !== "none") return { throws: false, reason: t.following };
  const targets = readTable(TRAVEL_DOC, "gettingLost");
  const target = Number(targets?.[t.ground]);
  const competence = navigationCompetence(formation);
  // The sky's signed modifier on the throw (RR 277-279), from the party's own
  // weather and ground; 0 while the effects table is unimported.
  const weather = throwPenalty(weatherEffects(conditionsOf(t.weather), { terrain: t.ground }), "navigation");
  if (!Number.isFinite(target)) {
    return { throws: true, target: null, missing: "gettingLost", terrain: t.ground, competence, weather };
  }
  return { throws: true, target, terrain: t.ground, competence, weather };
}

/**
 * How many faces a hex has, and therefore how the Judge rolls a stray.
 *
 * Structural: a hex has six sides, so a stray is a d6 among them. WHICH face
 * the party takes is the Judge's to decide from the lie of the land — this is
 * only the fallback when they would rather it be blind.
 */
export const HEX_FACES = 6;

/** A blind stray: a face index, 0-5. The Judge may always choose instead. */
export async function rollStrayFace() {
  const roll = await new Roll(`1d${HEX_FACES}`).evaluate();
  return { face: roll.total - 1, roll };
}

/**
 * The day's navigation throw.
 *
 * A d20 against the terrain's imported target, plus whatever the marching
 * order's competence is worth and the sky's modifier. An unmodified 1 fails whatever the bonus — the
 * one modifier-proof outcome the rule keeps.
 *
 * Returns `{throws: false}` untouched when a road or river carries the party,
 * and `{missing}` when the target was never imported. It reports; it does not
 * write. What a failure DOES is the episode's business.
 */
export async function rollLandNavigation(formation) {
  const spec = landNavigationSpec(formation);
  if (!spec.throws) return { ...spec, rolled: false };
  if (spec.target == null) return { ...spec, rolled: false };
  const bonus = (spec.competence?.bonus ?? 0) + (spec.weather ?? 0);
  const formula = bonus > 0 ? `1d20 + ${bonus}` : bonus < 0 ? `1d20 - ${Math.abs(bonus)}` : "1d20";
  const roll = await new Roll(formula).evaluate();
  const natural = roll.dice?.[0]?.results?.[0]?.result ?? null;
  const botched = natural === 1;
  return {
    ...spec,
    rolled: true,
    roll,
    natural,
    total: roll.total,
    botched,
    success: !botched && roll.total >= spec.target,
  };
}

/**
 * The Judge's override group of a submit, merged over the record's: each of
 * the six country keys the form names is set when valid and CLEARED when
 * blank; one it does not name stands. The group is `tv.override`; a key named
 * at the form's top level (`tv.ground`, `tv.weather.climate`) is the same
 * word and routes here too. Null when the submit names none of them.
 */
function overrideFromForm(current, tv) {
  const named = {
    ...Object.fromEntries(COUNTRY_KEYS.filter((k) => k !== "climate" && typeof tv[k] === "string").map((k) => [k, tv[k]])),
    ...(typeof tv.weather?.climate === "string" ? { climate: tv.weather.climate } : {}),
    ...Object.fromEntries(Object.entries(tv.override ?? {}).filter(([k, v]) => COUNTRY_KEYS.includes(k) && typeof v === "string")),
  };
  if (!Object.keys(named).length) return null;
  const next = { ...(current && typeof current === "object" ? current : {}) };
  for (const [key, value] of Object.entries(named)) {
    if (value === "") delete next[key];
    else if (countryValueValid(key, value)) next[key] = value;
  }
  return next;
}

/**
 * The panel's whole form in ONE ledger write: the Judge's overrides, weather
 * flags, the day board, the hex label, the lost note. The form submits itself
 * entire on every change (submitOnChange), so writing field-by-field would
 * queue a patch per field per keystroke; this applies what the form carries
 * and lets `travelOf` refuse the rest. The six country keys land in
 * `travel.override` (`overrideFromForm`), never in the declared record. Slot
 * edits under a forced march are ignored — the march owns the budget.
 *
 * A day-kind change INTO a forced march obeys the same bar as `setDayKind`:
 * barred, the kind alone is dropped (the rest of the form still lands) and the
 * seat is warned; with `{ override: true }` from a Judge's seat it is set and
 * the Judges are told who was barred.
 */
export async function applyTravelForm(formationId, tv = {}, { override = false } = {}) {
  let barred = [];
  let refused = false;
  let forcedHere = false;
  const result = await patchFormation(formationId, (record) => {
    const t = storedTravelOf(record);
    const next = { ...t };
    const declaredOver = overrideFromForm(t.override, tv);
    if (declaredOver) {
      if (Object.keys(declaredOver).length) next.override = declaredOver;
      else delete next.override;
    }
    if (Object.hasOwn(HOUR_MODES, tv.hour ?? "")) next.hour = tv.hour;
    // The settlement board rides the same submit as the journey pickers: an
    // ApplicationV2 action fires on CLICK, so a select bound to one never
    // reports a change at all.
    if (tv.settlement) {
      next.settlement = settlementOf({
        settlement: {
          ...t.settlement,
          ...tv.settlement,
          // The checkbox is read explicitly rather than left to the spread: an
          // unticked checkbox is ABSENT from the submit, so a spread keeps
          // whatever was there and the box can be ticked but never cleared.
          wanted: !!tv.settlement.wanted,
        },
      });
      // Stepping back into the street ends the stay, stamp and all.
      next.settlement = carryStay(t.settlement, next.settlement);
    }
    if (tv.weather) {
      const wv = tv.weather;
      const w = { ...t.weather, auto: !!wv.auto, fronts: !!wv.fronts };
      const pick = (value, vocab) => (value === "" || vocab[value] ? value : undefined);
      if (SEASONS.includes(wv.season)) w.season = wv.season;
      if (typeof wv.temperature === "string" && pick(wv.temperature, TEMPERATURE_BANDS) !== undefined) w.temperature = wv.temperature;
      if (typeof wv.precipitation === "string" && pick(wv.precipitation, PRECIPITATION_KINDS) !== undefined) w.precipitation = wv.precipitation;
      if (typeof wv.wind === "string" && pick(wv.wind, WIND_BANDS) !== undefined) w.wind = wv.wind;
      w.footing = {
        ...w.footing,
        ...(["none", "muddy", "frozen"].includes(wv.footingMud) ? { mud: wv.footingMud } : {}),
        snow: !!wv.footingSnow,
      };
      next.weather = w;
    }
    // How the order moves. Read as a group for the same reason the cold's
    // inputs are: a picker and two fields submit together.
    if (tv.movement) {
      next.movement = {
        mode: isMode(tv.movement.mode) ? tv.movement.mode : t.movement.mode,
        hoursAloft: Math.max(0, Number(tv.movement.hoursAloft) || 0),
        dayHours: Math.max(0, Number(tv.movement.dayHours) || 0),
        load: FLIGHT_LOADS[tv.movement.load] ? tv.movement.load : "normal",
      };
    }
    // The cold's declared inputs. The checkboxes are absent from the submit
    // when unticked, so the whole group is read together or not at all —
    // reading them one at a time would clear the other two on every keystroke
    // in the hours field.
    if (tv.exposure) {
      next.exposure = {
        hours: Math.min(24, Math.max(0, Math.floor(Number(tv.exposure.hours) || 0))),
        atHeatSource: !!tv.exposure.atHeatSource,
        wet: !!tv.exposure.wet,
      };
    }
    if (typeof tv.hexLabel === "string") next.hex = { ...t.hex, label: tv.hexLabel.trim() };
    if (typeof tv.lostNote === "string") next.lost = { ...next.lost, judgeNote: tv.lostNote };
    if (tv.day) {
      let day = t.day;
      if (typeof tv.day.kind === "string" && DAY_KINDS[tv.day.kind] && tv.day.kind !== day.kind) {
        if (tv.day.kind === "forced") {
          barred = forcedMarchBar(record);
          refused = barred.length > 0 && !overrides(override);
          forcedHere = !refused;
        }
        if (!refused) day = withDayKind(day, tv.day.kind);
      }
      if (tv.day.slot && !DAY_KINDS[day.kind]?.consumesAncillary) {
        const activities = [...day.activities];
        for (const [k, v] of Object.entries(tv.day.slot)) {
          const i = Number(k);
          if (Number.isInteger(i) && i >= 0 && i < ANCILLARY_SLOTS) activities[i] = ANCILLARY_ACTIVITIES[v] ? v : null;
        }
        day = { ...day, activities };
      }
      // The day's declarations. An unticked checkbox is absent from the submit,
      // so they are written explicitly once the group is present (its hidden
      // `declared` marker makes it so) and left alone when it is not.
      if (tv.day.declared !== undefined || tv.day.traps !== undefined || tv.day.noSleep !== undefined) {
        day = { ...day, traps: trapCount(tv.day.traps), noSleep: !!tv.day.noSleep };
      }
      next.day = day;
    }
    // The camp's declarations, read as a group for the same reason.
    if (tv.camp) {
      next.camp = { steal: !!tv.camp.steal, water: !!tv.camp.water, sleepInArmour: !!tv.camp.sleepInArmour };
    }
    record.travel = next;
  });
  if (refused) warnForcedMarchBarred(barred);
  else if (forcedHere && barred.length && result) await announceBarOverridden(result, barred);
  return result;
}

/** The world's season mapping, "" while unregistered or unset. */
function seasonMapSetting() {
  try {
    return String(game.settings.get(MODULE_ID, SETTING_SEASON_MAP) ?? "");
  } catch {
    return "";
  }
}

/**
 * The generator season in force for a party: the calendar's season, when the
 * calendar declares one and it maps (`seasonKeyFor`), else the season the party
 * declared. One shape for every reader — the key the sky is cached under, the
 * day change that settles it, and the sheet that shows it.
 * @param {object} travel  a `travelOf` result
 * @returns {{season: string, fromCalendar: boolean, calendarName: string}}
 *   `calendarName` is the calendar season's localized name when `fromCalendar`.
 */
export function effectiveSeason(travel) {
  const reading = calendarSeason();
  if (reading) {
    const labels = Object.fromEntries(SEASONS.map((s) => [s, game.i18n.localize(`ACKS-FORMATION.travel.weather.seasons.${s}`)]));
    const key = seasonKeyFor(reading, { map: seasonMapSetting(), keys: SEASONS, labels });
    if (key) return { season: key, fromCalendar: true, calendarName: reading.name };
  }
  return { season: travel?.weather?.season ?? "spring", fromCalendar: false, calendarName: "" };
}

/**
 * The sky cache key for a party's ground on a day: the calendar day the world
 * clock stands in, or — only where the clock keeps no calendar — the End-day
 * counter. `dayCount` keeps numbering the log; it is not the sky's identity.
 * The climate is `t`'s as `travelOf` resolves it — the map's, the scene's or
 * the Judge's — so `t` is a `travelOf` result, never a stored one.
 */
function skyParams(t, season, day = calendarDay() ?? t.dayCount) {
  return { day, climate: t.weather.climate, season };
}

/** The last calendar day a party's weather was settled, or null when none was recorded. */
function settledDayOf(weather) {
  const n = weather?.settledDay == null ? NaN : Math.floor(Number(weather.settledDay));
  return Number.isFinite(n) ? n : null;
}

/**
 * Settle one formation across a change of calendar day: the ground takes each
 * finished day's weather, and with the generator on, each new day's sky is
 * read from (or rolled into) the shared cache.
 *
 * The formation's `weather.settledDay` is the last day settled. Absent, it is
 * stamped with `today` and nothing is paid back; at or past `today` it is a
 * no-op, so a clock that is dragged or a hook that fires twice settles once.
 * Only a formation in journey mode is settled — any other is stamped, so one
 * that enters journey mode later does not back-pay. Each crossed day runs in
 * order against ONE local copy of the cache, which is written once; the
 * formation takes one patch.
 *
 * `counter` is the calendar-less path: End day settles the single day it
 * names, in any mode, and neither reads nor writes the watermark (a counter and
 * a calendar day must never meet in it).
 * @returns {Promise<boolean>} whether the formation was settled
 */
export async function settleDayChange(formationId, today, { counter = false } = {}) {
  const day = Math.floor(Number(today));
  const record = getFormation(formationId);
  if (!record || !Number.isFinite(day)) return false;
  const t = travelOf(record);
  const settled = settledDayOf(t.weather);
  if (!counter && settled != null && day <= settled) return false;
  if (!counter && (settled == null || t.mode !== "journey")) {
    await patchFormation(formationId, (rec) => {
      const cur = storedTravelOf(rec);
      rec.travel = { ...cur, weather: { ...cur.weather, settledDay: day } };
    });
    return false;
  }

  const { climate, fronts, auto } = t.weather;
  const season = effectiveSeason(t).season;
  const mudProne = terrainMudProne(t.ground);
  const cache0 = readSkyCache();
  let cache = cache0;
  let footing = t.weather.footing;
  let bands = {
    temperature: t.weather.temperature,
    temperatureNight: t.weather.temperatureNight,
    precipitation: t.weather.precipitation,
    wind: t.weather.wind,
    rolls: t.weather.rolls,
  };
  for (let d = counter ? day : settled + 1; d <= day; d++) {
    // The finished day's bands settle onto the ground first; the new day's sky
    // is read after, so it governs the NEXT settling.
    const { mud, snow, runs } = advanceGround(footing, {
      temperature: bands.temperature,
      precipitation: bands.precipitation,
      mudProne,
    });
    footing = { mud, snow, runs };
    if (!auto) continue;
    const params = { day: d, climate, season };
    const prior = fronts ? (priorSky(cache, params)?.rolls ?? bands.rolls) : null;
    const read = skyFrom(cache, params, () => generateDay({ climate, season, prior, fronts: !!fronts }));
    cache = read.cache;
    if (read.sky?.ok) {
      const { temperature, temperatureNight, precipitation, wind, rolls } = read.sky;
      bands = { temperature, temperatureNight, precipitation, wind, rolls };
    }
  }
  if (cache !== cache0) await writeSkyCache(cache, day);
  const result = await patchFormation(formationId, (rec) => {
    const cur = storedTravelOf(rec);
    if (!counter && (settledDayOf(cur.weather) ?? -Infinity) >= day) return false;
    const weather = { ...cur.weather, footing, ...(auto ? bands : {}) };
    if (!counter) weather.settledDay = day;
    rec.travel = { ...cur, weather };
  });
  return !!result;
}

/** Settles run one at a time, so two clock steps in quick succession read the watermark in turn. */
let settling = Promise.resolve();

/**
 * Settle every formation across a change of calendar day (`settleDayChange`),
 * one at a time and each in its own guard, so one formation's failure does not
 * stop the rest.
 */
export function settleAllOnDayChange(today) {
  const run = settling.then(async () => {
    for (const formation of Object.values(getFormations())) {
      try {
        await settleDayChange(formation.id, today);
      } catch (err) {
        console.error(`${MODULE_ID} | the day change could not settle ${formation.id}`, err);
      }
    }
  });
  settling = run.catch(() => {});
  return run;
}

/**
 * The Judge rolls the sky on demand — the journey's first morning, or a
 * result worth re-rolling. An on-demand roll is a fresh sky, never a front:
 * the drift compares to a prior day, and this roll is REPLACING today.
 * Refused (no write) when the registry cannot answer; the panel's hint
 * already names the missing document.
 */
export async function rollWeatherNow(formationId) {
  // The sky is shared: two parties in one climate on one calendar day read a
  // single roll, and re-rolling the same day is a cache hit rather than new
  // weather.
  const record0 = getFormation(formationId);
  const t0 = travelOf(record0 ?? {});
  const season = effectiveSeason(t0).season;
  const params = skyParams(t0, season);
  // No prior and no drift, whatever the fronts toggle says: the drift belongs
  // to the day change (`settleDayChange`), and this roll replaces today.
  const { sky: gen } = await skyFor(params, () => generateDay({
    climate: t0.weather.climate,
    season,
    prior: null,
    fronts: false,
  }));
  if (!gen?.ok) return false;
  return patchFormation(formationId, (record) => {
    const t = storedTravelOf(record);
    record.travel = {
      ...t,
      weather: {
        ...t.weather,
        temperature: gen.temperature,
        temperatureNight: gen.temperatureNight,
        precipitation: gen.precipitation,
        wind: gen.wind,
        rolls: gen.rolls,
      },
    };
  });
}


/**
 * End the day: log it, reset the board, advance the world clock to the next
 * dawn (when the module may). The caller supplies the derived figures the panel already
 * shows — miles and hexes made — so the log records what the Judge saw, not
 * a second derivation that could disagree with it.
 *
 * The weather does not settle here where the clock keeps a calendar: the
 * jump to dawn crosses the day change, and the day-change watcher settles the
 * ground and the new sky (`settleDayChange`). With the module not moving the
 * clock, End day fakes no day — the sky follows the real clock. Where the
 * clock keeps NO calendar, End day settles the day itself, keyed on its own
 * counter, exactly as the one-clock-per-party days always did.
 *
 * The jump is to the next dawn by the calendar. A clock that keeps no calendar
 * advances what the day has not already advanced of a whole day, so hours the
 * march ran earlier are absorbed and never charged twice.
 *
 * @returns the log entry written, or null when the formation is gone
 */
export async function endDay(formationId, { miles = null, hours = null, hexes = null, notes = "" } = {}) {
  let entry = null;
  let advancedToday = 0;
  const t0 = travelOf(getFormation(formationId) ?? {});
  // The day's navigation throw, whispered. Deliberately BEFORE the patch and
  // deliberately not acted on: RAW hands the stray direction to the Judge, so
  // the card reports and the Judge begins the episode.
  if (t0.mode === "journey" && !t0.lost?.active) {
    try {
      await postNavigationThrow(getFormation(formationId));
    } catch (err) {
      console.error(`${MODULE_ID} | the navigation throw failed; the day still ends`, err);
    }
  }

  // Feed the order and walk every ladder one step, BEFORE the patch: reading
  // packs and writing bodies is async, and the patch callback is not.
  let provisions = null;
  try {
    provisions = await runProvisionDay(getFormation(formationId));
  } catch (err) {
    console.error(`${MODULE_ID} | provisioning failed; the day still ends`, err);
  }

  const record = await patchFormation(formationId, (rec) => {
    const t = storedTravelOf(rec);
    // The day is logged as the party READ it — the country resolved — while
    // the record keeps only what it stored.
    entry = composeLogEntry(travelOf(rec), { miles, hours, hexes, notes, worldTime: game.time?.worldTime ?? null });
    advancedToday = t.day.secondsAdvanced ?? 0;
    rec.travel = {
      ...t,
      dayCount: entry.day,
      day: withDayKind(null, t.day?.kind ?? "march"),
      log: pushLog(t.log, entry, logCap()),
    };
  });
  if (!record) return null;
  // No calendar, no day change to watch: this day's settling is End day's own,
  // keyed on the counter the patch just advanced.
  if (calendarDay() == null) {
    try {
      await settleDayChange(formationId, entry.day, { counter: true });
    } catch (err) {
      console.error(`${MODULE_ID} | the day's weather could not settle; the day still ends`, err);
    }
  }
  const jump = untilNextDawn() ?? Math.max(0, DAY_SECONDS - advancedToday);
  if (jump > 0 && mayAdvanceWorldTime()) await game.time.advance(jump);
  // The finished day carries how it was fed, so the log can say the party ate
  // short on the fourteenth rather than leaving it to memory.
  if (entry && provisions) {
    entry.provisions = {
      short: provisions.short,
      suffering: provisions.report.filter((r) => r.worsened).map((r) => r.name),
    };
  }
  return entry;
}
