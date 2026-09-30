/**
 * Arbitrage trading (RR §VIII.6): market entry and impact, assessment of
 * supply and demand, the monthly merchandise market price, soliciting, and
 * spot-price negotiation. Pure module — imported table cells arrive as
 * printed strings; the engine rolls the dice, reads every printed figure (the
 * impact cap, the price shifts, the result bands) from the imported tables and
 * passes them in.
 */
import { requireNumber } from "./required.mjs";

/** The extremes of a 2d6 roll: the naturals that outrank any modifier. */
const TWO_D6 = Object.freeze({ min: 2, max: 12 });

/** The result rungs of a 2d6 result column, in the order the book lists them. */
export const ASSESSMENT_RESULTS = Object.freeze(["false", "failed", "expertise", "partial", "success"]);
export const NEGOTIATION_RESULTS = Object.freeze(["outrage", "refusal", "continue", "grudging", "agreement"]);

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
 * rounded half-to-even; capped at the printed maximum (the one class whose
 * cap scales with its urban families takes the larger of the two); impact 0
 * trades as the next lower class until it reaches 1, and always at least 1 in
 * the smallest class.
 *
 * @param {object} o
 * @param {number} o.impactCap - the printed maximum impact
 * @param {number} o.familyScaledClass - the market class whose cap scales with families
 * @param {number} o.familiesPerImpact - urban families per point of that scaled cap
 * @returns {{impact:number, effectiveClass:number}}
 */
