/* global game */
/**
 * Known markets: whether a trader has been in a market before, read the way
 * `rules/known.mjs` decides it — the market's ledger stamps, its venture rows
 * for the trader's party, and the Judge's list on the trader. The henchmen
 * feature's `effectiveMarketClass` asks `marketKnownTo` through the api at
 * call time, so a mercantile network's shift applies only where the rule
 * says it does; the Trade tab shows the answer and lets the Judge set it.
 */
import { MODULE_ID } from "../constants.mjs";
import { marketKnownTo as knownRule } from "../rules/known.mjs";
import { partyOf } from "./parties.mjs";

const FLAG = "markets";

/** The Judge's list of markets known to this actor (location uuids). */
export function knownMarketsOf(actor) {
  const list = actor?.getFlag?.(MODULE_ID, FLAG)?.knownMarkets;
  return Array.isArray(list) ? list : [];
}

/** Has this actor been in this market before? */
export function marketKnownTo(location, actor) {
  if (!location || !actor) return false;
  const market = location.system?.market;
  if (!market) return false;
  return knownRule(
    { ledger: market.marketLog ?? [], ventures: market.goods?.ventures ?? [], knownMarkets: knownMarketsOf(actor) },
    { actorUuid: actor.uuid, partyId: partyOf(actor).id, locationUuid: location.uuid }
  );
}

/** The Judge lists or delists a market on the trader. Writes the actor's flag; a Judge seat only. */
export async function setMarketKnown(actor, location, known) {
  if (!game.user?.isGM) return { error: "gmOnly" };
  const list = knownMarketsOf(actor).filter((u) => u !== location.uuid);
  if (known) list.push(location.uuid);
  await actor.setFlag(MODULE_ID, FLAG, { ...(actor.getFlag(MODULE_ID, FLAG) ?? {}), knownMarkets: list });
  return { ok: true, known: !!known };
}
