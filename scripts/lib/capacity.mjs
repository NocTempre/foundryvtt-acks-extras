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
  sumWeight6,
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

/** What is on the body: every item that has not left it. */
const present = (actor) => [...(actor.items ?? [])].filter((item) => !isAbsent(item));

/**
 * The "borne" reading: the kit a bearer answers for — no carrying overlay,
 * clothing free, nothing that has left the body. Coin is part of the kit and
 * weighs through the item model like the rest. See docs/lib/MODEL.md,
 * "Capacity", the burden/borne/carried table.
 */
export function borneWeight6(actor) {
  if (!isActor(actor)) return 0;
  return sumWeight6(present(actor), encumbering6);
}

/**
 * The "carried" reading: everything on the body at what it weighs, clothing
 * included. See docs/lib/MODEL.md, "Capacity", the burden/borne/carried table.
 */
export function carriedWeight6(actor) {
  if (!isActor(actor)) return 0;
  return sumWeight6(present(actor));
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

/** A monster's own carried weight: items and coin (core computes neither for
 * monsters, so both are summed here — clothing weighs nothing carried).
 * Spoils are the monster's own harvestable parts, not cargo. */
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

/** The document's capacity in stone, for display; null when none is stated. */
export const capacityStone = (doc) => {
  const cap = capacity6(doc);
  return cap === null ? null : cap / STONE;
};
/** What the document is holding, in stone, for display. */
export const loadStone =(doc) => load6(doc) / STONE;

/**
 * The exploration speed in feet per turn that the system's own movement
 * calculation gives a character bearing `stone` against a maximum of `max`,
 * with `mod` as the character's movement modifier; null when the system's actor
 * class has no such calculation or it throws. A figure for a bearing the
 * actor's own document does not hold: a seat core derived nothing for, or a
 * carrier's load with a casualty's share added.
 *
 * Core's `_calculateMovement` runs on a stub shaped as it reads, so the
 * system's tiers and bands stay the system's: nothing here states one. The
 * stub carries no `statuses`, which is the condition wrapper's own test for
 * "nothing to apply" — a condition on the real actor must not slow a bearing
 * that is hypothetical.
 *
 * @param {object} o
 * @param {number} o.stone the encumbrance, in stone
 * @param {number} o.max the maximum encumbrance, in stone
 * @param {number} [o.mod] the movement modifier added to the tier
 * @returns {number|null}
 */
export function explorationSpeedBearing({ stone, max, mod = 0 }) {
  const calculate = globalThis.CONFIG?.Actor?.documentClass?.prototype?._calculateMovement;
  if (typeof calculate !== "function") return null;
  const stub = {
    system: {
      encumbrance: { value: Number(stone), max: Number(max) },
      movement: { mod: Number(mod) || 0, base: 0 },
      movementacks: {},
    },
  };
  try {
    calculate.call(stub);
  } catch (err) {
    console.warn(`${MODULE_ID} | the system's movement calculation could not run on a stand-in actor`, err);
    return null;
  }
  const speed = stub.system.movementacks.exploration;
  return Number.isFinite(speed) ? speed : null;
}
