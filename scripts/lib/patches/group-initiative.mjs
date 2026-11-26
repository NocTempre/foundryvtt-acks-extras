/* global CONFIG */
/**
 * Core patch: `AcksCombat#manageGroup`, the tracker's group control, keeps each
 * group's own initiative modifier, returns its write and drops the token ids no
 * combatant holds.
 *
 * Three defects of the system's method, one patch. The loop that finds a group's
 * "worst initiative value" walks the tokens just passed for EVERY stored group,
 * so a new group overwrites every earlier group's `initiativeBonus` with the
 * lowest value among the new tokens. The method neither awaits nor returns its
 * write of the stored list; Foundry applies an update when the server replies, so
 * a caller cannot wait on the call, and a second call made before the first lands
 * starts from a list that lacks the first group. And it never drops a token id
 * that is no longer a combatant, so a group whose bodies were gathered back to one
 * row stays stored with dead ids and shifts the index the tracker marks each
 * group by (`[G<index>]`).
 *
 * This file is the one owner of `manageGroup`: nothing else shipped wraps it,
 * and `group-combat.mjs` only calls it. The wrapper never replaces the method.
 * While the system's own method runs, `setFlag` is shadowed on the combat as an
 * own property and the shadow comes off in a `finally`, even when the method
 * throws; `setFlag` itself is never wrapped, so no other document's write is
 * touched. The shadow acts on one write only, scope `acks`, key `groups`, an
 * array value. Anything else goes straight to the real `setFlag`.
 *
 * The shadow corrects the list before the real write, in two steps. First it
 * drops from each stored group, an object with a `tokens` array, every token id
 * that no combatant of this combat holds, and then any group those ids left with
 * fewer than two tokens, which is the system's own rule for a group. The group
 * just made always passes, since the method refuses a token that is no combatant;
 * a surviving group keeps its initiative and its bonus. A group with no dead id
 * is not touched, whatever its size. The list is pruned only when a group call
 * writes it, so a group stale from an early gather stands until the next call on
 * that combat. Second, a stored group, an object with a `tokens` array and an
 * `initiativeBonus`, takes the lowest
 * `actor.system.initiative.value` among its own tokens' combatants where its
 * bonus equals the lowest among the tokens just passed and differs from its
 * own. A group none of whose tokens resolve to a combatant with an actor, and
 * any other shape, keeps the system's figure. The method then returns a promise
 * for the real write, so a caller that awaits it holds a stored list that has
 * landed. Two presses of the control made before the first lands are not ordered
 * by this patch.
 *
 * It stands down by observation. A system that computes each group's bonus from
 * its own tokens leaves every bonus equal to its group's own lowest, so on a list
 * with no dead id nothing is corrected and the list written is the one the system
 * built, and the promise returned waits on the system's own before it resolves to
 * the write. A system that prunes dead ids itself leaves the pruning nothing to do.
 * There is no version gate. Should the system move its write behind an `await`,
 * the shadow catches nothing and the system's behaviour stands; the live walk's
 * checks on each group's bonus and on two awaited calls report that.
 *
 * See docs/lib/DECISIONS.md, "The group control keeps each group's own
 * initiative modifier and returns its write".
 */
import { MODULE_ID } from "../constants.mjs";
import { tokenlessNames, noticeOnce } from "./tokenless-combat.mjs";

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
 * The stored list without the token ids no combatant of this combat holds, and
 * without a group those ids left with fewer than two tokens (the system's own rule
 * for a group): the same array when nothing is stale, else a copy. A group with no
 * dead id keeps its place, its initiative and its bonus, whatever its token count;
 * a group of any other shape is passed through.
 * @param {Combat} combat
 * @param {Array} groups the list the system is writing
 */
function pruned(combat, groups) {
  const held = new Set(Array.from(combat.combatants ?? []).map((c) => c?.token?.id ?? c?.tokenId));
  let changed = false;
  const out = [];
  for (const g of groups) {
    if (!g || !Array.isArray(g.tokens) || g.tokens.every((id) => held.has(id))) {
      out.push(g);
      continue;
    }
    changed = true;
    const tokens = g.tokens.filter((id) => held.has(id));
    if (tokens.length > 1) out.push({ ...g, tokens });
  }
  return changed ? out : groups;
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
 *
 * In a combat holding a combatant with no token the method is not called: it
 * reads the token of every combatant and throws on that one. The Judge is shown
 * the combat's one notice, naming the row, and the call returns undefined, as the
 * system's own refusals do. The initiative wrap sends such a combat's rolls to
 * Foundry's roll, which makes no groups, so a group made there would never be
 * rolled as one.
 */
function onManageGroup(wrapped, ...args) {
  if (tokenlessNames(this).length) {
    noticeOnce(this);
    return undefined;
  }
  const real = this.setFlag;
  const prior = Object.getOwnPropertyDescriptor(this, "setFlag");
  let written = null;
  Object.defineProperty(this, "setFlag", {
    configurable: true,
    writable: true,
    value: (scope, key, value, ...rest) => {
      if (scope !== SCOPE || key !== KEY || !Array.isArray(value)) return real.call(this, scope, key, value, ...rest);
      written = real.call(this, scope, key, corrected(this, pruned(this, value), args[0] ?? []), ...rest);
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
