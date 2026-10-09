/**
 * A hex's stock: the lairs and finds a Judge sets in one hex of the map, and
 * the pure procedure that rolls them. No Foundry global and no document
 * write lives here; `hex-stock-run.mjs` reads and writes the scene flag this
 * record is stored in, and everything below takes its dice, its clock and its
 * id minter as arguments.
 *
 * A record is `{ label, stocked, stockedAt, terrain, territory, row, dice,
 * rolled, share, count, judgeCount, substitute, points, searches,
 * assessments }`. A point is `{ id, kind, name, sub, rarity, creature, draw,
 * found, placeUuid, note }`: `found` maps a formation id to the world time it
 * found the point, `sub` is the substitution roll (`{ roll, die }`) or null,
 * and `draw` is the whole terrain-encounter draw a terrain point resolved to.
 * The lairs-per-hex dice, the settled-territory share and the substitution
 * bands are read from the imported `encounters` document; absent, the stock
 * asks the Judge for a count rather than guessing one.
 */
import { ENCOUNTERS_DOC, monsterDraw, rarityThrow, rollDice, terrainEncounterDraw } from "./encounters.mjs";
import { readTable } from "../vehicles/vehicle-speed.mjs";
import { hexKeyOf } from "../battlemap/terrain-paint.mjs";
import { bracketRow } from "../lib/tables.mjs";

/** What a stocked point is: a creature's lair, a terrain find of either list, a unique find, or a point the Judge placed by hand. */
export const LAIR_KINDS = Object.freeze(["lair", "valuable", "dangerous", "unique", "placed"]);

/** The kinds of a substitution band that resolve through the terrain-encounter lists. */
const TERRAIN_KINDS = new Set(["valuable", "dangerous", "unique"]);

/** How many times a false count is re-rolled before the Judge is asked for one. */
export const FALSE_COUNT_TRIES = 20;

const isCount = (n) => Number.isInteger(n) && n >= 0;
const validShare = (share) => typeof share === "number" && Number.isFinite(share) && share > 0 && share <= 1;
const hasOwn = (obj, key) => !!obj && Object.hasOwn(obj, key);

/**
 * The key a hex's stock is stored under: `i:j` from a grid offset, else
 * `label:<label folded to letters and digits>` for a label-only trace (the
 * fold keeps dots out of the update path); null when neither names a hex.
 */
export function hexStockKey({ offset, label } = {}) {
  const { i, j } = offset ?? {};
  if (i != null && j != null && Number.isFinite(Number(i)) && Number.isFinite(Number(j))) {
    return hexKeyOf({ i: Number(i), j: Number(j) });
  }
  const folded = String(label ?? "").replace(/[^A-Za-z0-9]/g, "");
  return folded ? `label:${folded}` : null;
}

/**
 * A settled territory's share of a rolled lair count, rounded to the nearest
 * whole lair with a tie going down. A missing or invalid share (not in
 * (0, 1]) leaves the rolled count unchanged.
 */
export function settledCount(rolled, share) {
  const n = Number(rolled);
  if (!Number.isFinite(n) || !validShare(share)) return rolled;
  const scaled = Math.round(n * share * 1e9) / 1e9;
  return Math.max(0, Math.ceil(scaled - 0.5));
}

/** The kind the substitution band holding `roll` names, or null off the table. */
export function substituteKind(roll, bands) {
  if (!Array.isArray(bands)) return null;
  return bracketRow(bands, roll)?.kind ?? null;
}

/** 1 + floor(rng * faces), the same die the encounter chain rolls. */
const rollDie = (faces, rng) => 1 + Math.floor(rng() * faces);

/** The creature a plain lair holds: a rarity throw on the territory's column, then the terrain's monster sub-table. */
function lairCreature({ terrain, territory, rng }) {
  const rarity = rarityThrow({ territory, rng });
  if (!rarity.ok) return { rarity: null, creature: { missing: rarity.missing }, name: null };
  const draw = monsterDraw({ terrain, rarity: rarity.rarity, rng });
  if (!draw.ok) return { rarity: rarity.rarity, creature: { missing: draw.missing, rarityRoll: rarity.roll }, name: null };
  return { rarity: rarity.rarity, creature: { name: draw.name, roll: draw.roll, rarityRoll: rarity.roll }, name: draw.name };
}

/**
 * Roll a hex's stock. `row` is the lairs-per-hex row the caller resolved for
 * the terrain pick (null for a pick the book prints no row for). A count
 * the Judge typed (`judgeCount`, a non-negative integer) always wins over the
 * roll; otherwise the row's imported dice are rolled, and a settled
 * territory (anything but `unsettled`) scales the roll by the imported share.
 * With `substitute`, each lair rolls the imported substitution bands and a
 * terrain kind becomes a full terrain-encounter draw on the point.
 *
 * Returns `{ ok: true, record }`, or `{ ok: false, needsCount: true, reason }`
 * when no count can be rolled (`reason` is `noRow` or `lairsPerHex`), or
 * `{ ok: false, needsSubstitution: true, reason: "lairSubstitution" }` when
 * substitution is asked for and its bands are not imported.
 *
 * @param {object} opts
 * @param {string|null} opts.row the lairs-per-hex row key
 * @param {string} opts.terrain the encounter-terrain pick
 * @param {string} opts.territory a territory key; `unsettled` takes the roll as it falls
 * @param {boolean} [opts.substitute] roll each lair on the substitution bands
 * @param {number|null} [opts.judgeCount] a count the Judge typed
 * @param {() => number} [opts.rng] a [0, 1) source
 * @param {number} [opts.budget] the list rolls each terrain draw may spend
 * @param {() => string} [opts.mintId] the point id minter
 * @param {number|null} [opts.now] stamped as `stockedAt`
 * @param {string} [opts.label] the hex's label, kept on the record
 */
