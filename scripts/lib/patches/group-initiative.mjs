/* global CONFIG */
/**
 * Core patch: `AcksCombat#manageGroup`, the tracker's group control, keeps each
 * group's own initiative modifier and returns its write.
 *
 * Two defects of the system's method, one patch. The loop that finds a group's
 * "worst initiative value" walks the tokens just passed for EVERY stored group,
 * so a new group overwrites every earlier group's `initiativeBonus` with the
 * lowest value among the new tokens. And the method neither awaits nor returns
 * write of the stored list; Foundry applies an update when
 * the server replies, so a caller cannot wait on the call, and a second call
 * made before the first lands starts from a list that lacks the first group.
 *
 * This file is the one owner of `manageGroup`: nothing else shipped wraps it,
 * and `group-combat.mjs` only calls it. The wrapper never replaces the method.
 * While the system's own method runs, `setFlag` is shadowed on the combat as an
 * own property and the shadow comes off in a `finally`, even when the method
 * throws; `setFlag` itself is never wrapped, so no other document's write is
 * touched. The shadow acts on one write only, scope `acks`, key `groups`, an
 * array value. Anything else goes straight to the real `setFlag`.
 *
 * The shadow corrects the list before the real write. A stored group, an object
 * with a `tokens` array and an `initiativeBonus`, takes the lowest
 * `actor.system.initiative.value` among its own tokens' combatants where its
 * bonus equals the lowest among the tokens just passed and differs from its
 * own. A group none of whose tokens resolve to a combatant with an actor, and
 * any other shape, keeps the system's figure. The method then returns a promise
 * for the real write, so a caller that awaits it holds a stored list that has
 * landed. Two presses of the control made before the first lands are not ordered
 * by this patch.
 *
 * It stands down by observation. A system that computes each group's bonus from
 * its own tokens leaves every bonus equal to its group's own lowest, so nothing
 * is corrected and the list written is the one the system built, and the
 * promise returned waits on the system's own before it resolves to the write.
 * There is no version gate. Should the system move its write behind an `await`,
 * the shadow catches nothing and the system's behaviour stands; the live walk's
 * checks on each group's bonus and on two awaited calls report that.
 *
 * See docs/lib/DECISIONS.md, "The group control keeps each group's own
 * initiative modifier and returns its write".
 */
import { MODULE_ID } from "../constants.mjs";

/** The wrapped method's path, as libWrapper takes it. */
const TARGET = "CONFIG.Combat.documentClass.prototype.manageGroup";

/** The system's flag scope and key for a combat's stored groups. */
const SCOPE = "acks";
const KEY = "groups";

/** The combat classes already patched, so a second install adds no second layer. */
const installed = new WeakSet();

/** `combatant.actor.system.initiative.value`, or null when the combatant has no such number. */
function initiativeOf(combatant) {
  const value = combatant?.actor?.system?.initiative?.value;
  return typeof value === "number" ? value : null;
}

/** The lowest initiative value among the combatants standing for these token ids, or null when none resolves. */
function lowestOf(combatants, tokenIds) {
  const ids = new Set(tokenIds);
  const values = combatants
    .filter((c) => ids.has(c?.token?.id ?? c?.tokenId))
    .map(initiativeOf)
    .filter((v) => v !== null);
  return values.length ? Math.min(...values) : null;
}

/**
 * The stored list with each group's bonus put right: the same array when no
 * group needs it, else a copy with only the corrected groups replaced.
 * @param {Combat} combat
 * @param {Array} groups the list the system is writing
 * @param {Array<{id: string}>} passed the tokens the call was made with
 */
function corrected(combat, groups, passed) {
  const combatants = Array.from(combat.combatants ?? []);
  const lowestPassed = lowestOf(combatants, passed.map((t) => t?.id));
  if (lowestPassed === null) return groups;
  let changed = false;
  const out = groups.map((g) => {
    if (!g || !Array.isArray(g.tokens) || !("initiativeBonus" in g) || g.initiativeBonus !== lowestPassed) return g;
    const own = lowestOf(combatants, g.tokens);
    if (own === null || own === g.initiativeBonus) return g;
    changed = true;
    return { ...g, initiativeBonus: own };
  });
  return changed ? out : groups;
}

/**
 * WRAPPER form: the system's method runs unmodified, with `setFlag` shadowed for
 * its synchronous call. Returns the system's own return when it wrote nothing,
 * else a promise for the real write.
 */
function onManageGroup(wrapped, ...args) {
  const real = this.setFlag;
  const prior = Object.getOwnPropertyDescriptor(this, "setFlag");
  let written = null;
  Object.defineProperty(this, "setFlag", {
    configurable: true,
    writable: true,
    value: (scope, key, value, ...rest) => {
      if (scope !== SCOPE || key !== KEY || !Array.isArray(value)) return real.call(this, scope, key, value, ...rest);
      written = real.call(this, scope, key, corrected(this, value, args[0] ?? []), ...rest);
      return written;
    },
  });
  let out;
  try {
    out = wrapped(...args);
  } finally {
    if (prior) Object.defineProperty(this, "setFlag", prior);
    else delete this.setFlag;
  }
  return written ? Promise.resolve(out).then(() => written) : out;
}

/**
 * Install at `ready`, when the combat class is final. Unconditional and
 * settingless: this repairs two defects, and a toggle for either would only be
 * a toggle for the broken state. A second call adds no second layer.
 */
export function installGroupInitiativePatch() {
  const proto = CONFIG.Combat?.documentClass?.prototype;
  if (typeof proto?.manageGroup !== "function") {
    console.warn(`${MODULE_ID} | no Combat#manageGroup to wrap; a second group may take the first's initiative modifier and a caller cannot wait on the group control.`);
    return;
  }
  if (installed.has(proto)) return;
  installed.add(proto);
  if (globalThis.libWrapper?.register) {
    globalThis.libWrapper.register(MODULE_ID, TARGET, onManageGroup, "WRAPPER");
    return;
  }
  const original = proto.manageGroup;
  proto.manageGroup = function (...args) {
    return onManageGroup.call(this, (...a) => original.apply(this, a), ...args);
  };
}
