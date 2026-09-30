/**
 * Whether a market is one a trader has been in before — the condition a
 * mercantile network's class shift hangs on (RR 43: the shift applies in a
 * market the venturer has previously entered). Foundry-free. Three signs,
 * any one enough: the market's ledger holds a row stamped to the trader
 * (they bought, sold, hired, entered or assessed there); the market holds a
 * venture row for the trader's party, whatever month (the party entered it);
 * or the Judge has listed the market on the trader (`knownMarkets`), which is
 * how a history older than the ledger's stamps is stated.
 * @param {{ledger?: {actorUuid?: string}[], ventures?: {partyId?: string}[], knownMarkets?: string[]}} state
 * @param {{actorUuid: string, partyId?: string, locationUuid: string}} who
 * @returns {boolean}
 */
export function marketKnownTo({ ledger = [], ventures = [], knownMarkets = [] } = {}, { actorUuid, partyId = null, locationUuid }) {
  if (!actorUuid) return false;
  if ((knownMarkets ?? []).includes(locationUuid)) return true;
  if ((ledger ?? []).some((row) => row?.actorUuid === actorUuid)) return true;
  return partyId != null && (ventures ?? []).some((v) => v?.partyId === partyId);
}
