/**
 * Quick grab's planner on plain data, Foundry-free: who takes which of the
 * pot's lots so the party keeps moving as fast as it can. It is the only
 * planner: the relay runs it again on the GM's client and never reads a plan
 * out of a payload.
 *
 * A lot is `{id, weight6, coin?: {name, cv, count}}`; a coin lot's `weight6` is
 * the whole stack's, so one coin weighs `weight6 / count` and a stack splits by
 * whole coins. A member is `{id, capacity6, load6, casualty?, hasDocument}`:
 * `capacity6` is the most the member can bear (lib's `capacity6`) and `load6`
 * what they bear now, so the room is the difference. A member with no document,
 * a casualty, or no stated capacity or load takes nothing, and so does one
 * whose pace `paceWith` cannot give.
 *
 * `paceWith(memberId, adding6)` answers a rank for that member bearing
 * `adding6` more than now, a larger rank being slower, and a non-finite answer
 * meaning no figure. It must not fall as `adding6` rises. The planner never
 * states a pace step of its own: where a pace changes is whatever `paceWith`
 * says, found by probing it.
 *
 * The plan: the party's pace is its slowest member's. The lots that can be
 * placed at all are fixed first, with only capacity limiting them. Then each
 * party pace is tried from fastest down, placing whole lots heaviest first by
 * best fit (an exact search over the whole lots when there are
 * `EXACT_LOT_LIMIT` or fewer) and pouring coin by whole coins into what room
 * is left; the first pace that places the set wins. A worst-fit re-pack at that
 * pace then evens the loads, kept only if it places the same set. Ties go to
 * the lower member id, then the earlier lot in the pot's order, so equal input
 * gives an equal plan.
 */

/** Whole-lot counts at or below this are placed by exact search rather than by best fit alone. */
export const EXACT_LOT_LIMIT = 12;

/** The exact search gives up on a rank after this many nodes and that rank counts as not placing. */
const NODE_LIMIT = 200000;
const EPS = 1e-9;
const PROBES = 32;
const LEVEL_LIMIT = 256;
const POUR_LIMIT = 50000;

/** Why a lot, or a member, ended up unplaced. */
export const GRAB_NOTE = Object.freeze({
  excluded: "excluded",
  tooHeavy: "tooHeavy",
  noRoom: "noRoom",
  noMembers: "noMembers",
});

const finite = (v) => typeof v === "number" && Number.isFinite(v);
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Plan a Quick grab.
 * @param {object} input
 * @param {{id: string, capacity6: number|null, load6: number|null, casualty?: boolean, hasDocument: boolean}[]} input.members
 * @param {{id: string, weight6: number, coin?: {name: string, cv: number, count: number}|null}[]} input.lots
 * @param {(memberId: string, adding6: number) => number|null} input.paceWith
 * @returns {{assignments: {lotId: string, memberId: string, count?: number}[],
 *   pace: number|null, leftover: {lotId: string, count?: number}[],
 *   notes: {code: string, lotId?: string, memberId?: string, why?: string}[]}}
 *   `pace` is the party's rank under the plan, read from `paceWith` at the final loads
 */
