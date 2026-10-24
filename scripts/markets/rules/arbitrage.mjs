/**
 * Arbitrage trading (RR §VIII.6): market entry and impact, assessment of
 * supply and demand, the monthly merchandise market price, soliciting, and
 * spot-price negotiation. Pure module — imported table cells arrive as
 * printed strings; the engine rolls the dice, reads every printed figure (the
 * impact cap, the price shifts, the result bands) from the imported tables and
 * passes them in.
 */
import { requireNumber } from "./required.mjs";
import { parseMoneyCp } from "./commissions.mjs";

/** The extremes of a 2d6 roll: the naturals that outrank any modifier. */
const TWO_D6 = Object.freeze({ min: 2, max: 12 });

/** The result rungs of a 2d6 result column, in the order the book lists them. */
export const ASSESSMENT_RESULTS = Object.freeze(["false", "failed", "expertise", "partial", "success"]);
export const NEGOTIATION_RESULTS = Object.freeze(["outrage", "refusal", "continue", "grudging", "agreement"]);

/**
 * How a party's characters enter a market (RR ch. 8, Entering the Market,
 * step 2, Parties): as one party with one venture, or each character
 * separately with a venture of their own.
 */
export const VENTURE_MODES = Object.freeze(["party", "separately"]);

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
 * A Market Characteristics tariff cell as two percentages, `{precious,
 * common}`. The cell prints the precious rate before the common one, the
 * order the Entering the Market prose names them in (RR ch. 8, step 3), so
 * the first figure is precious. "none" or a dash charges both at 0; a cell
 * that is neither and does not hold exactly two percentages is null — a
 * tariff the market cannot read, never a free one.
 * @returns {{precious: number, common: number}|null}
 */
export function parseTariffPct(text) {
  const t = String(text ?? "").toLowerCase().trim();
  if (!t) return null;
  if (/\bnone\b/.test(t) || /^[-–—]$/.test(t)) return { precious: 0, common: 0 };
  const pcts = [...t.replace(/,/g, "").matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) => Number(m[1]));
  return pcts.length === 2 ? { precious: pcts[0], common: pcts[1] } : null;
}

/**
 * A Moorage and Stabling cell (RR ch. 8, Engaging in Mercantile Ventures)
 * as a daily rate, `{cp, perShp}`: the copper one day costs and, where the
 * cell prices a ship by its size ("… per N shp"), the structural hit points
 * that copper covers; `perShp` is null for a flat rate. A cell with no coin
 * amount, or any other unit, is null: a rate the market cannot read, never
 * a free one.
 * @returns {{cp: number, perShp: number|null}|null}
 */
export function parseStayFee(text) {
  const [money, unit, extra] = String(text ?? "").toLowerCase().replace(/,/g, "").split(/\bper\b/);
  const cp = parseMoneyCp(money);
  if (!(cp > 0) || extra !== undefined) return null;
  if (unit === undefined) return { cp, perShp: null };
  const perShp = Number(unit.match(/^\s*(\d+(?:\.\d+)?)\s*shp\s*$/)?.[1]);
  return perShp > 0 ? { cp, perShp } : null;
}

/** "2d6" → {min: 2, max: 12}: the throw's ends. Null for anything but one plain die term. */
export function diceRange(formula) {
  const m = String(formula ?? "").trim().toLowerCase().match(/^(\d+)d(\d+)$/);
  if (!m) return null;
  const count = Number(m[1]);
  const faces = Number(m[2]);
  return count > 0 && faces > 0 ? { min: count, max: count * faces } : null;
}

/**
 * The tariff on the merchandise a party brings to market (RR ch. 8, Entering
 * the Market, step 3): each load's base cost — base price per stone × stones —
 * at its tier's rate, a good marked exempt charged nothing. The rates are
 * percentages, passed in. The total rounds up to a whole copper, as the toll
 * does.
 * A line keeps its good's `holderName` and `kind` (a load, or an item
 * declared for sale), so the quote can say whose goods it is.
 * @param {{category: string, label: string, stones: number, basePriceGp: number, tier: string, exempt: boolean, holderName?: string, kind?: string}[]} loads
 * @param {{precious: number, common: number}} rates
 * @returns {{totalCp: number, lines: {category: string, label: string, stones: number, tier: string, exempt: boolean, pct: number, cp: number, holderName: string, kind: string}[]}}
 */
