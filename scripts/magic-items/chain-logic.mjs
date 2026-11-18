/**
 * Walking the imported item-generation lists: one roll on a list, and, where a
 * band names another list, one roll on that, until a band names an item. Pure:
 * no Foundry, no registry; the tables and the roller are passed in, so Node
 * tests drive it with invented ones.
 *
 * A list is an array of bands `{min, max, ...fields}`, optionally with `sub`,
 * inner bands under an outer face (a tail of the die rolled again on a die of
 * its own). The die of a list, and of a tail, is read off its own bands
 * (`bandDie`): nothing here knows how many faces any list has. A list is a
 * HOP list when a band or an inner band carries a `hop` key of its own: the
 * importer writes `hop` (a list id, or null) on every band of a list whose
 * rows name other lists, and nowhere else. A band of a hop list without a
 * string hop ends the walk flagged `unresolved-hop` rather than read as an item.
 *
 * Nothing throws on content: a table that cannot be rolled ends the walk with an
 * `error` and the steps so far, and a chain that cannot be followed to its end
 * keeps the item it reached with a `flag`.
 *
 * The roller is `roll(expr) -> {total, sides}`, sync or async, `expr` a die
 * such as `1d20` and `sides` the faces actually thrown; a walk checks the die it
 * got is the die it asked for.
 */
import { bandDie, bracketRow } from "../lib/tables.mjs";

/** The most hops one walk follows; a chain longer than this ends flagged `too-deep`. */
export const MAX_HOPS = 8;

/** Keys of a band that are not the item's fields (`ref` names the cookbook entry the importer linked the row to). */
const STRUCTURE = new Set(["min", "max", "sub", "hop", "ref"]);

/**
 * The bands of a list id `"<table>.<column>"` in a document's tables, or null
 * when the list is not there (or is not a list of bands).
 */
export function listAt(tables, id) {
  const [table, column, ...rest] = String(id ?? "").split(".");
  if (!table || !column || rest.length || !tables) return null;
  if (!Object.hasOwn(tables, table) || !Object.hasOwn(tables[table] ?? {}, column)) return null;
  const bands = tables[table][column];
  return Array.isArray(bands) && bands.length ? bands : null;
}

/** Whether bands run from 1 with no gap or overlap, every edge a whole number. */
function tilesFromOne(bands) {
  return (
    bands.length > 0 &&
    bands.every((b, i) => {
      if (!b || !Number.isInteger(b.min) || !Number.isInteger(b.max) || b.min > b.max) return false;
      return i === 0 ? b.min === 1 : b.min === bands[i - 1].max + 1;
    })
  );
}

/**
 * Roll the die one set of bands is read from and find the band it lands on.
 * Resolves `{band, die, total}` or `{error: code}`.
 */
async function rollBands(bands, roll) {
  if (!tilesFromOne(bands)) return { error: "bands-untiled" };
  const die = bandDie(bands);
  const top = bands.at(-1).max;
  let rolled;
  try {
    rolled = await roll(die);
  } catch {
    return { error: "roll-failed" };
  }
  if (!rolled || typeof rolled !== "object") return { error: "roll-failed" };
  if (rolled.sides !== top) return { error: "die-mismatch" };
  const total = rolled.total;
  if (!Number.isInteger(total) || total < 1 || total > top) return { error: "roll-out-of-range" };
  return { band: bracketRow(bands, total), die, total };
}

/** A band's item fields: every key but the structure. */
function fieldsOf(band) {
  return Object.fromEntries(Object.entries(band ?? {}).filter(([k]) => !STRUCTURE.has(k)));
}

/** The item's name: its `item` field, else the first text field. */
export function textOf(fields) {
  return fields.item ?? Object.values(fields).find((v) => typeof v === "string") ?? null;
}

/** Whether a list's bands name other lists: any band, or inner band, holds a `hop` key. */
function hopsList(bands) {
  return bands.some((b) => Object.hasOwn(b, "hop") || (b.sub ?? []).some((s) => Object.hasOwn(s, "hop")));
}

/**
 * Roll a start list and follow its hops to an item.
 *
 * @param {object} args
 * @param {object} args.tables the document's tables (`{classic: {potions: [bands]}}`)
 * @param {string} args.from the start list id, `"<table>.<column>"`
 * @param {function} args.roll `roll(expr) -> {total, sides}`, sync or async
 * @param {number} [args.maxHops] hops followed before `too-deep`
 * @returns {Promise<{steps: object[], item: object|null, error: object|null}>}
 *   Each step is `{list, die, total, band: {min, max}, inner?: {die, total,
 *   band}, fields}`; `item` is `{list, text, fields, flag, hop?, uuid}` with
 *   `flag` null or one of `unresolved-hop`, `missing-list`, `cycle`, `too-deep`;
 *   `error` is `{code, list}` with `code` one of `not-imported`, `bands-untiled`,
 *   `roll-failed`, `die-mismatch`, `roll-out-of-range`, and `steps` holds what
 *   was rolled before it. `ref` is the deepest band's `ref` (the id of the
 *   cookbook entry the importer linked the row to, else null); `uuid` is null
 *   here and is filled by the caller from `ref`.
 */
export async function walkChain({ tables, from, roll, maxHops = MAX_HOPS }) {
  const steps = [];
  const seen = new Set();
  let list = from;
  let hops = 0;
  for (;;) {
    const bands = listAt(tables, list);
    if (!bands) return { steps, item: null, error: { code: "not-imported", list } };
    seen.add(list);

    const outer = await rollBands(bands, roll);
    if (outer.error) return { steps, item: null, error: { code: outer.error, list } };
    const step = { list, die: outer.die, total: outer.total, band: { min: outer.band.min, max: outer.band.max } };
    let deepest = outer.band;
    if (Array.isArray(outer.band.sub)) {
      const inner = await rollBands(outer.band.sub, roll);
      if (inner.error) return { steps, item: null, error: { code: inner.error, list } };
      step.inner = { die: inner.die, total: inner.total, band: { min: inner.band.min, max: inner.band.max } };
      deepest = inner.band;
    }
    step.fields = fieldsOf(deepest);
    steps.push(step);

    const item = { list, text: textOf(step.fields), fields: step.fields, flag: null, ref: typeof deepest.ref === "string" ? deepest.ref : null, uuid: null };
    if (!hopsList(bands)) return { steps, item, error: null };

    const target = deepest.hop;
    if (typeof target !== "string" || !target) return { steps, item: { ...item, flag: "unresolved-hop" }, error: null };
    if (seen.has(target)) return { steps, item: { ...item, flag: "cycle", hop: target }, error: null };
    if (hops >= maxHops) return { steps, item: { ...item, flag: "too-deep", hop: target }, error: null };
    if (!listAt(tables, target)) return { steps, item: { ...item, flag: "missing-list", hop: target }, error: null };
    hops++;
    list = target;
  }
}
