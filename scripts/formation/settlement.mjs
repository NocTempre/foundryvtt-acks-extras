/**
 * Settlement travel: crossing a city the way the party crosses country.
 *
 * A settlement is measured in BLOCKS, not feet, and the shape of the rule is
 * the wilderness journey in miniature: a pace decides how far a turn carries
 * the party, a navigation throw decides whether it arrives where it meant to,
 * and where it stands decides how often the street throws something at it.
 *
 * Three structural facts: only the commuting pace throws to navigate; a route
 * walked before needs no throw and a destination reached before by another way
 * earns a registry-priced modifier; and a large party straggles in tiers that
 * bite only the commuting pace.
 *
 * Every number is read from the registered `cityTravel` document, and every
 * reader returns null with a stated reason when the table is absent.
 */
import { getDoc, hasDoc } from "../lib/tables.mjs";
import { numOrNull } from "../lib/util.mjs";
import { diceFormula } from "./constants.mjs";

/**
 * The registered document these derivations read: `cityTravel`, not
 * `settlement`, which the henchmen feature already registers for market class.
 */
export const SETTLEMENT_DOC = "cityTravel";

/** World toggle for the book's optional straggling rules. Ships on. */
export const SETTING_STRAGGLING = "settlementStraggling";

/**
 * The die the navigation throw is made on: the game's own throw (JJ p. 79).
 * Not interchangeable with the street's die, since each is made against a
 * target priced on its own scale.
 */
export const NAVIGATION_DIE = "1d20";

/**
 * The die the street's encounter throw is made on, from the imported `dice`
 * table, or null until it is imported (the caller reports it as not imported).
 * Rebuilt from its integers, since a Judge's override is free text.
 */
export const streetDie = () => diceFormula(table("dice")?.street);

/**
 * The die the city's own incident list is thrown on, from the imported `dice`
 * table, or null until it is imported. Used where the list itself names none.
 */
export const incidentDie = () => diceFormula(table("dice")?.incident);

/** The toggle, read defensively so the pure derivations stay Node-testable. */
function stragglingEnabled() {
  try {
    return globalThis.game?.settings?.get?.("acks-extras", SETTING_STRAGGLING) ?? true;
  } catch {
    return true;
  }
}

/**
 * How the party is moving through the streets.
 *
 * `throws` is the structural half of the navigation rule: a commuting party
 * can lose its way and a meandering one cannot.
 */
export const SETTLEMENT_PACES = Object.freeze({
  commuting: { label: "ACKS-FORMATION.settlement.pace.commuting", throws: true, straggles: true },
  meandering: { label: "ACKS-FORMATION.settlement.pace.meandering", throws: false, straggles: false },
});

/**
 * Where the party is, which decides how often the street answers. `holedUp` is
 * the party staying put, not a place in the street, and keeps its own cadence.
 */
export const SETTLEMENT_LOCATIONS = Object.freeze({
  avenue: { label: "ACKS-FORMATION.settlement.where.avenue" },
  alley: { label: "ACKS-FORMATION.settlement.where.alley" },
  holedUp: { label: "ACKS-FORMATION.settlement.where.holedUp", stationary: true },
});

/** How well the party knows the way. Ordered from no help to no throw. */
export const ROUTE_KNOWLEDGE = Object.freeze({
  unknown: { label: "ACKS-FORMATION.settlement.route.unknown" },
  destination: { label: "ACKS-FORMATION.settlement.route.destination" },
  route: { label: "ACKS-FORMATION.settlement.route.route", certain: true },
});

/**
 * What the party is doing about being noticed: seeking trouble raises the
 * encounter throw. Holing up is a LOCATION, not an intent.
 */
export const SETTLEMENT_INTENTS = Object.freeze({
  ordinary: { label: "ACKS-FORMATION.settlement.intent.ordinary" },
  trouble: { label: "ACKS-FORMATION.settlement.intent.trouble", seeks: true },
});

/**
 * How the party is carried. A conveyance carries no rate; `private` is a flag
 * the Judge reads for being unseen.
 */
export const CONVEYANCES = Object.freeze({
  onFoot: { label: "ACKS-FORMATION.settlement.conveyance.onFoot" },
  litter: { label: "ACKS-FORMATION.settlement.conveyance.litter", private: true },
  wagon: { label: "ACKS-FORMATION.settlement.conveyance.wagon", private: true },
});

