/* global game, Hooks */
/**
 * The journey's movement engine: what a party token's drag spends while its
 * formation is on a journey, on every kind of scene.
 *
 * A drag is measured in MILES, whatever the grid. One record patch then writes
 * the hex trace (the hex's identity and the map's reading of it, `travel.map`)
 * and the day's spend together; the world clock runs by the hours those miles
 * take; the
 * `acksExtras.hexEntered` hook fires once per cadence unit walked; and each
 * unit owes its encounter throw. The order is fixed: measure → record patch →
 * clock → hooks → throws, so a hook listener and a throw both read a record
 * that already holds the step.
 *
 * While a lost episode is open the drag also walks the truth: the party
 * token is where the party believes it is, and its shadow takes the same
 * steps from where the party really stands (`walkTheTruth`), before the
 * spend, so the throws read the true hex. After the spend, the day's first
 * step off a road makes the day's navigation throw (`throwDayNavigation`).
 *
 * This file is the one owner of the `acksExtras.hexEntered` and
 * `acksExtras.searchHourSpent` hooks. It sits above `turn-engine.mjs` (the
 * delve's tracker, which a journey never uses), `travel.mjs` (the record),
 * `march.mjs` (the arithmetic) and `combat-bridge.mjs` (a fight that is over,
 * re-formed before any move is spent); nothing below it imports it.
 */
import { TURN_SECONDS } from "./constants.mjs";
import { isActiveGMSeat } from "../lib/util.mjs";
import { getFormation, getPartyScene, partySpeed, patchFormation } from "./formation-model.mjs";
import {
  claimNavigationDay, journeyDayKey, mapReadingAt, navigationOwed, sameReading, seatJourneyHex, storedTravelOf, tokenCentre,
  travelOf, traceStep, trueTravelOf,
} from "./travel.mjs";
import { beginEpisode, walkAstrayPath } from "./lost-episode.mjs";
import { reformIfOver } from "./combat-bridge.mjs";
import { shadowFor } from "./shadow.mjs";
import { postNavigationThrow } from "./navigation-card.mjs";
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
  storedPosition,
} from "./turn-engine.mjs";
import { DISTANCE_UNITS, feetPerUnit, sceneMilesPerCell } from "../lib/distance-units.mjs";
import { clockReading, mayAdvanceWorldTime } from "../lib/world-time.mjs";
import { hexLabelFromOffset, isHexScene } from "../battlemap/terrain-paint.mjs";
import { routesOf, stepBetweenHexes } from "../battlemap/hex-routes.mjs";

/** Seconds in an hour on a clock that keeps no calendar. */
const DEFAULT_SECONDS_PER_HOUR = 3600;

/** The move each formation is still spending, so the next waits its turn. */
const moveQueues = new Map();

/**
 * The party token moved: hand it to the engine its formation's mode uses,
 * one move at a time per formation. A second move that arrives while the
 * first is still spending waits for it, so it measures from the baseline the
 * first wrote and walks the truth from where the first left the shadow;
 * handled at once, both would measure from the same baseline and walk the
 * shadow twice. `to` is where this move put the token (`storedPosition`),
 * read when the move is heard: by the time a queued move's turn comes, a later
 * move has written its own destination over the token's. `primary` is whether
 * this window does the move's GM-side half (the navigation throw, the truth's
 * walk), read when the move is heard too, since the seat's lead can change
 * while a move waits: the caller's seat by default, which the movement hook
 * has already narrowed to the elected window. Resolves with the engine's own
 * answer; a move that throws rejects without holding the next.
 */
export async function onPartyTokenMoved(tokenDoc, formationId, to = storedPosition(tokenDoc), { primary = isActiveGMSeat() } = {}) {
  const prior = moveQueues.get(formationId) ?? Promise.resolve();
  const next = prior.then(() => dispatchPartyTokenMoved(tokenDoc, formationId, to, primary));
  const settled = next.then(() => undefined, () => undefined);
  moveQueues.set(formationId, settled);
  settled.then(() => {
    if (moveQueues.get(formationId) === settled) moveQueues.delete(formationId);
  });
  return next;
}

/**
 * One move, spent: a journey whose Judge has paused it (`clock.pausedBy ===
 * "judge"`) bills nothing and follows the token; any other journey spends
 * miles; every other mode keeps the turn clock. On the primary window a party
 * whose fight is over first reforms where the move put it
 * (`reformIfOver`), in the move's turn, so a second move waiting behind it
 * finds the party already reformed.
 */
