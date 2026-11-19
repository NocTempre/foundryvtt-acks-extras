/**
 * The Foundry-free half of the Region window's Place row: which dropped
 * document becomes which thing, the thing a drop builds, why a refused drop was
 * refused, and the line of counts a place's list reads as. Pure over plain
 * data, so it imports under Node and is unit-tested offline.
 *
 * A drop is described as `{documentName, type, uuid, document}`, the shape
 * `place-things-logic.mjs` hands every kind's predicate. Formation owns three
 * kinds: a trap is an Item of the trap type; an obstacle and a condition are a
 * Hazard item whose `system.key` is in that kind's group. A Hazard whose key is
 * blank or unknown is accepted by neither.
 */
import { HAZARD_ITEM_TYPE, TRAP_ITEM_TYPE } from "./constants.mjs";
import { hazardGroupOf } from "./hazard-keys.mjs";

/** The three kinds formation registers, in the order the counts line lists them. */
export const HAZARD_THING_KINDS = Object.freeze(["trap", "obstacle", "condition"]);

/** The descriptor of a dropped document, or null when there is none. */
export function descriptorOf(document, uuid = null) {
  if (!document) return null;
  return { documentName: document.documentName ?? "", type: document.type ?? "", uuid: uuid ?? document.uuid ?? null, document };
}

const isItem = (drop) => drop?.documentName === "Item";

/** Does this drop become a trap thing: an Item of the trap type. */
export const acceptsTrap = (drop) => isItem(drop) && drop.type === TRAP_ITEM_TYPE;

/** The hazard group a drop's Hazard item names by its key, or null for anything else. */
function hazardGroupOfDrop(drop) {
  if (!isItem(drop) || drop.type !== HAZARD_ITEM_TYPE) return null;
  return hazardGroupOf(drop.document?.system?.key);
}

/** Does this drop become an obstacle thing: a Hazard item keyed as an obstacle. */
export const acceptsObstacle = (drop) => hazardGroupOfDrop(drop) === "obstacle";

/** Does this drop become a condition thing: a Hazard item keyed as a condition. */
export const acceptsCondition = (drop) => hazardGroupOfDrop(drop) === "condition";

/**
 * The thing a drop of this kind builds. `ref` is the dropped document's own
 * uuid; a trap starts hidden, as an unfound trap is; an obstacle's figures
 * start blank for the Judge to set at the table, and a condition has none. A
 * map drop sets `point`; a sheet drop leaves it null.
 * The id is assigned by `addThing`.
 *
 * @param {string} kind one of `HAZARD_THING_KINDS`
 * @param {{uuid: string}} drop
 * @param {{point?: {x: number, y: number}|null}} [options] `point` is where a map drop landed, in scene pixels; a sheet drop has none
 */
export function thingOfDrop(kind, drop, { point = null } = {}) {
  if (!HAZARD_THING_KINDS.includes(kind)) throw new RangeError(`thingOfDrop: ${kind} is not a hazard thing kind`);
  return {
    kind,
    ref: drop?.uuid ?? null,
    hidden: kind === "trap",
    hint: null,
    point: point && Number.isFinite(point.x) && Number.isFinite(point.y) ? { x: point.x, y: point.y } : null,
    params: kind === "obstacle" ? { length: null, gap: null, depth: null } : {},
    layers: {},
    state: {},
  };
}

/**
 * Why a drop that no kind took was refused: `notItem` for a drag that carries
 * no Item, `blankHazard` for a Hazard item with no usable key, `notAccepted`
 * for any other Item. Null when a kind took it. Each is a lang key under the
 * row's own `refused`.
 *
 * @param {object|null} drop
 * @param {string|null} kind what `kindOfDrop` answered
 */
export function refusalOfDrop(drop, kind) {
  if (kind) return null;
  if (!isItem(drop)) return "notItem";
  if (drop.type === HAZARD_ITEM_TYPE) return "blankHazard";
  return "notAccepted";
}

/**
 * A place's things grouped for the counts line: one row per hazard kind that
 * has any, in `HAZARD_THING_KINDS` order, each with its count and the name of
 * every thing's ref. Other kinds of thing are not counted here.
 *
 * @param {object[]} things the place's normalized list
 * @param {(ref: string) => string|null} [nameOf] a ref's document name; a ref it cannot name is shown as the ref
 * @returns {{kind: string, count: number, names: string[]}[]}
 */
export function countsOf(things, nameOf = () => null) {
  const rows = [];
  for (const kind of HAZARD_THING_KINDS) {
    const held = (Array.isArray(things) ? things : []).filter((thing) => thing?.kind === kind);
    if (!held.length) continue;
    rows.push({ kind, count: held.length, names: held.map((thing) => nameOf(thing.ref) || thing.ref || "") });
  }
  return rows;
}