/**
 * Where the board takes the hour from: `clock` follows the world clock (the
 * default); `day` and `night` are the Judge's word. Whether it is dark is
 * resolved by `isNight`, never read off the board directly.
 */
export const HOUR_MODES = Object.freeze({
  clock: { label: "ACKS-FORMATION.settlement.hour.clock", follows: true },
  day: { label: "ACKS-FORMATION.settlement.hour.day", night: false },
  night: { label: "ACKS-FORMATION.settlement.hour.night", night: true },
});

/**
 * Whether the board stands after dark: the Judge's word where one was given,
 * the clock's answer otherwise. `dark` is what the world clock says
 * (`lib/world-time.mjs` `clockReading().dark`), and null where the caller has
 * no clock to ask — a pure tick, a test — which reads as day.
 */
export function isNight(board, { dark = null } = {}) {
  const mode = HOUR_MODES[board?.hour] ? board.hour : "clock";
  if (mode === "clock") return !!dark;
  return !!HOUR_MODES[mode].night;
}

/** A table read that answers null rather than a guess. */
function table(key) {
  if (!hasDoc(SETTLEMENT_DOC)) return null;
  const t = getDoc(SETTLEMENT_DOC)?.tables?.[key];
  // A registered table may be a bare figure, so non-objects are not rejected.
  return t == null ? null : t;
}

/** A world-time stamp, or null for anything that is not one. */
function stampOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * A board's city stamp: a scene id, or null for anything that names no scene.
 *
 * The one place that says what a stamp is: the empty string is null, not a
 * stamp of its own, or it would compare unequal to every city.
 */
export function sceneStamp(value) {
  return typeof value === "string" && value ? value : null;
}

/** A fresh settlement board: on an avenue, at the clock's hour, going nowhere in particular. */
export function freshSettlement() {
  return {
    /** The scene whose blocks these are, or null for a board no city has claimed. */
    sceneId: null,
    pace: "meandering",
    where: "avenue",
    route: "unknown",
    /** Where the hour comes from (`HOUR_MODES`); `isNight` resolves it. */
    hour: "clock",
    intent: "ordinary",
    conveyance: "onFoot",
    /**
     * Is somebody in this settlement hunting this party? Picks a district's
     * wanted table over its ordinary one. Judge-told, and not carried across
     * re-entry. See docs/formation/DECISIONS.md, "Being hunted is a board fact,
     * and it does not travel (2026-09-12)".
     */
    wanted: false,
    /**
     * The faction hunting the party here, when `wanted` was set by one (the
     * uuid of a faction actor), and the district the ledger was last asked
     * for. `hunt.mjs` is the only writer; a Judge's untick clears the name.
     */
    huntedBy: "",
    huntRegion: "",
    blocks: 0,
    turns: 0,
    days: 0,
    /**
     * World time, in seconds, that the current stay is counted from. Null
     * until the party stays put; the clock watcher stamps it and moves it
     * forward by the days it has charged for.
     */
    holeUpSince: null,
    lost: false,
    lastThrow: null,
    /**
     * The road the party was standing on when the turn was taken, as the tick
     * read it off the map (`{name, surface, street}`), or null. A SNAPSHOT.
     */
    road: null,
    /** Was the last move counted ALONG the streets, or as the straight line between its ends? Null until the party has moved. */
    measuredAlong: null,
  };
}

/**
 * Normalize whatever the record holds into the vocabulary above.
 */
