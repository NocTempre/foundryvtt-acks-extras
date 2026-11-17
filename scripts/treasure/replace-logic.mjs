/**
 * The replace planner: which of a pot's lots a replacing seed takes the place
 * of. Foundry-free and import-free; it reads `{id, worth}` rows where `worth`
 * is the apparent worth in gp the bands rank by (`pot-logic.mjs` `rankWorth`),
 * so a seed is judged by what a seat would take it to be worth and never by
 * what its truth says.
 *
 * A lot is taken whole. Each seed, in the order given, takes the fewest of the
 * lots still free whose worth together covers its own; among sets of that size
 * the smallest total wins, and a tie goes to the set whose lots come first in
 * the pot. A lot one seed has taken is not offered to the next. Worths are
 * compared in hundredths of a gp so no float noise decides a tie.
 */

/** The most search nodes one seed's exact subset search may visit before it keeps the best set found. */
export const REPLACE_NODE_LIMIT = 200000;

const cents = (gp) => Math.round((Number(gp) || 0) * 100);
const gpOf = (c) => c / 100;

/**
 * The `k` lots (indices into `rows`) whose worths cover `target` with the least
 * total, ties to the earliest pot position. Include-first depth search over
 * the pot order: the first set reaching a total is the lexicographically
 * earliest one with it, and only a strictly smaller total replaces it.
 * Returns null when no `k`-set covers `target`.
 */
function bestSet(rows, k, target) {
  const n = rows.length;
  const reach = rows.map((_, i) => {
    const desc = rows.slice(i).map((r) => r.c).sort((a, b) => b - a);
    const out = [0];
    for (const c of desc) out.push(out[out.length - 1] + c);
    return out;
  });
  let best = null;
  let bestSum = Infinity;
  let nodes = 0;
  let capped = false;
  const chosen = [];
  const walk = (i, sum) => {
    const need = k - chosen.length;
    if (!need) {
      if (sum >= target && sum < bestSum) {
        best = [...chosen];
        bestSum = sum;
      }
      return;
    }
    if (n - i < need || sum >= bestSum || sum + reach[i][need] < target) return;
    if (++nodes > REPLACE_NODE_LIMIT) {
      capped = true;
      return;
    }
    chosen.push(i);
    walk(i + 1, sum + rows[i].c);
    chosen.pop();
    if (!capped) walk(i + 1, sum);
  };
  walk(0, 0);
  if (best) return best;
  const byWorth = rows.map((r, i) => ({ i, c: r.c })).sort((a, b) => b.c - a.c || a.i - b.i).slice(0, k);
  const sum = byWorth.reduce((s, r) => s + r.c, 0);
  return sum >= target ? byWorth.map((r) => r.i).sort((a, b) => a - b) : null;
}

/**
 * Plan every replacing seed over the lots, in turn.
 * @param {{seeds: Array<{id: string, worth: number}>, lots: Array<{id: string, worth: number}>}} input
 *   `lots` in pot order. A lot worth nothing is never taken, and a seed worth
 *   nothing takes nothing.
 * @returns {{plans: Array<object>, struck: string[]}} one entry per seed, in
 *   the seeds' order: `{seedId, ok: true, struck, worthGp, takenGp, overGp}`,
 *   or `{seedId, ok: false, code: "shortfall", struck: [], worthGp, availableGp,
 *   shortGp}` where the lots still free cannot cover the seed, which then takes
 *   none. `struck` is every lot id taken, in pot order.
 */
export function planReplace({ seeds = [], lots = [] } = {}) {
  const free = lots.map((l) => ({ id: l.id, c: cents(l.worth) })).filter((l) => l.c > 0);
  const taken = new Set();
  const plans = [];
  for (const seed of seeds) {
    const target = cents(seed.worth);
    const open = free.filter((l) => !taken.has(l.id));
    const available = open.reduce((s, l) => s + l.c, 0);
    if (target <= 0) {
      plans.push({ seedId: seed.id, ok: true, struck: [], worthGp: 0, takenGp: 0, overGp: 0 });
      continue;
    }
    if (available < target) {
      plans.push({ seedId: seed.id, ok: false, code: "shortfall", struck: [], worthGp: gpOf(target), availableGp: gpOf(available), shortGp: gpOf(target - available) });
      continue;
    }
    let k = 0;
    for (let sum = 0, desc = open.map((l) => l.c).sort((a, b) => b - a); sum < target; k++) sum += desc[k];
    const picked = bestSet(open, k, target).map((i) => open[i]);
    for (const l of picked) taken.add(l.id);
    const sum = picked.reduce((s, l) => s + l.c, 0);
    plans.push({ seedId: seed.id, ok: true, struck: picked.map((l) => l.id), worthGp: gpOf(target), takenGp: gpOf(sum), overGp: gpOf(sum - target) });
  }
  return { plans, struck: lots.map((l) => l.id).filter((id) => taken.has(id)) };
}
