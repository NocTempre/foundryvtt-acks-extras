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
import { citeOf, expectTables, getDoc, getLayer, hasDoc, PRIORITY } from "./tables.mjs";

/** The registered document the weight of a man-sized body arrives in (RR p. 161). */
export const CAPACITY_DOC = "capacity";
/** Its table holding the body a rider or a passenger is assumed to weigh: `{stone}`. */
export const RIDER_BODY_TABLE = "riderBody";

/** Declare the capacity tables, so an import names them as missing until they land. */
export function declareCapacityTables() {
  expectTables(CAPACITY_DOC, [RIDER_BODY_TABLE]);
}

/** A man-sized body's weight in sixths of a stone from the `capacity` table; null when none is imported. */
export function riderBody6() {
  if (!hasDoc(CAPACITY_DOC)) return null;
  const raw = getDoc(CAPACITY_DOC)?.tables?.[RIDER_BODY_TABLE]?.stone;
  const n = Number(raw);
  return raw != null && raw !== "" && Number.isFinite(n) && n > 0 ? n * STONE : null;
}

/**
 * Where the man-sized body's weight came from: the Judge's edit, the imported page, or nothing.
 * @returns {{state: "judge"|"page"|"none", cite: string|null}}
 */
export function riderBodySource() {
  if (riderBody6() === null) return { state: "none", cite: null };
  if (getLayer(CAPACITY_DOC, PRIORITY.OVERRIDE)?.tables?.[RIDER_BODY_TABLE] != null) return { state: "judge", cite: null };
  return { state: "page", cite: citeOf(CAPACITY_DOC, RIDER_BODY_TABLE) };
}

/** The body weight a creature states for itself (`extras.bodyStone`, per body), in stone; null when blank. */
export function statedBodyStone(actor) {
  const stated = actor?.flags?.[MODULE_ID]?.extras?.bodyStone;
  const body = stated == null || stated === "" ? NaN : Number(stated);
  return Number.isFinite(body) ? body : null;
}

/** Tooltip naming where the man-sized body's weight came from; empty for an actor who states their own. */
export function riderBodyTip(actor) {
  const i18n = globalThis.game?.i18n;
  if (!i18n || statedBodyStone(actor) !== null) return "";
  const { state, cite } = riderBodySource();
  if (state === "judge") return i18n.localize("ACKS-LIB.capacity.riderBody.judge");
  if (state === "page" && cite) return i18n.format("ACKS-LIB.capacity.riderBody.page", { cite });
  return i18n.localize("ACKS-LIB.capacity.riderBody.none");
}

/** One body's weight in sixths of a stone: the stated weight, else the imported man-sized body; null when neither. */
export function bodyWeight6(actor) {
  const own = statedBodyStone(actor);
  return own === null ? riderBody6() : own * STONE;
}

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
 * unmitigated, per living body of a stack (`riderBody6`, RR p. 161). Null
 * where the body's weight is not known.
 * @returns {number|null}
 */
export function borneBy6(actor) {
  const body6 = bodyWeight6(actor);
  return body6 === null ? null : body6 * bodyCount(actor) + borneWeight6(actor);
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
 * What the document is holding, in sixths of a stone; null for a mount whose rider's body weight is unknown.
 * @returns {number|null}
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
  if (rider) {
    const borne = borneBy6(rider);
    if (borne === null) return null;
    sum += borne;
  }
  return sum;
}

/** Is it holding more than it can? Unstated capacity and an unknown load never warn. */
export function overCapacity(doc) {
  const cap = capacity6(doc);
  const load = load6(doc);
  return cap !== null && load !== null && load > cap;
}

/** The document's capacity in stone, for display; null when none is stated. */
export const capacityStone = (doc) => {
  const cap = capacity6(doc);
  return cap === null ? null : cap / STONE;
};
/** What the document is holding, in stone, for display; null where `load6` is. */
export const loadStone = (doc) => {
  const load = load6(doc);
  return load === null ? null : load / STONE;
};

/**
 * The speeds that the system's own movement calculation gives a character
 * bearing `stone` against a maximum of `max`, with `mod` as the character's
 * movement modifier: exploration per turn, combat and running per round. Null
 * when the system's actor class has no such calculation or it throws. A figure
 * for a bearing the actor's own document does not hold: a seat core derived
 * nothing for, a carrier's load with a casualty's share added, or a swimmer
 * lifting a body.
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
 * @returns {{exploration: number|null, combat: number|null, running: number|null}|null}
 *   `running` is core's charge and run speed
 */
export function movementBearing({ stone, max, mod = 0 }) {
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
  const speeds = stub.system.movementacks;
  const read = (n) => (Number.isFinite(n) ? n : null);
  return { exploration: read(speeds.exploration), combat: read(speeds.combat), running: read(speeds.chargerun) };
}

/**
 * The exploration speed in feet per turn of a bearing (`movementBearing`), or
 * null where the system gives none.
 *
 * @param {{stone: number, max: number, mod?: number}} bearing
 * @returns {number|null}
 */
export function explorationSpeedBearing(bearing) {
  return movementBearing(bearing)?.exploration ?? null;
}
