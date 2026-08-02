/**
 * Availability-expression parsing and rolling. Pure module — the parser has
 * no Foundry dependency; `rollAvailability` accepts an async dice function so
 * tests can inject a deterministic roller while Foundry injects `Roll`.
 *
 * The ACKS availability tables (RR 164–165) use expressions like:
 *   "4d100"        — roll dice
 *   "2d4×50"       — roll dice, multiply
 *   "1"            — fixed quantity
 *   "1 (85%)"      — one available 85% of the time
 *   "1d2 (50%)"    — 50% chance of 1d2
 *   "1d4-3"        — dice with flat modifier (spell availability)
 *   "-"            — never available
 */

const EXPR_RE = /^(?:(\d+)d(\d+))?\s*([+-]\d+)?\s*(?:[x×]\s*(\d+))?\s*(?:\((\d+)%\))?$/i;

/**
 * @param {string|number} expr
 * @returns {{count: number, die: number, mod: number, mult: number, chance: number}|null}
 *   null when the expression means "not available".
 */
export function parseAvailability(expr) {
  if (expr === null || expr === undefined) return null;
  if (typeof expr === "number") return { count: 0, die: 0, mod: expr, mult: 1, chance: 100 };
  const text = String(expr).trim();
  if (!text || text === "-" || text === "—") return null;
  // Fixed quantity with optional chance, e.g. "1", "1 (85%)", "2"
  const fixed = text.match(/^(\d+)\s*(?:\((\d+)%\))?$/);
  if (fixed) return { count: 0, die: 0, mod: parseInt(fixed[1], 10), mult: 1, chance: fixed[2] ? parseInt(fixed[2], 10) : 100 };
  const m = text.match(EXPR_RE);
  if (!m || (!m[1] && !m[3])) return null;
  return {
    count: m[1] ? parseInt(m[1], 10) : 0,
    die: m[2] ? parseInt(m[2], 10) : 0,
    mod: m[3] ? parseInt(m[3], 10) : 0,
    mult: m[4] ? parseInt(m[4], 10) : 1,
    chance: m[5] ? parseInt(m[5], 10) : 100,
  };
}

/**
 * Roll an availability expression.
 * @param {string|number} expr
 * @param {(formula: string) => Promise<number>} rollDice - async "NdM" roller
 * @param {() => number} [rand=Math.random] - percentile source for (NN%)
 * @returns {Promise<{quantity: number, detail: string}>}
 */
export async function rollAvailability(expr, rollDice, rand = Math.random) {
  const parsed = parseAvailability(expr);
  if (!parsed) return { quantity: 0, detail: "—" };
  if (parsed.chance < 100) {
    const pct = Math.floor(rand() * 100) + 1;
    if (pct > parsed.chance) return { quantity: 0, detail: `${expr}: ${pct}% > ${parsed.chance}%` };
  }
  let base = parsed.mod;
  if (parsed.count > 0) base += await rollDice(`${parsed.count}d${parsed.die}`);
  const quantity = Math.max(0, base * parsed.mult);
  return { quantity, detail: `${expr} → ${quantity}` };
}

/**
 * The three-week arrival split (RR 162): ½ round up in week 1, ¼ round down
 * (min 1) in week 2, remainder in week 3.
 * @param {number} total
 * @returns {[number, number, number]} candidates arriving in weeks 1–3
 */
export function arrivalSplit(total) {
  if (total <= 0) return [0, 0, 0];
  // RR 162: ½ (round up) arrive week 1, ¼ (round DOWN — may be zero) week 2,
  // the rest week 3, none week 4.
  const week1 = Math.ceil(total / 2);
  const week2 = Math.min(Math.floor(total / 4), total - week1);
  const week3 = total - week1 - week2;
  return [week1, Math.max(0, week2), Math.max(0, week3)];
}
