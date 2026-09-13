/**
 * Settlement travel: crossing a city the way the party crosses country.
 *
 * A settlement is measured in BLOCKS, not feet — the distances are too short
 * for the expedition scale and too long for the dungeon turn — and the shape
 * of the rule is the wilderness journey in miniature: a pace decides how far a
 * turn carries you, a navigation throw decides whether you arrive where you
 * meant to, and where you are standing decides how often the street throws
 * something at you.
 *
 * Three structural facts and nothing else:
 *
 *  - **The paces.** Commuting is a walk with a destination; meandering is a
 *    walk with none. Only commuting can go wrong — a meandering pace reads the
 *    street signs it is already looking at, so it never throws.
 *  - **The route memory.** A route walked before is walked without a throw.
 *    A DESTINATION reached before by another way is easier but not free, and
 *    that partial credit is a modifier the registry prices.
 *  - **The straggle.** A large party moves worse through a crowd, in tiers.
 *    That the tiers EXIST and that they bite only the commuting pace is the
 *    rule; where each tier starts and what it costs is printed, and imported.
 *
 * Every number this file needs is read from the `settlement` registered
 * document (`expectTables`), and every reader here returns null with a stated
 * reason when the table is absent rather than guessing a distance.
 */
import { getDoc, hasDoc } from "../lib/tables.mjs";
import { numOrNull } from "../lib/util.mjs";

/**
 * The registered document these derivations read.
 *
 * `cityTravel`, NOT `settlement`: the henchmen feature already registers a
 * `settlement` document for market class by families, and a settlement in this
 * codebase means a PLACE where people live. Sharing the id would put two
 * unrelated features' tables in one document and make "is the settlement data
 * imported?" an ambiguous question.
 */
export const SETTLEMENT_DOC = "cityTravel";

/** World toggle for the book's optional straggling rules. Ships on. */
export const SETTING_STRAGGLING = "settlementStraggling";

/**
 * The die each settlement throw is made on.
 *
 * Not interchangeable, and named here so no two readers can drift apart: the
 * navigation throw is a d20 against a target the registry prices on that
 * scale, and the street's encounter throw is the d6 the wandering-monster
 * throw already uses, against a d6-scale cadence target. Rolling one against
 * the other's target changes how often the street answers while changing
 * nothing a Judge can see on the card.
 */
export const NAVIGATION_DIE = "1d20";
export const STREET_DIE = "1d6";

/** The d100 the city's own imported incident table is read with. */
export const INCIDENT_DIE = "1d100";

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
 * can lose its way and a meandering one cannot, whatever the printed target
 * turns out to be.
 */
export const SETTLEMENT_PACES = Object.freeze({
  commuting: { label: "ACKS-FORMATION.settlement.pace.commuting", throws: true, straggles: true },
  meandering: { label: "ACKS-FORMATION.settlement.pace.meandering", throws: false, straggles: false },
});

/**
 * Where the party is, which is what decides how often the street answers.
 * `holedUp` is not a place in the street at all — it is the party staying put,
 * and it keeps its own much slower cadence.
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
 * What the party is doing about being noticed.
 *
 * A structural choice with a printed price: making a nuisance of yourself
 * raises the encounter throw. Holing up is NOT here — that is a LOCATION, and
 * it changes the cadence rather than the target.
 */
export const SETTLEMENT_INTENTS = Object.freeze({
  ordinary: { label: "ACKS-FORMATION.settlement.intent.ordinary" },
  trouble: { label: "ACKS-FORMATION.settlement.intent.trouble", seeks: true },
});

/**
 * How the party is carried.
 *
 * Deliberately carries no rate: the rules say a litter or a wagon affords
 * privacy and is *not any faster*, so a conveyance that quietly changed the
 * block rate would be inventing a rule. It is a flag the Judge can see, and
 * the one thing it is good for — being unseen — is the Judge's call.
 */
export const CONVEYANCES = Object.freeze({
  onFoot: { label: "ACKS-FORMATION.settlement.conveyance.onFoot" },
  litter: { label: "ACKS-FORMATION.settlement.conveyance.litter", private: true },
  wagon: { label: "ACKS-FORMATION.settlement.conveyance.wagon", private: true },
});