export function settlementOf(travel) {
  const s = travel?.settlement ?? {};
  const fresh = freshSettlement();
  return {
    ...fresh,
    ...s,
    sceneId: sceneStamp(s.sceneId),
    pace: SETTLEMENT_PACES[s.pace] ? s.pace : fresh.pace,
    where: SETTLEMENT_LOCATIONS[s.where] ? s.where : fresh.where,
    route: ROUTE_KNOWLEDGE[s.route] ? s.route : fresh.route,
    hour: HOUR_MODES[s.hour] ? s.hour : fresh.hour,
    intent: SETTLEMENT_INTENTS[s.intent] ? s.intent : fresh.intent,
    conveyance: CONVEYANCES[s.conveyance] ? s.conveyance : fresh.conveyance,
    wanted: !!s.wanted,
    huntedBy: typeof s.huntedBy === "string" ? s.huntedBy : "",
    huntRegion: typeof s.huntRegion === "string" ? s.huntRegion : "",
    blocks: Number(s.blocks) || 0,
    turns: Number(s.turns) || 0,
    days: Number(s.days) || 0,
    // Never coerced: `Number(null)` is 0, a stamp the clock watcher would charge from world time zero.
    holeUpSince: stampOrNull(s.holeUpSince),
    lost: !!s.lost,
    road: s.road?.surface
      ? {
        name: s.road.name ?? "",
        surface: s.road.surface,
        street: SETTLEMENT_LOCATIONS[s.road.street] ? s.road.street : null,
      }
      : null,
    measuredAlong: s.measuredAlong == null ? null : !!s.measuredAlong,
  };
}

/**
 * Where the party actually is, for the street's purposes, and which source
 * said so. In order: a party holed up is holed up whatever it stands on;
 * otherwise the ROAD under the token answers, since it was DRAWN; with no drawn
 * street underfoot the picker is all there is.
 *
 * @param {object} board the settlement board
 * @param {string|null} roadStreet the `street` of the road under the party
 * @returns {{where: string, from: "road"|"picker"}}
 */
export function effectiveWhere(board, roadStreet = null) {
  const s = settlementOf({ settlement: board });
  if (SETTLEMENT_LOCATIONS[s.where]?.stationary) return { where: s.where, from: "picker" };
  // `holedUp` is a picker answer and can never be read off a road.
  if (roadStreet && SETTLEMENT_LOCATIONS[roadStreet] && !SETTLEMENT_LOCATIONS[roadStreet].stationary) {
    return { where: roadStreet, from: "road" };
  }
  return { where: s.where, from: "picker" };
}

/**
 * Carry a stay across a board write: a party that has moved is no longer on it.
 * Every writer of the board passes through here, so a stale stamp cannot
 * charge the days between two stays.
 */
export function carryStay(previous, next) {
  return next?.where === previous?.where ? next : { ...next, holeUpSince: null };
}

/**
 * The board a party re-entering a city starts on.
 *
 * What the Judge TOLD the board stays (the pace, the streets, the route, the
 * hour, the intent, how they are carried) and what the last city COUNTED goes
 * (blocks, turns, days and the stay's stamp). See docs/formation/DECISIONS.md,
 * "Re-entering a city keeps what the Judge set, not what the last city counted
 * (2026-09-12)".
 *
 * The board comes back stamped with the city being entered; naming no city
 * keeps the stamp `previous` already carries, since an unstamped board reads
 * as foreign to the next arrival.
 *
 * @param {object|null} previous the board being left
 * @param {string|null} [sceneId] the scene the fresh tally is counted in;
 *   naming none keeps `previous`'s own stamp
 */
export function reenterSettlement(previous, sceneId = null) {
  const s = settlementOf({ settlement: previous });
  const fresh = freshSettlement();
  return {
    ...fresh,
    sceneId: sceneStamp(sceneId) ?? s.sceneId,
    pace: s.pace,
    where: s.where,
    route: s.route,
    hour: s.hour,
    intent: s.intent,
    conveyance: s.conveyance,
  };
}

/**
 * The board asked about the hunt for the quarter the party now stands in.
 * Unchanged while that is the quarter last asked for (`huntRegion`), so the
 * Judge's own word on `wanted` stands until the party crosses into another.
 * Entering a quarter whose holder wants the party sets `wanted` and names the
 * hunter in `huntedBy`; entering one where nobody does clears the name and
 * leaves `wanted` as it was. The quarter is "" when the party stands in none,
 * and a fresh tally (`reenterSettlement`) names none, so an arrival is always asked.
 * @param {{regionUuid?: string, hunterUuid?: string}} hunt
 */
export function applyHunt(board, { regionUuid = "", hunterUuid = "" } = {}) {
  const s = settlementOf({ settlement: board });
  if (regionUuid === s.huntRegion) return board;
  return { ...s, huntRegion: regionUuid, huntedBy: hunterUuid, wanted: hunterUuid ? true : s.wanted };
}

