/**
 * Whether a market is one a trader has been in before — the condition a
 * mercantile network hangs on (RR ch. 2, Mercantile Network; RR ch. 8,
 * Entering the Market, Mercantile Networks). Foundry-free; the day a world
 * time falls on is handed in as `dayOf`.
 *
 * The current visit never counts itself: a sign counts only when its day falls
 * before the day the current visit began (`visitStartDay`). The signs: a ledger
 * row stamped to the trader (they bought, sold, hired, entered or assessed
 * there); a venture day the trader posted, or an entry their party posted; a
 * venture row for the party from an earlier month; or the Judge's list on the
 * trader (`knownMarkets`), which is undated and stands for a history older
 * than the record. Venture days and venture rows are never pruned, so they are
 * the durable half of the record: never prune them without moving that
 * evidence somewhere else.
 */

/**
 * The day the trader's current visit began. A party entered this month is on
 * the visit its entry opened: the day the entry was posted (`enteredTime`), or
 * on a row written before that was stored, the party's latest entry posted this
 * month, else the month's start. A party not entered is on a visit of one day,
 * the day of `at`.
 * @param {{ventures?: object[], actions?: object[], partyId?: string|null, monthStart: number, at: number, dayOf: (t: number) => number}} state
 * @returns {number}
 */
export function visitStartDay({ ventures = [], actions = [], partyId = null, monthStart, at, dayOf }) {
  const row = partyId == null ? null : (ventures ?? []).find((v) => v?.partyId === partyId && Number(v.monthStartTime) === Number(monthStart));
  if (!row?.entered) return dayOf(at);
  if (Number(row.enteredTime) > 0) return dayOf(Number(row.enteredTime));
  const entries = (actions ?? []).filter(
    (a) => a?.kind === "enter" && a.partyId === partyId && a.status !== "cancelled" && Number(a.postedTime) >= Number(monthStart)
  );
  if (entries.length) return dayOf(Math.max(...entries.map((a) => Number(a.postedTime))));
  return dayOf(Number(row.monthStartTime));
}

/**
 * Where a trader's knowledge of a market comes from: `"judge"` (the Judge's
 * list), `"record"` (a sign dated before the current visit), or null.
 * @param {{ledger?: {actorUuid?: string, time?: number}[], actions?: {kind?: string, actorUuid?: string, partyId?: string, postedTime?: number}[], ventures?: {partyId?: string, monthStartTime?: number}[], knownMarkets?: string[]}} state
 * @param {{actorUuid: string, partyId?: string|null, locationUuid: string}} who
 * @param {{visitStartDay: number, monthStart: number, dayOf: (t: number) => number}} when
 * @returns {"judge"|"record"|null}
 */
export function knownSource({ ledger = [], actions = [], ventures = [], knownMarkets = [] } = {}, { actorUuid, partyId = null, locationUuid }, { visitStartDay: start, monthStart, dayOf }) {
  if (!actorUuid) return null;
  if ((knownMarkets ?? []).includes(locationUuid)) return "judge";
  const before = (t) => Number.isFinite(Number(t)) && dayOf(Number(t)) < start;
  if ((ledger ?? []).some((row) => row?.actorUuid === actorUuid && before(row.time))) return "record";
  const ours = (a) => a?.actorUuid === actorUuid || (partyId != null && a?.kind === "enter" && a.partyId === partyId);
  if ((actions ?? []).some((a) => ours(a) && before(a.postedTime))) return "record";
  if (partyId != null && (ventures ?? []).some((v) => v?.partyId === partyId && Number(v.monthStartTime) < Number(monthStart))) return "record";
  return null;
}

/** Has the trader been in this market before the current visit? `knownSource` as a yes or no. */
export function marketKnownTo(state, who, when) {
  return knownSource(state, who, when) !== null;
}