export function stockHex({
  row = null, terrain = "", territory = "unsettled", substitute = false, judgeCount = null,
  rng = Math.random, budget, mintId, now = null, label = "",
} = {}) {
  const dice = row == null ? null : (readTable(ENCOUNTERS_DOC, "lairsPerHex")?.[row] ?? null);
  const settled = !!territory && territory !== "unsettled";
  const rawShare = settled ? readTable(ENCOUNTERS_DOC, "settledLairShare")?.[territory] : null;
  const share = validShare(rawShare) ? rawShare : null;
  const typed = isCount(judgeCount) ? judgeCount : null;

  let rolled = null;
  let count = typed;
  if (typed == null) {
    if (row == null) return { ok: false, needsCount: true, reason: "noRow" };
    rolled = dice == null ? null : rollDice(dice, rng);
    if (rolled == null) return { ok: false, needsCount: true, reason: "lairsPerHex" };
    count = settledCount(rolled, share);
  }

  const bands = substitute ? readTable(ENCOUNTERS_DOC, "lairSubstitution") : null;
  const die = Array.isArray(bands) && bands.length ? bands.at(-1).max : null;
  if (substitute && !die) return { ok: false, needsSubstitution: true, reason: "lairSubstitution" };

  let serial = 0;
  const mint = typeof mintId === "function" ? mintId : () => `p${++serial}`;
  const points = [];
  for (let i = 0; i < count; i++) {
    let kind = "lair";
    let sub = null;
    if (substitute) {
      const roll = rollDie(die, rng);
      sub = { roll, die };
      kind = substituteKind(roll, bands) ?? "lair";
    }
    const point = { id: mint(), kind, name: null, sub, rarity: null, creature: null, draw: null, found: {}, placeUuid: null, note: "" };
    if (TERRAIN_KINDS.has(kind)) {
      point.draw = terrainEncounterDraw({ kind, terrain, territory, rng, budget });
      point.name = point.draw.name ?? null;
    } else {
      const lair = lairCreature({ terrain, territory, rng });
      point.rarity = lair.rarity;
      point.creature = lair.creature;
      point.name = lair.name;
    }
    points.push(point);
  }

  return {
    ok: true,
    record: {
      label, stocked: true, stockedAt: now, terrain, territory, row, dice, rolled, share, count,
      judgeCount: typed, substitute: !!substitute, points, searches: {}, assessments: {},
    },
  };
}

/** The points this formation has not found yet, in stock order. */
export function unfoundPoints(record, formationId) {
  return (record?.points ?? []).filter((p) => !hasOwn(p.found, formationId));
}

/** A new record with `pointId` found by `formationId` at `worldTime`; the input is untouched. */
export function markFound(record, pointId, formationId, worldTime) {
  return {
    ...record,
    points: (record?.points ?? []).map((p) => (p.id === pointId ? { ...p, found: { ...p.found, [formationId]: worldTime } } : p)),
  };
}

/** A new record crediting `formationId` with one more search throw that beat the target. */
export function creditSearch(record, formationId) {
  const prior = Number(record?.searches?.[formationId]) || 0;
  return { ...record, searches: { ...record?.searches, [formationId]: prior + 1 } };
}

/** A new record holding the formation's land-surveying reading: what it was told, whether the telling was true, and when. */
export function recordAssessment(record, formationId, { told, trustworthy, at } = {}) {
  return { ...record, assessments: { ...record?.assessments, [formationId]: { told, trustworthy, at } } };
}

/**
 * A wrong count to tell a party that misread the hex: the stored dice
 * rolled again (the stored share applied) until the result differs from
 * `truth`, at most `tries` times. `{ n }` on success; `{ askJudge: true }`
 * when the record has no usable dice or every roll matched the truth.
 */
export function falseCount({ record, truth, rng = Math.random, tries = FALSE_COUNT_TRIES } = {}) {
  if (!record?.dice) return { askJudge: true };
  for (let i = 0; i < tries; i++) {
    const rolled = rollDice(record.dice, rng);
    if (rolled == null) return { askJudge: true };
    const n = settledCount(rolled, record.share);
    if (n !== truth) return { n };
  }
  return { askJudge: true };
}

/**
 * The record as a panel line reads it: whether it is stocked, its count, and
 * whether that count is a ceiling (`upTo`, false when the Judge typed it),
 * the lairs row and dice it came from, how many points it holds and how many
 * of them no formation has found.
 */
export function stockSummary(record) {
  const points = record?.points ?? [];
  return {
    stocked: record?.stocked === true,
    count: Number(record?.count) || 0,
    upTo: record?.stocked === true && record.judgeCount == null,
    row: record?.row ?? null,
    dice: record?.dice ?? null,
    points: points.length,
    unfound: points.filter((p) => !Object.keys(p.found ?? {}).length).length,
  };
}
