/**
 * Capacity is one concept, answered once: how much can this document hold, how
 * much is it holding, and is that too much — for any document that can carry
 * (a character, a monster or mount, a container item). See docs/lib/MODEL.md,
 * "Capacity".
 *
 * The canonical unit is SIXTHS of a stone — the books' minimum denomination
 * and core's own storage unit (`item.system.weight6`, `encumbrance.value6`).
 * Stone is the DISPLAY unit, derived by division.
 *
 * `null` capacity means unstated, and unstated never warns. `overCapacity` is
 * a STATE, not a gate: what an overloaded mount means is the caller's to
 * decide.
 */
import { MODULE_ID } from "./constants.mjs";
import { ACTOR_TYPE } from "./vocab.mjs";
import {
  STONE,
  capacityOf,
  encumbering6,
  weight6Of,
  contentsWeight6,
} from "./item-model.mjs";
import { riderOf } from "./mount.mjs";
import { bodyCount } from "./group-logic.mjs";

/** RR ch. 6 §Mounts prices the rider's own body at 15 stone. */
export const RIDER_BODY6 = 15 * STONE;

/**
 * An item listed on the sheet that is not on the body: a spoil (a creature's
 * own parts, harvestable) and a thrown weapon lying where it landed until it
 * is recovered. Neither weighs on anyone.
 */
const isAbsent = (item) => !!item.getFlag?.(MODULE_ID, "spoil") || !!item.getFlag?.(MODULE_ID, "thrownAway");

/** The coin an actor carries, in sixths, or 0 where the system cannot say. */
function coin6(actor) {
  const money = actor.getTotalMoneyEncumbrance?.();
  return Number.isFinite(money?.stone) ? money.stone * STONE : 0;
}

/**
 * The "borne" reading: the kit a bearer answers for — no carrying overlay,
 * clothing free, nothing that has left the body. See docs/lib/MODEL.md,
 * "Capacity", the burden/borne/carried table.
 */
export function borneWeight6(actor) {
  if (!isActor(actor)) return 0;
  let sum = 0;
  for (const item of actor.items ?? []) {
    if (isAbsent(item)) continue;
    sum += encumbering6(item);
  }
  return sum + coin6(actor);
}

/**
 * The "carried" reading: everything on the body at what it weighs, clothing
 * included. See docs/lib/MODEL.md, "Capacity", the burden/borne/carried table.
 */
export function carriedWeight6(actor) {
  if (!isActor(actor)) return 0;
  let sum = 0;
  for (const item of actor.items ?? []) {
    if (isAbsent(item)) continue;
    sum += weight6Of(item);
  }
  return sum + coin6(actor);
}

/**
 * What this actor costs the thing carrying them: their body plus their kit,
 * unmitigated. A character's body is the book's 15 stone; a creature with a
 * stated body weight uses its own (`bodyStone`, PER BODY); a stack weighs
 * every living body it stands for — twenty mercs as one group actor are
 * twenty bodies and one shared kit, never one.
 */
export function borneBy6(actor) {
  const body = Number(actor?.flags?.[MODULE_ID]?.extras?.bodyStone);
  const body6 = Number.isFinite(body) ? body * STONE : RIDER_BODY6;
  return body6 * bodyCount(actor) + borneWeight6(actor);
}

const isActor = (doc) => doc?.documentName === "Actor";
const isItem = (doc) => doc?.documentName === "Item";

const monsterLoadSpec = (actor) => actor?.flags?.[MODULE_ID]?.extras?.load ?? null;

/** A monster's own carried weight: items plus coin (core computes neither for
 * monsters, so both are summed here with core's semantics — clothing weighs
 * nothing carried). Spoils are the monster's own harvestable parts, not cargo. */
const monsterCarried6 = (actor) => borneWeight6(actor);

/**
 * What the document can hold, in sixths of a stone; null when unstated.
 */
export function capacity6(doc) {
  if (isItem(doc)) {
    const cap = capacityOf(doc);
    return cap === null ? null : cap * STONE;
  }
  if (!isActor(doc)) return null;
  if (doc.type === ACTOR_TYPE.character) {
    const max = Number(doc.system?.encumbrance?.max);
    return Number.isFinite(max) ? max * STONE : null;
  }
  // Monster chassis covers mounts, animals and whatever a wagon is played by.
  const load = monsterLoadSpec(doc);
  if (Number.isFinite(load?.capacity)) return Number(load.capacity) * STONE;
  if (Number.isFinite(load?.normal)) return Number(load.normal) * 2 * STONE; // MM p. 13's normal/maximum pairing
  return null;
}

/**
 * What the document is holding, in sixths of a stone.
 */
export function load6(doc) {
  if (isItem(doc)) {
    return doc.parent ? contentsWeight6(doc.parent, doc.id) : 0;
  }
  if (!isActor(doc)) return 0;
  if (doc.type === ACTOR_TYPE.character) {
    const v6 = Number(doc.system?.encumbrance?.value6);
    if (Number.isFinite(v6)) return v6;
    const v = Number(doc.system?.encumbrance?.value);
    return Number.isFinite(v) ? v * STONE : 0;
  }
  let sum = monsterCarried6(doc);
  // The rider's borne weight, never their encumbrance (see borneWeight6).
  const rider = riderOf(doc);
  if (rider) sum += borneBy6(rider);
  return sum;
}

/** Is it holding more than it can? Unstated capacity never warns. */
export function overCapacity(doc) {
  const cap = capacity6(doc);
  return cap !== null && load6(doc) > cap;
}

/* Stone views, for display. */
export const capacityStone = (doc) => {
  const cap = capacity6(doc);
  return cap === null ? null : cap / STONE;
};
export const loadStone = (doc) => load6(doc) / STONE;
