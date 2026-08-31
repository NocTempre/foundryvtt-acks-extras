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

/**
 * The band's weight badge shows sixths as decimal stone, and writes back what
 * it shows. These two are that conversion, extracted so the round trip can be
 * pinned offline: the badge is a DERIVED control over a stored field, and a
 * derived control that submits on every form change re-quantises the value it
 * displays.
 *
 * The trip is lossy by construction — `weight6FromStone(weightStoneOf(w))`
 * returns `w` only for a whole number of sixths. A bundle's per-unit weight is
 * a fraction of a sixth (twenty arrows at a sixth for the quiver is `0.05`
 * each) and does NOT survive it, which is why the sheet writes the weight back
 * only when the weight badge is the control that fired the change.
 */
export const STONE_SIXTHS = 6;

/** A stored weight in sixths, as the badge displays it: stone, to three places. */
export function weightStoneOf(weight6) {
  const w = Number(weight6);
  if (!Number.isFinite(w)) return null;
  return Math.round((w / STONE_SIXTHS) * 1000) / 1000;
}

/** A typed weight in stone, as the badge stores it: whole sixths, never negative. */
export function weight6FromStone(stone) {
  const st = Number(stone);
  if (!Number.isFinite(st)) return null;
  return Math.max(0, Math.round(st * STONE_SIXTHS));
}
