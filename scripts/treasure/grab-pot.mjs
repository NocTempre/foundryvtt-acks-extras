/**
 * What a Quick grab reads off a pot and the party, Foundry-free: which party a
 * pot answers to, the lots a pot offers, who may start a grab, how a coin
 * card splits into a share, and the party's pace as the window states it. The
 * planner itself is `grab-logic.mjs`; the relay (`pot-relay.mjs`) runs both.
 */
import { REFUSAL, PHASE } from "./constants.mjs";
import { isFound, normalizeTruth, potCards } from "./pot-logic.mjs";

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

const offered = (view) => potCards(view).filter((c) => isFound(c) && c.face !== null && c.face !== undefined && !c.truth.claimedBy);

/** A value card: worth only, delivered as minted coin (`deliverTruth`), not a coin stack and no goods. */
const isValueCard = (truth) => !truth.coin && truth.valueGp != null;

/**
 * The distinct worths of the value cards the pot offers a grab, which is what
 * the caller weighs as coin before planning (`grabLots`' `valueWeight6`).
 * @param {{pot: object, cards: object[]}} view a `PotView`
 * @returns {number[]}
 */
export const valueGpsOf = (view) => [...new Set(offered(view).filter((c) => isValueCard(c.truth)).map((c) => c.truth.valueGp))];

/**
 * The pot's lots for the planner: every turned, unclaimed card in `order`, in
 * the pot's order. A coin card's lot carries its coin row, and its weight is
 * the whole stack's. A value card is delivered as coin, so its lot weighs what
 * that coin does when `valueWeight6` states it, and the card's own weight when
 * it answers null or is not given. The lot keeps no coin row: it is one whole
 * lot, never split.
 * @param {{pot: object, cards: object[]}} view a `PotView`
 * @param {{valueWeight6?: (valueGp: number) => number|null}} [opts]
 * @returns {{id: string, weight6: number, coin: {name: string, cv: number, count: number}|null}[]}
 */
export function grabLots(view, { valueWeight6 = null } = {}) {
  return offered(view).map((c) => {
    const { truth } = c;
    const minted = valueWeight6 && isValueCard(truth) ? valueWeight6(truth.valueGp) : null;
    return { id: c.id, weight6: Number.isFinite(minted) ? minted : truth.weight6, coin: truth.coin ? { ...truth.coin } : null };
  });
}

/**
 * Whether a seat owns any member of the party, by the caller's ownership test.
 * A member with no actor uuid carries nothing and cannot be tested, so it
 * does not count.
 * @param {{uuid: string|null}[]} members the party's members
 * @param {(uuid: string) => boolean} owns whether the seat owns the actor
 * @returns {boolean}
 */
export const ownsAnyMember = (members, owns) => (Array.isArray(members) ? members : []).some((m) => !!m?.uuid && !!owns(m.uuid));

/**
 * Whether a seat may start a grab on a pot: the Judge always, any other seat
 * only when it is seated at the pot and owns at least one member of the pot's
 * party. The party's own players share out one load; an observer or a player
 * outside the party has no part in it.
 * @param {{sender: {id?: string, isGM?: boolean}, ownsMember: boolean, seated: boolean}} who `ownsMember` is `ownsAnyMember` over the pot's party; `seated` is the sender's LIMITED or better on the pile, read by the caller when the act arrives
 * @returns {boolean}
 */
export const mayStartGrab = ({ sender, ownsMember, seated }) => !!sender?.isGM || (!!ownsMember && !!seated);

/**
 * Whether `sender` may start a grab on this pot and what it would plan over.
 * The pot must be open and the sender the Judge, or a seat seated at the pot
 * that owns a member of the pot's party (`mayStartGrab`); a grab is not limited
 * to the characters the sender owns, since it shares the pot across the party.
 * @param {{pot: object, cards: object[]}|null} view a `PotView`
 * @param {{sender: object, ownsMember?: boolean, seated?: boolean, valueWeight6?: (valueGp: number) => number|null}} who `ownsMember`: the sender owns a member of the party, and `seated`: the sender holds LIMITED or better on the pile, both read by the caller; `valueWeight6` weighs a value card as `grabLots` reads it
 * @returns {{ok: true, lots: object[]}|{ok: false, reason: string}}
 */
export function planGrabStart(view, { sender, ownsMember = false, seated = false, valueWeight6 = null }) {
  if (!view) return { ok: false, reason: REFUSAL.noPot };
  if (view.pot.phase !== PHASE.open) return { ok: false, reason: REFUSAL.phase };
  if (!mayStartGrab({ sender, ownsMember, seated })) return { ok: false, reason: REFUSAL.notAllowed };
  const lots = grabLots(view, { valueWeight6 });
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
