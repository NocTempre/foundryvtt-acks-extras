/* global game, Roll */
/**
 * The overland mode: a formation that knows what ground it is crossing, how
 * the day is being spent, and where the days went.
 *
 * State lives on the formation record (a `travel` subtree), written only
 * through the ledger's own lock; see docs/formation/DECISIONS.md, "Travel state lives on the formation record, as a mode".
 * A record without the subtree is a party that has never journeyed, and
 * `travelOf` answers for it.
 *
 * A journey is counted in miles and spent in hours: the day owns a budget of
 * marching hours (the day kind's pace plus the ancillary activity slots, RR
 * ch. 6), the world clock runs by the hours the miles take, and the dungeon
 * turn tracker stays out of it. Ending the day advances the world clock to the
 * next dawn through the module's one world-time switch, appends the day to an
 * append-only log, and hands the entry back for the panel to show.
 *
 * The activity taxonomy carries each activity's encounter-frequency kind (per
 * hex entered, per hour, per attempt, per period; JJ ch. 2); how often each
 * cadence fires per territory arrives through the registry.
 *
 * Pure derivations (defaults, the day board, the log) are exported for the
 * committed tests; everything that writes goes through `patchFormation`.
 */
import { MODULE_ID } from "../lib/constants.mjs";
import { isPrimaryGM, numOrNull } from "../lib/util.mjs";
import { parentUuidOf, resolvePlaceSync } from "../lib/place.mjs";
import { patchFormation, getFormation, getFormations, getPartyToken, realMembers, getMemberActor, hasAbility, derivedMovementMode } from "./formation-model.mjs";
import { hasCapability } from "./ability-bridge.mjs";
import { mayAdvanceWorldTime, untilNextDawn, calendarDay, calendarSeason } from "../lib/world-time.mjs";
import { TRAVEL_PACE, expeditionCite, expeditionFigures } from "../lib/movement-scales.mjs";
import { isExpeditionScale } from "../lib/distance-units.mjs";
import { hexLabelFromOffset, isHexScene, layerRegionsOf } from "../battlemap/terrain-paint.mjs";
import { sceneTravelSystem } from "../battlemap/scene-setup.mjs";
import { COUNTRY_KEYS, countryAt, riverTableFor } from "../battlemap/country.mjs";
import { FOLLOWING_KINDS, TERRITORY_KEYS } from "./country-keys.mjs";
import { TRAVEL_MODES } from "../lib/vocab.mjs";
import { SLOT_HOURS, marchBudget, marchIsSpent } from "./march.mjs";
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

/**
 * How many ancillary activities a fresh day budgets: the imported ancillary
 * hours (the `travel` document's `expedition` table, RR p. 272), cut into
 * slots of `SLOT_HOURS`. Null while those hours are not imported, and a fresh
 * day then carries no slots. A stored day keeps the slots it was made with.
 * @returns {number|null}
 */
export function ancillarySlots() {
  const hours = expeditionFigures().ancillaryHours;
  return hours == null ? null : Math.floor(hours / SLOT_HOURS);
}

/**
 * Where the slot count came from, for its tooltip: the page the expedition
 * table was imported from, a Judge's override (which holds no page), or an
 * empty string while the hours are not imported.
 */
export function ancillarySlotsProvenance() {
  if (ancillarySlots() == null) return "";
  const cite = expeditionCite();
  return cite
    ? game.i18n.format("ACKS-FORMATION.chat.cadenceFrom.import", { cite })
    : game.i18n.localize("ACKS-FORMATION.chat.cadenceFrom.override");
}

/**
 * How the day itself is spent: a forced march spends every ancillary slot on
 * the road, and camp is a day that goes nowhere.
 */
export const DAY_KINDS = Object.freeze({
  march: { label: "ACKS-FORMATION.travel.day.march", pace: "dedicated", travels: true },
  forced: { label: "ACKS-FORMATION.travel.day.forced", pace: "forced", travels: true, consumesAncillary: true },
  camp: { label: "ACKS-FORMATION.travel.day.camp", pace: null, travels: false },
});

/**
 * What an ancillary hour can be spent on, and the encounter cadence each
 * activity answers to (JJ ch. 2); the frequencies arrive through the registry.
 */