/**
 * Which straggling tier a party of this size falls in, or null for none.
 *
 * The tiers are a registered ladder, `[{from, multiplier}]`; the deepest tier
 * whose threshold the party has reached applies.
 */
export function straggleTier(headcount, { pace = "commuting" } = {}) {
  if (!SETTLEMENT_PACES[pace]?.straggles) return null;
  if (!stragglingEnabled()) return null;
  const rungs = table("straggling")?.tiers;
  if (!Array.isArray(rungs) || !rungs.length) return null;
  const n = Number(headcount);
  if (!Number.isFinite(n)) return null;
  let hit = null;
  for (const rung of rungs) {
    const from = Number(rung?.from);
    const mult = Number(rung?.multiplier);
    if (!Number.isFinite(from) || !Number.isFinite(mult)) continue;
    if (n >= from && (!hit || from > hit.from)) hit = { from, multiplier: mult };
  }
  return hit;
}

/**
 * Blocks covered in one turn: the pace's rate, reduced by the straggling tier
 * the party's size earns.
 *
 * Returns `{blocks, parts}` so the panel can show the derivation, or
 * `{blocks: null, missing}` naming what was not imported.
 */
export function blocksPerTurn({ pace = "meandering", headcount = 1 } = {}) {
  if (!SETTLEMENT_PACES[pace]) return { blocks: null, missing: "pace" };
  const rate = Number(table("paces")?.[pace]?.blocksPerTurn);
  if (!Number.isFinite(rate)) return { blocks: null, missing: "paces" };
  const parts = [{ key: pace, factor: rate, base: true }];
  const tier = straggleTier(headcount, { pace });
  if (tier) parts.push({ key: "straggling", factor: tier.multiplier, from: tier.from });
  const blocks = parts.reduce((n, p) => (p.base ? p.factor : n * p.factor), rate);
  return { blocks, parts };
}

/**
 * How far one city turn carries the party, in FEET.
 *
 * The bridge between blocks and a drawn map: a block's size belongs to the map,
 * so `blockFeet` is passed in by the scene, not read from the registry. Null
 * feet with a stated `missing` when either half is unknown.
 */
export function feetPerTurn({ pace = "meandering", headcount = 1, blockFeet = null } = {}) {
  const rate = blocksPerTurn({ pace, headcount });
  if (rate.blocks == null) return { feet: null, missing: rate.missing };
  const size = Number(blockFeet);
  if (!Number.isFinite(size) || size <= 0) return { feet: null, missing: "blockFeet" };
  return { feet: rate.blocks * size, blocks: rate.blocks, blockFeet: size, parts: rate.parts };
}

/**
 * The navigation throw for one turn of city travel.
 *
 * A known route needs no throw; a known destination by an unknown way earns a
 * modifier; everything else throws bare. The target and the modifier are the
 * registry's, and an unimported table yields a null target.
 */
export function citySpec({ pace = "commuting", route = "unknown" } = {}) {
  const spec = SETTLEMENT_PACES[pace];
  if (!spec) return { throws: false, reason: "pace" };
  if (!spec.throws) return { throws: false, reason: "pace" };
  if (ROUTE_KNOWLEDGE[route]?.certain) return { throws: false, reason: "route" };
  const nav = table("navigation");
  const target = Number(nav?.target);
  if (!Number.isFinite(target)) return { throws: true, target: null, missing: "navigation" };
  // The target and the known-destination modifier can arrive separately: a
  // missing modifier is flagged `unpricedRoute`, never read as an imported zero.
  if (route !== "destination") return { throws: true, target, modifier: 0 };
  const known = numOrNull(nav?.knownDestination);
  return { throws: true, target, modifier: known ?? 0, unpricedRoute: known == null };
}

/**
 * How far off a lost turn puts the party, as a dice expression from the
 * registry. Null when unimported.
 */
export function strayBlocks() {
  const f = table("navigation")?.strayBlocks;
  return typeof f === "string" && f.trim() ? f.trim() : null;
}

/**
 * What looking for trouble is worth on the encounter throw: it eases the
 * throw, never shortens the interval. A party that WANTS trouble and has no
 * imported figure for it is flagged `unpriced`; keeping to yourself is the
 * absence of the modifier and is never unpriced.
 */
