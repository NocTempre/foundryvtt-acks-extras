/**
 * Market pricing (RR §IV.3, §VIII.6; JJ ch.4 for magic items). Pure module —
 * the engine resolves who won a bargaining contest, what the demand modifier
 * is, and reads every printed figure (the Bargaining swing, a price step, a
 * magic-item multiple) from the imported tables and passes it in; this
 * computes prices in integer copper (1 gp = 100 cp), matching the coin
 * adapter's math.
 */
import { requireNumber } from "./required.mjs";

export const toCopper = (gp) => Math.round(Number(gp || 0) * 100);
export const toGp = (cp) => Math.round(Number(cp || 0)) / 100;

/**
 * One demand-modifier step as a fraction of the item's value, derived from an
 * imported merchandise row (`priceStep / pricePerStone`, RR 375). Null when the
 * row is absent or either price is not positive: an item with no such row has
 * no printed step, and no demand shift applies to it.
 * @param {{pricePerStone?: number, priceStep?: number}|null} row
 * @returns {number|null}
 */
export function stepFractionOf(row) {
  const per = Number(row?.pricePerStone);
  const step = Number(row?.priceStep);
  return per > 0 && step > 0 ? step / per : null;
}

/**
 * Who the Bargaining swing favors, if anyone.
 * RAW: a proficient side takes the swing; both proficient → opposed reaction
 * rolls, the winner takes it (the engine rolls and passes `opposedWinner`).
 * @returns {"party"|"merchant"|null}
 */
export function bargainWinner({ partyRanks = 0, merchantRanks = 0, opposedWinner = null }) {
  if (partyRanks > 0 && merchantRanks > 0) return opposedWinner;
  if (partyRanks > 0) return "party";
  if (merchantRanks > 0) return "merchant";
  return null;
}

/**
 * Unit price for a mundane item.
 *
 * Order: base cost → scavenged/condition value multiplier (the item's actual
 * worth, which also picks its availability band) → demand steps (each a
 * `stepFraction` of that worth) → the Bargaining swing in the winner's favor.
 * Never below zero; rounded to copper. With demand steps but no
 * `stepFraction`, the demand stage is reported as unpriced and moves nothing.
 *
 * @param {object} o
 * @param {number} o.costGp - item base cost
 * @param {"buy"|"sell"} o.direction - from the party's side
 * @param {number} [o.valueMult] - scavenged/condition multiplier (sell)
 * @param {number} [o.demandSteps] - signed demand modifier for the category
 * @param {number|null} [o.stepFraction] - one step as a fraction of value (`stepFractionOf`)
 * @param {"party"|"merchant"|null} [o.bargain] - who won the Bargaining swing
 * @param {{buy: number, sell: number}} [o.bargainPct] - the printed swing in percent per direction; required when `bargain` is set
 * @returns {{unitCp:number, breakdown:{label:string, cp:number}[]}}
 */
export function quote({ costGp, direction, valueMult = 1, demandSteps = 0, stepFraction = null, bargain = null, bargainPct = null }) {
  const breakdown = [];
  let cp = toCopper(costGp);
  breakdown.push({ label: "base", cp });

  if (valueMult !== 1) {
    cp = Math.round(cp * valueMult);
    breakdown.push({ label: "condition", cp });
  }
  if (demandSteps) {
    if (stepFraction == null) {
      breakdown.push({ label: "demandUnpriced", cp });
    } else {
      cp = Math.round(cp * (1 + stepFraction * demandSteps));
      breakdown.push({ label: "demand", cp });
    }
  }
  if (bargain) {
    // The winner's swing: the party buys cheaper / sells dearer; the
    // merchant the reverse.
    const partyFavored = bargain === "party";
    const sign = (direction === "buy") === partyFavored ? -1 : 1;
    const pct = requireNumber(`bargainPct.${direction}`, bargainPct?.[direction]);
    cp = Math.round(cp * (1 + (sign * pct) / 100));
    breakdown.push({ label: "bargaining", cp });
  }
  cp = Math.max(0, cp);
  return { unitCp: cp, breakdown };
}

/**
 * Unit price for a magic item (JJ ch.4, p.131). Identification decides which
 * value the market sees: anything short of full identification trades at
 * apparent value; a fully identified item sells at base cost (a printed
 * multiple of it if the seller made it) and buys at a printed percentage of
 * base. Demand modifiers and scavenged multipliers do not apply — the
 * magic-item market prices by provenance.
 *
 * A price whose printed figure was not passed comes back `unitCp: 0` with
 * `unpriced: true`; the engine refuses the trade before it gets that far.
 *
 * @param {object} o
 * @param {number} o.baseCostGp
 * @param {number} [o.apparentValueGp]
 * @param {"none"|"partial"|"full"} [o.identified]
 * @param {boolean} [o.selfMade]
 * @param {"buy"|"sell"} o.direction
 * @param {number|null} [o.buyPct] - printed buy price as a percentage of base
 * @param {number|null} [o.selfMadeTimes] - printed sell multiple for an item the seller made
 * @returns {{unitCp:number, basis:"apparent"|"base"|"selfMade"|"buyPremium", unpriced?:true}}
 */
export function magicQuote({ baseCostGp, apparentValueGp = 0, identified = "none", selfMade = false, direction, buyPct = null, selfMadeTimes = null }) {
  if (direction === "buy") {
    if (buyPct == null) return { unitCp: 0, basis: "buyPremium", unpriced: true };
    return { unitCp: Math.round((toCopper(baseCostGp) * buyPct) / 100), basis: "buyPremium" };
  }
  if (identified !== "full") {
    return { unitCp: toCopper(apparentValueGp), basis: "apparent" };
  }
  if (selfMade) {
    if (selfMadeTimes == null) return { unitCp: 0, basis: "selfMade", unpriced: true };
    return { unitCp: Math.round(toCopper(baseCostGp) * selfMadeTimes), basis: "selfMade" };
  }
  return { unitCp: toCopper(baseCostGp), basis: "base" };
}

/**
 * The gp value that picks a magic item's availability band: what the market
 * believes the transaction is worth (JJ prices the transaction table by
 * item price).
 */
export function magicBandValueGp({ baseCostGp, apparentValueGp = 0, identified = "none" }) {
  return identified === "full" ? Number(baseCostGp || 0) : Number(apparentValueGp || 0);
}
