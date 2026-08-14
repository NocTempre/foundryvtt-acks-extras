/**
 * Market pricing (RR §IV.3, §VIII.6; JJ ch.4 for magic items). Pure module —
 * the engine resolves who won a bargaining contest and what the demand
 * modifier is; this computes prices in integer copper (1 gp = 100 cp),
 * matching the coin adapter's math.
 */

/** One demand-modifier step as a fraction of the item's value (the
 * merchandise table prints every price step at 10% of base). */
export const STEP_FRACTION = 0.1;

/** Bargaining proficiency swing: buy 10% cheaper / sell 10% dearer. */
export const BARGAIN_FRACTION = 0.1;

export const toCopper = (gp) => Math.round(Number(gp || 0) * 100);
export const toGp = (cp) => Math.round(Number(cp || 0)) / 100;

/**
 * Who the Bargaining ±10% favors, if anyone.
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
 * worth, which also picks its availability band) → demand steps (±10% of
 * that worth per point) → Bargaining ±10% in the winner's favor. Never below
 * zero; rounded to copper.
 *
 * @param {object} o
 * @param {number} o.costGp - item base cost
 * @param {"buy"|"sell"} o.direction - from the party's side
 * @param {number} [o.valueMult] - scavenged/condition multiplier (sell)
 * @param {number} [o.demandSteps] - signed demand modifier for the category
 * @param {"party"|"merchant"|null} [o.bargain] - who won the Bargaining swing
 * @returns {{unitCp:number, breakdown:{label:string, cp:number}[]}}
 */
export function quote({ costGp, direction, valueMult = 1, demandSteps = 0, bargain = null }) {
  const breakdown = [];
  let cp = toCopper(costGp);
  breakdown.push({ label: "base", cp });

  if (valueMult !== 1) {
    cp = Math.round(cp * valueMult);
    breakdown.push({ label: "condition", cp });
  }
  if (demandSteps) {
    cp = Math.round(cp * (1 + STEP_FRACTION * demandSteps));
    breakdown.push({ label: "demand", cp });
  }
  if (bargain) {
    // The winner's swing: the party buys cheaper / sells dearer; the
    // merchant the reverse.
    const partyFavored = bargain === "party";
    const sign = (direction === "buy") === partyFavored ? -1 : 1;
    cp = Math.round(cp * (1 + sign * BARGAIN_FRACTION));
    breakdown.push({ label: "bargaining", cp });
  }
  cp = Math.max(0, cp);
  return { unitCp: cp, breakdown };
}

/**
 * Unit price for a magic item (JJ ch.4). Identification decides which value
 * the market sees: anything short of full identification trades at apparent
 * value; a fully identified item sells at base cost (twice base if the
 * seller made it) and buys at 225% of base. Demand modifiers and scavenged
 * multipliers do not apply — the magic-item market prices by provenance.
 *
 * @returns {{unitCp:number, basis:"apparent"|"base"|"selfMade"|"buyPremium"}}
 */
export function magicQuote({ baseCostGp, apparentValueGp = 0, identified = "none", selfMade = false, direction }) {
  if (direction === "buy") {
    return { unitCp: Math.round(toCopper(baseCostGp) * 2.25), basis: "buyPremium" };
  }
  if (identified !== "full") {
    return { unitCp: toCopper(apparentValueGp), basis: "apparent" };
  }
  if (selfMade) return { unitCp: toCopper(baseCostGp) * 2, basis: "selfMade" };
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
