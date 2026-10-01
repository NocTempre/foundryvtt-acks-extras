/**
 * Coin arithmetic, Foundry-free (unit-tested offline; money.mjs owns the
 * document writes). Everything is INTEGER COPPER internally — coppervalue ×
 * count — because copper is the books' smallest coin and floats drift.
 *
 * A coin row holds ONE count, `system.quantity`: every reader below counts
 * that field and no other. The system's second number on the same row
 * (`system.quantitybank`) is not coin anybody holds; see docs/lib/DECISIONS.md,
 * "Currency is one stack with one count, weighed by how many make a stone".
 *
 * The spend policy (smallest denomination first, breaking a larger coin for
 * change when needed) is docs/lib/DECISIONS.md, "2026-08-14 — Money is
 * physical; four rulings land at once". Its shortfall reporting is what
 * every refusing caller (bribes, tolls, wages) shows the player.
 */
import { toNum as num } from "./util.mjs";
import { ITEM_TYPE } from "./vocab.mjs";

const isCoin = (plain) => plain?.type === ITEM_TYPE.money;

/**
 * The key a coin of this name and rate stacks under. Kind comes before rate:
 * two mints struck to the same value are still two stacks.
 */
export const coinKindKey = (name, cv) => `${String(name ?? "").trim().toLowerCase()}|${num(cv, 1)}`;

/** A coin row's identity — THE merge key every path that lands coin shares. */
export const coinKind = (plain) => coinKindKey(plain?.name, plain?.system?.coppervalue);

/** How many coins a row holds. */
export const coinCount = (plain) => Math.max(0, num(plain?.system?.quantity, 0));

/** What one coin of this row is worth, in copper. */
export const coinRate = (plain) => num(plain?.system?.coppervalue, 1);

/** What a set of rows is worth, in copper. Rows that are not coin count for nothing. */
export function coinTotalCp(plainItems) {
  let copper = 0;
  for (const it of plainItems ?? []) {
    if (isCoin(it)) copper += coinCount(it) * coinRate(it);
  }
  return copper;
}

/** The same worth in gold, the way the system counts it (100cp = 1gp). */
export const coinTotalGC = (plainItems) => coinTotalCp(plainItems) / 100;

/**
 * Spendable slots from plain item data, one per coin row. Order is NOT applied
 * here — the planner sorts by its own policy.
 */
export function coinSlots(plainItems) {
  const slots = [];
  for (const it of plainItems ?? []) {
    if (!isCoin(it)) continue;
    const cv = coinRate(it);
    if (cv <= 0) continue;
    slots.push({ id: it._id ?? it.id, cv, qty: coinCount(it), kind: coinKind(it), name: it.name });
  }
  return slots;
}

/**
 * Plan a spend of `needCp` copper: smallest coppervalue first, whole coins
 * only, breaking one larger coin when the small ones cannot cover the
 * remainder.
 *
 * @returns {{takes: Array<{id,cv,take}>, paidCp: number,
 *            changeCp: number, shortfallCp: number}}
 *   `takes` empty when short — a spend that cannot complete plans nothing.
 */
export function planCoinSpend(slots, needCp) {
  needCp = Math.max(0, Math.round(needCp));
  if (!needCp) return { takes: [], paidCp: 0, changeCp: 0, shortfallCp: 0 };
  const pool = slots.filter((s) => s.cv > 0 && s.qty > 0).sort((a, b) => a.cv - b.cv);

  const takes = [];
  let remaining = needCp;
  for (const slot of pool) {
    if (remaining <= 0) break;
    // Whole coins of this denomination, but never more than needed PLUS one
    // breaker: the last coin taken may overshoot, and that overshoot is the
    // change owed.
    const wanted = Math.ceil(remaining / slot.cv);
    const take = Math.min(slot.qty, wanted);
    if (take <= 0) continue;
    takes.push({ id: slot.id, cv: slot.cv, take });
    remaining -= take * slot.cv;
  }
  if (remaining > 0) return { takes: [], paidCp: 0, changeCp: 0, shortfallCp: remaining };
  // `remaining` is 0 or negative here; negate through Math.abs so an exact
  // payment reports 0, never -0 (strict equality treats them alike but a
  // JSON round-trip does not).
  return { takes, paidCp: needCp, changeCp: Math.abs(remaining), shortfallCp: 0 };
}