export const ANCILLARY_ACTIVITIES = Object.freeze({
  travel: { label: "ACKS-FORMATION.travel.activity.travel", frequency: "perHex" },
  hunt: { label: "ACKS-FORMATION.travel.activity.hunt", frequency: "perAttempt" },
  forage: { label: "ACKS-FORMATION.travel.activity.forage", frequency: "perAttempt" },
  search: { label: "ACKS-FORMATION.travel.activity.search", frequency: "perHour" },
  rest: { label: "ACKS-FORMATION.travel.activity.rest", frequency: "perPeriod" },
  other: { label: "ACKS-FORMATION.travel.activity.other", frequency: "perPeriod" },
  // Managing traps is a count on the day (`day.traps`), not a slot, so the
  // slot picker leaves it out.
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
import { isMode } from "../lib/movement-modes.mjs";
import { FLIGHT_LOADS } from "./flight.mjs";
import { lostOf } from "./lost.mjs";
import { shadowFor } from "./shadow.mjs";
import { weatherEffects, throwPenalty } from "./weather-effects.mjs";

/**
 * The three things a formation can be doing, re-exported from `lib/vocab.mjs`
 * (a scene may declare which applies on it, `docs/battlemap/MODEL.md`). A
 * `journey` is the one that stops the turn clock.
 */
export { TRAVEL_MODES };

/** The country's own vocabularies live in a leaf the battlemap reads too; re-exported for callers. */
export { FOLLOWING_KINDS, TERRITORY_KEYS };

/** A declared count as a whole number of at least zero. */
const trapCount = (n) => Math.max(0, Math.floor(Number(n) || 0));

/** A fresh, unspent day board. */
export function freshDay(kind = "march") {
  const spec = DAY_KINDS[kind] ? kind : "march";
  const slots = ancillarySlots() ?? 0;
  return {
    kind: spec,
    activities: Array.from({ length: slots }, () => null),
    hexesEntered: 0,
    // Extra distance the day's bends cost over straight crossings, in hexes.
    winding: 0,
    // What the day has spent, unrounded: miles walked, the hours those miles
    // took (the march's hours, not a resolved ancillary slot's), the miles and
    // seconds not yet worth a cadence unit or a whole second (`spendMarch`),
    // and the seconds the world clock has advanced for the day, slots included.
    miles: 0,
    hours: 0,
    cadenceCarry: 0,
    carrySeconds: 0,
    secondsAdvanced: 0,
    // Which ancillary slots have been resolved (a search hour, a forage).
    done: Array.from({ length: slots }, () => false),
    /** Whether the party has been asked to call this day done; a kind change resets it. */
    offered: false,
    // The day's own declarations: how many traps the order managed, and
    // whether the order goes without sleep tonight. Both end with the day.
    traps: 0,
    noSleep: false,
  };
}

/**
 * Apply a day-kind to a board. A forced march consumes the ancillary budget
 * (every slot becomes the march itself); stepping back down returns a fresh
 * budget. What the day has already walked survives every kind change; only
 * ending the day (`withDayKind(null, …)`) zeroes the tally.
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
    next.done = next.activities.map((_, n) => !!day.done?.[n]);
    next.traps = trapCount(day.traps);
    next.noSleep = !!day.noSleep;
  }
  return next;
}

/**
 * The hours the day's march may spend, and the miles that is at this speed:
 * the day kind's pace plus one hour per ancillary slot set to travel (unless
 * the pace already consumes the slots). A camp day marches only its travel
 * slots. A pace whose hours are not imported prices no day (`marchBudget`).
 * @param {object} travel         a `travelOf` result
 * @param {number|null} milesPerHour   the readout's speed, null while not imported
 * @returns {{hours: number|null, miles: number|null}}
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
 * Has the day's march been walked? True when the hours taken reach the budget,
 * or when the step just taken was after dusk (`dark`); a budget nobody could
 * price never ends the day by hours alone.
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
 * The modes that stand on the Judge's word alone: hours aloft are declared, and
 * a boat nobody holds a sheet for has no attachment to read.
 */
const DECLARED_MODES = Object.freeze(["flying", WATER_BORNE]);

/**
 * The Judge's word on how the whole party moves (`movement.set`), a mode key,
 * or null for the automatic reading.
 */
function movementSetOf(t) {
  const set = t.movement?.set;
  return isMode(set) ? set : null;
}

/** The mode in force: a declared mode's word, else what the attachments say. */
const movementModeOf = (formation, set) => (DECLARED_MODES.includes(set) ? set : derivedMovementMode(formation));

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
 * hex (`travel.map`), the declared record, then the module's default. A
 * declared value equal to the default reads as the default.
 *
 * The map's provenance is the reading's own `source` passed through: `map`,
 * `scene`, or the key of the layer that derived the value; a reading naming no
 * source is the map's.
 *
 * While the party moves on the water and a water line runs under it, the map's
 * encounter terrain is the river's table for the ground. An overridden ground
 * takes the table with it: the map's and the record's tables describe the
 * ground they were read with, so neither answers and the ground's own table
 * (`encounterTerrainFor`) does. The river's table stands.
 *
 * `mapValues` is what the map alone answers for each key, null where it says
 * nothing, whether or not a source above it won.
 *
 * @returns {{values: Record<string, string>, provenance: Record<string,
 *   string>, mapValues: Record<string, string|null>, map: object|null}}
 *   `provenance` is `override`, `map`, `scene`, a deriving layer's key,
 *   `declared` or `default`
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
    // `ground` is first in COUNTRY_KEYS, so the river's table reads the resolved ground.
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
      // Afloat, the river's table is the map's water.
      provenance[key] = (!river && map.source?.[key]) || "map";
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
 * What a player's seat is shown of the hex the party stands in, the Judge's
 * choice (`travel.shown`): `believed`, the party token's hex as the map reads
 * it, and the default; `unknown`, a blank plate and no country at all.
 */
export const SHOWN_KINDS = Object.freeze(["believed", "unknown"]);

/** How many navigation throws `travel.navigation.history` keeps, newest first. */
export const NAVIGATION_HISTORY = 10;

/** Who made a navigation throw: the day's first step off a road, or the Judge's own press. */
export const NAVIGATION_BY = Object.freeze(["step", "judge"]);

/** The Judge's answer to "is there anything here" as the record keeps it: the stock's, yes or no; null where nothing was said. */
const PRESENT_ANSWERS = Object.freeze(["stock", "yes", "no"]);
const campPresent = (v) => (PRESENT_ANSWERS.includes(v) ? v : null);
/** What the search looks for: a point's id, `elsewhere`, or `anything` for an empty or missing word. */
const campTarget = (v) => (typeof v === "string" && v ? v : "anything");

/** A day key as `journeyDayKey` writes it, or null for anything that is not a non-empty string. */
const dayKeyOrNull = (v) => (typeof v === "string" && v ? v : null);

/** A whole day count, or null for anything that is not a finite number. */
const dayCountOrNull = (v) => {
  const n = numOrNull(v);
  return n == null ? null : Math.floor(n);
};

/** One stored throw normalized, or null for anything that is not one. */
function navigationEntryOf(e) {
  if (!e || typeof e !== "object") return null;
  return {
    day: dayKeyOrNull(e.day),
    count: dayCountOrNull(e.count),
    hexLabel: String(e.hexLabel ?? ""),
    target: numOrNull(e.target),
    total: numOrNull(e.total),
    natural: numOrNull(e.natural),
    success: typeof e.success === "boolean" ? e.success : null,
    by: NAVIGATION_BY.includes(e.by) ? e.by : NAVIGATION_BY[0],
  };
}

/**
 * The navigation record of a travel subtree, normalized: `thrownOn`, the day
 * key of the last throw (null when none was made); `lastResult`, that throw;
 * `history`, the last `NAVIGATION_HISTORY` throws, newest first. A throw is
 * `{ day, count, hexLabel, target, total, natural, success, by }`: `day` the
 * key it was claimed under (`journeyDayKey`), `count` the End-day counter it
 * was made on, which the sheet shows as the log shows its days; `success` is
 * null for a throw that could not be made (its target unimported).
 */
export function navigationOf(travel) {
  const n = travel?.navigation && typeof travel.navigation === "object" ? travel.navigation : {};
  return {
    thrownOn: dayKeyOrNull(n.thrownOn),
    lastResult: navigationEntryOf(n.lastResult),
    history: (Array.isArray(n.history) ? n.history : []).map(navigationEntryOf).filter(Boolean).slice(0, NAVIGATION_HISTORY),
  };
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
    // `done` is one boolean per slot the day carries, however many it was made with.
    day: {
      ...freshDay(),
      ...(t.day ?? {}),
      done: (Array.isArray(t.day?.activities) ? t.day.activities : freshDay().activities).map((_, n) => !!t.day?.done?.[n]),
      traps: trapCount(t.day?.traps),
      noSleep: !!t.day?.noSleep,
    },
    // The camp's declarations: three yes-or-noes (the party takes what is not
    // its own, water is at hand, the order sleeps armoured) and the search's two
    // answers, kept so the selects re-draw what the Judge chose.
    camp: {
      steal: !!t.camp?.steal, water: !!t.camp?.water, sleepInArmour: !!t.camp?.sleepInArmour,
      present: campPresent(t.camp?.present), target: campTarget(t.camp?.target),
    },
    // Traps declared on a day that did not make a whole batch, carried to the
    // next; and the runs the sky has kept a condition, keyed by condition.
    trapsCarry: trapCount(t.trapsCarry),
    weatherRuns: { ...(t.weatherRuns ?? {}) },
    dayCount: Number(t.dayCount) || 0,
    lost: lostOf(t),
    // What a player's seat is shown of the party's hex (`SHOWN_KINDS`).
    shown: SHOWN_KINDS.includes(t.shown) ? t.shown : SHOWN_KINDS[0],
    navigation: navigationOf(t),
    // How the order moves (flying, afloat, on foot), independent of `mode`
    // above, which is the kind of adventuring. `mode` is the answer and is
    // never stored (`storedTravelOf`); `set` is the Judge's word.
    movement: {
      mode: movementModeOf(formation, movementSetOf(t)),
      set: movementSetOf(t),
      hoursAloft: Math.max(0, Number(t.movement?.hoursAloft) || 0),
      // The length of the travelling day, declared and never assumed, so a
      // flier that spent part of it aloft is priced on the share. Zero means the
      // whole travelling day was spent flying.
      dayHours: Math.max(0, Number(t.movement?.dayHours) || 0),
      load: FLIGHT_LOADS[t.movement?.load] ? t.movement.load : "normal",
    },
    // How long the order stood in the weather, and whether anything was done
    // about it; the hours are the Judge's count, never guessed.
    exposure: {
      hours: Math.max(0, Number(t.exposure?.hours) || 0),
      atHeatSource: !!t.exposure?.atHeatSource,
      wet: !!t.exposure?.wet,
    },
    settlement: settlementOf(t),
    // The arrangement as the last group press found it, for its Undo.
    lastArrangement: t.lastArrangement && typeof t.lastArrangement === "object" ? t.lastArrangement : null,
    log: Array.isArray(t.log) ? t.log : [],
  };
}

/**
 * The travel subtree, defaults answered and the country resolved; never
 * mutates the record. The six country keys (`ground`, `encounterTerrain`,
 * `territory`, `road`, `following`, and the climate at `weather.climate`)
 * are each the first answer of override → map → scene default → declared →
 * default (`resolveCountry`), and `provenance` names which answered. `map` and
 * `override` are the record's own. This is the reader's view: a writer spreads
 * `storedTravelOf`, or the resolved values would be written back as the
 * Judge's declaration.
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
 * The travel subtree as a writer spreads it: every key `travelOf` defaults is
 * defaulted the same way, and the country keys are left as stored (absent where
 * the record holds none) with `map` and `override` carried, so a patch writes
 * back only what it changed.
 */
export function storedTravelOf(formation) {
  const t = formation?.travel ?? {};
  const stored = travelBase(formation);
  for (const key of ["ground", "road", "following", "territory", "encounterTerrain", "map", "override"]) {
    if (t[key] !== undefined) stored[key] = t[key];
  }
  // The mode is an answer, never a fact of the record.
  delete stored.movement.mode;
  return stored;
}

/**
 * One finished day as a log row; the log is append-only and newest-first, and
 * the cap trims the oldest rows.
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
    // The day's declarations ride the row, since End day resets the board
    // before the night's costs are resolved.
    traps: trapCount(travel.day?.traps),
    noSleep: !!travel.day?.noSleep,
    hexesEntered: travel.day?.hexesEntered ?? 0,
    // The display half of the weather only, not the generator's working state.
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
    // The day's own hours tally unless the caller states another.
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
 * Enter or leave a mode. A mode change clears any pause and re-anchors the
 * movement baseline at the token's present position, so the next drag is
 * measured from where the party stands now. The day board is held where it
 * stood.
 *
 * @param {string} formationId
 * @param {string|boolean} journey the mode to adopt (a bare boolean is the
 *   journey/delve switch)
 * @param {string|null} [opts.sceneId] the scene a settlement board is being
 *   counted on; the board is stamped with its city (`cityStampOf`). Naming
 *   none leaves whatever stamp the board carries. Callers that know the scene
 *   pass it, since an unstamped board is read as foreign on the next arrival.
 */
export function setJourneyMode(formationId, journey, { sceneId = null } = {}) {
  // A mode string, or a bare boolean for the journey/delve switch.
  const mode = typeof journey === "string"
    ? (TRAVEL_MODES.includes(journey) ? journey : "delve")
    : (journey ? "journey" : "delve");
  return patchFormation(formationId, (record) => {
    const t = storedTravelOf(record);
    const token = getPartyToken(record);
    // The token's stored corner, as `storedPosition` (turn-engine.mjs) reads it,
    // since a move still being drawn has its prepared corner part way along.
    // Read here, not imported: the turn engine reaches this module.
    const stored = token ? (token._source ?? token) : null;
    const corner = stored ? { x: stored.x, y: stored.y, width: token.width, height: token.height } : null;
    record.travel = {
      ...t,
      mode,
      // Entering a city asks the factions' ledgers whether anyone hunts the
      // party in its quarter (hunt.mjs); leaving one keeps the board whole.
      settlement: mode === "settlement" ? withHunt(enteredSettlement(t, sceneId), record) : t.settlement,
      // A journey begun on the token reads the country under it now.
      ...(mode === "journey" && token?.parent
        ? { map: mapReadingAt(token.parent, tokenCentre(corner, token.parent), { at: game.time?.worldTime ?? null }) }
        : {}),
    };
    record.clock = {
      ...(record.clock ?? {}),
      paused: false,
      pausedBy: null,
      ...(corner ? { lastPosition: { x: corner.x, y: corner.y } } : {}),
    };
  });
}

/**
 * The settlement board a party entering settlement mode lands on: a fresh
 * tally that keeps what the Judge set. Arriving in another city is an entry
 * too, whether or not the mode changed, since the blocks, turns, hunted flag
 * and stay stamp were counted in the city being left. A board reaching a named
 * city it does not itself name is foreign, an unstamped board included
 * (`boardIsElsewhere`); the scene handed in is stamped as its city
 * (`cityStampOf`).
 */
function enteredSettlement(travel, sceneId) {
  const board = travel.settlement;
  const stamp = cityStampOf(sceneId);
  if (travel.mode !== "settlement" || boardIsElsewhere(board, stamp)) return reenterSettlement(board, stamp);
  return { ...board, sceneId: stamp ?? board.sceneId };
}

/**
 * Is this board's tally counted in a city other than the one being entered?
 * The one test both settlement writers ask, so the decision to re-enter and
 * the decision to announce it cannot disagree. An unstamped board is foreign;
 * an arrival that names no city is not somewhere new, since there is no stamp
 * to write and the tally would be wiped on every call.
 */
function boardIsElsewhere(board, stamp) {
  return stamp != null && board.sceneId !== stamp;
}

/** The location feature's scene ↔ place links, or null when it is not loaded. */
const sceneLinks = () => globalThis.acksExtras?.location?.scenes ?? null;

/**
 * The stamp a board arriving on this scene is counted under: the city map of
 * the outermost place, from the scene's own place up its parents, that has
 * one; else the scene's own id. Takes a scene or its id.
 *
 * A city drawn over several maps is one city, so stepping indoors keeps the
 * tally and only a scene outside every city's chain is somewhere new. The
 * chain is the places' own parent walk, and a place's city map is
 * `cityMapOf`'s; a place with no city map is climbed through. A city map's own
 * stamp is itself. Synchronous, because the board's writers decide inside one
 * ledger patch.
 *
 * @returns {string|null}
 */
export function cityStampOf(scene) {
  const own = sceneStamp(typeof scene === "string" ? scene : scene?.id);
  const links = sceneLinks();
  const at = typeof scene === "string" ? game.scenes?.get?.(scene) : scene;
  let place = own && at ? links?.locationOfScene?.(at) ?? null : null;
  let city = own;
  // A parent chain that loops back on itself ends where it first repeats.
  for (const seen = new Set(); place && !seen.has(place.uuid); place = resolvePlaceSync(parentUuidOf(place))) {
    seen.add(place.uuid);
    const map = cityMapOf(place, links);
    if (map) city = map.id;
  }
  return city;
}

/**
 * The map a place is a city on, or null: its verified mirror where that calls
 * for a settlement, else the lowest-id scene linked to it that does, so two
 * copies of one map name the same city whichever is asked.
 */
function cityMapOf(place, links) {
  const isCity = (s) => inferredTravelSystem(s).system === "settlement";
  const mirror = links.sceneOfLocation?.(place) ?? null;
  if (mirror && isCity(mirror)) return mirror;
  const linked = game.scenes?.filter?.((s) => links.locationOfScene(s)?.uuid === place.uuid && isCity(s)) ?? [];
  return linked.reduce((low, s) => (!low || s.id < low.id ? s : low), null);
}

/**
 * The travel system a scene calls for, and what said so: the one the Judge
 * declared (the battlemap setup tool writes it), else a journey for a map
 * whose cell is a mile or more across, else a settlement for a map with a
 * district drawn on it, else nothing.
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
 * The encounter line a scene reads: what it calls for, else the mode of a party
 * standing on it. A settlement has neither line, so it answers nothing.
 * @returns {"dungeon"|"wilderness"|null}
 */
export function sceneEncounterLine(scene) {
  if (!scene) return null;
  const party = Object.values(getFormations()).find((f) => f.sceneId === scene.id);
  const mode = inferredTravelSystem(scene).system ?? (party ? travelOf(party).mode : null);
  return { delve: "dungeon", journey: "wilderness" }[mode] ?? null;
}

/**
 * Whether a scene update's `changes` touch what `isExpeditionScale` reads, the
 * grid's distance or units.
 */
export function sceneScaleChanged(changes) {
  const grid = changes?.grid;
  return !!grid && typeof grid === "object" && ("distance" in grid || "units" in grid);
}

/**
 * Take the travel system the scene calls for (`inferredTravelSystem`); it
 * runs when a party token lands and when the declaration itself changes. A
 * scene that says nothing and shows nothing changes nothing, so a party
 * mid-march is not reset by crossing an unlabelled scene.
 *
 * A second city is an arrival even though the mode does not change
 * (`boardIsElsewhere`); a map of a building inside the city is the same city
 * (`cityStampOf`).
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
  const sceneId = cityStampOf(scene);
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
    // Every picker the panel shows; `settlementOf` below rejects a value
    // outside a vocabulary. `days` and `holeUpSince` are absent: the world
    // clock owns the stay.
    for (const key of ["pace", "where", "route", "hour", "intent", "conveyance"]) {
      if (patch[key] !== undefined) next[key] = String(patch[key]);
    }
    if (patch.wanted !== undefined) {
      next.wanted = !!patch.wanted;
      // The Judge's untick outranks the ledger: the hunter's name goes with the
      // flag, and the quarter stays asked.
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
 * Retire a record's declaration of one country key: the key's default
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
 * request that only a Gamemaster's seat is heard on.
 */
const overrides = (override) => override === true && !!game.user?.isGM;

/**
 * Choose how the day is spent. Changing into a forced march is refused while
 * a marching member's survival state bars one (`forcedMarchBar`): the seat is
 * warned, naming them, and the kind stays. The Judge's seat passes
 * `{ override: true }` to set it anyway, which whispers the Judges who was
 * barred. A day already forced is not asked again.
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

/**
 * Record a hex entered: the label updates and the day counts it. Spends no
 * miles and moves no clock; `nextHex` (journey.mjs) also spends a cadence unit.
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
 * compared, so a re-read that found nothing new is not worth a write.
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
 * the step names laid over it as the map's own answer, read on the step's
 * `sceneId` (else the last reading's scene). Null when the step reads nothing.
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
 * map's reading of it is cached as `travel.map`; the country keys themselves
 * are never written here. The first arrival (no prior offset) names the hex
 * without counting it. A repeat of the same offset counts nothing: it returns
 * the very object it was given unless the step reads the hex differently (the
 * same offset on another scene), and then only the reading changes. A crossing
 * whose step read nothing leaves no reading, so the last hex's is never taken
 * for this one's.
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
            // Only the excess is banked: a straight crossing costs nothing extra.
            winding: (travel.day.winding ?? 0) + Math.max(0, (Number(winding) || 1) - 1),
          }
        : travel.day,
    },
  };
}

/**
 * Seat a journeying party under a token that was set down rather than walked
 * (stepped onto its true position): the hex and the map's reading of it change
 * and nothing is counted. Off a hex grid only the reading is written; a
 * formation not on a journey changes nothing. `at` is the corner to read at; a
 * caller hearing a move passes the stored one (`storedPosition`), since a drawn
 * token's own `x`/`y` lag it.
 */
export function seatJourneyHex(tokenDoc, formationId, at = tokenDoc) {
  const scene = tokenDoc?.parent;
  if (!scene) return Promise.resolve(null);
  const corner = { x: at.x, y: at.y, width: tokenDoc.width, height: tokenDoc.height };
  const reading = mapReadingAt(scene, tokenCentre(corner, scene), { at: game.time?.worldTime ?? null });
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
 * The travel subtree read where the party really is. While a lost episode is
 * open and its shadow stands on the episode's scene, this is `travelOf`
 * resolved over the map's reading at the shadow (hex, country, water), through
 * the Judge's override and the grounded rule as at the token; otherwise it is
 * `travelOf` itself. The reading is taken on the episode's scene even where
 * the party token has since been placed on another. The encounter column reads
 * this; the sheet reads `travelOf`, the hex the party believes it stands in.
 * Never written back.
 */
export function trueTravelOf(formation) {
  const t = travelOf(formation);
  if (!t.lost.phase) return t;
  const scene = game.scenes?.get(t.lost.sceneId ?? formation?.sceneId) ?? null;
  const shadow = scene ? shadowFor(scene, formation?.id) : null;
  if (!shadow) return t;
  const map = mapReadingAt(scene, tokenCentre(shadow, scene), { at: t.map?.at ?? null });
  const stored = formation.travel ?? {};
  const hex = map.i != null && map.j != null
    ? { ...(stored.hex ?? {}), label: hexLabelFromOffset(map), i: map.i, j: map.j }
    : stored.hex;
  return travelOf({ ...formation, sceneId: scene.id, travel: { ...stored, map, hex } });
}

/**
 * Re-read the map under every journeying party standing on a scene, and cache
 * what changed (`travel.map`), for a party that has not moved. With `walls`
 * false a reading of the same hex keeps its cached road, route and water,
 * since the road may be the one the last step walked, which a re-read at the
 * token cannot see.
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
 * The scenes a change to one paint layer can re-read a party on: each scene a
 * party's token stands on that holds paint of that layer (`paintLayerChanged`
 * reports a change by the layer alone).
 *
 * @returns {string[]} scene ids, each once
 */
export function partyScenesPaintedWith(layer) {
  const ids = new Set();
  for (const formation of Object.values(getFormations())) {
    const scene = getPartyToken(formation)?.parent;
    if (scene?.id && layerRegionsOf(scene, layer).length) ids.add(scene.id);
  }
  return [...ids];
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
 * Who in the marching order can find the way: the Navigation proficiency and
 * the Pathfinding class power, either helping and both helping more. What each
 * is worth is read from the travel document's `navigationBonus` row; with
 * nothing imported there is no bonus and `unpriced` is set.
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
 * What spares a party the navigation throw: `"road"` on a road, the route it
 * follows (`FOLLOWING_KINDS`) beside one, null in trackless country. `t` is a
 * `travelOf` result.
 */
function routeFollowed(t) {
  if (t.road && t.road !== "none") return "road";
  if (t.following && t.following !== "none") return t.following;
  return null;
}

/**
 * The day's navigation prospect, before any dice. `throws` is false on a road
 * or a navigable river; otherwise the target is the terrain's, from the
 * imported `gettingLost` row, and a null target means not imported. What a
 * failure does is the card's (`navigation-card.mjs`).
 */
export function landNavigationSpec(formation) {
  const t = travelOf(formation);
  const route = routeFollowed(t);
  if (route) return { throws: false, reason: route };
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
 * How many faces a hex has, and therefore the die a blind stray is rolled on.
 */
export const HEX_FACES = 6;

/** A blind stray: a face index, 0-5; the fallback where the Judge does not choose the face. */
export async function rollStrayFace() {
  const roll = await new Roll(`1d${HEX_FACES}`).evaluate();
  return { face: roll.total - 1, roll };
}

/**
 * The day's navigation throw: a d20 against the terrain's imported target,
 * plus the marching order's competence and the sky's modifier; an unmodified 1
 * fails whatever the bonus.
 *
 * Returns `{throws: false}` untouched when a road or river carries the party,
 * and `{missing}` when the target was never imported. It reports and writes
 * nothing.
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
 * The day a navigation throw is owed on, as a key: the calendar day the world
 * clock stands in (empty where the clock keeps no calendar) and the End-day
 * counter, joined as `"<calendar day>:<counter>"`. A new day begins when
 * either moves. `travel` is a `travelOf` or `storedTravelOf` result.
 */
export function journeyDayKey(travel) {
  const calendar = calendarDay();
  return `${calendar == null ? "" : calendar}:${Number(travel?.dayCount) || 0}`;
}

/**
 * One throw as the record keeps it, from a `rollLandNavigation` result: the
 * target, the total and the natural die where it was rolled, and `success`
 * null where it could not be (the target unimported). `day` is the key it was
 * claimed under and `count` the End-day counter it was made on.
 */
export function navigationEntry(result, { day = null, count = null, hexLabel = "", by = "step" } = {}) {
  const rolled = !!result?.rolled;
  return navigationEntryOf({
    day,
    count,
    hexLabel,
    target: result?.target ?? null,
    total: rolled ? result.total : null,
    natural: rolled ? result.natural : null,
    success: rolled ? !!result.success : null,
    by,
  });
}

/**
 * A navigation record with `entry` thrown: it is the last result, it heads the
 * history (which keeps `NAVIGATION_HISTORY`), and its day is the day thrown
 * on. Pure; `navigation` is the record's own, normalized here.
 */
export function withNavigationThrow(navigation, entry) {
  const n = navigationOf({ navigation });
  const made = navigationEntryOf(entry);
  if (!made) return n;
  return {
    thrownOn: made.day ?? n.thrownOn,
    lastResult: made,
    history: [made, ...n.history].slice(0, NAVIGATION_HISTORY),
  };
}

/**
 * Write a navigation throw to the record (`withNavigationThrow`): `by` names
 * who threw it, `hexLabel` the hex it was thrown in (the party's own by
 * default), `day` the key it counts for (today's `journeyDayKey` by default)
 * and `count` the End-day counter it was made on (the record's own by
 * default). Resolves the entry written, or null when the formation is gone.
 */
export async function recordNavigationThrow(formationId, result, { by = "step", hexLabel = null, day = null, count = null } = {}) {
  let entry = null;
  await patchFormation(formationId, (record) => {
    const t = storedTravelOf(record);
    entry = navigationEntry(result, {
      day: day ?? journeyDayKey(t),
      count: count ?? (Number(t.dayCount) || 0),
      hexLabel: hexLabel ?? t.hex.label,
      by,
    });
    record.travel = { ...t, navigation: withNavigationThrow(t.navigation, entry) };
  });
  return entry;
}

/**
 * Mark `day` as the day the navigation throw was made, inside the ledger's
 * lock, so two steps racing for the day's first throw make it once. Resolves
 * true when this call claimed the day, false when it was claimed already or
 * the formation is gone.
 */
export async function claimNavigationDay(formationId, day) {
  let claimed = false;
  await patchFormation(formationId, (record) => {
    const t = storedTravelOf(record);
    if (t.navigation.thrownOn === day) return false;
    record.travel = { ...t, navigation: { ...t.navigation, thrownOn: day } };
    claimed = true;
  });
  return claimed;
}

/**
 * When the navigation throw is next owed, as the Judge's tab says it:
 * `{ state, day, route }`. `state` is `owed` (the day's first step off a road
 * throws it), `thrown` (today's throw is made), `following` (a road or a
 * route spares the party; `route` is `routeFollowed`'s answer, with the road's
 * kind as `road`), or `none` off a journey. `day` is the key asked about:
 * today's, or the one a step began in, handed in as `day`.
 */
export function navigationOwed(formation, { day = null } = {}) {
  const t = travelOf(formation);
  if (t.mode !== "journey") return { state: "none", day: null, route: null, road: null };
  if (day == null) day = journeyDayKey(t);
  if (t.navigation.thrownOn === day) return { state: "thrown", day, route: null, road: null };
  const route = routeFollowed(t);
  if (route) return { state: "following", day, route, road: route === "road" ? t.road : null };
  return { state: "owed", day, route: null, road: null };
}

/**
 * The Judge's override group of a submit, merged over the record's: each of
 * the six country keys the form names is set when valid and CLEARED when
 * blank; one it does not name stands. The group is `tv.override`; a key named
 * at the form's top level (`tv.ground`, `tv.weather.climate`) routes here too.
 * Null when the submit names none of them.
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
 * The panel's whole form in one ledger write: the Judge's overrides, weather
 * flags, the day board, the hex label, the lost note and what a player's seat
 * is shown (`tv.shown`, one of `SHOWN_KINDS`). The form submits itself entire
 * on every change (submitOnChange), so this applies what the form carries and
 * lets `travelOf` refuse the rest. The six country keys land in
 * `travel.override` (`overrideFromForm`), never in the declared record. Slot
 * edits under a forced march are ignored.
 *
 * A day-kind change into a forced march obeys the bar `setDayKind` does:
 * barred, the kind alone is dropped (the rest of the form lands) and the seat
 * is warned; with `{ override: true }` from a Judge's seat it is set and the
 * Judges are told who was barred.
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
    // The settlement board rides the same submit as the journey pickers (an
    // ApplicationV2 action fires on click, so a select bound to one reports no
    // change).
    if (tv.settlement) {
      next.settlement = settlementOf({
        settlement: {
          ...t.settlement,
          ...tv.settlement,
          // An unticked checkbox is absent from the submit, so a spread would
          // keep the old value; it is read explicitly.
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
    // A flier's hours and load, read as a group: a picker and two fields submit together.
    if (tv.movement) {
      next.movement = {
        ...t.movement,
        hoursAloft: Math.max(0, Number(tv.movement.hoursAloft) || 0),
        dayHours: Math.max(0, Number(tv.movement.dayHours) || 0),
        load: FLIGHT_LOADS[tv.movement.load] ? tv.movement.load : "normal",
      };
    }
    // The cold's declared inputs. Unticked checkboxes are absent from the
    // submit, so the group is read whole or not at all.
    if (tv.exposure) {
      next.exposure = {
        hours: Math.min(24, Math.max(0, Math.floor(Number(tv.exposure.hours) || 0))),
        atHeatSource: !!tv.exposure.atHeatSource,
        wet: !!tv.exposure.wet,
      };
    }
    if (typeof tv.hexLabel === "string") next.hex = { ...t.hex, label: tv.hexLabel.trim() };
    if (typeof tv.lostNote === "string") next.lost = { ...next.lost, judgeNote: tv.lostNote };
    if (SHOWN_KINDS.includes(tv.shown)) next.shown = tv.shown;
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
          if (Number.isInteger(i) && i >= 0 && i < activities.length) activities[i] = ANCILLARY_ACTIVITIES[v] ? v : null;
        }
        day = { ...day, activities };
      }
      // The day's declarations: written explicitly once the group is present
      // (its hidden `declared` marker makes it so), since an unticked checkbox
      // is absent from the submit; left alone otherwise.
      if (tv.day.declared !== undefined || tv.day.traps !== undefined || tv.day.noSleep !== undefined) {
        day = { ...day, traps: trapCount(tv.day.traps), noSleep: !!tv.day.noSleep };
      }
      next.day = day;
    }
    // The camp's declarations, read as a group. The search's two selects are
    // the Judge's and absent from a player's submit, so each keeps its word
    // when the group arrives without it.
    if (tv.camp) {
      next.camp = {
        steal: !!tv.camp.steal, water: !!tv.camp.water, sleepInArmour: !!tv.camp.sleepInArmour,
        present: tv.camp.present === undefined ? campPresent(t.camp?.present) : campPresent(tv.camp.present),
        target: tv.camp.target === undefined ? campTarget(t.camp?.target) : campTarget(tv.camp.target),
      };
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
 * declared; the one reading the sky cache key, the day change and the sheet share.
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
 * The day a sky is filed under: the calendar day the world clock stands in, or
 * where the clock keeps no calendar the End-day counter. Never
 * `journeyDayKey`, a string, where `skyKey` reads a number.
 */
function skyDayOf(t) {
  return calendarDay() ?? (Number(t?.dayCount) || 0);
}

/**
 * The sky cache key for a party's ground on a day (`skyDayOf`). The climate is
 * `t`'s as `travelOf` resolves it, so `t` is a `travelOf` result, never a
 * stored one.
 */
function skyParams(t, season, day = skyDayOf(t)) {
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
 * no-op, so a dragged clock or a hook firing twice settles once. Only a
 * formation in journey mode is settled; any other is stamped, so one entering
 * journey mode later does not back-pay. Each crossed day runs in order against
 * one local copy of the cache, written once, and the formation takes one patch.
 *
 * `counter` is the calendar-less path: End day settles the single day it
 * names, in any mode, and neither reads nor writes the watermark.
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
    // governs the next settling.
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
 * The Judge rolls the sky on demand. An on-demand roll is a fresh sky, never a
 * front: the drift compares to a prior day, and this roll replaces today.
 * Refused (no write) when the registry cannot answer.
 */
export async function rollWeatherNow(formationId) {
  // The sky is shared: re-rolling the same day for a climate is a cache hit,
  // not new weather.
  const record0 = getFormation(formationId);
  const t0 = travelOf(record0 ?? {});
  const season = effectiveSeason(t0).season;
  const params = skyParams(t0, season);
  // No prior and no drift, whatever the fronts toggle says: the drift belongs
  // to the day change (`settleDayChange`).
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
 * dawn (when the module may). The caller supplies the miles and hexes the panel
 * shows, so the log records what the Judge saw.
 *
 * Where the clock keeps a calendar the weather does not settle here: the jump
 * to dawn crosses the day change, and the day-change watcher settles the ground
 * and the new sky (`settleDayChange`). Where it keeps no calendar, End day
 * settles the day itself, keyed on its own counter. Without a calendar the jump
 * is what the day has not already advanced of a whole day, so hours the march
 * ran are never charged twice.
 *
 * End day makes no navigation throw: the next day's is made at its first step
 * off a road (`throwDayNavigation`, journey.mjs).
 *
 * @returns the log entry written, or null when the formation is gone
 */
export async function endDay(formationId, { miles = null, hours = null, hexes = null, notes = "" } = {}) {
  let entry = null;
  let advancedToday = 0;

  // Feed the order and walk every ladder one step before the patch, since
  // reading packs is async and the patch callback is not.
  let provisions = null;
  try {
    provisions = await runProvisionDay(getFormation(formationId));
  } catch (err) {
    console.error(`${MODULE_ID} | provisioning failed; the day still ends`, err);
  }

  const record = await patchFormation(formationId, (rec) => {
    const t = storedTravelOf(rec);
    // The day is logged as the party read it (the country resolved); the
    // record keeps only what it stored.
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
  // With no calendar there is no day change to watch: End day settles, keyed
  // on the counter the patch just advanced.
  if (calendarDay() == null) {
    try {
      await settleDayChange(formationId, entry.day, { counter: true });
    } catch (err) {
      console.error(`${MODULE_ID} | the day's weather could not settle; the day still ends`, err);
    }
  }
  const jump = untilNextDawn() ?? Math.max(0, DAY_SECONDS - advancedToday);
  if (jump > 0 && mayAdvanceWorldTime()) await game.time.advance(jump);
  // The finished day carries how it was fed.
  if (entry && provisions) {
    entry.provisions = {
      short: provisions.short,
      suffering: provisions.report.filter((r) => r.worsened).map((r) => r.name),
    };
  }
  return entry;
}
