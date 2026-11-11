/* global CONFIG */
/**
 * Core seam: the one wrapper on the system's `Item#_useSpell`, which the
 * system's and this module's cast buttons and macros end in, and the registry
 * of features that take a cast over.
 *
 * Core's `_useSpell` raises the spell's cast count and posts its chat card. The
 * system's sheet button, its hotbar macro, this module's Magic tab button and
 * the monster sheet all call `item.use()`, which calls `_useSpell`, so wrapping
 * it is the one place a feature can see a cast whichever door the player used.
 * A hand edit of a Cast count field writes the count directly and is no cast.
 * A feature registers a claimant with `addSpellUseClaimant`; the wrapper offers
 * each cast to the claimants in registration order, and the first whose
 * `claims` answers true runs the cast. With no claimant the system's method
 * runs untouched.
 *
 * A claimant's `cast(item, options, spend)` decides whether the cast happens at
 * all. `spend` is the system's own `_useSpell(options)`, the cast count and the
 * card, behind a once-only door: calling it twice runs the system's method
 * once. A claimant that is refused or cancelled never calls it, so a cast that
 * did not happen costs the spell nothing. `spend` resolves true when it ran
 * the system's method. It is libWrapper's chained call underneath, valid only
 * until `cast` settles, so a claimant calls it before `cast` returns. A
 * `spend` after that is a logged no-op that resolves false and never throws
 * into its caller: libWrapper would throw there, and Foundry would raise its
 * module-error notice at the table.
 *
 * The system's `use()` calls `_useSpell` WITHOUT awaiting it, so a caller of
 * `item.use()` cannot wait for, or catch, a claimant's cast. A feature that
 * must await the cast calls `item._useSpell(options)` itself: that is the
 * wrapped method, and its promise settles when the claimant's cast does.
 *
 * Every claimant that throws is contained: a `claims` that throws is logged and
 * passed over, a `cast` that throws is logged and the spell is spent only if
 * `spend` already ran. A claimant must never cost the table its cast.
 *
 * This is the method's one wrapper. A later cast engine registers a claimant;
 * it does not wrap `_useSpell` a second time.
 */
import { MODULE_ID } from "../constants.mjs";

/** The wrapped method's path, as libWrapper takes it. */
const TARGET = "CONFIG.Item.documentClass.prototype._useSpell";

/** Registered claimants by key; a Map iterates in insertion order. */
const claimants = new Map();

/** The prototypes already wrapped, so a second install adds no second layer. */
const installed = new WeakSet();

/**
 * Register a feature that takes a spell's cast over.
 *
 * A key already registered is replaced in place, keeping its position in the
 * order. The registry outlives a window or a sheet: register once, at `init`.
 * @param {object} claimant
 * @param {string} claimant.key Names the claimant; unique per feature.
 * @param {(item: Item, options: object) => boolean} claimant.claims Synchronous
 *   test of whether this claimant takes this cast. The first to answer exactly
 *   `true` wins and the rest are not asked; any other answer, a promise
 *   included, declines.
 * @param {(item: Item, options: object, spend: () => Promise<boolean>) => *} claimant.cast
 *   Runs the cast, awaited. Calls `spend()` before it returns when the cast is
 *   to count; never calling it spends nothing. `spend()` resolves true when the
 *   system's method ran and false when it was called too late to run it.
 */
export function addSpellUseClaimant({ key, claims, cast } = {}) {
  if (typeof key !== "string" || !key) throw new TypeError("addSpellUseClaimant: a claimant needs a key");
  if (typeof claims !== "function" || typeof cast !== "function") {
    throw new TypeError(`addSpellUseClaimant: claimant "${key}" needs claims and cast functions`);
  }
  claimants.set(key, { key, claims, cast });
}

/**
 * Remove a registered claimant.
 * @param {string} key
 * @returns {boolean} whether one was registered under the key
 */
export function removeSpellUseClaimant(key) {
  return claimants.delete(key);
}

/** The first claimant that claims this cast, or null; one that throws is passed over. */
function claimantFor(item, options) {
  for (const claimant of claimants.values()) {
    try {
      if (claimant.claims(item, options) === true) return claimant;
    } catch (err) {
      console.error(`${MODULE_ID} | spell-use claimant "${claimant.key}" threw in claims; offering the cast on`, err);
    }
  }
  return null;
}

/**
 * MIXED form: a claimant's cast replaces the system's, which runs only through
 * `spend`; with no claimant the system's method runs as it stands.
 */
async function onUseSpell(wrapped, options = {}) {
  const claimant = claimantFor(this, options);
  if (!claimant) return wrapped(options);
  let spent = null;
  let closed = false;
  const spend = () => {
    if (closed) {
      console.error(`${MODULE_ID} | spell-use claimant "${claimant.key}" called spend after its cast returned; the cast was not counted`);
      return Promise.resolve(false);
    }
    return (spent ??= (async () => { await wrapped(options); return true; })());
  };
  try {
    await claimant.cast(this, options, spend);
    // A spend the claimant started and did not await still settles inside this call.
    if (spent) await spent;
  } catch (err) {
    console.error(`${MODULE_ID} | spell-use claimant "${claimant.key}" threw in cast; ${spent ? "the cast was already spent" : "nothing was spent"}`, err);
  } finally {
    // libWrapper invalidates the chained call once this promise settles.
    closed = true;
  }
}

/**
 * Install at `init`, once the system's Item class is final. Unconditional and
 * settingless: with no claimant registered the wrapper only calls through. The
 * only owner of the wrapped method.
 */
export function installSpellUsePatch() {
  const proto = CONFIG?.Item?.documentClass?.prototype;
  if (typeof proto?._useSpell !== "function") {
    console.warn(`${MODULE_ID} | no Item#_useSpell to wrap; a feature that takes a cast over cannot.`);
    return;
  }
  if (installed.has(proto)) return;
  installed.add(proto);
  if (globalThis.libWrapper?.register) {
    globalThis.libWrapper.register(MODULE_ID, TARGET, onUseSpell, "MIXED");
    return;
  }
  const original = proto._useSpell;
  proto._useSpell = function (options) {
    return onUseSpell.call(this, (o) => original.call(this, o), options);
  };
}