/** A table read that answers null rather than a guess. */
function table(key) {
  if (!hasDoc(SETTLEMENT_DOC)) return null;
  const t = getDoc(SETTLEMENT_DOC)?.tables?.[key];
  // A registered table may be a bare figure — the after-dark shift on the
  // encounter roll is one number, not a row. Rejecting non-objects made every
  // such table read as "not imported", which is indistinguishable from a
  // Judge who has not imported it yet.
  return t == null ? null : t;
}

/** A world-time stamp, or null for anything that is not one. */
function stampOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** A fresh settlement board: on an avenue, by day, going nowhere in particular. */
export function freshSettlement() {
  return {
    pace: "meandering",
    where: "avenue",
    route: "unknown",
    night: false,
    intent: "ordinary",
    conveyance: "onFoot",
    /**
     * Is somebody in this settlement hunting this party? Picks a district's
     * wanted table over its ordinary one. Judge-told, and deliberately NOT
     * carried across re-entry: being hunted is a fact about one settlement's
     * own powers, and `reenterSettlement` cannot tell one settlement from
     * another, so a party arriving somewhere new arrives unhunted.
     */
    wanted: false,
    blocks: 0,
    turns: 0,
    days: 0,
    /**
     * World time, in seconds, that the current stay is counted from. Null
     * until the party is somewhere it stays put; the clock watcher stamps it
     * and moves it forward by the days it has already charged for.
     */
    holeUpSince: null,
    lost: false,
    lastThrow: null,
    /**
     * The road the party was standing on when the turn was taken, as the tick
     * read it off the map — `{name, surface, street}` — or null for a party on
     * no drawn street. A SNAPSHOT: what the map said then, not a second place
     * to edit the map.
     */
    road: null,
    /**
     * Was the last move counted ALONG the streets, or as the straight line
     * between its ends? Null until the party has moved. A city measured by the
     * chord charges a party that followed a curving street for the block it
     * went round, so which of the two happened is worth saying.
     */
    measuredAlong: null,
  };
}

