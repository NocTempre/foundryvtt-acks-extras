/**
 * Merchandise binding: the register's printed grids become one
 * `acks-extras.merchandise` item per good, and the demand grid appends to the
 * item each of its rows maps to.
 *
 * Pure, so the harness can drive it with invented grids. The runtime half
 * (creating and updating documents) lives in `cookbook.mjs`
 * (`importMerchandise`). Every number here is parsed from a cell the seat's own
 * book supplied; nothing is defaulted, and a label or named good that maps to
 * no key is returned in `unmapped` for the caller to report rather than
 * dropped. See docs/markets/MODEL.md, "The merchandise catalogue".
 */
import { MERCHANDISE_TYPE } from "../markets/constants.mjs";
import {
  DEMAND_AGE_KEYS,
  DEMAND_COLUMN_KEYS,
  MARKET_CLASS_COUNT,
  merchandiseKeyOf,
  normalizeGoodLabel,
} from "../markets/merchandise-keys.mjs";
import { bookText } from "./prose.mjs";
import { MODULE_ID } from "./constants.mjs";

/** The good whose price and tariff follow the printed procedure for staple food. */
const STAPLE_KEY = "grainVegetables";

/** The gp value of one coin of each printed denomination. */
const COIN_GP = { gp: 1, sp: 0.1, cp: 0.01 };

/** A minus sign, en or em dash: the page prints a negative with any of them. */
const MINUSES = /[−–—]/g;

/**
 * A printed price as gp: "0.12gp" → 0.12, "5sp" → 0.5, a bare "2,000" → 2000.
 * Several coins add ("1gp, 33cp"). Null when the cell holds no figure.
 * @param {*} raw
 * @returns {number|null}
 */
export function parseGp(raw) {
  const text = normalizeGoodLabel(raw);
  let total = 0;
  let seen = false;
  for (const m of text.matchAll(/(\d[\d,]*(?:\.\d+)?|\.\d+)\s*(gp|sp|cp)?/gi)) {
    const n = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    total += n * COIN_GP[(m[2] ?? "gp").toLowerCase()];
    seen = true;
  }
  return seen ? Math.round(total * 1e6) / 1e6 : null;
}

/**
 * A printed quantity: "2,000" → 2000, "0.4" → 0.4. A dash or an empty cell is
 * null. Anything else that holds no figure is null too.
 * @param {*} raw
 * @returns {number|null}
 */
export function parseQuantity(raw) {
  const text = normalizeGoodLabel(raw).replace(MINUSES, "-");
  const m = /^(\d[\d,]*(?:\.\d+)?|\.\d+)$/.exec(text);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

/**
 * A printed demand modifier: "+2" → 2, "-1 1/2" → -1.5, "+1/2" → 0.5,
 * "0" → 0. `value` is null for an empty cell or a bare dash, which the page
 * prints for no modifier; `bad` is set for text that is neither, so the caller
 * reports it instead of storing it.
 * @param {*} raw
 * @returns {{value: number|null, bad: boolean}}
 */
export function parseDemand(raw) {
  const text = normalizeGoodLabel(raw)
    .replace(MINUSES, "-")
    .replace(/½/g, " 1/2")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || text === "-") return { value: null, bad: false };
  const m = /^([+-])?\s*(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)$|^([+-])?\s*(\d+(?:\.\d+)?)$/.exec(text);
  if (!m) return { value: null, bad: true };
  let value;
  let sign;
  if (m[3] !== undefined) {
    if (!Number(m[4])) return { value: null, bad: true };
    value = Number(m[2] ?? 0) + Number(m[3]) / Number(m[4]);
    sign = m[1];
  } else {
    value = Number(m[6]);
    sign = m[5];
  }
  return { value: sign === "-" ? -value : value, bad: false };
}

/**
 * A random-table band: "1 – 20" → 1..20, "92" → 92..92, "* 100" → 100..100,
 * "Special" → the special mark with no range. Null when the cell is none of
 * those.
 * @param {*} raw
 * @returns {{min: number|null, max: number|null, special: boolean}|null}
 */
export function parseBand(raw) {
  const text = normalizeGoodLabel(raw).replace(MINUSES, "-");
  if (/^special$/i.test(text)) return { min: null, max: null, special: true };
  const range = /^(\d+)\s*-\s*(\d+)$/.exec(text);
  if (range) return { min: Number(range[1]), max: Number(range[2]), special: false };
  const single = /^(\d+)$/.exec(text);
  return single ? { min: Number(single[1]), max: Number(single[1]), special: false } : null;
}

