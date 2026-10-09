/* global game, Hooks */
/**
 * The journey's movement engine: what a party token's drag spends while its
 * formation is on a journey, on every kind of scene.
 *
 * A drag is measured in MILES, whatever the grid. One record patch then writes
 * the hex trace (label, terrain, road — identity only) and the day's spend
 * together; the world clock runs by the hours those miles take; the
 * `acksExtras.hexEntered` hook fires once per cadence unit walked; and each
 * unit owes its encounter throw. The order is fixed: measure → record patch →
 * clock → hooks → throws, so a hook listener and a throw both read a record
 * that already holds the step.
 *
 * This file is the one owner of the `acksExtras.hexEntered` and
 * `acksExtras.searchHourSpent` hooks. It sits above `turn-engine.mjs` (the
 * delve's tracker, which a journey never uses), `travel.mjs` (the record) and
 * `march.mjs` (the arithmetic); nothing below it imports it.
 */
import { TURN_SECONDS } from "./constants.mjs";
import { getFormation, getPartyScene, partySpeed, patchFormation } from "./formation-model.mjs";
import { travelOf, traceStep } from "./travel.mjs";
import { travelReadout } from "./formation-view.mjs";
import { ENCOUNTER_TERRAINS, encounterTerrainFor } from "./encounters.mjs";
import { cadenceMilesFor, encountersOn, maybeHexThrow } from "./encounter-card.mjs";
import { journeyZones } from "./encounter-zone.mjs";
import { SLOT_HOURS, cadenceOf, spendMarch } from "./march.mjs";
import { isNight } from "./settlement.mjs";
import {
  burnTurns,
  expiredEffectNotes,
  onPartyTokenMoved as onTurnClockTokenMoved,
  postNotesCard,
  snapshotRunningEffects,
} from "./turn-engine.mjs";
import { DISTANCE_UNITS, feetPerUnit, sceneMilesPerCell } from "../lib/distance-units.mjs";
import { clockReading, mayAdvanceWorldTime } from "../lib/world-time.mjs";
import { hexLabelFromOffset, isHexScene, paintedTerrainAt } from "../battlemap/terrain-paint.mjs";
import { routesOf, stepBetweenHexes } from "../battlemap/hex-routes.mjs";

/** Seconds in an hour on a clock that keeps no calendar. */
const DEFAULT_SECONDS_PER_HOUR = 3600;

/**
 * The party token moved: hand it to the engine its formation's mode uses. A
 * journey whose Judge has paused it (`clock.pausedBy === "judge"`) bills
 * nothing and follows the token; any other journey spends miles; every other
 * mode keeps the turn clock.
 */
export async function onPartyTokenMoved(tokenDoc, formationId) {
  const formation = getFormation(formationId);
  if (!formation) return null;
  if (travelOf(formation).mode !== "journey") return onTurnClockTokenMoved(tokenDoc, formationId);
  if (formation.clock?.pausedBy === "judge") {
    await patchFormation(formationId, (record) => {
      record.clock = { ...(record.clock ?? {}), lastPosition: { x: tokenDoc.x, y: tokenDoc.y } };
    });
    return null;
  }
  return onJourneyTokenMoved(tokenDoc, formationId);
}

/**
 * Miles between two token positions on a scene. The grid measures the move in
 * the scene's own units (hex steps times the cell distance on a hex grid, the
 * straight line on a square or gridless one); a grid that cannot, or answers
 * nothing finite, is measured as the straight line in cells. Both ends are the
 * token's top-left corner, so a move is the same distance whatever the token's
 * size.
 * @param {Scene} scene
 * @param {{x: number, y: number}} from
 * @param {{x: number, y: number}} to
 * @returns {number} 0 for no displacement
 */
export function journeyMilesBetween(scene, from, to) {
  return journeyMeasure(scene, from, to).miles;
}

/**
 * The drag measured as `journeyMilesBetween` does, with the grid's own count
 * of hex steps beside it: `spaces` is that count, or null where the grid gave
 * none. A measure taken from a token's corner carries a Euclidean remainder in
 * its distance, so the step count is what says how many hexes were crossed.
 * @returns {{miles: number, spaces: number|null}}
 */
