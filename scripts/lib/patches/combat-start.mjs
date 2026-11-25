/* global CONFIG, game */
/**
 * Core patch: a combat begun and then abandoned at the declaration prompt is
 * left unstarted, and the surprise its matrix applied is lifted.
 *
 * The system's `AcksCombat#internalStartCombat` stores `flags.acks.initDone`
 * before it asks `confirmCombatActionDeclaration()`, and on No or the window's X
 * it returns with nothing undone. The combat stays at round 0 with the flag set,
 * and the Surprised statuses the Surprise Matrix applied just before stay on the
 * actors; the system's `surprised` condition has no duration, so nothing else
 * lifts them for a combat that never started. `startCombat` (the tracker's Begin
 * Combat) clears its own `outnumbering` marks and opens the matrix, touching
 * neither the flag nor the statuses, so a second press meets the first attempt's
 * leavings.
 *
 * This file is the one owner of both methods: nothing else shipped wraps
 * `internalStartCombat` or `startCombat`, and `cleanupStatus` is only called.
 * Both wrappers run the system's method unmodified and act on the GM's seat only.
 * A start in flight is counted per combat on this seat, from before the original
 * is called to after it settles.
 *
 * `internalStartCombat`: once the original fulfils, with the combat still in the
 * world, at round 0 and with no other start of it still in flight on this seat,
 * the flag is unset and `cleanupStatus("surprised")` lifts the status from every
 * combatant's actor. The Yes path leaves round 1, so nothing runs for it. A
 * rejected original is rethrown untouched with no cleanup. An error of the
 * cleanup is warned and never thrown, and the original's result is returned.
 *
 * `startCombat`: before the call goes through, a combat at round 0 with the flag
 * set and no start in flight on this seat is an abandoned one (the page was
 * reloaded while the prompt was open), and gets the same cleanup. A start in
 * flight, whose prompt may be open, is never cleaned. An error of this
 * pre-clean is warned and the call goes through.
 *
 * It stands down by observation: on a system that leaves nothing behind there is
 * no flag to unset and no status to lift, so nothing is written. There is no
 * version gate, no duration is set on the status, and nothing in lib's
 * conditions or status files is wrapped. The status lift reaches every Surprised
 * on the combatants, including one a Judge set by hand before pressing Begin
 * Combat.
 *
 * See docs/lib/DECISIONS.md, "A cancelled declaration leaves the combat
 * unstarted and lifts its surprise".
 */
import { MODULE_ID } from "../constants.mjs";

/** The wrapped methods' paths, as libWrapper takes them. */
const TARGET_START = "CONFIG.Combat.documentClass.prototype.startCombat";
const TARGET_INTERNAL = "CONFIG.Combat.documentClass.prototype.internalStartCombat";

/** The system's flag scope and key for a combat that has begun, and the status its matrix applies. */
const SCOPE = "acks";
const KEY = "initDone";
const STATUS = "surprised";

/** The combat classes already patched, so a second install adds no second layer. */
const installed = new WeakSet();

/** Starts of each combat in flight on this seat, by combat id. */
const inFlight = new Map();

/** Whether this seat runs the Judge's half. */
const isGM = () => game.user?.isGM === true;

/** Whether the combat is at round 0 with the system's flag set: begun by the system's own account, and not yet round 1. */
const markedUnstarted = (combat) => combat.round === 0 && Boolean(combat.getFlag(SCOPE, KEY));

/**
 * Unset the flag and lift the status from every combatant. Each step is tried
 * apart, so a failed write leaves the other to run, and a failure is warned.
 */
async function leaveUnstarted(combat) {
  try {
    if (combat.getFlag(SCOPE, KEY)) await combat.unsetFlag(SCOPE, KEY);
  } catch (err) {
    console.warn(`${MODULE_ID} | could not unset the combat's started flag after an abandoned start.`, err);
  }
  try {
    await combat.cleanupStatus(STATUS);
  } catch (err) {
    console.warn(`${MODULE_ID} | could not lift the Surprised status after an abandoned start.`, err);
  }
}

/** The system's start, counted; the cleanup runs after it fulfils and only for the last start of the combat to finish. */
async function onInternalStartCombat(wrapped, ...args) {
  const id = this.id;
  inFlight.set(id, (inFlight.get(id) ?? 0) + 1);
  let result;
  try {
    result = await wrapped(...args);
  } finally {
    const left = (inFlight.get(id) ?? 1) - 1;
    if (left > 0) inFlight.set(id, left);
    else inFlight.delete(id);
  }
  if (isGM() && game.combats?.has(id) && !inFlight.has(id) && this.round === 0) await leaveUnstarted(this);
  return result;
}

/** The tracker's Begin Combat: an abandoned start is cleared before the matrix opens. */
async function onStartCombat(wrapped, ...args) {
  if (isGM() && !inFlight.has(this.id) && markedUnstarted(this)) await leaveUnstarted(this);
  return wrapped(...args);
}

/**
 * Install at `ready`, when the combat class is final. Unconditional and
 * settingless: this repairs one defect, and a toggle would only be a toggle for
 * the broken state. A second call adds no second layer.
 */
export function installCombatStartPatch() {
  const proto = CONFIG.Combat?.documentClass?.prototype;
  if (typeof proto?.startCombat !== "function" || typeof proto?.internalStartCombat !== "function") {
    console.warn(`${MODULE_ID} | no Combat#startCombat and #internalStartCombat to wrap; a combat abandoned at its declaration prompt keeps its started flag and its Surprised statuses.`);
    return;
  }
  if (installed.has(proto)) return;
  installed.add(proto);
  if (globalThis.libWrapper?.register) {
    globalThis.libWrapper.register(MODULE_ID, TARGET_INTERNAL, onInternalStartCombat, "WRAPPER");
    globalThis.libWrapper.register(MODULE_ID, TARGET_START, onStartCombat, "WRAPPER");
    return;
  }
  const internal = proto.internalStartCombat;
  const start = proto.startCombat;
  proto.internalStartCombat = function (...args) {
    return onInternalStartCombat.call(this, (...a) => internal.apply(this, a), ...args);
  };
  proto.startCombat = function (...args) {
    return onStartCombat.call(this, (...a) => start.apply(this, a), ...args);
  };
}