export function planGrab({ members = [], lots = [], paceWith } = {}) {
  const notes = [];
  const ms = [];
  const rankMemo = new Map();
  const rankOf = (mi, w) => {
    const key = `${mi}|${w}`;
    if (rankMemo.has(key)) return rankMemo.get(key);
    let r = null;
    try {
      r = paceWith(ms[mi].id, w);
    } catch {
      r = null;
    }
    // No figure is the slowest pace there is, so it never passes a `<= rank` test, whatever the sign of the ranks.
    r = finite(r) ? r : Infinity;
    rankMemo.set(key, r);
    return r;
  };

  for (const m of [...(members ?? [])].sort(byId)) {
    const why = !m.hasDocument ? "noDocument" : m.casualty ? "casualty" : !finite(m.capacity6) ? "noCapacity" : !finite(m.load6) ? "noLoad" : null;
    if (why) {
      notes.push({ code: GRAB_NOTE.excluded, memberId: m.id, why });
      continue;
    }
    ms.push({ id: m.id, room: Math.max(0, m.capacity6 - m.load6) });
    if (!finite(rankOf(ms.length - 1, 0))) {
      ms.pop();
      notes.push({ code: GRAB_NOTE.excluded, memberId: m.id, why: "noFigure" });
    }
  }

  const wholes = [];
  const coins = [];
  (lots ?? []).forEach((lot, index) => {
    const weight6 = finite(lot?.weight6) ? Math.max(0, lot.weight6) : 0;
    const count = Math.floor(Number(lot?.coin?.count));
    if (lot?.coin && count > 0) coins.push({ id: lot.id, index, count, per: weight6 / count, weight6 });
    else if (!lot?.coin) wholes.push({ id: lot.id, index, weight6 });
  });
  const heaviest = (a, b) => b.weight6 - a.weight6 || a.index - b.index;
  wholes.sort(heaviest);
  coins.sort(heaviest);

  if (!ms.length) {
    if (wholes.length || coins.length) notes.push({ code: GRAB_NOTE.noMembers });
    return {
      assignments: [],
      pace: null,
      leftover: [...wholes, ...coins].sort((a, b) => a.index - b.index).map((l) => (l.per === undefined ? { lotId: l.id } : { lotId: l.id, count: l.count })),
      notes,
    };
  }

  const budgetMemo = new Map();
  /** The most a member can bear at rank `r`: the room, or where their rank passes `r`, found by probing. */
  const budgetOf = (mi, r) => {
    const room = ms[mi].room;
    if (r === Infinity || rankOf(mi, room) <= r) return room;
    const key = `${mi}|${r}`;
    if (budgetMemo.has(key)) return budgetMemo.get(key);
    let lo = 0;
    let hi = room;
    for (let k = 0; k < PROBES; k++) {
      const mid = (lo + hi) / 2;
      if (rankOf(mi, mid) <= r) lo = mid;
      else hi = mid;
    }
    budgetMemo.set(key, lo);
    return lo;
  };

  const canTake = (mi, loads, extra, r) => {
    const total = loads[mi] + extra;
    if (total > ms[mi].room + EPS) return false;
    const rank = rankOf(mi, total);
    return r === Infinity ? rank !== Infinity : rank <= r;
  };

  const maxCoins = (mi, loads, per, left, r) => {
    if (per <= EPS) return canTake(mi, loads, 0, r) ? left : 0;
    let lo = 0;
    let hi = left;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (canTake(mi, loads, mid * per, r)) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  const remaining = (mi, loads, r) => budgetOf(mi, r) - loads[mi];
  const indices = ms.map((_, i) => i);

  /** Pour each coin lot by whole coins into the room that is left. Mutates `loads`. */
  const pour = (pieces, loads, r, pref) => {
    const gives = [];
    const left = [];
    for (const coin of pieces) {
      let rest = coin.count;
      const give = (mi, k) => {
        if (k <= 0) return;
        loads[mi] += k * coin.per;
        rest -= k;
        gives.push({ coin, mi, k });
      };
      const bestFit = () => {
        const order = [...indices].sort((a, b) => remaining(a, loads, r) - remaining(b, loads, r) || a - b);
        for (const mi of order) {
          if (rest > 0) give(mi, maxCoins(mi, loads, coin.per, rest, r));
        }
      };
      if (pref === "worst") {
        let guard = 0;
        while (rest > 0 && guard++ < POUR_LIMIT) {
          const order = [...indices].sort((a, b) => remaining(b, loads, r) - remaining(a, loads, r) || a - b);
          const pos = order.findIndex((mi) => canTake(mi, loads, coin.per, r));
          if (pos < 0) break;
          const top = order[pos];
          const chunk = pos + 1 < order.length
            ? Math.max(1, Math.floor((remaining(top, loads, r) - remaining(order[pos + 1], loads, r)) / Math.max(coin.per, EPS)))
            : rest;
          give(top, maxCoins(top, loads, coin.per, Math.min(chunk, rest), r));
        }
        if (rest > 0) bestFit();
      } else {
        bestFit();
      }
      left.push({ coin, left: rest });
    }
    return { gives, left };
  };

  /**
   * Place the pieces at rank `r`. `pref` picks the member for each whole lot
   * (best fit: least room left over; worst fit: most). `exact` backtracks over
   * the whole lots. `skip` places what it can and reports the rest; otherwise
   * every piece must be placed or the answer is null.
   */
  const pack = (wholeLots, coinLots, r, { pref = "best", exact = false, skip = false } = {}) => {
    const loads = new Array(ms.length).fill(0);
    const chosen = new Array(wholeLots.length).fill(-1);
    const dead = new Set();
    let nodes = 0;
    let found = null;

    const order = (w) => indices
      .filter((mi) => canTake(mi, loads, w, r))
      .sort((a, b) => {
        const sa = remaining(a, loads, r) - w;
        const sb = remaining(b, loads, r) - w;
        return (pref === "worst" ? sb - sa : sa - sb) || a - b;
      });

    const leaf = () => {
      // Coin goes into a copy: a leaf that fails must leave the search's loads as they were.
      const withCoin = [...loads];
      const poured = pour(coinLots, withCoin, r, pref);
      if (!skip && poured.left.some((c) => c.left > 0)) return false;
      found = { loads: withCoin, chosen: [...chosen], poured };
      return true;
    };

    // What a member can still take at this rank is the cap less the load, so a member
    // is told from another by those two figures alone: the search treats equals as one.
    const caps = indices.map((mi) => Math.min(ms[mi].room, budgetOf(mi, r)));
    const suffix = new Array(wholeLots.length + 1).fill(coinLots.reduce((sum, c) => sum + c.count * c.per, 0));
    for (let i = wholeLots.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + wholeLots[i].weight6;

    const go = (i) => {
      if (i === wholeLots.length) return leaf();
      if (!skip) {
        // Everything left to place must fit in the room that is left; the cap is probed from below, so the margin.
        const room = indices.reduce((sum, mi) => sum + caps[mi] - loads[mi], 0);
        if (suffix[i] > room + 1e-6 * (1 + room)) return false;
      }
      const key = exact ? `${i}|${indices.map((mi) => `${caps[mi]}:${loads[mi]}`).sort().join(",")}` : "";
      if (exact) {
        if (dead.has(key) || ++nodes > NODE_LIMIT) return false;
      }
      const w = wholeLots[i].weight6;
      let options = order(w);
      if (!options.length) return skip ? go(i + 1) : false;
      if (exact) {
        const seen = new Set();
        options = options.filter((mi) => {
          const same = `${caps[mi]}:${loads[mi]}`;
          return seen.has(same) ? false : (seen.add(same), true);
        });
      }
      for (const mi of exact ? options : options.slice(0, 1)) {
        const before = loads[mi];
        loads[mi] = before + w;
        chosen[i] = mi;
        const ok = go(i + 1);
        loads[mi] = before;
        chosen[i] = -1;
        if (ok) return true;
      }
      if (exact) dead.add(key);
      return false;
    };

    return go(0) ? found : null;
  };

  const maxRoom = Math.max(...ms.map((m) => m.room));
  const tooHeavy = new Set();
  const fits = [];
  for (const lot of wholes) (lot.weight6 > maxRoom + EPS ? tooHeavy.add(lot.id) : fits.push(lot));
  const exact = fits.length <= EXACT_LOT_LIMIT;

  // The lots that can be placed at all, with only capacity limiting them.
  const widest = pack(fits, coins, Infinity, { exact }) ?? pack(fits, coins, Infinity, { skip: true });
  const placedWholes = fits.filter((_, i) => widest.chosen[i] >= 0);
  const placedCoins = new Map();
  for (const { coin, mi, k } of widest.poured.gives) {
    if (mi >= 0) placedCoins.set(coin.id, (placedCoins.get(coin.id) ?? 0) + k);
  }
  const coinSet = coins.filter((c) => placedCoins.get(c.id) > 0).map((c) => ({ ...c, count: placedCoins.get(c.id) }));

  // Each party pace from fastest down, over the ranks a member's own figure steps through.
  const floor = Math.max(...indices.map((mi) => rankOf(mi, 0)));
  const ranks = new Set();
  for (const mi of indices) {
    const room = ms[mi].room;
    let r = rankOf(mi, 0);
    let lo = 0;
    ranks.add(r);
    for (let step = 0; step < LEVEL_LIMIT && r < rankOf(mi, room); step++) {
      let a = lo;
      let b = room;
      for (let k = 0; k < PROBES; k++) {
        const mid = (a + b) / 2;
        if (rankOf(mi, mid) > r) b = mid;
        else a = mid;
      }
      r = rankOf(mi, b);
      if (!finite(r)) break;
      ranks.add(r);
      lo = b;
    }
  }
  const candidates = [...ranks].filter((r) => r >= floor).sort((a, b) => a - b);

  let plan = null;
  let at = Infinity;
  for (const r of candidates) {
    plan = pack(placedWholes, coinSet, r, { exact: placedWholes.length <= EXACT_LOT_LIMIT });
    if (plan) {
      at = r;
      break;
    }
  }
  if (!plan) plan = pack(placedWholes, coinSet, Infinity, { exact: placedWholes.length <= EXACT_LOT_LIMIT }) ?? widest;
  const paceOf = (loads) => Math.max(...indices.map((mi) => rankOf(mi, loads[mi])));
  const even = pack(placedWholes, coinSet, at, { pref: "worst" });
  if (even && paceOf(even.loads) <= paceOf(plan.loads)) plan = even;

  // The plan's pieces, read back as assignments and what is left.
  const assignments = [];
  const placedOf = new Map();
  const wholesOf = plan === widest ? fits : placedWholes;
  wholesOf.forEach((lot, i) => {
    const mi = plan.chosen[i];
    if (mi < 0) return;
    assignments.push({ lotId: lot.id, memberId: ms[mi].id, index: lot.index });
    placedOf.set(lot.id, true);
  });
  const coinPlaced = new Map();
  // A pour gives in chunks; one assignment says each member's whole share of a stack.
  const shares = new Map();
  for (const { coin, mi, k } of plan.poured.gives) {
    const key = `${coin.id}|${mi}`;
    const share = shares.get(key) ?? { lotId: coin.id, memberId: ms[mi].id, count: 0, index: coin.index };
    share.count += k;
    shares.set(key, share);
    coinPlaced.set(coin.id, (coinPlaced.get(coin.id) ?? 0) + k);
  }
  assignments.push(...shares.values());
  assignments.sort((a, b) => a.index - b.index || (a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0));

  const leftover = [];
  for (const lot of wholes) {
    if (placedOf.has(lot.id)) continue;
    leftover.push({ lotId: lot.id, index: lot.index });
    notes.push({ code: tooHeavy.has(lot.id) ? GRAB_NOTE.tooHeavy : GRAB_NOTE.noRoom, lotId: lot.id });
  }
  for (const coin of coins) {
    const rest = coin.count - (coinPlaced.get(coin.id) ?? 0);
    if (rest <= 0) continue;
    leftover.push({ lotId: coin.id, count: rest, index: coin.index });
    notes.push({ code: coin.per > maxRoom + EPS ? GRAB_NOTE.tooHeavy : GRAB_NOTE.noRoom, lotId: coin.id });
  }
  leftover.sort((a, b) => a.index - b.index);

  return {
    assignments: assignments.map(({ index, ...rest }) => rest),
    pace: paceOf(plan.loads),
    leftover: leftover.map(({ index, ...rest }) => rest),
    notes,
  };
}
