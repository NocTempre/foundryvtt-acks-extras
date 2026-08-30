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
 * Two clocks, one paused at a time: journey mode pauses the movement-driven
 * dungeon turn tracking (`clock.paused`, the flag the turn engine already
 * honours) and the DAY becomes the unit — one dedicated day-kind plus the
 * four ancillary activity slots the wilderness rules budget (RR ch. 6: a
 * dedicated march is the day's eight hours; a forced march is twelve and
 * spends every ancillary activity to do it). Ending the day advances the
 * world clock a full day through the module's one world-time switch, appends
 * the day to an append-only log, and hands the entry back for the panel to
 * show.
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
import { patchFormation, getFormation, realMembers, getMemberActor, hasAbility } from "./formation-model.mjs";
import { hasCapability } from "./ability-bridge.mjs";
import { mayAdvanceWorldTime } from "../lib/world-time.mjs";
import { TRAVEL_PACE } from "../lib/movement-scales.mjs";
import { terrainAtPoint, hexLabelFromOffset, isHexScene } from "../battlemap/terrain-paint.mjs";
import { sceneTravelSystem } from "../battlemap/scene-setup.mjs";
import { TRAVEL_MODES } from "../lib/vocab.mjs";
import { routesOf, stepBetweenHexes } from "../battlemap/hex-routes.mjs";
import {
  CLIMATES,
  PRECIPITATION_KINDS,
  SEASONS,
  TEMPERATURE_BANDS,
  WIND_BANDS,
  advanceGround,
  conditionsOf,
  freshFooting,
  generateDay,
  terrainMudProne,
} from "./weather.mjs";

/** World setting: how many day entries a formation's travel log keeps. */
export const SETTING_TRAVEL_LOG_CAP = "travelLogCap";

/** Seconds the world clock advances when a travel day ends. */
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
});

/** The road vocabulary is the vehicles feature's; re-exported for callers. */
export { ROAD_KINDS } from "../vehicles/vehicle-speed.mjs";
import { ROAD_KINDS, readTable, TRAVEL_DOC } from "../vehicles/vehicle-speed.mjs";
import { settlementOf, freshSettlement } from "./settlement.mjs";
import { skyFor, readSkyCache, priorSky } from "./sky.mjs";
import { runProvisionDay } from "./provision-day.mjs";
import { postNavigationThrow } from "./navigation-card.mjs";
import { isMode } from "../lib/movement-modes.mjs";
import { FLIGHT_LOADS } from "./flight.mjs";

/**
 * The three things a formation can be doing, re-exported so this feature's
 * consumers keep one import path. Only `delve` leaves the turn clock running;
 * a SCENE may declare which of them applies on it (`docs/battlemap/MODEL.md`),
 * which is why the list itself lives in `lib/vocab.mjs`.
 */
export { TRAVEL_MODES };

/**
 * A route the party is following, which spares it the navigation throw.
 *
 * RAW exempts navigable rivers, roads, and "other well-established routes".
 * Roads are already the road picker's business, so this carries the other two —
 * and `knownRoute` is deliberately vague because the book is: it is the Judge's
 * call what counts as well-established.
 */
export const FOLLOWING_KINDS = Object.freeze(["none", "river", "knownRoute"]);

/** The wilderness territory classifications (JJ ch. 2) — keys only. */
export const TERRITORY_KEYS = Object.freeze(["civilized", "borderlands", "outlands", "unsettled"]);

/** A fresh, unspent day board. */
export function freshDay(kind = "march") {
  const spec = DAY_KINDS[kind] ? kind : "march";
  return {
    kind: spec,
    activities: Array.from({ length: ANCILLARY_SLOTS }, () => null),
    hexesEntered: 0,
    // Extra distance the day's bends cost over straight crossings, in hexes.
    winding: 0,
  };
}

/**
 * Apply a day-kind to a board. A forced march CONSUMES the ancillary budget
 * (every slot becomes the march itself); stepping back down returns a fresh
 * budget rather than resurrecting whatever the forced march overwrote.
 */
export function withDayKind(day, kind) {
  const next = freshDay(kind);
  if (DAY_KINDS[next.kind]?.consumesAncillary) {
    next.activities = next.activities.map(() => "travel");
  } else if (day && !DAY_KINDS[day.kind]?.consumesAncillary) {
    next.activities = [...(day.activities ?? next.activities)];
    next.hexesEntered = day.hexesEntered ?? 0;
  }
  return next;
}