export function tariffOn(loads, rates) {
  const lines = (loads ?? []).map((load) => {
    const tier = load.tier === "precious" ? "precious" : "common";
    const pct = load.exempt ? 0 : Math.max(0, Number(rates?.[tier]) || 0);
    const stones = Math.max(0, Number(load.stones) || 0);
    const cp = stones * Math.max(0, Number(load.basePriceGp) || 0) * pct;
    return {
      category: load.category,
      label: load.label,
      stones,
      tier,
      exempt: !!load.exempt,
      pct,
      cp,
      holderName: load.holderName ?? "",
      kind: load.kind ?? "load",
    };
  });
  const sum = lines.reduce((n, l) => n + l.cp, 0);
  return { totalCp: sum > 0 ? Math.ceil(sum - 1e-9) : 0, lines };
}

/**
 * Market impact (RR §VIII.6 step 2): cargo capacity over the baseline,
 * rounded half-to-even; capped at the printed maximum (the one class whose
 * cap scales with its urban families takes the larger of the two); impact 0
 * trades as the next lower class until it reaches 1, and always at least 1 in
 * the smallest class.
 *
 * A character of a party entering separately (`entrants` above 1, step 2,
 * Parties) is capped at the printed maximum shared among the party's
 * characters, rounded down so the shares never add up past it, in every class
 * the family-scaled one included. The cap holds at each class the drop
 * reaches, so a share of none trades down the classes like an impact of 0.
 *
 * @param {object} o
 * @param {number} o.impactCap - the printed maximum impact
 * @param {number} o.familyScaledClass - the market class whose cap scales with families
 * @param {number} o.familiesPerImpact - urban families per point of that scaled cap
 * @param {number} [o.entrants] - the party's characters, where they enter separately
 * @returns {{impact:number, effectiveClass:number, rawImpact:number, cap:number}} `rawImpact`
 *   is the figure at the market's own class before any drop, capped; `cap` the maximum
 */
