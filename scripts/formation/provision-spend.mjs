/**
 * Spending what a pack holds: the one consumer of food and the one draw of
 * water.
 *
 * [provisions.mjs](./provisions.mjs) reads what an item is and deals the pool;
 * this takes the days dealt back out of the items, so the Supplies press and
 * End day ([provision-day.mjs](./provision-day.mjs)) spend through one function
 * and nothing is spent twice. Food leaves a pack as units (a stack's quantity)
 * and part-units (the `uses` flag, in days); water stays in its vessels as
 * what is left (`provision.left`, days across the stack). Only SIZED items are
 * touched: an item with no size is left as it is. See docs/formation/MODEL.md,
 * "Provisions".
 */
import { MODULE_ID } from "./constants.mjs";
import { unset } from "../lib/util.mjs";
import { quantityOf } from "../lib/storage-logic.mjs";
import { EPSILON, figureOf, flagOf, provisionOf, tidy } from "./provisions.mjs";

/** The actor flag naming the day the Supplies press last fed a member, as the formation's End-day counter (`fedDayOf`). */
export const FED_FLAG = "fedOn";

/**
 * The day a formation is in, for `FED_FLAG`: its End-day counter, which only
 * End day advances. The press writes it and End day compares it, so a member
 * fed once is not fed again for the same day however the clock has moved.
 */
export const fedDayOf = (formation) => Number(formation?.travel?.dayCount) || 0;

/** What the press spends: food and nothing else. */
const FOOD_ONLY = Object.freeze(["food"]);

/** What End day spends: the food it counts, hunted game included. */
export const FOOD_AND_GAME = Object.freeze(["food", "hunt"]);

/** The sized, non-empty items of one reading a unit worth the fewest days first. */
function drawable(actor, kinds, holds) {
  const out = [];
  for (const item of actor?.items ?? []) {
    const provision = provisionOf(item);
    if (provision?.sized && kinds.includes(provision.kind) && provision.units > 0 && holds(provision) > EPSILON) out.push({ item, provision });
  }
  // `sort` is stable, so equal units keep the order the pack lists them in.
  return out.sort((a, b) => a.provision.perUnit - b.provision.perUnit);
}

/**
 * Spend `days` (fractional where a half portion is dealt) from an actor's sized
 * food, the unit worth the fewest days first, so a day's ration goes before a
 * week's. A multi-day unit keeps what is part-eaten as the days used in its
 * `uses` flag, and the stack's quantity drops when a unit is used up; an
 * emptied stack stays in the pack. An unsized item is never touched.
 *
 * @param {object} actor
 * @param {number} days
 * @param {{kinds?: string[]}} [options] the provision kinds drawn on, `food` only by default
 * @returns {Promise<{spent: number, short: number, from: Array<{item: object, name: string, days: number, perUnit: number, eaten: number}>}>}
 *   `spent` is the days taken, `short` what the pack could not give, and each
 *   `from` row an item drawn on: `eaten` is the days of its current unit used
 *   (0 where the unit was finished).
 */
export async function spendFood(actor, days, { kinds = FOOD_ONLY } = {}) {
  const asked = Math.max(0, Number(days) || 0);
  let owed = asked;
  const from = [];
  for (const { item, provision } of drawable(actor, kinds, (p) => p.days)) {
    if (owed <= EPSILON) break;
    const take = Math.min(owed, provision.days);
    const left = tidy(provision.days - take);
    const units = left <= EPSILON ? 0 : Math.ceil(left / provision.perUnit - EPSILON);
    const eaten = units === 0 ? 0 : tidy(units * provision.perUnit - left);
    const patch = {};
    if (units !== provision.units) patch[quantityOf(item).path] = units;
    if (eaten !== (Number(flagOf(item, "uses")) || 0)) patch[`flags.${MODULE_ID}.uses`] = eaten;
    if (Object.keys(patch).length) await item.update(patch);
    owed = tidy(owed - take);
    from.push({ item, name: item.name, days: take, perUnit: provision.perUnit, eaten });
  }
  return { spent: tidy(asked - owed), short: owed, from };
}

