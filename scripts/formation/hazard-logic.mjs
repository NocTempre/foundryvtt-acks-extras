/**
 * What the hazards on a place seed into the party's crossing. A place carries a
 * list of things; an obstacle thing names a crossing's kind through its
 * hazard's key, a condition thing names a fact about the ground, and
 * `crossingSeed` turns the list into one entry per obstacle: the kind to begin
 * and the setup keys to begin it with. Nothing here touches a Foundry global.
 *
 * Both functions take a list that has already gone through lib's
 * `normalizeThings` (every key present, `params` and `state` objects), never
 * the raw flag.
 *
 * A thing's `params` carry the figures its Judge authored (`length`, `gap`,
 * `depth`), blank meaning "set it at the table"; each is read by the same reader
 * the party sheet's form uses, so the seed holds what the sheet would store.
 * `params` may also name a pick: a squeeze's `shape`, and a swim's water
 * penalty (`penaltyPick`, with `penaltyLarger` when the pick is the larger
 * figure). A pick is seeded only when it is one the caller lists as valid, and
 * only where the kind reads it; anything else is absent, never defaulted. A
 * condition lands in the setup under the key the crossing reads, and only where
 * the obstacle's kind reads that key: a rope fixed to a jump's far side is one
 * fact, but the swim kind has no rope field to hold it. No value is defaulted
 * here.
 *
 * `SETUP_FIELDS` is read inside function bodies only, so `crossing.mjs` can
 * import this file without a load-order cycle.
 */
import { SETUP_FIELDS } from "./crossing.mjs";
import { CONDITION_HAZARDS, OBSTACLE_HAZARDS } from "./hazard-keys.mjs";

/**
 * The numeric figures a thing's `params` may carry; each is a setup key of the
 * crossing, and the entry card shows exactly these.
 */
export const PARAM_KEYS = Object.freeze(["length", "gap", "depth"]);

/** The squeeze shapes a thing's `params.shape` may name. */
const SQUEEZE_SHAPES = Object.freeze(["chokepoint", "squeeze"]);

/** The picks a thing's `params` may carry beyond the figures; each is a setup key of the crossing. */
const PICK_KEYS = Object.freeze(["shape", "penaltyPick", "penaltyLarger"]);

/** The water-penalty picks that are no imported step: no penalty, or a figure the Judge types. */
const STRUCTURAL_PENALTY_PICKS = Object.freeze(["none", "larger"]);

/**
 * The water-penalty picks `crossingSeed` accepts: the structural two plus one
 * per imported step, each as the string the party sheet's select stores.
 *
 * @param {number[]|null|undefined} steps the imported penalty sizes, or null while none are
 * @returns {string[]}
 */
export function penaltyPicksOf(steps) {
  return [...STRUCTURAL_PENALTY_PICKS, ...(Array.isArray(steps) ? steps.map(String) : [])];
}

/**
 * What each condition sets in the crossing's setup: the setup key and the
 * value it takes. A condition is present or absent, so there is no figure.
 */
export const CONDITION_SETUP = Object.freeze({
  ropeFixed: Object.freeze({ ropeFixed: true }),
  noRunUp: Object.freeze({ runUp: false }),
  precarious: Object.freeze({ precarious: true }),
  waterCold: Object.freeze({ waterCold: true }),
  waterRough: Object.freeze({ waterRough: true }),
  waterFast: Object.freeze({ waterFast: true }),
});

/** The setup keys the party sheet's partial offers a climb obstacle, in the partial's own order. */
const CLIMB_SETUP_KEYS = Object.freeze(["length", "depth", "ropeFixed", "judgeMod"]);

/**
 * The setup keys each crossing kind reads, one list per kind; every climb
 * obstacle shares the climb's. The test parses the party sheet's crossing
 * template and holds this to the controls it offers for each kind.
 */
export const KIND_SETUP_KEYS = Object.freeze({
  jump: Object.freeze(["gap", "runUp", "precarious", "charging", "depth", "ropeFixed"]),
  swim: Object.freeze(["waterCold", "waterRough", "waterFast", "penaltyPick", "penaltyLarger", "movement", "judgeMod"]),
  squeeze: Object.freeze(["shape", "length", "judgeMod"]),
});

/** The setup keys a crossing of `kind` reads, or an empty list for a kind that is none. */
export function setupKeysOf(kind) {
  if (!OBSTACLE_HAZARDS.includes(kind)) return [];
  return KIND_SETUP_KEYS[kind] ?? CLIMB_SETUP_KEYS;
}