function intentBonus(intent) {
  if (!SETTLEMENT_INTENTS[intent]?.seeks) return { seeking: false, bonus: 0, unpriced: false };
  const figure = numOrNull(table("encounterIntent")?.trouble);
  return { seeking: true, bonus: figure ?? 0, unpriced: figure == null };
}

/**
 * The street's encounter cadence for where the party is and what time it is.
 *
 * Keyed `<where>` → `{day, night}` → `{everyTurns, throw}`. Returns null when
 * the table is absent; a caller must not fall back to the wilderness cadence.
 * What a Judge has drawn over the street answers first
 * (`resolveCityCadence`).
 */
export function streetCadence({ where = "avenue", night = false, intent = "ordinary" } = {}) {
  if (!SETTLEMENT_LOCATIONS[where]) return null;
  const row = table("encounters")?.[where];
  const cell = row?.[night ? "night" : "day"] ?? row?.any ?? null;
  if (!cell) return null;
  const everyTurns = Number(cell.everyTurns);
  const target = Number(cell.throw);
  if (!Number.isFinite(everyTurns) || !Number.isFinite(target)) return null;

  const intended = intentBonus(intent);
  return {
    everyTurns,
    target: target - intended.bonus,
    bareTarget: target,
    modifier: intended.bonus,
    seeking: intended.seeking,
    unpricedIntent: intended.unpriced,
    source: "street",
  };
}

/**
 * A stated override figure, or null for one left alone.
 *
 * The behaviour schemas initialise number fields to 0, so zero reads as
 * "inherit", never as "never" or "on a 0".
 */
