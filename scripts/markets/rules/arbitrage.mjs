/**
 * Arbitrage trading (RR §VIII.6): market entry and impact, assessment of
 * supply and demand, the monthly merchandise market price, soliciting, and
 * spot-price negotiation. Pure module — imported table cells arrive as
 * printed strings; the engine rolls the dice and passes results in.
 */

/** "30,000 st" → 30000; "-" → 0. */
export function parseStones(text) {
  const m = String(text ?? "").replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : 0;
}

/** "0.2cp/st" → 0.2 (copper per stone); "none" → 0. */
export function parseTollCpPerSt(text) {
  const t = String(text ?? "").toLowerCase();
  if (!t || t.includes("none")) return 0;
  const m = t.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*cp/);
  return m ? Number(m[1]) : 0;
}

/**
 * Market impact (RR §VIII.6 step 2): cargo capacity over the baseline,
 * rounded half-to-even; capped at 10 (Class I: families/2,000 if larger);
 * impact 0 trades as the next lower class until it reaches 1, and always at
 * least 1 in Class VI.
 * @returns {{impact:number, effectiveClass:number}}
 */
export function marketImpact({ cargoSt, baselineCargoSt, marketClass, urbanFamilies = 0, baselineOfClass }) {
  const roundEven = (x) => {
    const f = Math.floor(x);
    const frac = x - f;
    if (Math.abs(frac - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
    return Math.round(x);
  };
  const cap = marketClass === 1 ? Math.max(10, Math.floor((Number(urbanFamilies) || 0) / 2000)) : 10;
  let cls = marketClass;
  let baseline = baselineCargoSt;
  let impact = baseline > 0 ? roundEven(cargoSt / baseline) : 0;
  while (impact < 1 && cls < 6) {
    cls += 1;
    baseline = baselineOfClass ? baselineOfClass(cls) : baseline;
    impact = baseline > 0 ? roundEven(cargoSt / baseline) : 0;
  }
  if (cls === 6 && impact < 1) impact = 1;
  return { impact: Math.min(cap, impact), effectiveClass: cls };
}

/** Assessment of Supply and Demand (2d6, adjusted). */
export function assessmentOutcome(total) {
  if (total <= 2) return "false";
  if (total <= 5) return "failed";
  if (total <= 8) return "expertise";
  if (total <= 11) return "partial";
  return "success";
}

/**
 * The monthly market price for one merchandise type (RR §VIII.6 step 4):
 * base price shifted by 4d4−10 steps, the demand modifier, ±1 for market
 * class I/II vs V/VI, and the grain season. Never below one step.
 * @returns {{priceCp:number, steps:number}}
 */
export function merchMarketPriceCp({ basePriceCp, stepCp, roll4d4, dm = 0, marketClass, season = null, grain = false }) {
  let steps = (Number(roll4d4) || 10) - 10 + (Number(dm) || 0);
  if (marketClass <= 2) steps += 1;
  if (marketClass >= 5) steps -= 1;
  if (grain && season === "spring") steps += 1;
  if (grain && season === "autumn") steps -= 1;
  const priceCp = Math.max(stepCp, Math.round(basePriceCp + steps * stepCp));
  return { priceCp, steps };
}

/** Reaction to Negotiation (2d6, adjusted; naturals 2 and 12 stand). */
export function negotiationOutcome(total, natural) {
  const t = natural === 2 ? 2 : natural === 12 ? 12 : total;
  if (t <= 2) return "outrage";
  if (t <= 5) return "refusal";
  if (t <= 8) return "continue";
  if (t <= 11) return "grudging";
  return "agreement";
}

/** Daily solicited quantity: base stones × market impact (fractions carry). */
export function solicitedStones({ baseStones, impact }) {
  return (Number(baseStones) || 0) * Math.max(0, Number(impact) || 0);
}
