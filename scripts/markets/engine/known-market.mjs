/* global game */
/**
 * Known markets: whether a trader has been in a market before the current
 * visit, read the way `rules/known.mjs` decides it — the market's ledger
 * stamps, its venture days and venture rows, and the Judge's list on the
 * trader, each dated by the calendar day (`lib/world-time.mjs`
 * `dayOfWorldTime`). The henchmen feature's `effectiveMarketClass` asks
 * `marketKnownTo` through the api at call time, so a mercantile network's
 * shift applies only where the rule says it does; the Trade tab shows the
 * answer and lets the Judge state it.
 */
import { MODULE_ID } from "../constants.mjs";
import { knownSource as knownRule, visitStartDay as visitRule } from "../rules/known.mjs";
import { dayOfWorldTime } from "../../lib/world-time.mjs";
import { now } from "../../henchmen/time.mjs";
import { partyOf } from "./parties.mjs";
import { marketMonthStart } from "./trade.mjs";

const FLAG = "markets";

/** The Judge's list of markets known to this actor (location uuids). */
export function knownMarketsOf(actor) {
  const list = actor?.getFlag?.(MODULE_ID, FLAG)?.knownMarkets;
  return Array.isArray(list) ? list : [];
}

/** The record a market keeps, plain, for the pure rule. */
function recordOf(location) {
  const market = location.system.market;
  return {
    ledger: market.marketLog ?? [],
    actions: market.goods?.actions ?? [],
    ventures: market.goods?.ventures ?? [],
  };
}

/**
 * Where this actor's knowledge of this market comes from: `"judge"`,
 * `"record"`, or null. `at` is the moment asked about (now by default);
 * `visitStartDay` overrides the day the current visit began, for a sweep
 * resolving a day posted earlier.
 * @param {Actor} location
 * @param {Actor} actor
 * @param {{at?: number, visitStartDay?: number|null}} [options]
 * @returns {"judge"|"record"|null}
 */
export function knownSource(location, actor, { at = now(), visitStartDay = null } = {}) {
  if (!location || !actor || !location.system?.market) return null;
  const record = recordOf(location);
  const partyId = partyOf(actor).id;
  const monthStart = marketMonthStart(at);
  const start = visitStartDay ?? visitRule({ ventures: record.ventures, actions: record.actions, partyId, monthStart, at, dayOf: dayOfWorldTime });
  return knownRule(
    { ...record, knownMarkets: knownMarketsOf(actor) },
    { actorUuid: actor.uuid, partyId, locationUuid: location.uuid },
    { visitStartDay: start, monthStart, dayOf: dayOfWorldTime }
  );
}

/** Had this actor been in this market before the current visit? Options as `knownSource`. */
export function marketKnownTo(location, actor, options = {}) {
  return knownSource(location, actor, options) !== null;
}

/** The Judge lists or delists a market on the trader. Writes the actor's flag; a Judge seat only. */
export async function setMarketKnown(actor, location, known) {
  if (!game.user?.isGM) return { error: "gmOnly" };
  const list = knownMarketsOf(actor).filter((u) => u !== location.uuid);
  if (known) list.push(location.uuid);
  await actor.setFlag(MODULE_ID, FLAG, { ...(actor.getFlag(MODULE_ID, FLAG) ?? {}), knownMarkets: list });
  return { ok: true, known: !!known };
}