function stated(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Which cadence this turn actually answers to.
 *
 * Precedence runs street → zone → district, innermost wins, and it is decided
 * PER FIELD: an override that states only an interval keeps the target beneath
 * it. The intent modifier is the PARTY's, so it is re-derived here from the
 * bare target of whichever layer answered. Null when no layer can price the
 * throw. See docs/formation/DECISIONS.md, "A zone in a city overrides interval,
 * target and table (2026-09-12)".
 *
 * @param {object|null} street       `streetCadence()`'s answer, or null when unimported
 * @param {object|null} [opts.zone]      an Encounter Zone behaviour's `system`
 * @param {object|null} [opts.district]  a District behaviour's `system`
 * @param {boolean} [opts.night]     picks the district's day or night pair
 * @param {string} [opts.intent]     what the party is doing about being noticed
 */
export function resolveCityCadence(street, { zone = null, district = null, night = false, intent = "ordinary" } = {}) {
  const layers = [];
  if (street) {
    layers.push({ everyTurns: street.everyTurns, bareTarget: street.bareTarget, source: "street" });
  }
  if (zone) {
    layers.push({
      everyTurns: stated(zone.encounterEvery),
      bareTarget: stated(zone.encounterTarget),
      source: "zone",
    });
  }
  if (district) {
    layers.push({
      everyTurns: stated(night ? district.encounterEveryNight : district.encounterEveryDay),
      bareTarget: stated(night ? district.encounterTargetNight : district.encounterTargetDay),
      source: "district",
    });
  }

  let everyTurns = null;
  let bareTarget = null;
  // ONE owner per figure: the interval and the target can come from different layers.
  let everyTurnsSource = null;
  let targetSource = null;
  for (const layer of layers) {
    if (layer.everyTurns != null) { everyTurns = layer.everyTurns; everyTurnsSource = layer.source; }
    if (layer.bareTarget != null) { bareTarget = layer.bareTarget; targetSource = layer.source; }
  }
  if (everyTurns == null || bareTarget == null) return null;

  const intended = intentBonus(intent);
  return {
    everyTurns,
    target: bareTarget - intended.bonus,
    bareTarget,
    modifier: intended.bonus,
    seeking: intended.seeking,
    unpricedIntent: intended.unpriced,
    everyTurnsSource,
    targetSource,
  };
}

/**
 * Which layer each half of the cadence came from, as a line for the Judge.
 * The one reader the panel and the turn card share; a split answer gets its
 * own sentence rather than one place-name over both figures.
 *
 * @param {object|null} cadence `resolveCityCadence()`'s answer, or an
 *   `encounterOwed` event, which carries the same two source fields
 * @param {object} names display name per layer, `{street, zone, district}`,
 *   supplied by the caller that can read them
 * @returns {{key: string, data: object}|null} a full lang key and its format
 *   data, or null when the street owns both figures and no line is owed
 */
export function cadenceAttribution(cadence, names = {}) {
  if (!cadence) return null;
  const byTurns = cadence.everyTurnsSource;
  const byTarget = cadence.targetSource;
  if (byTurns === "street" && byTarget === "street") return null;
  const turnsFrom = names[byTurns] || null;
  const targetFrom = names[byTarget] || null;
  if (byTurns === byTarget) {
    return turnsFrom
      ? {
        key: "ACKS-FORMATION.settlement.cadenceInside",
        data: { place: turnsFrom, turns: cadence.everyTurns, target: cadence.target },
      }
      : null;
  }
  // A half with no name to print cannot be attributed.
  if (!turnsFrom || !targetFrom) return null;
  return {
    key: "ACKS-FORMATION.settlement.cadenceSplit",
    data: { turns: cadence.everyTurns, turnsFrom, target: cadence.target, targetFrom },
  };
}

/**
 * Which table says what the street throws at them, picked innermost-first: a
 * district's wanted table when the party is hunted there, the district's
 * ordinary table, a zone's, the map's own city list, and otherwise the world's
 * own imported incident table.
 *
 * The whole ORDER is returned, not only its head, since a uuid can name a
 * document that no longer exists: `rollSettlementIncident` walks it to the
 * first table that EXISTS and reports that candidate's `source`. The last entry
 * is always the world's own table, which ends the walk.
 *
 * The map's city list (`city`) alone is `banded`: read by range with the map's
 * after-dark shift, carrying the band that defers to the quarter with the
 * quarter's special list and what THAT list adds after dark.
 *
 * @param {object} [opts]
 * @param {{tableUuid?: string, afterDark?: number, band?: {from: number, to: number}|null}|null} [opts.city]
 *   what the map says of its own list (`sceneIncidents`)
 * @returns {{tableUuid: string|null, source: string, candidates: Array<{tableUuid: string|null, source: string}>}}
 *   the first candidate, spread for callers that want only it, plus the
 *   ordered list. A null uuid means the world's own table.
 */
export function pickIncidentSource({ district = null, zone = null, wanted = false, city = null } = {}) {
  const candidates = [];
  if (wanted && district?.wantedTableUuid) candidates.push({ tableUuid: district.wantedTableUuid, source: "wanted" });
  if (district?.tableUuid) candidates.push({ tableUuid: district.tableUuid, source: "district" });
  if (zone?.tableUuid) candidates.push({ tableUuid: zone.tableUuid, source: "zone" });
  if (city?.tableUuid) {
    candidates.push({
      tableUuid: city.tableUuid,
      source: "map",
      banded: true,
      afterDark: numOrNull(city.afterDark) ?? 0,
      band: incidentBand(city.band?.from, city.band?.to),
      specialTableUuid: district?.specialTableUuid || null,
      specialAfterDark: numOrNull(district?.specialAfterDark) ?? 0,
    });
  }
  candidates.push({ tableUuid: null, source: "city" });
  return { ...candidates[0], candidates };
}

/** A shift as the panel prints it, the sign written out. */
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);

/**
 * Which list answers for the street here, as lines for the Judge: every list
 * named ahead of the answer that no longer exists, then the first list in
 * `pickIncidentSource`'s order that does, with what it adds after dark and
 * the band it hands to the quarter. The order is the one
 * `rollSettlementIncident` walks; a named list that exists is taken to
 * answer.
 *
 * @param {{candidates: object[]}|null} pick `pickIncidentSource()`'s answer
 * @param {(uuid: string) => string|null} nameOf a list's name, or null for one that does not exist
 * @returns {Array<{key: string, data: object, warn?: boolean}>} `key` names a
 *   string under the settlement lang block's lists family; `data.list`, on a
 *   `missing` line, is the source whose list is gone
 */
