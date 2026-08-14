/**
 * Capacity is one concept, answered once: how much can this document hold, how
 * much is it holding, and is that too much — for ANY document that can carry
 * (a character, a monster or mount, a container item; a wagon slots in as
 * whatever document core eventually makes it, with `load` fields meanwhile).
 *
 * The canonical unit is SIXTHS of a stone — the books' minimum denomination
 * (most small items weigh 1/6 stone) and core's own storage unit
 * (`item.system.weight6`, `encumbrance.value6`). Integer sixths are exact
 * where stone floats drift; stone is the DISPLAY unit, derived by division.
 *
 * Encumbrance is capacity applied to an actor:
 *  - a CHARACTER's capacity is core's `system.encumbrance.max` — which already
 *    resolves the GM's forced maximum against `20 + STR mod` — and its load is
 *    core's computed `value6` (items plus coin);
 *  - a MONSTER or mount's capacity is the extras model's `load.capacity`,
 *    falling back to twice `load.normal` (MM p. 13's normal/maximum pairing),
 *    and its load is what it carries — its items, its coin, and its rider: a
 *    mounted character counts BODY weight plus carried encumbrance against the
 *    mount (RR ch. 6 prices the adventurer at 15 stone);
 *  - a CONTAINER item's capacity is its declared gear capacity and its load is
 *    its contents, nested containers included.
 *
 * `null` capacity means unstated, and unstated never warns — the same rule
 * `capacityOf` set for containers. `overCapacity` is a STATE, not a gate:
 * what an overloaded mount means is the caller's to decide.
 */
import { MODULE_ID } from "./constants.mjs";
import { ACTOR_TYPE } from "./vocab.mjs";
import {
  STONE,
  capacityOf,
  encumbering6,
  contentsWeight6,
} from "./item-model.mjs";
import { riderOf } from "./mount.mjs";

/** RR ch. 6 §Mounts prices the rider's own body at 15 stone. */
export const RIDER_BODY6 = 15 * STONE;

/**
 * What an actor's kit actually WEIGHS, as opposed to how burdened they feel.
 *
 * `system.encumbrance` is a movement figure, and this family bends it on
 * purpose: an adventurer's harness ignores a stone of gear, a mounted shield
 * rides lighter, a bowquiver counts as two items instead of its parts, a
 * thrown weapon stops weighing on the hand that threw it. Every one of those
 * is a statement about how well the load is CARRIED, not about how much mass
 * exists — so none of them may reach a mount or a wagon. A harness does not
 * make a horse's burden lighter; it makes the walking easier.
 *
 * Hence this: the same sum core makes over the actor's own items, without the
 * encumbrance overlay. Clothing still weighs nothing, which is core's own
 * semantics for worn clothes rather than an overlay of ours.
 */
export function borneWeight6(actor) {
  if (!isActor(actor)) return 0;
  let sum = 0;
  for (const item of actor.items ?? []) {
    if (item.getFlag?.(MODULE_ID, "spoil")) continue;
    sum += encumbering6(item);
  }
  const money = actor.getTotalMoneyEncumbrance?.();
  if (Number.isFinite(money?.stone)) sum += money.stone * STONE;
  return sum;
}

/**
 * What this actor costs the thing carrying them: their body plus their kit,
 * unmitigated. A character's body is the book's 15 stone; a creature with a
 * stated body weight uses its own.
 */
export function borneBy6(actor) {
  const body = Number(actor?.flags?.[MODULE_ID]?.extras?.bodyStone);
  const body6 = Number.isFinite(body) ? body * STONE : RIDER_BODY6;
  return body6 + borneWeight6(actor);
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
  if (Number.isFinite(load?.normal)) return Number(load.normal) * 2 * STONE;
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
  // A rider costs their body plus what they are actually carrying. Reading
  // their ENCUMBRANCE here would hand the mount every trick that makes the
  // rider's own walking easier, and a harness does not lighten a horse.
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
