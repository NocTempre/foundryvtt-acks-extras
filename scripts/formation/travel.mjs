/* global game */
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
import { patchFormation } from "./formation-model.mjs";
import { mayAdvanceWorldTime } from "../lib/world-time.mjs";
import { TRAVEL_PACE } from "../lib/movement-scales.mjs";

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
import { ROAD_KINDS } from "../vehicles/vehicle-speed.mjs";

/** The wilderness territory classifications (JJ ch. 2) — keys only. */
export const TERRITORY_KEYS = Object.freeze(["civilized", "borderlands", "outlands", "unsettled"]);

/** A fresh, unspent day board. */
export function freshDay(kind = "march") {
  const spec = DAY_KINDS[kind] ? kind : "march";
  return {
    kind: spec,
    activities: Array.from({ length: ANCILLARY_SLOTS }, () => null),
    hexesEntered: 0,
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
    mode: t.mode === "journey" ? "journey" : "delve",
    ground: t.ground ?? formation?.ground ?? "grassland",
    road: ROAD_KINDS.includes(t.road) ? t.road : "none",
    territory: TERRITORY_KEYS.includes(t.territory) ? t.territory : "borderlands",
    pace: TRAVEL_PACE[t.pace] ? t.pace : "dedicated",
    weather: { raining: false, snowing: false, ...(t.weather ?? {}) },
    hex: { label: "", note: "", ...(t.hex ?? {}) },
    day: t.day ?? freshDay(),
    dayCount: Number(t.dayCount) || 0,
    lost: { active: false, sinceDay: null, judgeNote: "", ...(t.lost ?? {}) },
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
    weather: { ...(travel.weather ?? {}) },
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
  return patchFormation(formationId, (record) => {
    const t = travelOf(record);
    record.travel = { ...t, mode: journey ? "journey" : "delve" };
    record.clock = { ...(record.clock ?? {}), paused: !!journey };
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
    if (TERRITORY_KEYS.includes(tv.territory)) next.territory = tv.territory;
    if (tv.weather) next.weather = { ...t.weather, raining: !!tv.weather.raining, snowing: !!tv.weather.snowing };
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
 * End the day: log it, reset the board, advance the world clock a day (when
 * the module may). The caller supplies the derived figures the panel already
 * shows — miles and hexes made — so the log records what the Judge saw, not
 * a second derivation that could disagree with it.
 *
 * @returns the log entry written, or null when the formation is gone
 */
export async function endDay(formationId, { miles = null, hexes = null, notes = "" } = {}) {
  let entry = null;
  const record = await patchFormation(formationId, (rec) => {
    const t = travelOf(rec);
    entry = composeLogEntry(t, { miles, hexes, notes, worldTime: game.time?.worldTime ?? null });
    rec.travel = {
      ...t,
      dayCount: entry.day,
      day: withDayKind(null, t.day?.kind ?? "march"),
      log: pushLog(t.log, entry, logCap()),
    };
  });
  if (!record) return null;
  if (mayAdvanceWorldTime()) await game.time.advance(DAY_SECONDS);
  return entry;
}
