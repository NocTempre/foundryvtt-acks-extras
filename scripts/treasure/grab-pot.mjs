/**
 * What a Quick grab reads off a pot and the party, Foundry-free: which party a
 * pot answers to, the lots a pot offers, who may start a grab, how a coin
 * card splits into a share, and the party's pace as the window states it. The
 * planner itself is `grab-logic.mjs`; the relay (`pot-relay.mjs`) runs both.
 */
import { REFUSAL, PHASE } from "./constants.mjs";
import { normalizeTruth, potCards } from "./pot-logic.mjs";

/**
 * The party a pot answers to: the one its flag names while the roster still
 * lists it, else the only party the world has, else none. Read the same way
 * on every client and on the Judge's, so the window and the relay agree.
 * @param {{partyId: string|null}} pot a normalized pot
 * @param {{id: string}[]} parties the roster's `list()`
 * @returns {string|null}
 */
export function resolveParty(pot, parties) {
  const listed = (Array.isArray(parties) ? parties : []).map((p) => p?.id).filter((id) => typeof id === "string" && id);
  if (pot?.partyId && listed.includes(pot.partyId)) return pot.partyId;
  return listed.length === 1 ? listed[0] : null;
}

/**
 * The pot's lots for the planner: every turned, unclaimed card in `order`, in
 * the pot's order. A coin card's lot carries its coin row, and its weight is
 * the whole stack's.
 * @param {{pot: object, cards: object[]}} view a `PotView`
 * @returns {{id: string, weight6: number, coin: {name: string, cv: number, count: number}|null}[]}
 */
export function grabLots(view) {
  return potCards(view)
    .filter((c) => c.face !== null && c.face !== undefined && !c.truth.claimedBy)
    .map((c) => ({ id: c.id, weight6: c.truth.weight6, coin: c.truth.coin ? { ...c.truth.coin } : null }));
}

/**
 * Whether `sender` may start a grab on this pot and what it would plan over.
 * The pot must be open and the sender the Judge or a seat the pot opened to,
 * the same seats that may take a card; a grab is not limited to characters the
 * sender owns, since it shares the pot across the party.
 * @returns {{ok: true, lots: object[]}|{ok: false, reason: string}}
 */
export function planGrabStart(view, { sender }) {
  if (!view) return { ok: false, reason: REFUSAL.noPot };
  if (view.pot.phase !== PHASE.open) return { ok: false, reason: REFUSAL.phase };
  if (!sender?.isGM && !view.pot.audience.includes(sender?.id)) return { ok: false, reason: REFUSAL.notAllowed };
  const lots = grabLots(view);
  if (!lots.length) return { ok: false, reason: REFUSAL.nothingToGrab };
  return { ok: true, lots };
}

/**
 * A coin truth split into a share of `take` coins and what is left, by whole
 * coins: the share weighs its coins' part of the stack, the rest weighs what
 * remains, so counts and weights add back to the stack's. Null where the truth
 * is no coin, or `take` is not between none and the whole stack.
 * @param {object} truth a normalized truth
 * @param {number} take
 * @param {{text?: (count: number) => string}} [opts] words a count for the label
 * @returns {{taken: object, rest: object}|null}
 */
export function splitCoin(truth, take, { text = String } = {}) {
  const count = truth?.coin?.count ?? 0;
  const k = Math.floor(Number(take));
  if (!truth?.coin || !(k > 0) || k >= count) return null;
  const part = (n, weight6) => normalizeTruth({ ...truth, weight6, coin: { ...truth.coin, count: n }, label: `${text(n)} ${truth.coin.name}` });
  const taken = part(k, (truth.weight6 / count) * k);
  return { taken, rest: part(count - k, Math.max(0, truth.weight6 - taken.weight6)) };
}

/**
 * Feet per turn from the roster's `rank`, which the contract defines as the
 * speed's negative; null where the planner or the roster gave no figure.
 */
export const speedOfRank = (rank) => (Number.isFinite(rank) ? 0 - rank : null);

/**
 * The party's pace: its slowest counted member's speed. `speeds` holds one
 * entry per member, null for a member who is not counted (a casualty, one who
 * carries nothing, one with no figure).
 * @param {(number|null)[]} speeds
 * @returns {number|null} null where nobody is counted
 */
export function slowestSpeed(speeds) {
  const counted = (speeds ?? []).filter((s) => Number.isFinite(s));
  return counted.length ? Math.min(...counted) : null;
}