export function journeyMeasure(scene, from, to) {
  const dx = Number(to?.x) - Number(from?.x);
  const dy = Number(to?.y) - Number(from?.y);
  if (!(dx || dy) || !Number.isFinite(dx + dy)) return { miles: 0, spaces: 0 };
  const grid = scene?.grid;
  const measured = grid?.measurePath?.([{ x: from.x, y: from.y }, { x: to.x, y: to.y }]);
  let distance = Number(measured?.distance);
  if (!Number.isFinite(distance)) distance = (Math.hypot(dx, dy) / Number(grid?.size)) * Number(grid?.distance);
  if (!Number.isFinite(distance) || distance <= 0) return { miles: 0, spaces: 0 };
  const spaces = Number(measured?.spaces);
  return { miles: (distance * feetPerUnit(grid?.units)) / DISTANCE_UNITS.mi.feet, spaces: Number.isFinite(spaces) ? spaces : null };
}

/**
 * The cadence the party's scene and the imported table agree on, for this
 * territory (`cadenceOf`): `scene` may be null for a journey with no map.
 */
function cadenceFor(territory, scene) {
  return cadenceOf({
    isHex: scene ? isHexScene(scene) : false,
    milesPerCell: scene ? sceneMilesPerCell(scene) : 0,
    mileHex: cadenceMilesFor(territory),
  });
}

/**
 * A journeying party token moved: measure the drag in miles, trace the hex it
 * stands in when the scene is a hex grid, and spend the miles. The baseline for
 * the next drag is this position.
 */
export async function onJourneyTokenMoved(tokenDoc, formationId) {
  const scene = tokenDoc?.parent;
  const formation = getFormation(formationId);
  if (!scene || !formation) return null;
  const here = { x: tokenDoc.x, y: tokenDoc.y };
  const { miles, spaces } = journeyMeasure(scene, formation.clock?.lastPosition ?? here, here);

  let trace = null;
  if (isHexScene(scene)) {
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
    const prior = travelOf(formation).hex;
    if (routesOf(scene).length && prior.i != null && prior.j != null) {
      const step = stepBetweenHexes(scene, { i: prior.i, j: prior.j }, offset);
      road = step.on ? step.road : "none";
      if (step.on) winding = step.winding ?? 1;
    }
    const painted = paintedTerrainAt(scene, point);
    trace = {
      label: hexLabelFromOffset(offset),
      i: offset.i,
      j: offset.j,
      ground: painted.ground,
      encounterTerrain: painted.encounterTerrain,
      road,
      winding,
    };
  }
  return spendJourneyMiles(formationId, miles, { scene, trace, anchor: here, crossings: spaces });
}

/**
 * Spend miles walked on a journey: the day's tally, the clock, the hooks and
 * the throws, in that order.
 *
 * One record patch applies the hex trace (or, for `hex`, a named hex counted as
 * one crossing) and the miles together, and re-anchors the movement baseline
 * when an `anchor` is given. The hours come from the party's speed on the
 * current ground (a camp day is priced at the march pace, so its travel
 * slots can be walked); a speed the readout cannot price moves no clock. The
 * cadence units the walk earned (`cadenceOf`) each fire `acksExtras.hexEntered`
 * and then owe their encounter throw.
 *
 * The encounter zones under the party's true position (`journeyZones`) can
 * take the per-unit throws over. Under a composed cadence of `entry` or
 * `periods` the units still fire the hook, with `throwOwed: false`, and throw
 * nothing; under `entry`, crossing into the zone that states it throws once,
 * after the hooks. A crossing is read against `clock.zoneIds`, the regions
 * the party stood in after its last spend, which the same record patch
 * rewrites.
 *
 * @param {string} formationId
 * @param {number} miles
 * @param {object} [o]
 * @param {Scene|null} [o.scene]      the scene walked on; null for a journey with no map
 * @param {object|null} [o.trace]     a hex trace step (`traceStep`)
 * @param {{label: string}|null} [o.hex]  a hex named by the Judge, counted as one crossing
 * @param {{x: number, y: number}|null} [o.anchor]  the token position to measure the next drag from
 * @param {number|null} [o.crossings]  the hex steps the grid measured for the drag; the miles in cells stand in when absent
 * @returns {Promise<{miles: number, hours: number, seconds: number, units: number,
 *   crossed: number, day: object, zoneEntered: boolean}|null>} null when the
 *   formation is gone; `zoneEntered` is whether the walk crossed into an
 *   `entry` zone
 */
