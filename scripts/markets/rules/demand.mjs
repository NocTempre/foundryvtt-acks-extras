/**
 * Demand modifiers under the RAW procedure (JJ 199-202): the one reader of a
 * market's true demand, and the pure arithmetic of the Demand Generator.
 *
 * A market keeps its demand in layers per merchandise category: the `base`
 * (`goods.demand`, what the generator or a book wrote), the `derived` layer
 * (`goods.demandDerived`, reserved for trade-route equalisation), and the
 * Judge's `override` pins (`goods.demandOverrides`). `trueDemand` is the ONE
 * function that reads them; nothing else reaches into a layer to price
 * anything.
 *
 * Every figure the procedure applies (the environment and racial columns, the
 * land-revenue counts) is passed in from the Judge's imported data. Only the
 * shape is here: which columns apply, that a fraction is dropped after the
 * environment, the order of the steps, and the dice expressions.
 *
 * Pure: no Foundry globals, importable from Node.
 */

/** Step A's roll, one per merchandise type. */
export const STEP_A_ROLL = "1d3-1d3";

/** The dice a random merchandise pick rolls on each of the two tables. */
export const RANDOM_GOOD_DIE = 100;

/** The demand layers a market keeps, each with the goods field that holds it. */
export const DEMAND_LAYER = Object.freeze({
  base: "demand",
  derived: "demandDerived",
  override: "demandOverrides",
});

/** The settlement age bands, numbered as the environment columns are (`age1`..`age5`). */
export const AGE_BANDS = Object.freeze([1, 2, 3, 4, 5]);

/** The waterside columns a settlement may take several of. */
export const DEMAND_WATER = Object.freeze(["seaCoast", "lakeShore", "riverBank"]);

/** The biome and climate columns a settlement may take several of. */
export const DEMAND_BIOMES = Object.freeze([
  "rainforest",
  "savanna",
  "desert",
  "steppe",
  "scrub",
  "grasslands",
  "forest",
  "taiga",
  "tundra",
]);

/** The elevation columns, one at most. */
export const DEMAND_ELEVATIONS = Object.freeze(["plains", "hills", "mountains"]);

const MINUSES = /[−–—]/g;

/**
 * A demand figure in any form the importer or a Judge may store: a number, or
 * text such as "+1/2", "-1 1/2", "1.5", "½", "0". Halves are the only
 * fractions the procedure prints. Null for an empty or unreadable value, so an
 * absent column can never pass for a printed zero.
 * @param {*} raw
 * @returns {number|null}
 */
export function parseHalfPoint(raw) {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const text = String(raw ?? "")
    .replace(MINUSES, "-")
    .replace(/½/g, " 1/2")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  const m = /^([+-])?\s*(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)$|^([+-])?\s*(\d+(?:\.\d+)?)$/.exec(text);
  if (!m) return null;
  let value;
  let sign;
  if (m[3] !== undefined) {
    if (!Number(m[4])) return null;
    value = Number(m[2] ?? 0) + Number(m[3]) / Number(m[4]);
    sign = m[1];
  } else {
    value = Number(m[6]);
    sign = m[5];
  }
  const signed = sign === "-" ? -value : value;
  return signed === 0 ? 0 : signed;
}

const rowsOf = (goods, field) => (Array.isArray(goods?.[field]) ? goods[field] : []);

const layerRow = (goods, layer, category) => rowsOf(goods, DEMAND_LAYER[layer]).find((row) => row?.category === category) ?? null;

const asModifier = (row) => Number(row?.modifier ?? 0) || 0;

/**
 * Which layer answers for a category: `"override"` when the Judge pinned it,
 * else `"derived"`, else `"base"`, else null when no layer holds a row.
 * @param {object} goods  A market's `system.market.goods` (or a plain copy).
 * @param {string} category
 * @returns {"override"|"derived"|"base"|null}
 */
export function demandSource(goods, category) {
  for (const layer of ["override", "derived", "base"]) if (layerRow(goods, layer, category)) return layer;
  return null;
}

