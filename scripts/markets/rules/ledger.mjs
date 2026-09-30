/**
 * A trader's own trade history, read out of the markets' ledgers (each
 * location's `marketLog`). Foundry-free. A row is the market's record of one
 * thing that happened there; the rows about a given actor, across the markets
 * that hold them, are that actor's history. Nothing is written here: the
 * ledger is append-only and the engine stamps `actorUuid` (and the actor's
 * signed coin movement, `gp`) as it writes.
 */

/** The row types a trader's history shows; every other ledger row is the market's own business. */
export const HISTORY_TYPES = Object.freeze([
  "purchase",
  "sale",
  "importOrder",
  "importArrived",
  "importLost",
  "commission",
  "commissionDone",
  "search",
  "searchFound",
  "extraSearch",
  "ventureAction",
  "ventureCancelled",
  "ventureEntered",
  "ventureLeft",
  "ventureAssessed",
  "ventureSolicited",
  "ventureTrade",
  "ventureFailed",
]);

/**
 * The rows about the given actors, newest first, capped.
 * @param {Array<{marketUuid:string, marketName:string, rows:object[]}>} ledgers - one per market
 * @param {object} o
 * @param {string[]} o.actorUuids - whose rows
 * @param {number} [o.limit]
 * @returns {Array<{time:number, type:string, note:string, gp:number, actorUuid:string, marketUuid:string, marketName:string}>}
 */
export function historyRows(ledgers, { actorUuids = [], limit = 60 } = {}) {
  const who = new Set(actorUuids.filter(Boolean));
  if (!who.size) return [];
  const out = [];
  for (const { marketUuid, marketName, rows } of ledgers ?? []) {
    for (const row of rows ?? []) {
      if (!row?.actorUuid || !who.has(row.actorUuid) || !HISTORY_TYPES.includes(row.type)) continue;
      out.push({
        time: Number(row.time) || 0,
        type: row.type,
        note: String(row.note ?? ""),
        gp: Number(row.gp) || 0,
        actorUuid: row.actorUuid,
        marketUuid,
        marketName,
      });
    }
  }
  out.sort((a, b) => b.time - a.time);
  return out.slice(0, Math.max(0, limit));
}

/** The net coin movement of a history, as the trader saw it (paid negative). */
export const historyNetGp = (rows) => (rows ?? []).reduce((sum, r) => sum + (Number(r.gp) || 0), 0);