export async function spendJourneyMiles(formationId, miles, { scene = null, trace = null, hex = null, anchor = null, crossings = null } = {}) {
  const formation = getFormation(formationId);
  if (!formation) return null;
  const readout = travelReadout(formation, partySpeed(formation, { dark: false }));
  const milesPerHour = Number(readout.milesPerHour) || 0;
  const cadence = cadenceFor(travelOf(formation).territory, scene);
  const secondsPerHour = clockReading()?.secondsPerHour ?? DEFAULT_SECONDS_PER_HOUR;

  const zones = journeyZones(formation);
  const zoneCadence = zones.fields.journeyCadence;
  const zoneIds = zones.layers.map((layer) => layer.region?.id).filter(Boolean);
  const before = Array.isArray(formation.clock?.zoneIds) ? formation.clock.zoneIds : [];
  const entryId = zoneCadence === "entry" ? zones.sources.journeyCadence?.region?.id ?? null : null;
  const zoneEntered = !!entryId && !before.includes(entryId);
  const perUnit = zoneCadence !== "entry" && zoneCadence !== "periods";

  let spent = null;
  let crossed = 0;
  const written = await patchFormation(formationId, (record) => {
    const t = travelOf(record);
    let travel = t;
    if (trace) {
      ({ travel, crossed } = traceStep(t, trace));
      // The trace records one change of hex; a drag spans whole cells. The
      // grid's own count of hex steps is the crossings, and the miles in cells
      // stand in where none was measured. The day's tally and the cadence both
      // count every hex the party passed through.
      const cell = scene ? sceneMilesPerCell(scene) : 0;
      const spanned = crossings != null && Number.isFinite(Number(crossings))
        ? Math.max(0, Math.floor(Number(crossings)))
        : (cell > 0 ? Math.floor(miles / cell + 1e-6) : 0);
      if (spanned > crossed) {
        travel = { ...travel, day: { ...travel.day, hexesEntered: (travel.day.hexesEntered ?? 0) + (spanned - crossed) } };
        crossed = spanned;
      }
    } else if (hex) {
      crossed = 1;
      travel = {
        ...t,
        hex: { ...t.hex, label: String(hex.label ?? "").trim() },
        day: { ...t.day, hexesEntered: (t.day.hexesEntered ?? 0) + 1 },
      };
    }
    spent = spendMarch(travel.day, { miles, milesPerHour, cadence, crossed, secondsPerHour });
    record.travel = { ...travel, day: spent.day };
    if (anchor) record.clock = { ...(record.clock ?? {}), lastPosition: { x: anchor.x, y: anchor.y } };
    // A record that never stood in a zone gains no key.
    if (zoneIds.length || before.length) record.clock = { ...(record.clock ?? {}), zoneIds };
  });
  if (!written || !spent) return null;

  if (spent.seconds > 0) await advanceJourneyClock(formationId, spent.seconds);

  if (spent.units > 0 || zoneEntered) {
    const fresh = getFormation(formationId);
    if (fresh) {
      const context = hexContext(fresh, scene);
      const night = journeyNight(travelOf(fresh));
      for (let n = 0; n < spent.units; n++) {
        Hooks.callAll("acksExtras.hexEntered", {
          formationId,
          ...context,
          cadence: cadence.by,
          night,
          throwOwed: encountersOn() && perUnit,
        });
        if (perUnit) await maybeHexThrow(fresh, { night, hex: context.hex });
      }
      if (zoneEntered) await maybeHexThrow(fresh, { night, hex: context.hex, activity: "entry" });
    }
  }
  return { miles, hours: spent.hours, seconds: spent.seconds, units: spent.units, crossed, day: spent.day, zoneEntered };
}

/**
 * The Judge's override: the party crosses into the next hex without a drag (a
 * journey with no map, or a click in place of a walk). Spends one cadence
 * unit's miles — none when no cadence is known — against the party's scene if
 * it has one, and names the hex `label`.
 */
