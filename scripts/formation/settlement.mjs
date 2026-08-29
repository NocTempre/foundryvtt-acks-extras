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

/** A table read that answers null rather than a guess. */
function table(key) {
  if (!hasDoc(SETTLEMENT_DOC)) return null;
  const t = getDoc(SETTLEMENT_DOC)?.tables?.[key];
  return t && typeof t === "object" ? t : null;
}

/** A fresh settlement board: on an avenue, by day, going nowhere in particular. */
export function freshSettlement() {
  return {
    pace: "meandering",
    where: "avenue",
    route: "unknown",
    night: false,
    blocks: 0,
    turns: 0,
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
    blocks: Number(s.blocks) || 0,
    turns: Number(s.turns) || 0,
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
export function streetCadence({ where = "avenue", night = false } = {}) {
  if (!SETTLEMENT_LOCATIONS[where]) return null;
  const row = table("encounters")?.[where];
  const cell = row?.[night ? "night" : "day"] ?? row?.any ?? null;
  if (!cell) return null;
  const everyTurns = Number(cell.everyTurns);
  const target = Number(cell.throw);
  if (!Number.isFinite(everyTurns) || !Number.isFinite(target)) return null;
  return { everyTurns, target };
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
  const cadence = streetCadence({ where: s.where, night: s.night });
  if (!cadence) {
    events.push({ kind: "unpriced", what: "encounters" });
  } else if (next.turns % cadence.everyTurns === 0) {
    const owed = { kind: "encounterOwed", target: cadence.target };
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
