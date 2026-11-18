/**
 * What a ceremonial invocation leaves behind, and the implements it wears
 * down: pure functions over plain data, plus thin flag helpers that take the
 * document.
 *
 * Two records, both under `flags["acks-extras"].ceremony`.
 *
 * - The ACTOR's `{stigma: [{castId, at, cause}], corruption: {points, wounds,
 *   log}}`. Stigma belongs to the invoker and not to a tradition: the ledger
 *   is the entry count, and a `castId` already in it is a replay that writes
 *   nothing. Corruption is a running total with the wounds it has made due.
 * - An ITEM's `{implementLevel, damage}`: the effective level of an implement
 *   set is its level less its damage.
 *
 * Every figure a book prints (how many marks a failure or a botch leaves, how
 * many points an invocation adds) arrives as an argument. A mutator handed no
 * usable count writes nothing and answers `{written: false, reason:
 * "noFigure"}`; no count is ever assumed here. What ships is procedure: the
 * ledger, the idempotence, and the Wisdom-score multiples that make wounds
 * due.
 *
 * Mutators are pure: they return `{state, written, reason?}` and never alter
 * the state they are given. The `record*` and `mark*` helpers apply one to a
 * document and call `setFlag` only when `written` is true.
 */
import { MODULE_ID } from "./constants.mjs";

/** Flag key under `flags["acks-extras"]` holding the ceremony record, on an actor and on an item. */
export const FLAG_CEREMONY = "ceremony";

/** A count of marks or points a book prints: a positive integer, else null. */
const markCount = (n) => (Number.isInteger(n) && n > 0 ? n : null);

/** A corruption point total a book prints: a positive finite number, else null. */
const pointCount = (n) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null);

const NO_FIGURE = Object.freeze({ written: false, reason: "noFigure" });

/** The flag value on a document, from `getFlag` where it has one, else from its plain `flags`. */
function flagOf(doc) {
  const viaGetter = typeof doc?.getFlag === "function" ? doc.getFlag(MODULE_ID, FLAG_CEREMONY) : undefined;
  return viaGetter ?? doc?.flags?.[MODULE_ID]?.[FLAG_CEREMONY] ?? null;
}

/** An actor's ceremony state in full shape, whatever the flag holds. The result shares nothing with the flag. */
export function actorState(raw) {
  const s = raw ?? {};
  const c = s.corruption ?? {};
  return {
    stigma: Array.isArray(s.stigma) ? s.stigma.map((e) => ({ ...e })) : [],
    corruption: {
      points: Number.isFinite(c.points) ? c.points : 0,
      wounds: Number.isFinite(c.wounds) ? c.wounds : 0,
      log: Array.isArray(c.log) ? c.log.map((e) => ({ ...e })) : [],
    },
  };
}

/** An implement's state in full shape: `implementLevel` is null until one is set, `damage` is never negative. */
export function itemState(raw) {
  const s = raw ?? {};
  return {
    implementLevel: Number.isFinite(s.implementLevel) ? s.implementLevel : null,
    damage: Number.isFinite(s.damage) && s.damage > 0 ? s.damage : 0,
  };
}

/** The stigma marks an invoker carries: the ledger's entry count. */
export function stigmaCount(state) {
  return actorState(state).stigma.length;
}

/**
 * Add `marks` stigma entries for one cast. Idempotent by `castId`: when the
 * ledger already holds the id nothing changes and the answer is `{written:
 * false, reason: "replay"}`. A `marks` that is not a positive integer, or a
 * blank `castId`, writes nothing (`"noFigure"`).
 */
export function addStigma(state, { castId, at, cause, marks } = {}) {
  const s = actorState(state);
  if (!castId || markCount(marks) === null) return { state: s, ...NO_FIGURE };
  if (s.stigma.some((e) => e.castId === castId)) return { state: s, written: false, reason: "replay" };
  for (let i = 0; i < marks; i++) s.stigma.push({ castId, at: at ?? null, cause: cause ?? null });
  return { state: s, written: true };
}

/** Empty the stigma ledger; corruption is not touched. An already empty ledger writes nothing (`"empty"`). */
export function purify(state) {
  const s = actorState(state);
  if (!s.stigma.length) return { state: s, written: false, reason: "empty" };
  s.stigma = [];
  return { state: s, written: true };
}

