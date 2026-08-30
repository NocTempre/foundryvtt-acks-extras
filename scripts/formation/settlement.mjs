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

/** A fresh settlement board: on an avenue, by day, going nowhere in particular. */
export function freshSettlement() {
  return {
    pace: "meandering",
    where: "avenue",
    route: "unknown",
    night: false,
    intent: "ordinary",
    conveyance: "onFoot",
    blocks: 0,
    turns: 0,
    days: 0,
    /** How long a stay the Judge has queued up. A control's value, not a tally. */
    holeUpDays: 1,
    lost: false,
    lastThrow: null,
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
    blocks: Number(s.blocks) || 0,
    turns: Number(s.turns) || 0,
    days: Number(s.days) || 0,
    holeUpDays: Math.min(30, Math.max(1, Math.floor(Number(s.holeUpDays) || 1))),
    lost: !!s.lost,
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
  const bonus = route === "destination" ? Number(nav?.knownDestination) : 0;
  return { throws: true, target, modifier: Number.isFinite(bonus) ? bonus : 0 };
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
 * The street's encounter cadence for where the party is and what time it is.
 *
 * Keyed `<where>` → `{day, night}` → `{everyTurns, throw}`. Returns null when
 * the table is absent; a caller must not fall back to the wilderness cadence,
 * which is a different rule at a different scale.
 */
export function streetCadence({ where = "avenue", night = false, intent = "ordinary" } = {}) {
  if (!SETTLEMENT_LOCATIONS[where]) return null;
  const row = table("encounters")?.[where];
  const cell = row?.[night ? "night" : "day"] ?? row?.any ?? null;
  if (!cell) return null;
  const everyTurns = Number(cell.everyTurns);
  const target = Number(cell.throw);
  if (!Number.isFinite(everyTurns) || !Number.isFinite(target)) return null;

  // Looking for trouble does not come round more often — it succeeds more
  // easily. The size of that is printed; that it eases the throw rather than
  // shortening the interval is the rule, and lives here.
  const seeking = !!SETTLEMENT_INTENTS[intent]?.seeks;
  const bonus = seeking ? (numOrNull(table("encounterIntent")?.trouble) ?? 0) : 0;
  return {
    everyTurns,
    target: target - bonus,
    bareTarget: target,
    modifier: bonus,
    seeking,
    // A party that WANTS trouble and has no imported figure for it is told,
    // rather than quietly throwing at the ordinary target.
    unpricedIntent: seeking && numOrNull(table("encounterIntent")?.trouble) == null,
  };
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
export function advanceSettlementDays(board, { days = 1, rolls = [] } = {}) {
  const s = settlementOf({ settlement: board });
  const spec = SETTLEMENT_LOCATIONS[s.where];
  if (!spec?.stationary) return { board: s, events: [{ kind: "notHoledUp", where: s.where }] };

  const n = Math.max(0, Math.floor(Number(days) || 0));
  const cadence = streetCadence({ where: s.where, night: s.night, intent: s.intent });
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
export function settlementEncounter(roll, { night = false } = {}) {
  const rows = table("encounters100");
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
  headcount = 1, navRoll = null, encounterRoll = null,
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
  const nav = citySpec({ pace: s.pace, route: s.route });
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
  const cadence = streetCadence({ where: s.where, night: s.night, intent: s.intent });
  if (!cadence) {
    events.push({ kind: "unpriced", what: "encounters" });
  } else if (next.turns % cadence.everyTurns === 0) {
    const owed = {
      kind: "encounterOwed", scale: "turn", target: cadence.target,
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

/** True once the registry can price a settlement at all. */
export function settlementReady() {
  return !!table("paces");
}
