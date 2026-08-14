/**
 * Coin arithmetic, Foundry-free (unit-tested offline; money.mjs owns the
 * document writes). Everything is INTEGER COPPER internally — coppervalue ×
 * count — because copper is the books' smallest coin and floats drift.
 *
 * One spend policy survives 4.0 (owner ruling 2026-08-14): SMALLEST
 * denomination first, breaking a larger coin when the small ones run out, with
 * the overshoot owed back as change. The policy is the rules-faithful one — a
 * purse pays exact where it can, and where it cannot, the larger coin is
 * broken and the difference returned — and its shortfall reporting is what
 * every refusing caller (bribes, tolls, wages) shows the player.
 */
import { toNum as num } from "./util.mjs";
import { ITEM_TYPE } from "./vocab.mjs";

/** A coin kind's identity: the stack-signature tail (kind before rate). */
export const coinKind = (plain) => `${String(plain?.name ?? "").trim().toLowerCase()}|${num(plain?.system?.coppervalue, 1)}`;

/**
 * Spendable slots from plain item data: carried before banked, both fields.
 * Order is NOT applied here — the planner sorts by its own policy.
 */
export function coinSlots(plainItems) {
  const slots = [];
  for (const it of plainItems ?? []) {
    if (it?.type !== ITEM_TYPE.money) continue;
    const cv = num(it.system?.coppervalue, 0);
    if (cv <= 0) continue;
    for (const field of ["quantity", "quantitybank"]) {
      const qty = num(it.system?.[field], 0);
      slots.push({ id: it._id ?? it.id, field, cv, qty, kind: coinKind(it), name: it.name });
    }
  }
  return slots;
}

/**
 * Plan a spend of `needCp` copper: smallest coppervalue first (carried before
 * banked at equal value), whole coins only, breaking one larger coin when the
 * small ones cannot cover the remainder.
 *
 * @returns {{takes: Array<{id,field,cv,take}>, paidCp: number,
 *            changeCp: number, shortfallCp: number}}
 *   `takes` empty when short — a spend that cannot complete plans nothing.
 */
export function planCoinSpend(slots, needCp) {
  needCp = Math.max(0, Math.round(needCp));
  if (!needCp) return { takes: [], paidCp: 0, changeCp: 0, shortfallCp: 0 };
  const pool = slots
    .filter((s) => s.cv > 0 && s.qty > 0)
    .sort((a, b) => a.cv - b.cv || (a.field === "quantity" ? -1 : 1));

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
    takes.push({ id: slot.id, field: slot.field, cv: slot.cv, take });
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
 * broken, no change is owed. Greedy smallest-first accumulation; the
 * uncovered remainder is the caller's to record (wages book it as arrears
 * until the employer finds a changer).
 * @returns {{takes: Array<{id,field,cv,take}>, paidCp: number, shortCp: number}}
 */
export function planCoinPayUpTo(slots, capCp) {
  capCp = Math.max(0, Math.round(capCp));
  const pool = slots
    .filter((s) => s.cv > 0 && s.qty > 0)
    .sort((a, b) => a.cv - b.cv || (a.field === "quantity" ? -1 : 1));
  const takes = [];
  let paid = 0;
  for (const slot of pool) {
    const room = capCp - paid;
    if (room < slot.cv) continue;
    const take = Math.min(slot.qty, Math.floor(room / slot.cv));
    if (take <= 0) continue;
    takes.push({ id: slot.id, field: slot.field, cv: slot.cv, take });
    paid += take * slot.cv;
  }
  return { takes, paidCp: paid, shortCp: capCp - paid };
}

/**
 * Change in the payer's own denominations, largest first (fewest coins; the
 * remainder below the smallest kind is unrepresentable either way).
 * @returns {{credits: Array<{kind, cv, count}>, remainderCp: number}}
 */
export function planChange(kinds, changeCp) {
  changeCp = Math.max(0, Math.round(changeCp));
  const credits = [];
  let owed = changeCp;
  for (const k of [...kinds].sort((a, b) => b.cv - a.cv)) {
    if (k.cv <= 0 || owed < k.cv) continue;
    const count = Math.floor(owed / k.cv);
    owed -= count * k.cv;
    credits.push({ kind: k.kind, cv: k.cv, count });
  }
  return { credits, remainderCp: owed };
}

/**
 * What the local economy gives for coin (owner ruling 2026-08-14): a MARKET
 * exchanges denominations freely at face value; anywhere else there is no
 * changer — coin still SPENDS at face value, but conversion is refused and
 * the parties barter with the stacks they hold. `terms` come from the place
 * (money.mjs derives them; a GM override field wins when present).
 *
 * @returns {number|null} copper value, or null when conversion is refused.
 */
export function convertCp(cp, terms) {
  if (!terms || terms.mode === "none") return null;
  if (terms.mode === "market") return Math.round(cp);
  return null;
}