/** Normalize whatever the record holds into the vocabulary above. */
export function settlementOf(travel) {
  const s = travel?.settlement ?? {};
  const fresh = freshSettlement();
  return {
    ...fresh,
    ...s,
    pace: SETTLEMENT_PACES[s.pace] ? s.pace : fresh.pace,
    where: SETTLEMENT_LOCATIONS[s.where] ? s.where : fresh.where,
    route: ROUTE_KNOWLEDGE[s.route] ? s.route : fresh.route,
    night: !!s.night,
    intent: SETTLEMENT_INTENTS[s.intent] ? s.intent : fresh.intent,
    conveyance: CONVEYANCES[s.conveyance] ? s.conveyance : fresh.conveyance,
    wanted: !!s.wanted,
    blocks: Number(s.blocks) || 0,
    turns: Number(s.turns) || 0,
    days: Number(s.days) || 0,
    // Nothing coerces to zero here: `Number(null)` and `Number("")` are both 0,
    // and a stay stamped at world time zero is a stay the clock watcher charges
    // every day since the world began for.
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
 * Where the party actually is, for the street's purposes — and which source
 * said so.
 *
 * Three answers, in order. A party holed up is holed up whatever it is standing
 * on: the room is the answer and the street outside is not. Otherwise the ROAD
 * under the token answers, because it was DRAWN while the picker was typed — a
 * Judge who drew an alley and left the picker on the avenue meant the alley, and
 * keeping the two in step by hand is the kind of bookkeeping the map exists to
 * end. With no drawn street underfoot the picker is all there is, which is every
 * city map until someone lays a road on it.
 *
 * @param {object} board the settlement board
 * @param {string|null} roadStreet the `street` of the road under the party
 * @returns {{where: string, from: "road"|"picker"}}
 */
export function effectiveWhere(board, roadStreet = null) {
  const s = settlementOf({ settlement: board });
  if (SETTLEMENT_LOCATIONS[s.where]?.stationary) return { where: s.where, from: "picker" };
  // `holedUp` is a picker answer and can never be read off a road: a wall
  // flagged as a street is a street, and nobody is hiding in it.
  if (roadStreet && SETTLEMENT_LOCATIONS[roadStreet] && !SETTLEMENT_LOCATIONS[roadStreet].stationary) {
    return { where: roadStreet, from: "road" };
  }
  return { where: s.where, from: "picker" };
}

/**
 * Carry a stay across a board write: a party that has moved is no longer on it.
 *
 * Every writer of the board passes through here, rather than each remembering
 * the rule, because a stale stamp is not a visible defect — a party that holed
 * up in spring and walked out in autumn is charged every day between the two
 * the moment it next stops somewhere, and only the card at the end says so.
 */
export function carryStay(previous, next) {
  return next?.where === previous?.where ? next : { ...next, holeUpSince: null };
}

/**
 * The board a party re-entering a city starts on.
 *
 * What the Judge TOLD the board stays — the pace, the streets, the route they
 * know, the hour, the intent, how they are carried — and what the last city
 * COUNTED goes: blocks, turns, days and the stay's stamp belong to the city
 * they were spent in, and carrying them makes a party arrive somewhere new
 * already a mile into it. Stepping out to the country and back therefore does
 * not forget the route, which is the whole reason the route is remembered at
 * all.
 */
export function reenterSettlement(previous) {
  const s = settlementOf({ settlement: previous });
  const fresh = freshSettlement();
  return {
    ...fresh,
    pace: s.pace,
    where: s.where,
    route: s.route,
    night: s.night,
    intent: s.intent,
    conveyance: s.conveyance,
  };
}

/**
 * Which straggling tier a party of this size falls in, or null for none.
 *
 * The tiers are a registered ladder — `[{from, multiplier}]` — because both
 * the headcount each starts at and what it costs are printed. The RULE here is
 * that the deepest tier whose threshold the party has reached is the one that
 * applies, and that splitting the party is the way out (each group then throws
 * for its own encounters, which is the cost of splitting).
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
 * Returns `{blocks, parts}` so the panel can show the derivation the way the
 * march readout does, or `{blocks: null, missing}` naming what was not
 * imported — a settlement with no imported rates has no distance, and saying
 * so is better than moving the party an invented number of blocks.
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
 * The bridge between the book's abstraction and a drawn map: the rules measure
 * a city in blocks because feet-per-turn in a village would be tedious, but a
 * party crossing a city SCENE moves in feet, and the tracker needs one currency
 * to convert. How big a block is belongs to the map, not to the book — a Judge
 * draws the blocks — so `blockFeet` is passed in by the scene rather than read
 * from the registry.
 *
 * Null feet with a stated `missing` when either half is unknown, so the caller
 * can time the party by its walking speed and SAY it is doing that, instead of
 * ticking against an invented block.
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
 * Structure only: a known route needs no throw at all; a known destination by
 * an unknown way earns a modifier; everything else throws bare. The target and
 * the modifier are the registry's, and an unimported table yields a null
 * target so the caller reports the gap instead of rolling against nothing.
 */
export function citySpec({ pace = "commuting", route = "unknown" } = {}) {
  const spec = SETTLEMENT_PACES[pace];
  if (!spec) return { throws: false, reason: "pace" };
  if (!spec.throws) return { throws: false, reason: "pace" };
  if (ROUTE_KNOWLEDGE[route]?.certain) return { throws: false, reason: "route" };
  const nav = table("navigation");
  const target = Number(nav?.target);
  if (!Number.isFinite(target)) return { throws: true, target: null, missing: "navigation" };
  // The target and the known-destination modifier are read from separate
  // sentences, so one can arrive without the other. A party that has been
  // there before and has no imported figure for it is TOLD, rather than
  // quietly throwing at the bare target — the same contract the intent
  // modifier keeps, and for the same reason: an imported zero and a figure
  // that never came look identical on the panel.
  if (route !== "destination") return { throws: true, target, modifier: 0 };
  const known = numOrNull(nav?.knownDestination);
  return { throws: true, target, modifier: known ?? 0, unpricedRoute: known == null };
}

/**
 * How far off a lost turn puts the party, as a dice expression from the
 * registry. Null when unimported — the party is lost, and by how much is a
 * printed figure the Judge's own book supplies.
 */
export function strayBlocks() {
  const f = table("navigation")?.strayBlocks;
  return typeof f === "string" && f.trim() ? f.trim() : null;
}

/**
 * What looking for trouble is worth on the encounter throw.
 *
 * Looking for trouble does not come round more often — it succeeds more
 * easily. The size of that is printed; that it eases the throw rather than
 * shortening the interval is the rule, and lives here. A party that WANTS
 * trouble and has no imported figure for it is told, rather than quietly
 * throwing at the ordinary target.
 *
 * Keeping to yourself is the absence of the modifier, not a modifier of zero:
 * it is never unpriced, whatever the registry holds.
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
 * the table is absent; a caller must not fall back to the wilderness cadence,
 * which is a different rule at a different scale.
 *
 * The street is the OUTERMOST layer: what a Judge has drawn over it answers
 * first, and `resolveCityCadence` is where the two are put in order.
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
 * The behaviour schemas initialise their number fields to 0 and a Judge who
 * leaves a box alone means the layer beneath to answer, so zero reads as
 * "inherit" and never as "never" or "on a 0".
 */
function stated(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Which cadence this turn actually answers to.
 *
 * A city is not one uniform crowd: a Judge draws an Encounter Zone over the
 * harbour, or a district over the thieves' quarter, and expects the streets
 * inside it to keep their own time — the same override the delve clock already
 * honours, at the city's scale. Precedence runs street → zone → district,
 * innermost wins, and it is decided PER FIELD: an override that states only an
 * interval keeps the target beneath it, so a Judge never has to restate what
 * they did not mean to change.
 *
 * The intent modifier is the PARTY's and not the place's, so it is re-derived
 * here from the bare target of whichever layer answered rather than inherited
 * from the street's already-adjusted figure.
 *
 * Null when no layer can price the throw at all — the caller reports the gap.
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
  // ONE owner per figure, not one owner for the pair. Per-field inheritance
  // means the interval and the target can come from different layers, and a
  // single name over both credits one layer with the other's number.
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
 *
 * Named ONCE, because the panel and the turn card have to say the same thing
 * and they are the two surfaces in this feature that have already drifted. A
 * split answer gets its own sentence rather than one place-name over both
 * figures: a zone that states only an interval, inside a district that states
 * only a target, is the DESIGNED use of per-field inheritance, and one name
 * there prints one layer's figure under the other layer's name.
 *
 * @param {object|null} cadence `resolveCityCadence()`'s answer, or an
 *   `encounterOwed` event, which carries the same two source fields
 * @param {object} names display name per layer — `{street, zone, district}`.
 *   The region names are the Judge's own and the street's is a localized word,
 *   so all three come from the caller that can read them.
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
  // A half with no name to print cannot be attributed, and an unattributed
  // figure is worse than an unmentioned one.
  if (!turnsFrom || !targetFrom) return null;
  return {
    key: "ACKS-FORMATION.settlement.cadenceSplit",
    data: { turns: cadence.everyTurns, turnsFrom, target: cadence.target, targetFrom },
  };
}

/**
 * Which table says what the street throws at them.
 *
 * The cadence decides WHETHER something finds the party; this decides WHAT.
 * They are separate questions and a Judge answers them separately — a zone may
 * change how often the harbour is busy without changing who is on it — so the
 * table is picked innermost-first on its own: a district's wanted table when
 * the party is being hunted there, then the district's ordinary table, then a
 * zone's, and otherwise the city's own imported incident table.
 *
 * @returns {{tableUuid: string|null, source: string}} a null uuid means the city's own table
 */
export function pickIncidentSource({ district = null, zone = null, wanted = false } = {}) {
  if (wanted && district?.wantedTableUuid) return { tableUuid: district.wantedTableUuid, source: "wanted" };
  if (district?.tableUuid) return { tableUuid: district.tableUuid, source: "district" };
  if (zone?.tableUuid) return { tableUuid: zone.tableUuid, source: "zone" };
  return { tableUuid: null, source: "city" };
}

/**
 * What a district does to how the locals take the party, where they are.
 *
 * A quarter's reputation is not uniform inside it — a gazetteer states the
 * unwelcome as something that happens in the alleyways rather than on the
 * avenue — so the figure carries the place it applies to and is only owed when
 * the party is standing there. `any` is the district-wide case.
 *
 * The figure is SIGNED and never passes through `stated()`: 0 here means "this
 * quarter is unremarkable", where 0 on a cadence field means "inherit the layer
 * outside me", and `stated()` also rejects the negative that is the whole point
 * of this field.
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
 * Holing up is the one settlement rate measured in DAYS rather than turns, so
 * it gets its own tick: the party covers no ground, and the street is given
 * exactly one chance at them. Advancing turn by turn through a week of study
 * would be twenty-four hours of ticks a day to reach the same throw.
 *
 * Pure, like the turn: the caller owns the dice.
 */
export function advanceSettlementDays(board, { days = 1, rolls = [], cadence: given = null } = {}) {
  const s = settlementOf({ settlement: board });
  const spec = SETTLEMENT_LOCATIONS[s.where];
  if (!spec?.stationary) return { board: s, events: [{ kind: "notHoledUp", where: s.where }] };

  const n = Math.max(0, Math.floor(Number(days) || 0));
  // The caller may have resolved what a Judge drew over this spot; a party
  // hiding inside a zone hides at the cadence the zone keeps.
  const cadence = given ?? streetCadence({ where: s.where, night: s.night, intent: s.intent });
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
 * The table itself is written content and can only arrive by import — but the
 * PROCEDURE ships: one d100, a modifier after dark, and the band it falls in.
 * Returns null when unimported so a caller reports the gap rather than
 * inventing an incident.
 */
export function settlementEncounter(roll, { night = false, rows: given = null } = {}) {
  // Rows may be HANDED IN — the incident list usually arrives as a Foundry
  // RollTable rather than as ruledata, and this stays pure by being told about
  // it rather than going looking. A world that authored the table by hand
  // supplies it through the registry instead, and both read the same way.
  const rows = given ?? table("encounters100");
  if (!Array.isArray(rows) || !rows.length) return null;
  const base = Number(roll);
  if (!Number.isFinite(base)) return null;
  const after = night ? (numOrNull(table("encounterAfterDark")) ?? 0) : 0;
  const total = base + after;
  const row = rows.find((r) => total >= Number(r.min) && total <= Number(r.max));
  return { roll: base, afterDark: after, total, entry: row?.text ?? null, matched: !!row };
}

/**
 * One turn of city travel, resolved.
 *
 * The board's `blocks`, `turns`, `lost` and `lastThrow` exist for this: without
 * a tick they are fields nothing reads, which is the same defect as a schema a
 * Judge cannot populate.
 *
 * Pure — it takes the board and a roll, and returns the next board plus what
 * happened. The caller owns the dice and the chat card, so the sequence can be
 * tested without a world.
 *
 * Order matters: the party MOVES, then the street gets its chance. A turn spent
 * walking into an alley is a turn the alley can answer for.
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
  // A party that is staying put is not going anywhere to go wrong: the throw
  // belongs to a journey across the city, not to the ten minutes it spends in
  // the room it is hiding in.
  const nav = spec?.stationary
    ? { throws: false, reason: "stationary" }
    : citySpec({ pace: s.pace, route: s.route });
  if (nav.throws && nav.target != null && navRoll != null) {
    const total = Number(navRoll) + (nav.modifier ?? 0);
    const kept = total >= nav.target;
    next.lastThrow = { total, target: nav.target, kept };
    next.lost = !kept;
    if (!kept) {
      // Lost in a city is not lost in the wild: the party ends the turn a
      // short way from where it meant to be, and knows it at once.
      events.push({ kind: "strayed", blocks: strayBlocks() });
    }
  } else if (nav.throws && nav.target == null) {
    events.push({ kind: "unpriced", what: "navigation" });
  } else {
    next.lost = false;
  }

  // --- and did anything find them? ---
  // A party that is not going anywhere is thrown for by the DAY, and
  // `advanceSettlementDays` owns that throw. Counting the same stay in turns
  // as well would give a holed-up party two chances at the same interruption.
  // The caller resolves what a Judge has drawn over the street and hands the
  // answer in; the bare street is the fallback for a caller that has no canvas
  // to ask, which is every test and every headless read.
  const cadence = spec?.stationary
    ? null
    : (given ?? streetCadence({ where: s.where, night: s.night, intent: s.intent }));
  if (spec?.stationary) {
    // Nothing owed and nothing missing: the day tick is the one that answers.
  } else if (!cadence) {
    events.push({ kind: "unpriced", what: "encounters" });
  } else if (next.turns % cadence.everyTurns === 0) {
    const owed = {
      kind: "encounterOwed", scale: "turn", target: cadence.target,
      everyTurns: cadence.everyTurns,
      // Which layer set each HALF of this cadence, so the card can name what a
      // Judge drew rather than leaving an unexplained change of rhythm on the
      // street. Both, because the two halves can have different owners.
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