export function incidentRouting(pick, nameOf = () => null) {
  const lines = [];
  for (const c of pick?.candidates ?? []) {
    if (!c.tableUuid) {
      lines.push({ key: "world", data: {} });
      break;
    }
    const table = nameOf(c.tableUuid);
    if (table == null) {
      lines.push({ key: "missing", data: { list: c.source }, warn: true });
      continue;
    }
    if (!c.banded) {
      lines.push({ key: c.source, data: { table } });
      break;
    }
    lines.push({ key: c.afterDark ? "mapDark" : "map", data: { table, shift: signed(c.afterDark) } });
    if (c.band) {
      const special = c.specialTableUuid ? nameOf(c.specialTableUuid) : null;
      if (c.specialTableUuid && special == null) lines.push({ key: "specialMissing", data: {}, warn: true });
      lines.push(special == null
        ? { key: "bandNone", data: { ...c.band } }
        : {
          key: c.specialAfterDark ? "bandDark" : "band",
          data: { ...c.band, table: special, shift: signed(c.specialAfterDark) },
        });
    }
    break;
  }
  return lines;
}

/**
 * The stretch of a city list that defers to the quarter, as a pair of edges.
 *
 * Null unless both edges are stated and in order.
 * @returns {{from: number, to: number}|null}
 */
export function incidentBand(from, to) {
  const lo = numOrNull(from);
  const hi = numOrNull(to);
  if (lo == null || hi == null || lo < 1 || hi < lo) return null;
  return { from: lo, to: hi };
}

/**
 * What a district does to how the locals take the party, where they are. The
 * figure carries the place it applies to and is owed only when the party stands
 * there; `any` is the district-wide case. It is SIGNED and never passes through
 * `stated()`: 0 here means unremarkable, not "inherit". See
 * docs/formation/DECISIONS.md, "A district's reaction figure is signed, and
 * never inherits (2026-09-12)".
 *
 * @param {object|null} district a District behaviour's `system`
 * @param {string} [opts.where] the place the party is, in the board's vocabulary
 * @returns {{modifier: number, scope: string}|null} null when nothing is owed here
 */
export function districtReaction(district, { where = "avenue" } = {}) {
  if (!district) return null;
  const modifier = Number(district.reactionModifier);
  if (!Number.isFinite(modifier) || modifier === 0) return null;
  const scope = district.reactionWhere || "any";
  if (scope !== "any" && scope !== where) return null;
  return { modifier, scope };
}

/**
 * A day spent holed up, resolved.
 *
 * Holing up is the one settlement rate measured in DAYS rather than turns: the
 * party covers no ground and the street gets one chance at them a day. Pure,
 * like the turn: the caller owns the dice.
 */
export function advanceSettlementDays(board, { days = 1, rolls = [], cadence: given = null } = {}) {
  const s = settlementOf({ settlement: board });
  const spec = SETTLEMENT_LOCATIONS[s.where];
  if (!spec?.stationary) return { board: s, events: [{ kind: "notHoledUp", where: s.where }] };

  const n = Math.max(0, Math.floor(Number(days) || 0));
  // The caller may have resolved what a Judge drew over this spot.
  const cadence = given ?? streetCadence({ where: s.where, night: isNight(s), intent: s.intent });
  const next = { ...s, days: s.days + n };
  const events = [];
  if (!cadence) {
    if (n) events.push({ kind: "unpriced", what: "encounters" });
    return { board: next, events };
  }
  for (let d = 0; d < n; d++) {
    const owed = { kind: "encounterOwed", scale: "day", day: s.days + d + 1, target: cadence.target };
    const roll = rolls[d];
    if (roll != null) {
      owed.rolled = Number(roll);
      owed.met = owed.rolled >= cadence.target;
    }
    events.push(owed);
  }
  return { board: next, events };
}

/**
 * Which row of the settlement encounter table a roll lands on.
 *
 * The table is imported content; the procedure is one roll, a modifier after
 * dark, and the band it falls in. Returns null when unimported.
 */
export function settlementEncounter(roll, { night = false, rows: given = null } = {}) {
  // Rows may be handed in (the imported RollTable's), keeping this pure.
  const rows = given ?? table("encounters100");
  // The world's list names no quarter stretch, so nothing read here is `special`.
  return readIncident(roll, { night, afterDark: table("encounterAfterDark"), rows });
}