async function dispatchPartyTokenMoved(tokenDoc, formationId, to, primary) {
  if (primary) {
    const reforming = reformIfOver(formationId, { inPlace: true });
    if (reforming) await reforming;
  }
  const formation = getFormation(formationId);
  if (!formation) return null;
  if (travelOf(formation).mode !== "journey") return onTurnClockTokenMoved(tokenDoc, formationId, to);
  if (formation.clock?.pausedBy === "judge") {
    await patchFormation(formationId, (record) => {
      record.clock = { ...(record.clock ?? {}), lastPosition: { x: to.x, y: to.y } };
    });
    // The hex and the reading follow the token too, so what the party stands
    // on when the pause lifts is what it reads, with nothing billed.
    await seatJourneyHex(tokenDoc, formationId, to);
    return null;
  }
  return onJourneyTokenMoved(tokenDoc, formationId, { to, primary });
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
 * A journeying party token moved: measure the drag in miles, read the map
 * under the token (`mapReadingAt`), trace the hex it stands in when the scene
 * is a hex grid, and spend the miles. Off a hex grid there is no hex to trace,
 * and the reading alone is cached. The baseline for the next drag is this
 * position.
 *
 * On a hex grid with a lost episode open, the truth walks the drag first
 * (`walkTheTruth`). A drag that spent miles then owes the day's navigation
 * throw when it is the day's first step off a road (`throwDayNavigation`), on
 * the window that runs the automation only (`primary`, read once by the
 * caller), for the day the step BEGAN in: the key is read before the spend
 * moves the clock, so a march that crosses midnight owes the new day's throw
 * at its next step, not at the step that crossed. `begin` is the episode
 * opener a failed throw calls, `beginEpisode`'s shape; `to` is where the move
 * put the token (`storedPosition`).
 */
export async function onJourneyTokenMoved(tokenDoc, formationId, { begin = beginEpisode, to = storedPosition(tokenDoc), primary = isActiveGMSeat() } = {}) {
  const scene = tokenDoc?.parent;
  const formation = getFormation(formationId);
  if (!scene || !formation) return null;
  const here = { x: to.x, y: to.y };
  const from = formation.clock?.lastPosition ?? here;
  const { miles, spaces } = journeyMeasure(scene, from, here);
  const point = tokenDoc.getCenterPoint?.(here) ?? tokenCentre({ ...here, width: tokenDoc.width, height: tokenDoc.height }, scene);
  const map = mapReadingAt(scene, point, { at: game.time?.worldTime ?? null });
  const day = journeyDayKey(travelOf(formation));

  const spent = isHexScene(scene)
    ? await stepOnHexes(scene, tokenDoc, formation, { from, here, point, map, miles, spaces, primary })
    : await spendJourneyMiles(formationId, miles, { scene, reading: map, anchor: here, crossings: spaces });
  if (spent?.miles > 0 && primary) await throwDayNavigation(formationId, { begin, day });
  return spent;
}

/**
 * A drag on a hex grid: the hex trace, the truth walked when an episode is
 * open (on the window that runs the automation), then the spend.
 */
async function stepOnHexes(scene, tokenDoc, formation, { from, here, point, map, miles, spaces, primary }) {
  const formationId = formation.id;
  const offset = scene.grid.getOffset(point);
  // Which road, if any, this STEP followed. Only asked when a network exists:
  // a scene nobody has drawn routes on leaves the map's own reading of the
  // hex standing rather than declaring every march off-road. A move inside
  // the hex the party already stands in is no step: the road its last step
  // walked stays the map's answer, which a read at the token cannot see.
  let road;
  let winding = 1;
  const { hex: prior, map: held } = travelOf(formation);
  const standing = prior.i === offset.i && prior.j === offset.j;
  if (standing) {
    if (held?.sceneId === scene.id && held.i === offset.i && held.j === offset.j && held.road != null) road = held.road;
  } else if (routesOf(scene).length && prior.i != null && prior.j != null) {
    const step = stepBetweenHexes(scene, { i: prior.i, j: prior.j }, offset);
    road = step.on ? step.road : "none";
    if (step.on) winding = step.winding ?? 1;
  }
  const trace = { label: hexLabelFromOffset(offset), i: offset.i, j: offset.j, map, road, winding };
  if (primary) await walkTheTruth(scene, tokenDoc, formation, { from, to: here });
  return spendJourneyMiles(formationId, miles, { scene, trace, anchor: here, crossings: spaces });
}

/**
 * The hexes a drag walked and where each puts the truth, pure. The believed
 * path is the grid's direct path between the token's centres before and after
 * the drag (`getDirectPath`); each hex on it past the first moves the truth by
 * that hex's own displacement from the first, centre to centre, so the shadow
 * takes the same steps from wherever it stands and the whole drag moves it by
 * the token's displacement snapped to the grid.
 *
 * @param {Scene} scene  a hex scene
 * @param {object} o
 * @param {{x: number, y: number}} o.from   the token's centre before the drag
 * @param {{x: number, y: number}} o.to     the token's centre after it
 * @param {{x: number, y: number}} o.truth  the shadow's centre before the drag
 * @returns {Array<{believed: {i: number, j: number}, truth: {i: number, j: number}}>}
 *   one pair per hex entered, in order; empty for a drag inside one hex
 */
export function astrayPath(scene, { from, to, truth } = {}) {
  const grid = scene?.grid;
  if (!grid || !from || !to || !truth) return [];
  const start = grid.getOffset(from);
  const end = grid.getOffset(to);
  if (start.i === end.i && start.j === end.j) return [];
  const direct = grid.getDirectPath?.([from, to]) ?? [];
  const path = direct.length >= 2 ? direct : [start, end];
  const origin = grid.getCenterPoint(path[0]);
  return path.slice(1).map((believed) => {
    const c = grid.getCenterPoint(believed);
    const truthHex = grid.getOffset({ x: truth.x + (c.x - origin.x), y: truth.y + (c.y - origin.y) });
    return { believed: { i: believed.i, j: believed.j }, truth: { i: truthHex.i, j: truthHex.j } };
  });
}

/**
 * The drag walks the truth: while a lost episode is open, in either phase,
 * and its shadow stands on the scene the party token walked, each hex the
 * drag entered moves the shadow one step (`astrayPath`) and records the pair,
 * in order, through `walkAstrayPath` — one call for the whole drag, so the
 * players' fog is painted once for every hex it faked. `from` and `to` are
 * the token's top-left corners before and after.
 *
 * @returns {Promise<number>} how many hexes the truth walked
 */
export async function walkTheTruth(scene, tokenDoc, formation, { from, to, walk = walkAstrayPath } = {}) {
  if (!travelOf(formation).lost.phase || !isHexScene(scene)) return 0;
  const shadow = shadowFor(scene, formation.id);
  if (!shadow) return 0;
  const centre = (corner) => tokenCentre({ x: corner.x, y: corner.y, width: tokenDoc.width, height: tokenDoc.height }, scene);
  const pairs = astrayPath(scene, { from: centre(from), to: centre(to), truth: tokenCentre(shadow, scene) });
  if (pairs.length) {
    await walk(formation, pairs.map(({ believed, truth }) => ({ believedOffset: believed, trueOffset: truth })));
  }
  return pairs.length;
}

/**
 * The day's navigation throw, made at the day's first step off a road: when
 * `navigationOwed` says it is owed for `day` (the key the step began in;
 * today's where none is handed in), the day is claimed inside the ledger's
 * lock (`claimNavigationDay`), so a second step the same day on this client
 * finds it made, and the throw is rolled, recorded and whispered
 * (`postNavigationThrow`). The caller guards the client: the active GM's for
 * a drag, the pressing Judge's for a hex entered by hand. `begin` is the
 * episode opener a failure calls.
 *
 * @returns {Promise<object|null>} `postNavigationThrow`'s answer, or null when nothing was owed
 */
export async function throwDayNavigation(formationId, { begin = beginEpisode, day = null } = {}) {
  const formation = getFormation(formationId);
  if (!formation) return null;
  const owed = navigationOwed(formation, { day });
  if (owed.state !== "owed") return null;
  if (!(await claimNavigationDay(formationId, owed.day))) return null;
  const fresh = getFormation(formationId);
  return fresh ? postNavigationThrow(fresh, { by: "step", begin, day: owed.day }) : null;
}

/**
 * The stored travel subtree once a step's trace or reading is applied, pure:
 * what the record patch below writes the step from, and what the cadence of
 * the walk is read from before it.
 */
function steppedTravel(t, { trace = null, reading = null } = {}) {
  if (trace) return traceStep(t, trace);
  if (reading && !sameReading(t.map, reading)) return { travel: { ...t, map: reading }, crossed: 0 };
  return { travel: t, crossed: 0 };
}

/**
 * Spend miles walked on a journey: the day's tally, the clock, the hooks and
 * the throws, in that order.
 *
 * One record patch applies the hex trace (or, off a hex grid, the map's
 * `reading` alone; or, for `hex`, a named hex counted as one crossing) and the
 * miles together, and re-anchors the movement baseline when an `anchor` is
 * given. The hours come from the party's speed on the current ground (a camp
 * day is priced at the march pace, so its travel slots can be walked); a speed
 * the readout cannot price moves no clock. The cadence is the territory's the
 * step arrives in — the country the throws it owes are thrown in, which is the
 * party's true position's while a lost episode is open (`trueTravelOf`) — and
 * the cadence units the walk earned (`cadenceOf`) each fire
 * `acksExtras.hexEntered` and then owe their encounter throw.
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
 * @param {object|null} [o.reading]   the map's reading under the party (`mapReadingAt`), where no trace carries one
 * @param {{label: string}|null} [o.hex]  a hex named by the Judge, counted as one crossing
 * @param {{x: number, y: number}|null} [o.anchor]  the token position to measure the next drag from
 * @param {number|null} [o.crossings]  the hex steps the grid measured for the drag; the miles in cells stand in when absent
 * @returns {Promise<{miles: number, hours: number, seconds: number, units: number,
 *   crossed: number, day: object, zoneEntered: boolean}|null>} null when the
 *   formation is gone; `zoneEntered` is whether the walk crossed into an
 *   `entry` zone
 */
export async function spendJourneyMiles(formationId, miles, { scene = null, trace = null, reading = null, hex = null, anchor = null, crossings = null } = {}) {
  const formation = getFormation(formationId);
  if (!formation) return null;
  const readout = travelReadout(formation, partySpeed(formation, { dark: false }));
  const milesPerHour = Number(readout.milesPerHour) || 0;
  const arrived = steppedTravel(storedTravelOf(formation), { trace, reading: hex ? null : reading }).travel;
  const cadence = cadenceFor(trueTravelOf({ ...formation, travel: arrived }).territory, scene);
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
    const t = storedTravelOf(record);
    let travel = t;
    if (trace) {
      ({ travel, crossed } = steppedTravel(t, { trace }));
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
    } else if (reading) {
      ({ travel } = steppedTravel(t, { reading }));
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
 * it has one, and names the hex `label`. It is a step like a drag's, so it
 * owes the day's navigation throw the same way (`throwDayNavigation`, for the
 * day the step began in), on the pressing Judge's client.
 */
export async function nextHex(formationId, label, { begin = beginEpisode } = {}) {
  const formation = getFormation(formationId);
  if (!formation) return null;
  const scene = getPartyScene(formation);
  const cadence = cadenceFor(trueTravelOf(formation).territory, scene);
  const day = journeyDayKey(travelOf(formation));
  const spent = await spendJourneyMiles(formationId, cadence.miles ?? 0, { scene, hex: { label } });
  if (spent && game.user?.isGM) await throwDayNavigation(formationId, { begin, day });
  return spent;
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
export function spendSearchHour(formationId) {
  return spendActivityHours(formationId, ["search"]);
}

/**
 * Hours of the day spent on the listed kinds of ancillary slot: marks the first
 * unresolved slot of those kinds done (every unresolved one with `all`), adds
 * the slots' hours to the seconds the day has advanced, and runs the journey
 * clock by them. The day's `hours` stay the march's alone.
 *
 * Without `all` one slot's hour always runs the clock, even when no unresolved
 * slot is left to mark; with `all` only the slots actually marked do, so a day
 * with none left advances nothing.
 * @param {string} formationId
 * @param {string[]} kinds  the activity keys whose slots are spent
 * @param {{all?: boolean}} [options]
 * @returns {Promise<{seconds: number, notes: object[]}>}
 */
export async function spendActivityHours(formationId, kinds, { all = false } = {}) {
  const wanted = new Set(kinds ?? []);
  const secondsPerSlot = (clockReading()?.secondsPerHour ?? DEFAULT_SECONDS_PER_HOUR) * SLOT_HOURS;
  let seconds = 0;
  await patchFormation(formationId, (record) => {
    const t = storedTravelOf(record);
    const done = [...t.day.done];
    const open = t.day.activities
      .map((a, n) => (wanted.has(a) && !done[n] ? n : -1))
      .filter((n) => n >= 0);
    const marked = all ? open : open.slice(0, 1);
    for (const n of marked) done[n] = true;
    seconds = (all ? marked.length : 1) * secondsPerSlot;
    if (!seconds) return false;
    record.travel = {
      ...t,
      day: {
        ...t.day,
        secondsAdvanced: (Number(t.day.secondsAdvanced) || 0) + seconds,
        done,
      },
    };
  });
  return advanceJourneyClock(formationId, seconds);
}

/**
 * Where the party really is, as the stocking and hook seams read it: the
 * shadow's hex and country while a lost episode is open (`trueTravelOf`), the
 * party token's otherwise.
 * @returns {{sceneId: string|null, hex: {i: number|null, j: number|null, label: string}|null,
 *   ground: string, encounterTerrain: string, territory: string, lost: boolean}}
 *   `hex` is null while the trace has named nothing; `encounterTerrain` is the
 *   pick the encounter throw would use.
 */
export function hexContext(formation, scene = null) {
  const t = trueTravelOf(formation);
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