/** A figure as the sheet's reader takes it, or undefined while it is blank or refused. */
export function readParam(key, raw) {
  if (raw === null || raw === undefined || raw === "") return undefined;
  const value = SETUP_FIELDS[key](raw);
  return value === null ? undefined : value;
}

/**
 * The pick a thing's `params` state for one of `PICK_KEYS`, as the crossing
 * stores it, or undefined while it is blank, invalid or not listed. `setup`
 * holds the keys read so far: the larger penalty figure rides only on a pick of
 * `larger`.
 */
function readPick(key, raw, setup, penaltyPicks) {
  if (raw === null || raw === undefined || raw === "") return undefined;
  if (key === "shape") return typeof raw === "string" && SQUEEZE_SHAPES.includes(raw.trim()) ? raw.trim() : undefined;
  if (key === "penaltyPick") {
    if (typeof raw !== "string" && typeof raw !== "number") return undefined;
    const pick = String(raw).trim();
    return penaltyPicks.includes(pick) ? pick : undefined;
  }
  return setup.penaltyPick === "larger" ? readParam(key, raw) : undefined;
}

/** The hazard key a thing's `ref` resolves to, in the group its `kind` names, or null. */
function keyOfThing(thing, hazardKeyOf, kind, keys) {
  if (thing?.kind !== kind) return null;
  const key = hazardKeyOf(thing.ref);
  return keys.includes(key) ? key : null;
}

/**
 * The seed for every obstacle in a place's list.
 *
 * One entry per obstacle thing, in list order: `kind` is what `beginCrossing`
 * accepts (a climb obstacle key, `jump`, `swim` or `squeeze`), and `setup` is
 * the thing's own figures read through `SETUP_FIELDS` (a blank or refused one
 * is absent), its picks (each kept only where `kind` reads it, and a pick that
 * is blank, invalid or not in `penaltyPicks` is absent), plus the union of
 * every condition thing in the list, each kept only where `kind` reads it. A
 * thing whose kind is not `obstacle` or `condition`, a blank key and a ref the
 * resolver does not know are skipped. `movement` and `judgeMod` are the
 * table's to set and are never seeded.
 *
 * @param {object[]} things a place's list as `normalizeThings` returns it
 * @param {(ref: string) => string|null} hazardKeyOf the hazard key of a thing's
 *   `ref`, or null for a ref that is no hazard
 * @param {{penaltyPicks?: string[]}} [options] `penaltyPicks` are the water-penalty
 *   picks that are valid now (`penaltyPicksOf`); with none given no penalty pick is seeded
 * @returns {{thingId: string, kind: string, setup: Record<string, number|boolean|string>}[]}
 */
export function crossingSeed(things, hazardKeyOf, { penaltyPicks = [] } = {}) {
  const list = Array.isArray(things) ? things : [];
  const conditions = {};
  for (const thing of list) {
    const key = keyOfThing(thing, hazardKeyOf, "condition", CONDITION_HAZARDS);
    if (key) Object.assign(conditions, CONDITION_SETUP[key]);
  }
  const seeds = [];
  for (const thing of list) {
    const kind = keyOfThing(thing, hazardKeyOf, "obstacle", OBSTACLE_HAZARDS);
    if (!kind) continue;
    const reads = setupKeysOf(kind);
    const setup = {};
    for (const key of PARAM_KEYS) {
      const value = readParam(key, thing.params?.[key]);
      if (value !== undefined) setup[key] = value;
    }
    for (const key of PICK_KEYS) {
      if (!reads.includes(key)) continue;
      const value = readPick(key, thing.params?.[key], setup, penaltyPicks);
      if (value !== undefined) setup[key] = value;
    }
    for (const [key, stated] of Object.entries(conditions)) {
      if (!reads.includes(key)) continue;
      const value = SETUP_FIELDS[key](stated);
      if (value !== null) setup[key] = value;
    }
    seeds.push({ thingId: thing.id, kind, setup });
  }
  return seeds;
}

/**
 * The seed for the places a party stands in: every place's list read as one,
 * so a condition on one place reaches an obstacle on another and the entries
 * come back in place order, each place's in list order. The caller picks the
 * entry its Begin button names by `thingId`.
 *
 * @param {object[][]} lists each place's list as `normalizeThings` returns it
 * @param {(ref: string) => string|null} hazardKeyOf as for `crossingSeed`
 * @param {{penaltyPicks?: string[]}} [options] as for `crossingSeed`
 * @returns {{thingId: string, kind: string, setup: Record<string, number|boolean|string>}[]}
 */
export function seedFromPlaces(lists, hazardKeyOf, options) {
  return crossingSeed((Array.isArray(lists) ? lists : []).flat(), hazardKeyOf, options);
}