export function marketImpact({ cargoSt, baselineCargoSt, marketClass, urbanFamilies = 0, baselineOfClass, impactCap, familyScaledClass, familiesPerImpact, entrants = 0 }) {
  const roundEven = (x) => {
    const f = Math.floor(x);
    const frac = x - f;
    if (Math.abs(frac - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
    return Math.round(x);
  };
  const top = requireNumber("impactCap", impactCap);
  const scaledClass = requireNumber("familyScaledClass", familyScaledClass);
  const perImpact = requireNumber("familiesPerImpact", familiesPerImpact);
  const shares = Math.floor(Number(entrants) || 0);
  const cap = shares > 1 ? Math.floor(top / shares) : marketClass === scaledClass ? Math.max(top, Math.floor((Number(urbanFamilies) || 0) / perImpact)) : top;
  const at = (baseline) => (baseline > 0 ? Math.min(cap, roundEven(cargoSt / baseline)) : 0);
  let cls = marketClass;
  let baseline = baselineCargoSt;
  let impact = at(baseline);
  const raw = impact;
  while (impact < 1 && cls < 6) {
    cls += 1;
    baseline = baselineOfClass ? baselineOfClass(cls) : baseline;
    impact = at(baseline);
  }
  if (cls === 6 && impact < 1) impact = 1;
  return { impact, effectiveClass: cls, rawImpact: raw, cap };
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

/** The character whose own venture a row belongs to: "" for a party entered as one, and on a row stored before entrants were. */
const entrantOf = (row) => row?.entrantUuid ?? "";

/**
 * Whether a venture, solicitation or venture-day row belongs to the venture
 * `key` names (`ventureKey`). The one test those rows are matched by.
 * @param {{partyId?: string, entrantUuid?: string}} row
 * @param {{partyId: string, entrantUuid: string}} key
 */
export const inVenture = (row, key) => !!row && row.partyId === key?.partyId && entrantOf(row) === (key?.entrantUuid ?? "");

/**
 * The venture a character acts in at a market this month: their own while
 * any of the party stands or waits entered separately, so a character who
 * has not entered beside them is not in; the party's (`entrantUuid` "")
 * otherwise. The two never stand together (`entryConflict`).
 * @param {{ventures?: object[], actions?: object[]}} state
 * @param {{partyId: string, actorUuid: string, monthStart: number}} who
 * @returns {{partyId: string, entrantUuid: string}}
 */
export function ventureKey({ ventures = [], actions = [] } = {}, { partyId, actorUuid, monthStart }) {
  const { rows, waiting } = entriesOf({ ventures, actions }, partyId, monthStart);
  return { partyId, entrantUuid: [...rows, ...waiting].some(entrantOf) ? actorUuid : "" };
}

/** A party's venture rows standing entered this month, and its entries waiting to resolve. */
function entriesOf({ ventures = [], actions = [] }, partyId, monthStart) {
  return {
    rows: (ventures ?? []).filter((v) => v?.entered && v.partyId === partyId && Number(v.monthStartTime) === Number(monthStart)),
    waiting: (actions ?? []).filter((a) => a?.status === "pending" && a.kind === "enter" && a.partyId === partyId),
  };
}

/**
 * Whether a character may enter a market this month as `mode` asks, and as
 * one of how many. `characters` is the party's character count now. An entry
 * as one is refused where the party stands or waits entered as one
 * (`alreadyEntered`) or any of its characters separately
 * (`enteredSeparately`). A separate entry is refused where the party stands
 * or waits entered as one (`enteredAsParty`), or the character already
 * stands or waits entered (`alreadyEntered`). It counts the party's
 * characters as the month's first separate entry stored them, else as
 * `characters`, and once that many stand or wait, another is refused
 * (`separateFull`, with the count). A party of one has no separate entry to
 * make, so it enters as one.
 * @param {{ventures?: object[], actions?: object[]}} state
 * @param {{partyId: string, actorUuid: string, monthStart: number, mode?: string, characters?: number}} o
 * @returns {{error: string, entrants?: number}|{entrants: number}} `entrants` 0 for an entry as one
 */
export function entryConflict({ ventures = [], actions = [] } = {}, { partyId, actorUuid, monthStart, mode = "party", characters = 1 }) {
  const { rows, waiting } = entriesOf({ ventures, actions }, partyId, monthStart);
  const standing = [...rows, ...waiting];
  const apart = standing.filter(entrantOf);
  // Stored on every separate entry of the month, standing or left: the first is the count.
  const stored = [...(ventures ?? []).filter((v) => v?.partyId === partyId && Number(v.monthStartTime) === Number(monthStart)), ...waiting]
    .filter(entrantOf)
    .map((x) => Math.floor(Number(x.entrants) || 0))
    .find((n) => n > 1);
  const entrants = stored ?? Math.floor(Number(characters) || 0);
  if (mode !== "separately" || entrants < 2) {
    if (standing.some((x) => !entrantOf(x))) return { error: "alreadyEntered" };
    if (apart.length) return { error: "enteredSeparately" };
    return { entrants: 0 };
  }
  if (standing.some((x) => !entrantOf(x))) return { error: "enteredAsParty" };
  if (apart.some((x) => entrantOf(x) === actorUuid)) return { error: "alreadyEntered" };
  if (new Set(apart.map(entrantOf)).size >= entrants) return { error: "separateFull", entrants };
  return { entrants };
}

/**
 * The vehicles already through a market's gate this month, whoever declared
 * them: on a venture row standing entered, or on an entry waiting to
 * resolve. A vehicle enters once.
 * @returns {Set<string>}
 */
export function vehiclesEntered({ ventures = [], actions = [] } = {}, monthStart) {
  const out = new Set();
  for (const v of ventures ?? []) if (v?.entered && Number(v.monthStartTime) === Number(monthStart)) for (const uuid of v.vehicleUuids ?? []) out.add(uuid);
  for (const a of actions ?? []) if (a?.status === "pending" && a.kind === "enter") for (const uuid of a.vehicleUuids ?? []) out.add(uuid);
  return out;
}

/**
 * The pending day this one would repeat, still waiting to resolve: the same
 * trader's same kind of day, or for a solicitation the same merchandise
 * solicited in the same venture (`venture`, a `ventureKey`), whoever of it
 * posted it — two members soliciting one good on one day share what it
 * opens rather than each opening it whole. A day already resolved or
 * withdrawn is no duplicate — the book lets a trader assess again tomorrow;
 * it is posting the same tomorrow twice that is refused. Undefined when
 * there is none. Without `venture`, a solicitation is matched by trader.
 * @param {{kind:string, actorUuid:string, partyId?:string, entrantUuid?:string, category?:string, status:string}[]} actions
 * @param {{kind:string, actorUuid:string, category?:string, venture?:{partyId:string, entrantUuid:string}|null}} day
 */
export function pendingDuplicate(actions, { kind, actorUuid, category = "", venture = null }) {
  return (actions ?? []).find((a) => {
    if (a.status !== "pending" || a.kind !== kind) return false;
    if (kind !== "solicit") return a.actorUuid === actorUuid;
    return (a.category ?? "") === category && (venture ? inVenture(a, venture) : a.actorUuid === actorUuid);
  });
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
 * A venture leaves the market it entered this month: the party's, or one
 * character's where the party entered separately (`entrantUuid`). Nothing
 * paid comes back: the toll stays with the gate, and what a day of
 * soliciting opened closes with the venture gone, so its solicitations are
 * dropped. A venture day of its own still waiting to resolve is withdrawn
 * with it — it cannot resolve for a venture that is not there. The month's
 * row is kept, entered no longer, so a later entry overwrites it with a fresh
 * declaration and a fresh toll. Another venture's rows, the same party's
 * included, are untouched. Mutates the given copies; `error` when the
 * venture is not in.
 * @param {{ventures:object[], actions:object[], solicitations:object[]}} state - cloned goods rows
 * @param {{partyId:string, entrantUuid?:string, monthStart:number}} o
 * @returns {{ok:true, cancelledIds:string[], droppedSolicitations:number}|{error:"notEntered"}}
 */
export function leaveMarket({ ventures, actions, solicitations }, { partyId, entrantUuid = "", monthStart }) {
  const key = { partyId, entrantUuid };
  const venture = (ventures ?? []).find((v) => inVenture(v, key) && Number(v.monthStartTime) === monthStart);
  if (!venture?.entered) return { error: "notEntered" };
  venture.entered = false;
  const cancelledIds = [];
  for (const a of actions ?? []) {
    if (a.status !== "pending" || !inVenture(a, key) || !["enter", "assess", "solicit"].includes(a.kind)) continue;
    a.status = "cancelled";
    cancelledIds.push(a.id);
  }
  let droppedSolicitations = 0;
  for (let i = (solicitations ?? []).length - 1; i >= 0; i--) {
    const s = solicitations[i];
    if (!inVenture(s, key) || Number(s.monthStartTime) !== monthStart) continue;
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

/** How a venture uses a mercantile network: whichever opens more, or the trader's pick. */
export const NETWORK_MODES = Object.freeze(["auto", "class", "impact"]);

/**
 * A mercantile network's two options on a venture in a known market (RR ch. 8,
 * Entering the Market, Mercantile Networks). The CLASS option reads the
 * merchandise `classStep` classes larger, never past Class I, at the impact
 * the cargo earned. The IMPACT option trades at the market's own class with
 * `impactStep` more impact, counted from the impact earned there before any
 * drop (so a party with none trades at the step itself) and never past the
 * maximum. Neither touches the toll, which is figured from the cargo alone. An
 * option whose step is absent (0, or not imported) is null.
 * @param {{impact: number, effectiveClass: number, rawImpact: number, trueClass: number, cap: number, classStep?: number, impactStep?: number}} o
 * @returns {{classOption: {cls: number, imp: number}|null, impactOption: {cls: number, imp: number}|null}}
 */
export function networkOptions({ impact, effectiveClass, rawImpact, trueClass, cap, classStep = 0, impactStep = 0 }) {
  const cs = Math.max(0, Math.floor(Number(classStep) || 0));
  const is = Math.max(0, Math.floor(Number(impactStep) || 0));
  return {
    classOption: cs > 0 ? { cls: Math.max(1, Number(effectiveClass) - cs), imp: Number(impact) } : null,
    impactOption: is > 0 ? { cls: Number(trueClass), imp: Math.max(1, Math.min(Number(cap), (Number(rawImpact) || 0) + is)) } : null,
  };
}

/**
 * The option a solicitation trades at. `auto` takes whichever opens the most
 * stones of this good (`stonesAt(cls, imp)`), keeping the plain entry on a tie
 * and the class option over the impact one; a pinned mode takes its option
 * where it exists and the plain entry where it does not.
 * @returns {{cls: number, imp: number, used: "base"|"class"|"impact"}}
 */
export function pickNetworkOption({ base, classOption = null, impactOption = null, mode = "auto", stonesAt }) {
  const as = (opt, used) => ({ cls: opt.cls, imp: opt.imp, used });
  if (mode === "class") return classOption ? as(classOption, "class") : as(base, "base");
  if (mode === "impact") return impactOption ? as(impactOption, "impact") : as(base, "base");
  let best = as(base, "base");
  for (const [opt, used] of [
    [classOption, "class"],
    [impactOption, "impact"],
  ]) {
    if (opt && stonesAt(opt.cls, opt.imp) > stonesAt(best.cls, best.imp)) best = as(opt, used);
  }
  return best;
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
