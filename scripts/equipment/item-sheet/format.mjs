/**
 * Display formatting for the item sheet — pure, Foundry-free.
 *
 * The books write weight as stone with vulgar fractions and prices as
 * thousands-separated gold; every badge on the sheet reads through here so the
 * title band, the contents list and the price ledger cannot disagree about how
 * a number looks.
 */

/** The six sixths of a stone as the books print them. Index = sixths. */
const SIXTHS = ["", "¹⁄₆", "¹⁄₃", "¹⁄₂", "²⁄₃", "⁵⁄₆"];

/** An em dash, the sheet's one "nothing here" mark. */
export const DASH = "—";

/**
 * A weight in sixths of a stone as the sheet shows it: `4`, `¹⁄₆`, `2¹⁄₂`,
 * and a dash for nothing at all. Anything that is not a whole number of sixths
 * (a hand-typed 0.25) falls back to two decimals so it is never silently
 * rounded to a fraction it is not.
 */
export function stoneLabel(weight6) {
  const w = Number(weight6);
  if (!Number.isFinite(w) || w <= 0) return DASH;
  if (!Number.isInteger(w)) return String(Math.round((w / 6) * 100) / 100);
  const whole = Math.floor(w / 6);
  const rest = w % 6;
  if (!rest) return String(whole);
  return `${whole || ""}${SIXTHS[rest]}`;
}

/**
 * A gold amount: thousands-separated, decimals only where there are any.
 * `null`/`undefined` reads as a dash — an unknown price is not a free one.
 */
export function gpLabel(cost) {
  if (cost === null || cost === undefined || cost === "") return DASH;
  const n = Number(cost);
  if (!Number.isFinite(n)) return DASH;
  const rounded = Math.round(n * 100) / 100;
  const [whole, frac] = String(Math.abs(rounded)).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${rounded < 0 ? "−" : ""}${grouped}${frac ? `.${frac}` : ""} gp`;
}

/** A signed modifier with a real minus sign: `+1`, `−2`, `+0`. */
export function signed(n) {
  const v = Number(n) || 0;
  return v < 0 ? `−${Math.abs(v)}` : `+${v}`;
}

/** A multiplier as the ledger prints it: `× 10`, `× 0.67`. */
export function timesLabel(mult) {
  const m = Math.round(Number(mult) * 100) / 100;
  return `× ${m}`;
}

/** A whole percentage, clamped to 0–100. */
export function pctLabel(ratio) {
  const r = Number(ratio);
  if (!Number.isFinite(r)) return "0%";
  return `${Math.round(Math.min(1, Math.max(0, r)) * 100)}%`;
}

/** The first letter of a name, for the initial tiles. */
export function initialOf(name) {
  return String(name ?? "").trim().charAt(0).toUpperCase() || "?";
}