/**
 * The market's true demand modifier for a category, in price steps: the pinned
 * override if present, else the derived value, else the base, else 0. The one
 * reader; every price, roll and display goes through it.
 * @param {object} goods
 * @param {string} category  A merchandise key.
 * @returns {number}
 */
export function trueDemand(goods, category) {
  if (!category) return 0;
  const source = demandSource(goods, category);
  return source ? asModifier(layerRow(goods, source, category)) : 0;
}

/**
 * Whether a merchandise item carries any environment column at all. A good
 * whose columns are all unread has no environment step to show or apply.
 * @param {object|null|undefined} environment  Column key to modifier or null.
 * @returns {boolean}
 */
export const hasEnvironment = (environment) => !!environment && Object.values(environment).some((v) => parseHalfPoint(v) !== null);

/**
 * The environment columns a market's profile applies: its age column, each
 * water and biome it has, and its elevation.
 * @param {{ageBand?: number|null, water?: string[], biome?: string[], elevation?: string|null}} profile
 * @returns {string[]}
 */
export function environmentColumns({ ageBand = null, water = [], biome = [], elevation = null } = {}) {
  return [ageBand ? `age${ageBand}` : null, ...(water ?? []), ...(biome ?? []), elevation || null].filter(Boolean);
}

/**
 * One good's base demand modifier by Step 7 A-D: A (the roll) plus every
 * applicable environment column (B); the fraction is dropped after B (toward
 * zero, so a total of -3 1/2 is -3 and 3 1/2 is 3); then C (the land-revenue
 * pick) and D (each race present) are added.
 *
 * The result carries every step so a preview can show them: `a`, `b` (the
 * unrounded environment sum, null when the good has no environment data),
 * `afterB` (A plus B, truncated), `c`, `d`, and `base`.
 *
 * @param {object} o
 * @param {object|null} o.environment  The good's column modifiers (a number, text or null each).
 * @param {number|null} o.ageBand      1..5, or null for none.
 * @param {string[]} o.water           Waterside columns the market has.
 * @param {string[]} o.biome           Biome columns the market has.
 * @param {string|null} o.elevation    One elevation column, or null.
 * @param {object} o.racial            Race key to the good's modifier for a market of that race.
 * @param {string[]} o.races           The race keys present in the market.
 * @param {number} o.a                 Step A's roll for this good.
 * @param {number} o.landDelta         Step C's pick for this good (0 when it was not picked).
 * @returns {{a: number, b: number|null, afterB: number, c: number, d: number, base: number}}
 */
export function baseDemand({ environment = null, ageBand = null, water = [], biome = [], elevation = null, racial = {}, races = [], a = 0, landDelta = 0 } = {}) {
  const known = hasEnvironment(environment);
  let b = null;
  if (known) {
    b = 0;
    for (const column of environmentColumns({ ageBand, water, biome, elevation })) b += parseHalfPoint(environment[column]) ?? 0;
  }
  const rolled = Number(a) || 0;
  // The book's "drop any fractions": truncate toward zero after the environment
  // step, so the half a negative total carries is discarded, never rounded down.
  const afterB = Math.trunc(rolled + (b ?? 0)) + 0;
  const c = Number(landDelta) || 0;
  let d = 0;
  for (const race of races ?? []) d += parseHalfPoint(racial?.[race]) ?? 0;
  const base = afterB + c + d;
  return { a: rolled, b, afterB, c, d, base: base === 0 ? 0 : base };
}

/**
 * The race keys any catalogue good names in its `racial` layer, sorted.
 * @param {Array<{racial?: object}>} catalog
 * @returns {string[]}
 */
export function racesOf(catalog) {
  const seen = new Set();
  for (const row of catalog ?? []) for (const race of Object.keys(row?.racial ?? {})) seen.add(race);
  return [...seen].sort((x, y) => x.localeCompare(y));
}

/**
 * Step C's counts for a land revenue, from the imported land-revenue window (a
 * lowercased text stream of every row, small caps splitting words). Finds the
 * row whose gold figure equals the revenue and reads its two clauses: a signed
 * amount, then how many merchandise types it applies to.
 *
 * `plus` and `minus` are the counts of types to raise and lower, and
 * `plusDelta` and `minusDelta` the signed amount each takes. Null when no row
 * carries the figure or the row's clauses are unreadable.
 *
 * @param {string} rowsWindow
 * @param {number} revenueGp
 * @returns {{plus: number, minus: number, plusDelta: number, minusDelta: number}|null}
 */
