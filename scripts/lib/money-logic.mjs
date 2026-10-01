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
 *
 * Coin is kept in STORES — carried loose, inside a carried container, or at
 * a place that keeps it for the holder — and a slot may state the `rank` of
 * the store its row is in. The keys that name a store and the flag a holder
 * states their order under are declared here, so the planners and the writers
 * read one vocabulary; docs/lib/DECISIONS.md, "Coin is kept in stores, and a
 * holder states their order".
 */
import { MODULE_ID } from "./constants.mjs";
import { toNum as num } from "./util.mjs";
import { ITEM_TYPE } from "./vocab.mjs";

const isCoin = (plain) => plain?.type === ITEM_TYPE.money;

/* -------------------------------------------- */
/*  Where coin is kept                           */
/* -------------------------------------------- */

/**
 * The flag a holder states their coin order under:
 * `flags["acks-extras"].coinOrder = {payFrom, receiveInto}`, each a store key.
 */
export const COIN_ORDER_FLAG = "coinOrder";

/** The key of coin carried loose: the store every holder has, and what both orders default to. */
export const LOOSE_STORE = "";

/** The key of coin kept inside a container the holder carries. */
export const containerStoreKey = (itemId) => `item:${itemId}`;

/** The key of coin a place keeps for the holder. */
export const placeStoreKey = (actorUuid) => `place:${actorUuid}`;

/**
 * What a store key names. A key that reads as nothing names coin carried
 * loose, so a flag left pointing at a store that is gone still answers.
 * @returns {{kind: "loose"}|{kind: "container", id: string}|{kind: "place", uuid: string}}
 */
export function readStoreKey(key) {
  const text = typeof key === "string" ? key : "";
  if (text.startsWith("item:") && text.length > 5) return { kind: "container", id: text.slice(5) };
  if (text.startsWith("place:") && text.length > 6) return { kind: "place", uuid: text.slice(6) };
  return { kind: "loose" };
}

/**
 * The order a holder states: the store a payment draws on first, and the store
 * arriving coin lands in. Reads a document or its plain data; a holder that
 * states neither answers loose for both.
 * @returns {{payFrom: string, receiveInto: string}}
 */
export function coinOrderOf(holder) {
  const stated = holder?.flags?.[MODULE_ID]?.[COIN_ORDER_FLAG] ?? null;
  const key = (value) => (typeof value === "string" ? value : LOOSE_STORE);
  return { payFrom: key(stated?.payFrom), receiveInto: key(stated?.receiveInto) };
}

/* -------------------------------------------- */
/*  Counting and planning                        */
/* -------------------------------------------- */

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
 * The slots a spend may draw on, in the order it draws: a lower `rank` before a
 * higher one, and the smallest coin first within a rank. Slots that state no
 * rank share one, which is smallest first across all of them.
 */
const spendOrder = (slots) => slots.filter((s) => s.cv > 0 && s.qty > 0).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || a.cv - b.cv);

/**
 * Plan a spend of `needCp` copper: slots in spend order (`spendOrder`), whole
 * coins only, breaking one larger coin when what came before it cannot cover
 * the remainder. What a purse can cover does not depend on the order; which
 * coins leave it does.
 *
 * @returns {{takes: Array<{id,cv,take}>, paidCp: number,
 *            changeCp: number, shortfallCp: number}}
 *   `takes` empty when short — a spend that cannot complete plans nothing.
 */
export function planCoinSpend(slots, needCp) {
  needCp = Math.max(0, Math.round(needCp));
  if (!needCp) return { takes: [], paidCp: 0, changeCp: 0, shortfallCp: 0 };
  const pool = spendOrder(slots);

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

/** Whole coins up to `capCp`, drawn from `pool` in the order given; none is broken. */
function payWhole(pool, capCp) {
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
  return { takes, paidCp: paid, shortCp: capCp - paid };
}

/**
 * Pay AS MUCH OF `capCp` as the purse can represent EXACTLY — no coin is
 * broken, no change is owed. The uncovered remainder is the caller's to
 * record (wages book it as arrears until the employer finds a changer).
 *
 * Slots are drawn on in spend order, as every spend is. Where that pick leaves
 * a remainder — a handful of small coin taken first can strand the last few
 * copper of an amount the larger coins would have met — two more picks are
 * weighed against it: smallest first across every rank, then largest first
 * (`planChange` over the same stacks). Whichever pays most is the plan, the
 * earlier pick where two pay the same.
 * @returns {{takes: Array<{id,cv,take}>, paidCp: number, shortCp: number}}
 */
export function planCoinPayUpTo(slots, capCp) {
  capCp = Math.max(0, Math.round(capCp));
  const pool = spendOrder(slots);
  let best = payWhole(pool, capCp);
  if (best.shortCp > 0 && pool.some((s) => s.rank)) {
    const flat = payWhole([...pool].sort((a, b) => a.cv - b.cv), capCp);
    if (flat.paidCp > best.paidCp) best = flat;
  }
  if (best.shortCp > 0) {
    const largest = planChange(pool.map((s) => ({ kind: s.id, cv: s.cv, qty: s.qty })), capCp);
    if (capCp - largest.remainderCp > best.paidCp) {
      best = {
        takes: largest.credits.map((c) => ({ id: c.kind, cv: c.cv, take: c.count })),
        paidCp: capCp - largest.remainderCp,
        shortCp: largest.remainderCp,
      };
    }
  }
  return best;
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