/** The label as the item's name: footnote marks off, spacing repaired, first letter capital. */
const nameOf = (label) =>
  normalizeGoodLabel(label)
    .replace(/\s*,\s*/g, ", ")
    .replace(/^[a-z]/, (c) => c.toUpperCase());

/**
 * Split a demand-modifier cell's prose into its groups: each is a signed
 * amount and the goods it applies to. The amount opens a group and the goods
 * run to the next amount (or the end). Text ahead of the first amount, and a
 * cell with no amount at all, come back in `stray` for the caller to report.
 * @param {*} text
 * @returns {{groups: Array<{amount: number, goods: string[]}>, stray: string}}
 */
export function parseRacialGroups(text) {
  const source = normalizeGoodLabel(text).replace(MINUSES, "-");
  const header = /([+-]\s*\d+(?:\.\d+)?(?:\s+\d\/\d|\s*\/\s*\d)?)\s*(?:demand\s*)?(?:modifiers?\s*)?(?:to|for)\b\s*/gi;
  const marks = [...source.matchAll(header)];
  if (!marks.length) return { groups: [], stray: source };
  const groups = [];
  marks.forEach((mark, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].index : source.length;
    const list = source.slice(mark.index + mark[0].length, end);
    const { value } = parseDemand(mark[1]);
    groups.push({ amount: value, goods: splitGoods(list) });
  });
  return { groups: groups.filter((g) => g.amount !== null), stray: source.slice(0, marks[0].index).trim() };
}

/**
 * A list of goods as printed: comma-separated with a closing "and". A chunk
 * that names no good whole is tried again split at "and", so "rare books and
 * art" survives as one name when the vocabulary knows it whole.
 */
function splitGoods(list) {
  const chunks = String(list ?? "")
    .replace(/[.;]\s*$/, "")
    .split(/\s*,\s*(?:and\s+)?/)
    .map((c) => c.replace(/^\s*and\s+/i, "").trim())
    .filter(Boolean);
  const out = [];
  for (const chunk of chunks) {
    if (merchandiseKeyOf(chunk) || !/\sand\s/i.test(chunk)) out.push(chunk);
    else out.push(...chunk.split(/\s+and\s+/i).map((c) => c.trim()).filter(Boolean));
  }
  return out;
}

/** The rows of a grid the executor read, or none. */
const rowsOf = (grids, name) => grids?.[name]?.rows ?? [];

/**
 * Read the merchandise table's grids into one planned item per good.
 *
 * `common` and `precious` carry the goods; `randomCommon` and `randomPrecious`
 * carry each good's band, matched by label. A row that maps to no key, or to a
 * key already planned, is reported in `unmapped` and produces no item.
 *
 * @param {object} grids the entry's materialized `fields.grids`
 * @returns {{rows: Array<{key: string, tier: string, label: string, cells: object, random: object|null}>,
 *   unmapped: Array<{where: string, label: string, reason: string}>}}
 */
export function planMerchandise(grids) {
  const unmapped = [];
  const rows = [];
  const byKey = new Map();
  for (const tier of ["common", "precious"]) {
    for (const row of rowsOf(grids, tier)) {
      const label = nameOf(row.label);
      const key = merchandiseKeyOf(label);
      if (!key) {
        unmapped.push({ where: tier, label, reason: "no key" });
        continue;
      }
      if (byKey.has(key)) {
        unmapped.push({ where: tier, label, reason: `duplicate of ${key}` });
        continue;
      }
      const planned = { key, tier, label, cells: row.cells ?? {}, random: null };
      byKey.set(key, planned);
      rows.push(planned);
    }
  }
  for (const [name, table] of [["randomCommon", "common"], ["randomPrecious", "precious"]]) {
    for (const row of rowsOf(grids, name)) {
      const label = nameOf(row.label);
      const key = merchandiseKeyOf(label);
      const planned = key ? byKey.get(key) : null;
      if (!planned) {
        unmapped.push({ where: name, label, reason: key ? `no good for ${key}` : "no key" });
        continue;
      }
      const band = parseBand(row.cells?.band);
      if (!band) {
        unmapped.push({ where: name, label, reason: "unreadable band" });
        continue;
      }
      planned.random = { table, ...band };
    }
  }
  return { rows, unmapped };
}

/**
 * The creation data of one merchandise item from a planned row.
 *
 * A figure the page did not supply stays null. The staple's tariff and season
 * marks are procedure, so they are written here (and only when set, so a
 * repair never resets a Judge's own mark on another good).
 *
 * @param {{key: string, tier: string, label: string, cells: object, random: object|null}} planned
 * @param {object} entry the cookbook entry the table came from
 * @param {string} id the entry id
 * @returns {object} creation data for `Item.create`
 */
