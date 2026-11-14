/**
 * The toll and the duty a city's gates charge merchandise (AX3 p. 56), the
 * alternative to the class toll and tariff (RR ch. 8) that a market opts into.
 * Pure module: the dice, the stones one throw covers and the duty percent are the
 * Judge's own, imported, and arrive as arguments.
 */
import { roundHalfEven } from "./arbitrage.mjs";

const COPPER_PER_GP = 100;

/** Which charge a market's gate takes: the class's toll and tariff, or the city's toll and duty. */
export const GATE_TOLLS = Object.freeze(["class", "city"]);

/**
 * One dice term with an optional modifier, `{count, faces, mod}` ("d6", "4d6+2");
 * null for anything else.
 */
export function parseDiceTerm(formula) {
  const m = String(formula ?? "").trim().toLowerCase().match(/^(\d*)\s*d\s*(\d+)\s*(?:([+-])\s*(\d+))?$/);
  if (!m) return null;
  const count = m[1] === "" ? 1 : Number(m[1]);
  const faces = Number(m[2]);
  if (!(count > 0) || !(faces > 0)) return null;
  return { count, faces, mod: m[3] ? (m[3] === "-" ? -1 : 1) * Number(m[4]) : 0 };
}

/**
 * A dice term thrown `units` times as one throw: the count and the modifier both
 * multiply ("4d6+2" ×3 → "12d6+6"); null where it does not read.
 */
export function scaleDice(formula, units) {
  const term = parseDiceTerm(formula);
  if (!term || !Number.isInteger(units) || units < 1) return null;
  const mod = term.mod * units;
  return `${term.count * units}d${term.faces}${mod > 0 ? `+${mod}` : mod < 0 ? `${mod}` : ""}`;
}

/** The lowest and highest totals a dice term can throw, its modifier included; null where it does not read. */
export function diceSpan(formula) {
  const term = parseDiceTerm(formula);
  return term ? { min: term.count + term.mod, max: term.count * term.faces + term.mod } : null;
}

/**
 * The stones of merchandise a gate assesses: a load's stones and an item's
 * `weightSt`, its `stones` counting its pieces; smuggled goods are not passed.
 */
export function merchandiseStonesOf(rows) {
  return (rows ?? []).reduce((n, r) => n + Math.max(0, Number((r?.kind === "item" ? r.weightSt : r?.stones) ?? 0) || 0), 0);
}

/**
 * The toll on `merchandiseSt` stones: whole units of `perStones` (nearest, half to
 * even) and the one scaled throw they make, in gp; `formula` is null when none is owed.
 * @param {object} o
 * @param {number} o.merchandiseSt
 * @param {string} o.dice - the printed dice, in gp
 * @param {number} o.perStones - the stones one throw covers
 * @returns {{units: number, formula: string|null, range: {minCp: number, maxCp: number}}}
 */
export function cityTollOn({ merchandiseSt, dice, perStones }) {
  const per = Number(perStones);
  const units = per > 0 ? roundHalfEven(Math.max(0, Number(merchandiseSt) || 0) / per) : 0;
  const formula = scaleDice(dice, units);
  const span = formula ? diceSpan(formula) : null;
  const cp = (gp) => Math.max(0, Math.round(gp * COPPER_PER_GP));
  return { units: formula ? units : 0, formula, range: span ? { minCp: cp(span.min), maxCp: cp(span.max) } : { minCp: 0, maxCp: 0 } };
}

/**
 * The duty on the goods coming in: each line's `valueCp` at `pct` percent, rounded
 * up to a whole copper; a line with no value is charged nothing.
 * @param {{valueCp?: number|null}[]} lines
 * @param {number} pct
 * @returns {{totalCp: number, lines: object[]}} each line kept with its `pct` and `cp`
 */
export function dutyOn(lines, pct) {
  const rate = Math.max(0, Number(pct) || 0);
  const out = (lines ?? []).map((line) => {
    const value = Math.max(0, Number(line?.valueCp) || 0);
    return { ...line, pct: rate, cp: value > 0 && rate > 0 ? Math.ceil((value * rate) / 100 - 1e-9) : 0 };
  });
  return { totalCp: out.reduce((n, l) => n + l.cp, 0), lines: out };
}