/**
 * Pay AS MUCH OF `capCp` as the purse can represent EXACTLY — no coin is
 * broken, no change is owed. The uncovered remainder is the caller's to
 * record (wages book it as arrears until the employer finds a changer).
 *
 * Smallest coins first, as every spend is. Where that pick leaves a remainder
 * — a handful of small coin taken first can strand the last few copper of an
 * amount the larger coins would have met — the largest-first pick is weighed
 * against it (`planChange` over the same stacks) and whichever pays more is
 * the plan.
 * @returns {{takes: Array<{id,cv,take}>, paidCp: number, shortCp: number}}
 */
export function planCoinPayUpTo(slots, capCp) {
  capCp = Math.max(0, Math.round(capCp));
  const pool = slots.filter((s) => s.cv > 0 && s.qty > 0).sort((a, b) => a.cv - b.cv);
  const takes = [];
  let paid = 0;
  for (const slot of pool) {
    const room = capCp - paid;
    if (room < slot.cv) continue;
    const take = Math.min(slot.qty, Math.floor(room / slot.cv));
    if (take <= 0) continue;
    takes.push({ id: slot.id, cv: slot.cv, take });
    paid += take * slot.cv;
  }
  if (paid < capCp) {
    const largest = planChange(pool.map((s) => ({ kind: s.id, cv: s.cv, qty: s.qty })), capCp);
    if (capCp - largest.remainderCp > paid) {
      return {
        takes: largest.credits.map((c) => ({ id: c.kind, cv: c.cv, take: c.count })),
        paidCp: capCp - largest.remainderCp,
        shortCp: largest.remainderCp,
      };
    }
  }
  return { takes, paidCp: paid, shortCp: capCp - paid };
}

/**
 * Change, largest coin first and never more than is owed: change is not itself
 * broken, so what comes back is exact or it is short by `remainderCp`.
 *
 * A kind that states a `qty` is a stack somebody holds and gives no more than
 * it has (a payee's purse); a kind that states none is unbounded (change handed
 * back from off-stage, in the payer's own denominations). Among kinds of one
 * rate the earlier in the list is drawn on first.
 *
 * Largest-first finds the exact amount wherever each rate divides the next
 * larger one. Among rates that do not, it can leave a remainder a different
 * pick would not have; the caller treats that as change nobody can make.
 * @param {Array<{kind: string, cv: number, qty?: number}>} kinds
 * @returns {{credits: Array<{kind, cv, count}>, remainderCp: number}}
 */
export function planChange(kinds, changeCp) {
  changeCp = Math.max(0, Math.round(changeCp));
  const credits = [];
  let owed = changeCp;
  for (const k of [...kinds].sort((a, b) => b.cv - a.cv)) {
    if (k.cv <= 0 || owed < k.cv) continue;
    const count = Math.min(Math.floor(owed / k.cv), k.qty == null ? Infinity : Math.max(0, Math.floor(k.qty)));
    if (count <= 0) continue;
    owed -= count * k.cv;
    credits.push({ kind: k.kind, cv: k.cv, count });
  }
  return { credits, remainderCp: owed };
}

/**
 * What the local economy gives for coin: a MARKET exchanges denominations
 * freely at face value; anywhere else there is no changer — coin still
 * SPENDS at face value, but conversion is refused and the parties barter
 * with the stacks they hold (docs/lib/DECISIONS.md, "2026-08-14 — Money is
 * physical; four rulings land at once"). `terms` come from the place
 * (money.mjs derives them; a GM override field wins when present).
 *
 * @returns {number|null} copper value, or null when conversion is refused.
 */
export function convertCp(cp, terms) {
  if (!terms || terms.mode === "none") return null;
  if (terms.mode === "market") return Math.round(cp);
  return null;
}