/**
 * Add corruption `points` for one cast and work out the wounds now due: one
 * for each multiple of `wisdomScore` the total has reached, never past `cap`
 * (null or absent: no ceiling). The wounds recorded never fall, so a later
 * call with a lower score cannot take one back. Idempotent by `castId` through
 * the log (`"replay"`); points that are not a positive number write nothing
 * (`"noFigure"`). A blank `wisdomScore` still records the points and makes no
 * wound due. The answer carries `woundsDue`, the wounds this call added.
 */
export function addCorruption(state, { castId, at, points, wisdomScore, cap } = {}) {
  const s = actorState(state);
  const add = pointCount(points);
  if (!castId || add === null) return { state: s, woundsDue: 0, ...NO_FIGURE };
  if (s.corruption.log.some((e) => e.castId === castId)) return { state: s, woundsDue: 0, written: false, reason: "replay" };
  s.corruption.points += add;
  s.corruption.log.push({ castId, at: at ?? null, points: add });
  let multiples = 0;
  if (typeof wisdomScore === "number" && Number.isFinite(wisdomScore) && wisdomScore > 0) {
    multiples = Math.floor(s.corruption.points / wisdomScore);
  }
  const ceiling = typeof cap === "number" && Number.isFinite(cap) ? Math.max(0, cap) : Infinity;
  const due = Math.max(s.corruption.wounds, Math.min(multiples, ceiling));
  const woundsDue = due - s.corruption.wounds;
  s.corruption.wounds = due;
  return { state: s, woundsDue, written: true };
}

/** An implement's effective level: its level less its damage, never below 0. An item with no level is 0. */
export function effectiveLevel(item) {
  const s = itemState(flagOf(item));
  if (s.implementLevel === null) return 0;
  return Math.max(0, s.implementLevel - s.damage);
}

/**
 * The implement sets an invoker may pick for a throw needing `needed`: the
 * items that carry an implement level and whose effective level is at least
 * `needed`, lowest effective level first (given order on a tie). The invoker
 * chooses among them; the throw never picks one. Empty when none is high
 * enough or `needed` is not a number.
 */
export function usableSets(items, needed) {
  if (typeof needed !== "number" || !Number.isFinite(needed)) return [];
  return [...(items ?? [])]
    .filter((item) => itemState(flagOf(item)).implementLevel !== null && effectiveLevel(item) >= needed)
    .sort((a, b) => effectiveLevel(a) - effectiveLevel(b));
}

/** Add `marks` damage to an implement's state. A `marks` that is not a positive integer writes nothing (`"noFigure"`). */
export function markDamage(state, { marks } = {}) {
  const s = itemState(state);
  if (markCount(marks) === null) return { state: s, ...NO_FIGURE };
  s.damage += marks;
  return { state: s, written: true };
}

/** Clear an implement's damage. An undamaged implement writes nothing (`"empty"`). */
export function resetDamage(state) {
  const s = itemState(state);
  if (s.damage === 0) return { state: s, written: false, reason: "empty" };
  s.damage = 0;
  return { state: s, written: true };
}

/** The actor's ceremony state, in full shape. */
export function readActorState(actor) {
  return actorState(flagOf(actor));
}

/** The item's ceremony state, in full shape. */
export function readItemState(item) {
  return itemState(flagOf(item));
}

/** Apply a mutator's answer to a document: one `setFlag` when it wrote, none otherwise. Returns the answer. */
async function apply(doc, answer) {
  if (answer.written) await doc.setFlag(MODULE_ID, FLAG_CEREMONY, answer.state);
  return answer;
}

/** `addStigma` on an actor's flag; see there for the arguments and the answer. */
export function recordStigma(actor, args) {
  return apply(actor, addStigma(flagOf(actor), args));
}

/** `purify` on an actor's flag. */
export function purifyActor(actor) {
  return apply(actor, purify(flagOf(actor)));
}

/** `addCorruption` on an actor's flag; see there for the arguments and the answer. */
export function recordCorruption(actor, args) {
  return apply(actor, addCorruption(flagOf(actor), args));
}

/** `markDamage` on an item's flag. */
export function markItemDamage(item, args) {
  return apply(item, markDamage(flagOf(item), args));
}

/** `resetDamage` on an item's flag. */
export function resetItemDamage(item) {
  return apply(item, resetDamage(flagOf(item)));
}