/**
 * A banded incident list, read the way a gazetteer reads its own: one roll, a
 * shift once it is dark, the row the total lands in — and, where the list has
 * a stretch that defers to the quarter the party is in, whether this total is
 * inside it.
 *
 * The shift and the band are the CALLER's, since they belong to whichever list
 * is being read. A total no row covers is an answer, not an error, and comes
 * back unmatched.
 *
 * @param {number} roll the die as thrown
 * @param {object} [opts]
 * @param {number|null} [opts.afterDark] added to the roll when `night`
 * @param {Array<{min: number, max: number, text: string}>} [opts.rows]
 * @param {{from: number, to: number}|null} [opts.band] the stretch that defers to the quarter
 * @returns {{roll: number, afterDark: number, total: number, entry: string|null, matched: boolean, special: boolean}|null}
 *   null when there are no rows to read or the roll is not a number
 */
export function readIncident(roll, { night = false, afterDark = 0, rows = null, band = null } = {}) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const base = Number(roll);
  if (!Number.isFinite(base)) return null;
  const after = night ? (numOrNull(afterDark) ?? 0) : 0;
  const total = base + after;
  const row = rows.find((r) => total >= Number(r.min) && total <= Number(r.max));
  const special = !!band && total >= band.from && total <= band.to;
  return { roll: base, afterDark: after, total, entry: row?.text ?? null, matched: !!row, special };
}

/**
 * One turn of city travel, resolved.
 *
 * Pure: it takes the board and the rolls, and returns the next board plus what
 * happened; the caller owns the dice and the chat card. The party MOVES, then
 * the street gets its chance.
 */
export function advanceSettlementTurn(board, {
  headcount = 1, navRoll = null, encounterRoll = null, cadence: given = null,
} = {}) {
  const s = settlementOf({ settlement: board });
  const spec = SETTLEMENT_LOCATIONS[s.where];
  const next = { ...s, turns: s.turns + 1 };
  const events = [];

  // --- movement ---
  const rate = spec?.stationary ? { blocks: 0 } : blocksPerTurn({ pace: s.pace, headcount });
  if (rate.blocks == null) {
    events.push({ kind: "unpriced", what: rate.missing });
  } else {
    next.blocks = s.blocks + rate.blocks;
  }

  // --- did they go the right way? ---
  // The navigation throw belongs to a journey, not to a party staying put.
  const nav = spec?.stationary
    ? { throws: false, reason: "stationary" }
    : citySpec({ pace: s.pace, route: s.route });
  if (nav.throws && nav.target != null && navRoll != null) {
    const total = Number(navRoll) + (nav.modifier ?? 0);
    const kept = total >= nav.target;
    next.lastThrow = { total, target: nav.target, kept };
    next.lost = !kept;
    if (!kept) {
      events.push({ kind: "strayed", blocks: strayBlocks() });
    }
  } else if (nav.throws && nav.target == null) {
    events.push({ kind: "unpriced", what: "navigation" });
  } else {
    next.lost = false;
  }

  // --- and did anything find them? ---
  // A stationary party is thrown for by the DAY (`advanceSettlementDays`), never
  // also by the turn. The caller hands in what a Judge drew over the street; the
  // bare street is the fallback for a caller with no canvas, and with no clock a
  // board following the clock reads as day.
  const cadence = spec?.stationary
    ? null
    : (given ?? streetCadence({ where: s.where, night: isNight(s), intent: s.intent }));
  if (spec?.stationary) {
    // Nothing owed: the day tick answers.
  } else if (!cadence) {
    events.push({ kind: "unpriced", what: "encounters" });
  } else if (next.turns % cadence.everyTurns === 0) {
    const owed = {
      kind: "encounterOwed", scale: "turn", target: cadence.target,
      everyTurns: cadence.everyTurns,
      // Which layer set each HALF of this cadence; the two can differ.
      everyTurnsSource: cadence.everyTurnsSource ?? "street",
      targetSource: cadence.targetSource ?? "street",
      ...(cadence.modifier ? { modifier: cadence.modifier, seeking: true } : {}),
      ...(cadence.unpricedIntent ? { unpricedIntent: true } : {}),
    };
    if (encounterRoll != null) {
      owed.rolled = Number(encounterRoll);
      owed.met = owed.rolled >= cadence.target;
    }
    events.push(owed);
  }

  return { board: next, events };
}