/**
 * Spend `days` from an actor's sized water, vessel by vessel in the pack's
 * order. A vessel's `provision.left` drops by what is drawn and never below
 * empty; an emptied vessel stays in the pack with its quantity unchanged. The
 * write merges into the item's own `provision` flag, so a declared kind or
 * size is kept.
 *
 * @param {object} actor
 * @param {number} days
 * @returns {Promise<{spent: number, short: number, from: Array<{item: object, name: string, days: number}>}>}
 *   as `spendFood`, without the unit fields.
 */
export async function spendWater(actor, days) {
  const asked = Math.max(0, Number(days) || 0);
  let owed = asked;
  const from = [];
  for (const { item, provision } of drawable(actor, ["water"], (p) => p.left)) {
    if (owed <= EPSILON) break;
    const take = Math.min(owed, provision.left);
    const declared = flagOf(item, "provision");
    await item.setFlag(MODULE_ID, "provision", {
      ...(declared && typeof declared === "object" ? declared : {}),
      left: Math.max(0, tidy(provision.left - take)),
    });
    owed = tidy(owed - take);
    from.push({ item, name: item.name, days: take });
  }
  return { spent: tidy(asked - owed), short: owed, from };
}

/**
 * Spend one share of days for each of several actors: each share is drawn from
 * its own actor's pack first, then what is left owing from the rest of the
 * order's, in the order given. The shares are the pool dealt out, so the total
 * drawn is the total dealt.
 *
 * @param {object[]} actors the order, in member order
 * @param {number[]} shares days owed for each actor, by position
 * @param {(actor: object, days: number) => Promise<{spent: number, from: object[]}>} spend `spendFood` or `spendWater`, bound
 * @returns {Promise<Array<{days: number, short: number, from: Array<{name: string, owner: string, days: number}>}>>}
 *   per actor, by position: the days drawn for it, what stayed owing, and the
 *   items it was drawn from, with whose pack each sat in.
 */
export async function spendShares(actors, shares, spend) {
  const rows = actors.map(() => ({ days: 0, short: 0, from: [] }));
  const owed = actors.map((_, i) => Math.max(0, Number(shares[i]) || 0));
  const draw = async (i, j) => {
    if (owed[i] <= EPSILON) return;
    const got = await spend(actors[j], owed[i]);
    owed[i] = tidy(owed[i] - got.spent);
    rows[i].days = tidy(rows[i].days + got.spent);
    for (const f of got.from) rows[i].from.push({ name: f.name, owner: actors[j]?.name ?? "", days: f.days });
  };
  for (let i = 0; i < actors.length; i++) await draw(i, i);
  for (let i = 0; i < actors.length; i++) {
    for (let j = 0; j < actors.length; j++) if (j !== i) await draw(i, j);
  }
  owed.forEach((n, i) => { rows[i].short = n; });
  return rows;
}

/**
 * Fill every sized vessel an actor carries. What is left is unset, which reads
 * as full and follows the stack's size, so a vessel added later reads full too.
 * A vessel with no size is skipped, since what full is for it is not known.
 *
 * @returns {Promise<{filled: object[], skipped: object[]}>} the vessels filled and the unsized ones skipped
 */
export async function refillActor(actor) {
  const filled = [];
  const skipped = [];
  for (const item of actor?.items ?? []) {
    const provision = provisionOf(item);
    if (provision?.kind !== "water" || !(provision.units > 0)) continue;
    if (!provision.sized) {
      skipped.push(item);
      continue;
    }
    if (figureOf(flagOf(item, "provision")?.left) !== null) {
      await item.update({ [`flags.${MODULE_ID}.provision.left`]: unset() });
    }
    filled.push(item);
  }
  return { filled, skipped };
}