/** The travel subtree, defaults answered — never mutates the record. */
export function travelOf(formation) {
  const t = formation?.travel ?? {};
  return {
    mode: TRAVEL_MODES.includes(t.mode) ? t.mode : "delve",
    ground: t.ground ?? formation?.ground ?? "grassland",
    road: ROAD_KINDS.includes(t.road) ? t.road : "none",
    following: FOLLOWING_KINDS.includes(t.following) ? t.following : "none",
    territory: TERRITORY_KEYS.includes(t.territory) ? t.territory : "borderlands",
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
    // Validated at USE by the encounter engine's own vocabulary — a plain
    // passthrough here keeps travel free of an import back into encounters.
    encounterTerrain: typeof t.encounterTerrain === "string" ? t.encounterTerrain : "",
    hex: { label: "", note: "", i: null, j: null, ...(t.hex ?? {}) },
    day: t.day ?? freshDay(),
    dayCount: Number(t.dayCount) || 0,
    lost: { active: false, sinceDay: null, judgeNote: "", ...(t.lost ?? {}) },
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
 * One finished day as a log row. Append-only and newest-first; the cap keeps
 * a seasons-long campaign from growing the settings blob without bound, and
 * trimming eats the OLDEST rows.
 */
export function composeLogEntry(travel, { miles = null, hexes = null, notes = "", worldTime = null } = {}) {
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
 * Enter or leave journey mode. The turn clock and the day board are two
 * clocks with one running at a time: journeying pauses movement-driven turn
 * ticks; returning to delve mode un-pauses them and holds the day board
 * where it stood (a dungeon on the route does not reset the march).
 */
export function setJourneyMode(formationId, journey) {
  // Historically a boolean; a mode string is now accepted and preferred. The
  // clock pauses for anything that is not a delve, because both travel modes
  // put their own scale on the table.
  const mode = typeof journey === "string"
    ? (TRAVEL_MODES.includes(journey) ? journey : "delve")
    : (journey ? "journey" : "delve");
  return patchFormation(formationId, (record) => {
    const t = travelOf(record);
    record.travel = {
      ...t,
      mode,
      // Entering a settlement starts a fresh board; leaving one keeps it, so
      // stepping out to the country and back does not forget the route.
      settlement: mode === "settlement" && t.mode !== "settlement" ? freshSettlement() : t.settlement,
    };
    record.clock = { ...(record.clock ?? {}), paused: mode !== "delve" };
  });
}

/**
 * Take the travel system the SCENE declares (the battlemap setup tool writes
 * it) — a dungeon map runs the turn clock, a wilderness map runs the day, a
 * settlement crosses in blocks.
 *
 * Arriving on a map is the moment the question is answered, so this runs when
 * a party token lands and when the declaration itself changes. A scene that
 * declares nothing changes nothing: silence is "nobody has said", not
 * "dungeon", and a party mid-march must not be reset by crossing an unlabelled
 * scene.
 *
 * @returns {Promise<string|null>} the mode adopted, or null if nothing moved.
 */
export async function adoptSceneSystem(formationId, scene) {
  const system = sceneTravelSystem(scene);
  if (!system) return null;
  const formation = getFormation(formationId);
  if (!formation || travelOf(formation).mode === system) return null;
  await setJourneyMode(formationId, system);
  return system;
}

/** The settlement board's own writer: pace, where, route, night. */
export function patchSettlement(formationId, patch = {}) {
  return patchFormation(formationId, (record) => {
    const t = travelOf(record);
    const next = { ...t.settlement };
    for (const key of ["pace", "where", "route"]) {
      if (patch[key] !== undefined) next[key] = String(patch[key]);
    }
    if (patch.night !== undefined) next.night = !!patch.night;
    if (patch.blocks !== undefined) next.blocks = Number(patch.blocks) || 0;
    if (patch.turns !== undefined) next.turns = Number(patch.turns) || 0;
    if (patch.lost !== undefined) next.lost = !!patch.lost;
    if (patch.lastThrow !== undefined) next.lastThrow = patch.lastThrow;
    record.travel = { ...t, settlement: settlementOf({ settlement: next }) };
  });
}

/** The pickers: ground, road, territory, pace, weather flags, hex note. */
export function patchTravel(formationId, patch = {}) {
  return patchFormation(formationId, (record) => {
    const t = travelOf(record);
    const next = { ...t };
    if (patch.ground !== undefined) next.ground = String(patch.ground);
    if (patch.road !== undefined && ROAD_KINDS.includes(patch.road)) next.road = patch.road;
    if (patch.territory !== undefined && TERRITORY_KEYS.includes(patch.territory)) next.territory = patch.territory;
    if (patch.pace !== undefined && TRAVEL_PACE[patch.pace]) next.pace = patch.pace;
    if (patch.weather !== undefined) next.weather = { ...t.weather, ...patch.weather };
    if (patch.hex !== undefined) next.hex = { ...t.hex, ...patch.hex };
    record.travel = next;
  });
}

/** Choose how the day is spent. Forced marches consume the ancillary budget. */
export function setDayKind(formationId, kind) {
  return patchFormation(formationId, (record) => {
    const t = travelOf(record);
    record.travel = { ...t, day: withDayKind(t.day, kind) };
  });
}

/** Fill one ancillary slot (null clears it). Refused under a forced march. */
export function setAncillary(formationId, slot, activity) {
  return patchFormation(formationId, (record) => {
    const t = travelOf(record);
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
 * The party crosses into the next hex: the label updates and the day counts
 * it. The per-hex encounter throw hangs off this count once the frequency
 * tables are registered; until then the count itself is the trace.
 */
export function enterHex(formationId, label) {
  return patchFormation(formationId, (record) => {
    const t = travelOf(record);
    record.travel = {
      ...t,
      hex: { ...t.hex, label: String(label ?? "").trim() },
      day: { ...t.day, hexesEntered: (t.day.hexesEntered ?? 0) + 1 },
    };
  });
}

/**
 * The party token crossed into a hex on a PAINTED map: the offset is the
 * identity, the label its name, the terrain what the map says. One patch —
 * the first arrival (no prior offset) NAMES the hex without counting it (you
 * do not enter the hex you were already standing in), and a repeat of the
 * same offset writes nothing. A painted terrain overrides the ground picker;
 * an unpainted hex leaves the Judge's pick standing.
 */
export function autoEnterHex(formationId, { label = "", i = null, j = null, ground = null, road = undefined, winding = 1 } = {}) {
  return patchFormation(formationId, (record) => {
    const t = travelOf(record);
    const had = t.hex.i != null && t.hex.j != null;
    if (had && t.hex.i === i && t.hex.j === j) return false;
    record.travel = {
      ...t,
      hex: { ...t.hex, label: String(label ?? "").trim(), i, j },
      ...(ground ? { ground: String(ground) } : {}),
      // A drawn network OVERRIDES the day's road picker, exactly as painted
      // terrain overrides the ground picker: the map is the better witness.
      // `undefined` means no network was drawn, so the picker still stands.
      ...(road !== undefined ? { road: String(road) } : {}),
      day: had
        ? {
            ...t.day,
            hexesEntered: (t.day.hexesEntered ?? 0) + 1,
            // Only the EXCESS is banked: a straight crossing costs nothing
            // extra, so a road with no bends never shows a tax.
            winding: (t.day.winding ?? 0) + Math.max(0, (Number(winding) || 1) - 1),
          }
        : t.day,
    };
  });
}

/**
 * The journey's movement handler: while a formation journeys on a
 * hex-gridded scene, its party token's position IS the hex trace. Runs on
 * the same seam as the dungeon turn engine (which hands journeying
 * formations here instead of ticking turns); non-hex scenes change nothing —
 * the manual Next-hex button remains their trace.
 */
export async function onJourneyTokenMoved(tokenDoc, formationId) {
  const scene = tokenDoc?.parent;
  if (!scene || !isHexScene(scene)) return;
  const point = tokenDoc.object?.center ?? {
    x: tokenDoc.x + ((tokenDoc.width ?? 1) * scene.grid.sizeX) / 2,
    y: tokenDoc.y + ((tokenDoc.height ?? 1) * scene.grid.sizeY) / 2,
  };
  const offset = scene.grid.getOffset(point);
  // Which road, if any, this STEP followed. Only asked when a network exists:
  // a scene nobody has drawn routes on leaves the Judge's picker alone rather
  // than declaring every march off-road.
  let road;
  let winding = 1;
  const prior = travelOf(getFormation(formationId) ?? {}).hex;
  if (routesOf(scene).length && prior.i != null && prior.j != null) {
    const step = stepBetweenHexes(scene, { i: prior.i, j: prior.j }, offset);
    road = step.on ? step.road : "none";
    if (step.on) winding = step.winding ?? 1;
  }
  await autoEnterHex(formationId, {
    label: hexLabelFromOffset(offset),
    i: offset.i,
    j: offset.j,
    ground: terrainAtPoint(scene, point),
    road,
    winding,
  });
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
 * This deliberately stops short of the consequence. What a failure DOES to the
 * party's position is an open ruling (`docs/vehicles/DECISIONS.md`), and this
 * returns only what can be decided without it.
 */
export function landNavigationSpec(formation) {
  const t = travelOf(formation);
  if (t.road && t.road !== "none") return { throws: false, reason: "road" };
  if (t.following && t.following !== "none") return { throws: false, reason: t.following };
  const targets = readTable(TRAVEL_DOC, "gettingLost");
  const target = Number(targets?.[t.ground]);
  const competence = navigationCompetence(formation);
  if (!Number.isFinite(target)) {
    return { throws: true, target: null, missing: "gettingLost", terrain: t.ground, competence };
  }
  return { throws: true, target, terrain: t.ground, competence };
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
 * order's competence is worth. An unmodified 1 fails whatever the bonus — the
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
  const bonus = spec.competence?.bonus ?? 0;
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

/** GM-only lost state: players see the intended hex, the Judge the truth. */
export function setLost(formationId, { active, judgeNote } = {}) {
  return patchFormation(formationId, (record) => {
    const t = travelOf(record);
    record.travel = {
      ...t,
      lost: {
        ...t.lost,
        ...(active !== undefined ? { active: !!active, sinceDay: active ? t.dayCount + 1 : null } : {}),
        ...(judgeNote !== undefined ? { judgeNote: String(judgeNote) } : {}),
      },
    };
  });
}

/**
 * The panel's whole form in ONE ledger write: pickers, weather flags, the
 * day board, the hex label, the lost state. The form submits itself entire
 * on every change (submitOnChange), so writing field-by-field would queue a
 * patch per field per keystroke; this applies what the form carries and lets
 * `travelOf` refuse the rest. Slot edits under a forced march are ignored —
 * the march owns the budget.
 */
export function applyTravelForm(formationId, tv = {}) {
  return patchFormation(formationId, (record) => {
    const t = travelOf(record);
    const next = { ...t };
    if (typeof tv.ground === "string" && tv.ground) next.ground = tv.ground;
    if (ROAD_KINDS.includes(tv.road)) next.road = tv.road;
    if (FOLLOWING_KINDS.includes(tv.following)) next.following = tv.following;
    if (TERRITORY_KEYS.includes(tv.territory)) next.territory = tv.territory;
    if (typeof tv.encounterTerrain === "string") next.encounterTerrain = tv.encounterTerrain;
    // The settlement board rides the same submit as the journey pickers: an
    // ApplicationV2 action fires on CLICK, so a select bound to one never
    // reports a change at all.
    if (tv.settlement) {
      next.settlement = settlementOf({
        settlement: {
          ...t.settlement,
          ...tv.settlement,
          night: !!tv.settlement.night,
        },
      });
      // How many days a stay lasts is a form field rather than board state the
      // tick owns; it is kept so the control does not reset itself each render.
      const stay = Math.min(30, Math.max(1, Math.floor(Number(tv.settlement.holeUpDays) || 1)));
      next.settlement.holeUpDays = stay;
    }
    if (tv.weather) {
      const wv = tv.weather;
      const w = { ...t.weather, auto: !!wv.auto, fronts: !!wv.fronts };
      const pick = (value, vocab) => (value === "" || vocab[value] ? value : undefined);
      if (typeof wv.climate === "string" && pick(wv.climate, CLIMATES) !== undefined) w.climate = wv.climate;
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
    if ("lostActive" in tv) {
      const active = !!tv.lostActive;
      next.lost = { ...next.lost, active, sinceDay: active ? (next.lost.sinceDay ?? t.dayCount + 1) : null };
    }
    if (tv.day) {
      let day = t.day;
      if (typeof tv.day.kind === "string" && DAY_KINDS[tv.day.kind] && tv.day.kind !== day.kind) {
        day = withDayKind(day, tv.day.kind);
      }
      if (tv.day.slot && !DAY_KINDS[day.kind]?.consumesAncillary) {
        const activities = [...day.activities];
        for (const [k, v] of Object.entries(tv.day.slot)) {
          const i = Number(k);
          if (Number.isInteger(i) && i >= 0 && i < ANCILLARY_SLOTS) activities[i] = ANCILLARY_ACTIVITIES[v] ? v : null;
        }
        day = { ...day, activities };
      }
      next.day = day;
    }
    record.travel = next;
  });
}

/**
 * The Judge rolls the sky on demand — the journey's first morning, or a
 * result worth re-rolling. An on-demand roll is a fresh sky, never a front:
 * the drift compares to a prior day, and this roll is REPLACING today.
 * Refused (no write) when the registry cannot answer; the panel's hint
 * already names the missing document.
 */
export async function rollWeatherNow(formationId) {
  // The sky is shared: two parties in one climate on one day read a single
  // roll, and re-rolling the same day is a cache hit rather than new weather.
  const record0 = getFormation(formationId);
  const t0 = travelOf(record0 ?? {});
  const params = { day: t0.dayCount, climate: t0.weather.climate, season: t0.weather.season };
  const cache = readSkyCache();
  const prior = t0.weather.fronts ? priorSky(cache, params) : null;
  const { sky: gen } = await skyFor(params, () => generateDay({
    climate: t0.weather.climate,
    season: t0.weather.season,
    prior,
    fronts: !!t0.weather.fronts,
  }));
  if (!gen?.ok) return false;
  return patchFormation(formationId, (record) => {
    const t = travelOf(record);
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
 * End the day: log it, reset the board, advance the world clock a day (when
 * the module may). The caller supplies the derived figures the panel already
 * shows — miles and hexes made — so the log records what the Judge saw, not
 * a second derivation that could disagree with it.
 *
 * The finished day also settles onto the ground and rolls the next one in:
 * its weather advances the footing counters (mud forms, snow lies, roads
 * drown), and with the generator on, tomorrow's sky is rolled — under the
 * fronts drift when asked — before the board resets. A registry that cannot
 * answer leaves the manual picks standing.
 *
 * @returns the log entry written, or null when the formation is gone
 */
export async function endDay(formationId, { miles = null, hexes = null, notes = "" } = {}) {
  let entry = null;
  // Tomorrow's sky is settled BEFORE the patch, because the patch callback is
  // synchronous and the cache is not. Same key as any other party crossing the
  // same climate tomorrow, so they wake to one shared morning.
  const t0 = travelOf(getFormation(formationId) ?? {});
  let nextSky = null;
  if (t0.weather.auto) {
    const params = { day: t0.dayCount + 1, climate: t0.weather.climate, season: t0.weather.season };
    const cache = readSkyCache();
    const { sky } = await skyFor(params, () => generateDay({
      climate: t0.weather.climate,
      season: t0.weather.season,
      prior: t0.weather.fronts ? (priorSky(cache, params) ?? t0.weather.rolls) : null,
      fronts: !!t0.weather.fronts,
    }));
    if (sky?.ok) nextSky = sky;
  }
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
    const t = travelOf(rec);
    entry = composeLogEntry(t, { miles, hexes, notes, worldTime: game.time?.worldTime ?? null });
    const settled = advanceGround(t.weather.footing, {
      temperature: t.weather.temperature,
      precipitation: t.weather.precipitation,
      mudProne: terrainMudProne(t.ground),
    });
    let weather = { ...t.weather, footing: { mud: settled.mud, snow: settled.snow, runs: settled.runs } };
    if (weather.auto) {
      const gen = nextSky ?? { ok: false };
      if (gen.ok) {
        weather = {
          ...weather,
          temperature: gen.temperature,
          temperatureNight: gen.temperatureNight,
          precipitation: gen.precipitation,
          wind: gen.wind,
          rolls: gen.rolls,
        };
      }
    }
    rec.travel = {
      ...t,
      dayCount: entry.day,
      day: withDayKind(null, t.day?.kind ?? "march"),
      log: pushLog(t.log, entry, logCap()),
      weather,
    };
  });
  if (!record) return null;
  if (mayAdvanceWorldTime()) await game.time.advance(DAY_SECONDS);
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
