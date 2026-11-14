/**
 * Availability-expression parsing and rolling. Pure module — the parser has
 * no Foundry dependency; `rollAvailability` accepts an async dice function so
 * tests can inject a deterministic roller while Foundry injects `Roll`.
 *
 * The availability tables (RR 164–165) give a quantity as an expression:
 *   "NdM"          — roll dice
 *   "NdM×K"        — roll dice, multiply
 *   "N"            — fixed quantity
 *   "N (P%)"       — N available P% of the time
 *   "NdM (P%)"     — P% chance of NdM
 *   "NdM-K"        — dice with a flat modifier
 *   "-"            — never available
 */

const EXPR_RE = /^(?:(\d+)d(\d+))?\s*([+-]\d+)?\s*(?:[x×]\s*(\d+))?\s*(?:\((\d+)%\))?$/i;

/**
 * Parse an availability expression into dice count, die, modifier, multiplier and percent chance.
 * @param {string|number} expr
 * @returns {{count: number, die: number, mod: number, mult: number, chance: number}|null}
 *   null when the expression means "not available".
 */
export function parseAvailability(expr) {
  if (expr === null || expr === undefined) return null;
  if (typeof expr === "number") return { count: 0, die: 0, mod: expr, mult: 1, chance: 100 };
  const text = String(expr).trim();
  if (!text || text === "-" || text === "—") return null;
  // Fixed quantity with optional chance: "N" or "N (P%)".
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

/** Slack that keeps a share of a whole count from rounding the wrong way on a float's last bit. */
const SHARE_SLACK = 1e-9;

/**
 * The three-week arrival split (RR 162): the first share of a month's pool
 * rounds up into week 1, the second share rounds down into week 2 but never
 * below its minimum (and never past what week 1 left), and the remainder
 * arrives in week 3. The shares and the minimum are the Judge's imported
 * figures (`arrivalShares`); the rounding directions are the procedure.
 *
 * With no shares nothing is scheduled: the answer is null, never a default.
 * @param {number} total - the month's pool for one segment
 * @param {{first: number, second: number, secondMin: number}|null} shares
 * @returns {[number, number, number]|null} candidates arriving in weeks 1-3
 */
export function arrivalSplit(total, shares) {
  if (!shares) return null;
  if (!(total > 0)) return [0, 0, 0];
  const week1 = Math.min(total, Math.ceil(total * shares.first - SHARE_SLACK));
  const week2 = Math.min(Math.max(Math.floor(total * shares.second + SHARE_SLACK), shares.secondMin), total - week1);
  return [week1, week2, total - week1 - week2];
}