export function landRevenueCounts(rowsWindow, revenueGp) {
  const text = String(rowsWindow ?? "")
    .toLowerCase()
    .replace(MINUSES, "-");
  const want = Number(revenueGp);
  if (!text || !Number.isFinite(want)) return null;
  const heads = [...text.matchAll(/(\d[\d,]*)\s*g\s*p\b/g)];
  for (let i = 0; i < heads.length; i++) {
    if (Number(heads[i][1].replace(/,/g, "")) !== want) continue;
    const from = heads[i].index + heads[i][0].length;
    const to = i + 1 < heads.length ? heads[i + 1].index : text.length;
    // A row has exactly two clauses; anything after them belongs to the page.
    const clauses = [...text.slice(from, to).matchAll(/([+-])\s*(\d+)\s*d\s*emand\s*m\s*odifiers?\s*to\s*(\d+)\s*m\s*erchandise/g)].slice(0, 2);
    if (!clauses.length) return null;
    const out = { plus: 0, minus: 0, plusDelta: 0, minusDelta: 0 };
    for (const [, sign, amount, count] of clauses) {
      if (sign === "+") {
        out.plus += Number(count);
        out.plusDelta = Number(amount);
      } else {
        out.minus += Number(count);
        out.minusDelta = -Number(amount);
      }
    }
    return out;
  }
  return null;
}

/**
 * The good a random-merchandise roll lands on: the one whose printed band on
 * that table holds the roll, or null when it lands in none (or on a row the
 * page marks special, which has no band).
 * @param {Array<{key: string, random?: {table: string|null, min: number|null, max: number|null}}>} catalog
 * @param {"common"|"precious"} table
 * @param {number} roll
 * @returns {string|null}
 */
export function goodAtRoll(catalog, table, roll) {
  for (const row of catalog ?? []) {
    const band = row?.random;
    if (!band || band.table !== table || band.min == null || band.max == null) continue;
    if (roll >= band.min && roll <= band.max) return row.key;
  }
  return null;
}

/** Whether any catalogue good carries a random-table band, the precondition of a random draw. */
export const hasRandomBands = (catalog) => (catalog ?? []).some((row) => row?.random?.table && row.random.min != null && row.random.max != null);

/**
 * Draw the goods Step C names: `plus` types to raise, then `minus` to lower.
 * One draw rolls d100 on the common table; a roll that lands in no common band
 * goes to the precious table and is rolled again there. A good already picked
 * is drawn again, so each type is named once.
 *
 * `roll` is injected (an async function returning 1..100) so the dice stay in
 * the caller; `attempts` bounds the redraws when the catalogue cannot supply
 * enough distinct goods, and the shortfall is reported in `short`.
 *
 * @param {object[]} catalog
 * @param {{plus: number, minus: number, plusDelta: number, minusDelta: number}} counts
 * @param {() => Promise<number>} roll
 * @param {{attempts?: number, exclude?: string[]}} [options]  `exclude` keys are never drawn.
 * @returns {Promise<{picks: Array<{category: string, delta: number}>, short: number}>}
 */
export async function drawLandPicks(catalog, counts, roll, { attempts = 400, exclude = [] } = {}) {
  const taken = new Set(exclude);
  const picks = [];
  let budget = attempts;
  let short = 0;
  const draw = async () => {
    while (budget-- > 0) {
      let key = goodAtRoll(catalog, "common", await roll());
      if (!key) key = goodAtRoll(catalog, "precious", await roll());
      if (key && !taken.has(key)) {
        taken.add(key);
        return key;
      }
    }
    return null;
  };
  for (const [count, delta] of [
    [counts.plus, counts.plusDelta],
    [counts.minus, counts.minusDelta],
  ]) {
    for (let i = 0; i < count; i++) {
      const category = await draw();
      if (category) picks.push({ category, delta });
      else short++;
    }
  }
  return { picks, short };
}
