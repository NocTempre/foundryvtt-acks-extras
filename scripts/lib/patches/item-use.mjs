/* global CONFIG */
/**
 * Core seam: the one wrapper on the system's `Item#use`, which every door that
 * uses an item ends in (the system's sheets and hotbar macro, the monster
 * sheet's rolls, the character sheet's spell cast), and the registry of
 * features that take an item's use over.
 *
 * Core's `use()` shows an `item`'s chat card and runs a weapon, a spell or a
 * proficiency through their own methods. A feature registers a claimant with
 * `addItemUseClaimant`; the wrapper offers each use to the claimants in
 * registration order, and the first whose `claims` answers exactly `true` runs
 * it. With no claimant the system's method runs untouched. A claimant must
 * decline every spell: `use()` reaches `_useSpell` for one, where
 * `patches/spell-use.mjs` is the cast's one owner.
 *
 * A claimant's `run(item, options, system)` decides what the use does. `system`
 * is the system's own `use(options)` behind a once-only door, and resolves true
 * when it ran; a claimant that wants the item's card shown calls it. It is
 * libWrapper's chained call, valid only until `run` settles; a later `system` is
 * a logged no-op that resolves false and never throws. A claimant that throws is
 * contained: `claims` is logged and passed over, `run` is logged.
 *
 * Nobody else wraps `use`. See docs/lib/DECISIONS.md, "The item carrier".
 */
import { MODULE_ID } from "../constants.mjs";

/** The wrapped method's path, as libWrapper takes it. */
const TARGET = "CONFIG.Item.documentClass.prototype.use";

/** Registered claimants by key; a Map iterates in insertion order. */
const claimants = new Map();

/** The prototypes already wrapped, so a second install adds no second layer. */
const installed = new WeakSet();

/**
 * Register a feature that takes an item's use over. A key already registered is
 * replaced in place, keeping its position. Register once, at `init`.
 * @param {object} claimant
 * @param {string} claimant.key Names the claimant; unique per feature.
 * @param {(item: Item, options: object) => boolean} claimant.claims Synchronous
 *   test; the first to answer exactly `true` wins, any other answer declines.
 * @param {(item: Item, options: object, system: () => Promise<boolean>) => *} claimant.run
 *   Runs the use, awaited. `system()` runs the system's own use once.
 */
export function addItemUseClaimant({ key, claims, run } = {}) {
  if (typeof key !== "string" || !key) throw new TypeError("addItemUseClaimant: a claimant needs a key");
  if (typeof claims !== "function" || typeof run !== "function") {
    throw new TypeError(`addItemUseClaimant: claimant "${key}" needs claims and run functions`);
  }
  claimants.set(key, { key, claims, run });
}

/**
 * Remove a registered claimant.
 * @param {string} key
 * @returns {boolean} whether one was registered under the key
 */
export function removeItemUseClaimant(key) {
  return claimants.delete(key);
}

/** The first claimant that claims this use, or null; one that throws is passed over. */
function claimantFor(item, options) {
  for (const claimant of claimants.values()) {
    try {
      if (claimant.claims(item, options) === true) return claimant;
    } catch (err) {
      console.error(`${MODULE_ID} | item-use claimant "${claimant.key}" threw in claims; offering the use on`, err);
    }
  }
  return null;
}

/** MIXED form: a claimant's run replaces the system's, which runs only through `system`. */
async function onUse(wrapped, options = {}) {
  const claimant = claimantFor(this, options);
  if (!claimant) return wrapped(options);
  let ran = null;
  let closed = false;
  const system = () => {
    if (closed) {
      console.error(`${MODULE_ID} | item-use claimant "${claimant.key}" called system after its run returned; nothing ran`);
      return Promise.resolve(false);
    }
    return (ran ??= (async () => { await wrapped(options); return true; })());
  };
  try {
    await claimant.run(this, options, system);
    if (ran) await ran;
  } catch (err) {
    console.error(`${MODULE_ID} | item-use claimant "${claimant.key}" threw in run`, err);
  } finally {
    closed = true;
  }
}

/**
 * Install at `init`, once the system's Item class is final. Unconditional and
 * settingless: with no claimant registered the wrapper only calls through. The
 * only owner of the wrapped method.
 */
export function installItemUsePatch() {
  const proto = CONFIG?.Item?.documentClass?.prototype;
  if (typeof proto?.use !== "function") {
    console.warn(`${MODULE_ID} | no Item#use to wrap; a feature that takes an item's use over cannot.`);
    return;
  }
  if (installed.has(proto)) return;
  installed.add(proto);
  if (globalThis.libWrapper?.register) {
    globalThis.libWrapper.register(MODULE_ID, TARGET, onUse, "MIXED");
    return;
  }
  const original = proto.use;
  proto.use = function (options) {
    return onUse.call(this, (o) => original.call(this, o), options);
  };
}