export async function nextHex(formationId, label) {
  const formation = getFormation(formationId);
  if (!formation) return null;
  const scene = getPartyScene(formation);
  const cadence = cadenceFor(travelOf(formation).territory, scene);
  return spendJourneyMiles(formationId, cadence.miles ?? 0, { scene, hex: { label } });
}

/**
 * Run the world clock forward by the seconds a journey took. Lights and tracked
 * spells burn by every whole turn the seconds add up to (the remainder is kept
 * in `clock.journeySeconds`), and effects that run out are reported. Only
 * elapsed time passes: no rest or winded accounting, no wandering-monster
 * throw, no turn count.
 * @returns {Promise<{seconds: number, notes: object[]}>}
 */
export async function advanceJourneyClock(formationId, seconds) {
  const whole = Math.max(0, Math.floor(Number(seconds) || 0));
  const formation = getFormation(formationId);
  if (!formation || !(whole > 0)) return { seconds: 0, notes: [] };
  const snapshot = snapshotRunningEffects(formation);
  if (mayAdvanceWorldTime()) await game.time.advance(whole);

  const notes = [];
  await patchFormation(formationId, (record) => {
    const total = (Number(record.clock?.journeySeconds) || 0) + whole;
    const turns = Math.floor(total / TURN_SECONDS);
    record.clock = { ...(record.clock ?? {}), journeySeconds: total - turns * TURN_SECONDS };
    if (turns > 0) {
      record.lights ??= [];
      burnTurns(record, turns, notes);
      record.lights = (record.lights ?? []).filter((l) => l.lit || l.remaining > 0);
    }
  });
  const fresh = getFormation(formationId);
  if (fresh) {
    expiredEffectNotes(fresh, snapshot, notes);
    if (notes.length) await postNotesCard(fresh, notes);
  }
  return { seconds: whole, notes };
}

/**
 * An hour of the day spent searching: it marks the first unresolved search
 * slot done and runs the clock an hour. The day's `hours` are the march's
 * alone — they are what the budget is measured against, and a slot spent
 * looking is an hour the budget never held — so this leaves them standing.
 * @returns {Promise<{seconds: number, notes: object[]}>}
 */
export async function spendSearchHour(formationId) {
  const secondsPerHour = (clockReading()?.secondsPerHour ?? DEFAULT_SECONDS_PER_HOUR) * SLOT_HOURS;
  await patchFormation(formationId, (record) => {
    const t = travelOf(record);
    const done = [...t.day.done];
    const slot = t.day.activities.findIndex((a, n) => a === "search" && !done[n]);
    if (slot >= 0) done[slot] = true;
    record.travel = {
      ...t,
      day: {
        ...t.day,
        secondsAdvanced: (Number(t.day.secondsAdvanced) || 0) + secondsPerHour,
        done,
      },
    };
  });
  return advanceJourneyClock(formationId, secondsPerHour);
}

/**
 * Where the party is, as the stocking and hook seams read it.
 * @returns {{sceneId: string|null, hex: {i: number|null, j: number|null, label: string}|null,
 *   ground: string, encounterTerrain: string, territory: string, lost: boolean}}
 *   `hex` is null while the trace has named nothing; `encounterTerrain` is the
 *   pick the encounter throw would use.
 */
export function hexContext(formation, scene = null) {
  const t = travelOf(formation);
  const named = t.hex.i != null || t.hex.j != null || !!t.hex.label;
  return {
    sceneId: scene?.id ?? formation?.sceneId ?? null,
    hex: named ? { i: t.hex.i, j: t.hex.j, label: t.hex.label } : null,
    ground: t.ground,
    encounterTerrain: Object.hasOwn(ENCOUNTER_TERRAINS, t.encounterTerrain) ? t.encounterTerrain : encounterTerrainFor(t.ground),
    territory: t.territory,
    lost: !!t.lost?.active,
  };
}

/** Whether the journey stands after dark: the Judge's word on the hour, else the world clock's. */
export function journeyNight(travel) {
  return isNight({ hour: travel?.hour }, { dark: clockReading()?.dark ?? null });
}
