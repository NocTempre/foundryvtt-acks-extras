/**
 * The Foundry-free half of the Region window's Place row: which dropped
 * document becomes which thing, the thing a drop builds, why a refused drop was
 * refused, the line of counts a place's list reads as, what each seat is shown
 * of it, and whom a drop may write for. Pure over plain
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
 * The things a seat may see: every thing for a Judge, and for anyone else only
 * those not marked hidden. A hidden thing is neither counted nor named off a
 * Judge's seat, and every trap is stored hidden.
 *
 * @param {object[]} things the place's normalized list
 * @param {boolean} isGM whether the seat is a Judge's
 * @returns {object[]}
 */
export function thingsShownTo(things, isGM) {
  const list = Array.isArray(things) ? things : [];
  return isGM ? list : list.filter((thing) => !thing?.hidden);
}

/**
 * What a drop onto a Region's place may do for a user: `"place"` writes the
 * thing onto the place already there, `"create"` makes the place first, and
 * null refuses. A place the user does not own and no place at all both refuse,
 * so the answer never says which of the two it was. The Region's own place is
 * made only by a user who owns the Region and may create Actors.
 *
 * @param {object} state
 * @param {boolean} state.linked whether a place already holds the point or the Region
 * @param {boolean} state.owns whether the user owns that place
 * @param {boolean} state.regionOwns whether the user owns the Region a place would be made for
 * @param {boolean} state.canCreate whether the user may create Actors
 * @returns {"place"|"create"|null}
 */
export function dropAuthority({ linked, owns, regionOwns, canCreate }) {
  if (linked) return owns ? "place" : null;
  return regionOwns && canCreate ? "create" : null;
}

/**
 * What the Place row shows one seat. A Judge's row is the picker, the counts
 * and the drop zone, unchanged. Any other seat that owns the Region gets a
 * read-only row: a linked place the seat owns shows its name, its counts of
 * shown things and the drop zone; one it can open but does not own shows its
 * name alone; one it cannot open shows only that it is closed; with no place
 * the row says so, and offers the zone only where a drop would make one.
 *
 * @param {object} state
 * @param {boolean} state.isGM
 * @param {boolean} state.linked whether the Region has a linked place
 * @param {boolean} state.canOpen whether the seat may open the linked place
 * @param {boolean} state.owns whether the seat owns the linked place
 * @param {boolean} state.canCreate whether the seat may create Actors
 * @returns {{picker: boolean, name: "picker"|"text"|"closed"|"none", counts: boolean, zone: boolean, hiddenNote: boolean}}
 */
export function placeRowOf({ isGM, linked, canOpen, owns, canCreate }) {
  if (isGM) return { picker: true, name: "picker", counts: true, zone: true, hiddenNote: false };
  if (!linked) return { picker: false, name: "none", counts: false, zone: !!canCreate, hiddenNote: !!canCreate };
  if (owns) return { picker: false, name: "text", counts: true, zone: true, hiddenNote: true };
  if (canOpen) return { picker: false, name: "text", counts: false, zone: false, hiddenNote: false };
  return { picker: false, name: "closed", counts: false, zone: false, hiddenNote: false };
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