export function bindMerchandiseRow(planned, entry, id) {
  const cite = entry?.cite ?? "";
  const cells = planned.cells ?? {};
  const container = normalizeGoodLabel(cells.container);
  const dailyStones = Array.from({ length: MARKET_CLASS_COUNT }, (_, i) => parseQuantity(cells[`c${i + 1}`]));
  const staple = planned.key === STAPLE_KEY;
  return {
    name: planned.label,
    type: MERCHANDISE_TYPE,
    ...(entry?.icon ? { img: entry.icon } : {}),
    // The stamp Remove ALL Imports finds documents by; a row claims its own id
    // so removal and a repair are per good.
    flags: { [MODULE_ID]: { cookbook: { id: `${id}.${planned.key}`, cite } } },
    system: {
      key: planned.key,
      tier: planned.tier,
      ...(container ? { container } : {}),
      pricePerStoneGp: parseGp(cells.pricePerStone),
      priceStepGp: parseGp(cells.priceStep),
      dailyStones,
      ...(planned.random ? { random: { table: planned.random.table, min: planned.random.min, max: planned.random.max, special: planned.random.special } } : {}),
      ...(staple ? { tariffExempt: true, seasonalPrice: true } : {}),
      source: { book: entry?.book ?? "rr", page: cite },
      description: bookText([], cite, { id, book: entry?.book, page: entry?.pages?.[0] }),
    },
  };
}

/**
 * Read the demand grids into the layers each good takes.
 *
 * `environment` rows map by label to a good and give a modifier per column;
 * `racial` rows are prose naming goods after each signed amount. The age-band
 * header text the environment grid carries is returned as printed. Everything
 * that maps to no good, every unreadable cell, and every good named twice for
 * one race is reported in `unmapped`.
 *
 * @param {object} grids the demand entry's materialized `fields.grids`
 * @returns {{byKey: Map<string, {environment: object, racial: object}>,
 *   ageHeaders: object, unmapped: Array<{where: string, label: string, reason: string}>}}
 */
export function planDemand(grids) {
  const unmapped = [];
  const byKey = new Map();
  const layer = (key) => {
    if (!byKey.has(key)) byKey.set(key, { environment: {}, racial: {} });
    return byKey.get(key);
  };

  for (const row of rowsOf(grids, "environment")) {
    const label = nameOf(row.label);
    const key = merchandiseKeyOf(label);
    if (!key) {
      unmapped.push({ where: "environment", label, reason: "no key" });
      continue;
    }
    const target = layer(key).environment;
    for (const column of DEMAND_COLUMN_KEYS) {
      const raw = row.cells?.[column];
      if (raw === undefined || raw === null) continue;
      const { value, bad } = parseDemand(raw);
      if (bad) unmapped.push({ where: "environment", label: `${label} / ${column}`, reason: `unreadable cell "${normalizeGoodLabel(raw)}"` });
      else target[column] = value;
    }
  }

  for (const row of rowsOf(grids, "racial")) {
    const race = String(row.key ?? row.label ?? "").trim().toLowerCase();
    const where = `racial:${race}`;
    const { groups, stray } = parseRacialGroups(row.cells?.text);
    if (stray) unmapped.push({ where, label: stray, reason: groups.length ? "text ahead of the first modifier" : "no modifier found" });
    for (const group of groups) {
      for (const good of group.goods) {
        const key = merchandiseKeyOf(good);
        if (!key) {
          unmapped.push({ where, label: good, reason: "no key" });
          continue;
        }
        const target = layer(key).racial;
        if (race in target && target[race] !== group.amount) {
          unmapped.push({ where, label: good, reason: "named under two modifiers" });
          continue;
        }
        target[race] = group.amount;
      }
    }
  }

  const ageHeaders = {};
  const header = grids?.environment?.header ?? {};
  for (const column of DEMAND_AGE_KEYS) if (header[column]) ageHeaders[column] = String(header[column]).trim();
  return { byKey, ageHeaders, unmapped };
}

/**
 * One line per unmapped item, for a console report and the notification: the
 * grid it came from, the printed text, and why it was left out.
 * @param {Array<{where: string, label: string, reason: string}>} unmapped
 * @returns {string[]}
 */
export const describeUnmapped = (unmapped) => unmapped.map((u) => `${u.where}: ${u.label} (${u.reason})`);
