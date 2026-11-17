/**
 * How many times a damage or heal row acts in one cast, and how that many is
 * dealt out. A row's `value` is its instance count, a LevelValue read at the
 * caster level and held to `max`; a row that never authored one acts once, and
 * a row whose count the import left unread (`value` or `max` in `unread`)
 * acts on nothing, so no figure is rolled and the card carries the page
 * reference alone.
 *
 * A row with no throw rolls once for the cast, its dice scaled by the count
 * (`scaledRoll`). A row with a throw is thrown that many times, split among the
 * targets (`allocate` is the default split). The figures are the page's, read
 * from the world by the caller; this file holds the procedure only. Pure and
 * Foundry-free.
 */
import { modifierFigure } from "./cast-mods.mjs";

/** Does a LevelValue carry a figure at all? A flat shape needs its figure, any other shape is authored by its kind. */
function authored(lv) {
  if (lv == null) return false;
  if (typeof lv === "number") return Number.isFinite(lv);
  if (typeof lv !== "object") return false;
  const kind = lv.kind ?? (lv.flat != null ? "flat" : "");
  return kind === "flat" || kind === "" ? lv.flat != null : true;
}

/** Is a LevelValue anything but a flat figure? */
const scaled = (lv) => Boolean(lv) && typeof lv === "object" && (lv.kind ?? "flat") !== "flat";

/** A count nothing could read. */
const blank = () => ({ value: null, parts: [] });

/**
 * A damage or heal row's instance count at a caster level, with the parts it is
 * made of. Never authored is one, with no parts. A figure the import left
 * unread, one that needs a level none resolved, one that resolves below one, and
 * a cap that cannot be read all give a blank (`value` null): the count is never
 * guessed.
 *
 * @param {{value?: object|number|null, max?: object|number|null, unread?: string[]}} row
 * @param {number|null} level  the resolved caster level
 * @returns {{value: number|null, parts: Array<{key: "figure"|"level"|"cap", value: number}>}}
 */
export function instanceCount(row, level) {
  const unread = Array.from(row?.unread ?? []);
  if (unread.includes("value") || unread.includes("max")) return blank();
  if (!authored(row?.value)) return { value: 1, parts: [] };
  const figure = modifierFigure({ value: row.value }, level);
  if (figure === null) return blank();
  const whole = Math.floor(figure);
  const parts = [{ key: "figure", value: whole }];
  if (scaled(row.value) || scaled(row.max)) parts.push({ key: "level", value: Number(level) });
  let value = whole;
  if (authored(row.max)) {
    const cap = modifierFigure({ value: row.max }, level);
    if (cap === null) return blank();
    parts.push({ key: "cap", value: Math.floor(cap) });
    value = Math.min(whole, Math.floor(cap));
  }
  return value >= 1 ? { value, parts } : blank();
}

/** A single bare dice term: `NdM`, or `dM` for one die. */
const BARE_DICE = /^\s*(\d*)\s*d\s*(\d+)\s*$/i;

/**
 * A formula for a count of instances rolled as one. A single `NdM` term takes
 * `count` times its dice; any other formula is repeated `count` times, joined
 * with " + ". A count of one leaves the formula as it is, and a blank count or
 * formula gives a blank formula.
 *
 * @param {string} formula
 * @param {number|null} count
 * @returns {string}
 */
export function scaledRoll(formula, count) {
  const text = String(formula ?? "").trim();
  const n = Number(count);
  if (!text || !Number.isInteger(n) || n < 1) return "";
  if (n === 1) return text;
  const bare = BARE_DICE.exec(text);
  if (bare) return `${(bare[1] === "" ? 1 : Number(bare[1])) * n}d${bare[2]}`;
  return Array.from({ length: n }, () => text).join(" + ");
}

/**
 * The row a no-throw cast rolls: the spell's own row with its roll scaled by
 * its instance count at the caster level, one roll per row per cast. A blank
 * count leaves no roll. The cast and the relay both read it, so the roll and
 * its bounds are the same formula.
 *
 * @param {object} row
 * @param {number|null} level
 */
export const instanceRow = (row, level) => ({ ...row, roll: scaledRoll(row?.roll, instanceCount(row, level).value) });

/**
 * The default split of a count of throws among targets: round-robin in the
 * order given, so the first targets take the remainder.
 *
 * @param {number|null} count
 * @param {string[]} targetKeys
 * @returns {Record<string, number>}  a figure for every key, zero where none falls
 */
export function allocate(count, targetKeys) {
  const keys = Array.from(targetKeys ?? []);
  const out = Object.fromEntries(keys.map((key) => [key, 0]));
  const n = Number(count);
  if (!keys.length || !Number.isInteger(n) || n < 1) return out;
  for (let i = 0; i < n; i++) out[keys[i % keys.length]] += 1;
  return out;
}

/**
 * The tooltip of an instance count: the count, each part it is made of (the
 * figure read, the caster level it was read at, the cap that held it) with the
 * world's own numbers, then the page reference. A count that never authored a
 * figure has no parts and no tooltip of its own.
 *
 * @param {{value: number|null, parts: Array<{key: string, value: number}>}|null|undefined} count
 * @param {string} cite  the page reference
 * @param {(key: string, data?: object) => string} loc  the cast's strings
 */
export function instancesTip(count, cite, loc) {
  if (!count?.parts?.length) return "";
  const parts = count.parts.map((p) => loc(`tip.instancesPart.${p.key}`, { value: p.value })).join(" · ");
  return loc("tip.instances", { count: count.value, parts, cite: cite ?? "" });
}

/**
 * A split a seat typed, as whole throws: each figure a non-negative integer,
 * anything else zero.
 *
 * @param {Record<string, unknown>|null|undefined} split
 * @returns {Record<string, number>}
 */
export function wholeSplit(split) {
  return Object.fromEntries(Object.entries(split ?? {}).map(([key, v]) => [key, Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : 0]));
}

/** How many throws a split assigns in all. */
export const assignedOf = (split) => Object.values(split ?? {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