export function marketImpact({ cargoSt, baselineCargoSt, marketClass, urbanFamilies = 0, baselineOfClass, impactCap, familyScaledClass, familiesPerImpact }) {
  const roundEven = (x) => {
    const f = Math.floor(x);
    const frac = x - f;
    if (Math.abs(frac - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
    return Math.round(x);
  };
  const top = requireNumber("impactCap", impactCap);
  const scaledClass = requireNumber("familyScaledClass", familyScaledClass);
  const perImpact = requireNumber("familiesPerImpact", familiesPerImpact);
  const cap = marketClass === scaledClass ? Math.max(top, Math.floor((Number(urbanFamilies) || 0) / perImpact)) : top;
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

/**
 * The rung of a printed result column a total falls in, by position. `bands`
 * is the column's five `{min, max}` ranges in printed order (null = open end);
 * a total outside every range clamps to the nearest end.
 */
function rungOf(total, bands) {
  if (!Array.isArray(bands) || bands.length !== 5) throw new TypeError("markets rules: a result column needs its five printed bands");
  const at = bands.findIndex((b) => (b.min == null || total >= b.min) && (b.max == null || total <= b.max));
  if (at >= 0) return at;
  return bands[0].min != null && total < bands[0].min ? 0 : bands.length - 1;
}

/**
 * Assessment of Supply and Demand (2d6, adjusted): the outcome name of the
 * band `total` falls in. The bands are the printed column, false result first.
 * @param {number} total
 * @param {{min:number|null, max:number|null}[]} bands - five, in `ASSESSMENT_RESULTS` order
 */
export function assessmentOutcome(total, bands) {
  return ASSESSMENT_RESULTS[rungOf(total, bands)];
}

/**
 * The assessment bands as an influence page reads them: `{min, max, key}` rows,
 * worst first, open ends omitted. Null when the printed column is unread.
 * @param {{min:number|null, max:number|null}[]|null} bands - `ASSESSMENT_RESULTS` order
 */
export function assessmentPageBands(bands) {
  if (!Array.isArray(bands) || bands.length !== ASSESSMENT_RESULTS.length) return null;
  return bands.map((b, i) => {
    const row = { key: ASSESSMENT_RESULTS[i] };
    if (b?.min !== null && b?.min !== undefined) row.min = b.min;
    if (b?.max !== null && b?.max !== undefined) row.max = b.max;
    return row;
  });
}

/**
 * The pending day this one would repeat: the same trader's same kind of day
 * (and, for a solicitation, the same merchandise) still waiting to resolve.
 * A day already resolved or withdrawn is no duplicate — the book lets a
 * trader assess again tomorrow; it is posting the same tomorrow twice that is
 * refused. Undefined when there is none.
 * @param {{kind:string, actorUuid:string, category?:string, status:string}[]} actions
 * @param {{kind:string, actorUuid:string, category?:string}} day
 */
export function pendingDuplicate(actions, { kind, actorUuid, category = "" }) {
  return (actions ?? []).find(
    (a) => a.status === "pending" && a.kind === kind && a.actorUuid === actorUuid && (kind !== "solicit" || (a.category ?? "") === category)
  );
}

/**
 * Whether a queued day may be withdrawn by this user: a Judge always; anyone
 * else only their own trader's, and only while it is still pending. What the
 * day cost stays spent — the gate kept the toll, the merchants the bribe.
 * @param {{status:string, actorUuid:string}|undefined} action
 * @param {{isGM:boolean, ownsActor:(uuid:string)=>boolean}} user
 * @returns {"ok"|"notPending"|"notYours"}
 */
export function cancelVerdict(action, { isGM, ownsActor }) {
  if (!action || action.status !== "pending") return "notPending";
  if (isGM || ownsActor(action.actorUuid)) return "ok";
  return "notYours";
}

/**
 * A party leaves the market it entered this month. Nothing paid comes back:
 * the toll stays with the gate, and what a day of soliciting opened closes
 * with the party gone, so its solicitations are dropped. A venture day of
 * the party's still waiting to resolve is withdrawn with it — it cannot
 * resolve for a party that is not there. The month's row is kept, entered
 * no longer, so a later entry overwrites it with a fresh declaration and a
 * fresh toll. Mutates the given copies; `error` when the party is not in.
 * @param {{ventures:object[], actions:object[], solicitations:object[]}} state - cloned goods rows
 * @param {{partyId:string, monthStart:number}} o
 * @returns {{ok:true, cancelledIds:string[], droppedSolicitations:number}|{error:"notEntered"}}
 */
export function leaveMarket({ ventures, actions, solicitations }, { partyId, monthStart }) {
  const venture = (ventures ?? []).find((v) => v.partyId === partyId && Number(v.monthStartTime) === monthStart);
  if (!venture?.entered) return { error: "notEntered" };
  venture.entered = false;
  const cancelledIds = [];
  for (const a of actions ?? []) {
    if (a.status !== "pending" || a.partyId !== partyId || !["enter", "assess", "solicit"].includes(a.kind)) continue;
    a.status = "cancelled";
    cancelledIds.push(a.id);
  }
  let droppedSolicitations = 0;
  for (let i = (solicitations ?? []).length - 1; i >= 0; i--) {
    const s = solicitations[i];
    if (s.partyId !== partyId || Number(s.monthStartTime) !== monthStart) continue;
    solicitations.splice(i, 1);
    droppedSolicitations++;
  }
  return { ok: true, cancelledIds, droppedSolicitations };
}

/**
 * The monthly market price for one merchandise type (RR §VIII.6 step 4):
 * base price shifted by 4d4−10 steps, the demand modifier, the printed class
 * shifts for the largest and smallest markets, and the grain season. Never
 * below one step. Every shift is a printed figure passed in.
 *
 * @param {object} o
 * @param {number} o.largeClassEdge - classes at or below this number shift up
 * @param {number} o.largeClassShift
 * @param {number} o.smallClassEdge - classes at or above this number shift down
 * @param {number} o.smallClassShift
 * @param {number} o.sowingShift - grain in spring, up
 * @param {number} o.harvestShift - grain in autumn, down
 * @returns {{priceCp:number, steps:number}}
 */
export function merchMarketPriceCp({
  basePriceCp,
  stepCp,
  roll4d4,
  dm = 0,
  marketClass,
  season = null,
  grain = false,
  largeClassEdge,
  largeClassShift,
  smallClassEdge,
  smallClassShift,
  sowingShift,
  harvestShift,
}) {
  let steps = (Number(roll4d4) || 10) - 10 + (Number(dm) || 0);
  if (marketClass <= requireNumber("largeClassEdge", largeClassEdge)) steps += requireNumber("largeClassShift", largeClassShift);
  if (marketClass >= requireNumber("smallClassEdge", smallClassEdge)) steps -= requireNumber("smallClassShift", smallClassShift);
  if (grain && season === "spring") steps += requireNumber("sowingShift", sowingShift);
  if (grain && season === "autumn") steps -= requireNumber("harvestShift", harvestShift);
  const priceCp = Math.max(stepCp, Math.round(basePriceCp + steps * stepCp));
  return { priceCp, steps };
}

/**
 * Reaction to Negotiation (2d6, adjusted): the outcome name of the band the
 * total falls in, the printed column outrage first. A natural roll of either
 * extreme stands regardless of modifiers: the lowest is the first rung, the
 * highest the last.
 * @param {number} total - the adjusted result
 * @param {number} natural - the unmodified 2d6
 * @param {{min:number|null, max:number|null}[]} bands - five, in `NEGOTIATION_RESULTS` order
 */
export function negotiationOutcome(total, natural, bands) {
  if (natural === TWO_D6.min) return NEGOTIATION_RESULTS[0];
  if (natural === TWO_D6.max) return NEGOTIATION_RESULTS[NEGOTIATION_RESULTS.length - 1];
  return NEGOTIATION_RESULTS[rungOf(total, bands)];
}

/** Daily solicited quantity: base stones × market impact (fractions carry). */
export function solicitedStones({ baseStones, impact }) {
  return (Number(baseStones) || 0) * Math.max(0, Number(impact) || 0);
}

/**
 * Draw `stones` of one kind of load from a hold's stacks, in the order given:
 * each stack gives what it has until the draw is met, so a sale is not refused
 * because the loads it needs sit in two sacks rather than one. `rows` are
 * `{id, qty}`; only whole loads are drawn. The plan takes exactly `stones` —
 * a stack left with nothing is deleted, one left with a remainder (a broken
 * stack, or the fraction of a load nobody can sell) is updated — or is
 * `short`, with the whole loads the stacks hold between them, and takes
 * nothing.
 * @returns {{updates: {id: string, qty: number}[], deletes: string[], held: number, short: boolean}}
 */
export function planLoadDraw(rows, stones) {
  const count = (n) => Math.max(0, Math.floor(Number(n) || 0));
  const want = count(stones);
  const held = (rows ?? []).reduce((n, r) => n + count(r.qty), 0);
  if (held < want) return { updates: [], deletes: [], held, short: true };
  const updates = [];
  const deletes = [];
  let left = want;
  for (const row of rows ?? []) {
    if (left <= 0) break;
    const take = Math.min(count(row.qty), left);
    if (take <= 0) continue;
    const rest = Math.round((Math.max(0, Number(row.qty) || 0) - take) * 1e6) / 1e6;
    if (rest > 0) updates.push({ id: row.id, qty: rest });
    else deletes.push(row.id);
    left -= take;
  }
  return { updates, deletes, held, short: false };
}
