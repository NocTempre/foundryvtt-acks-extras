/* global CONFIG, game, ui */
/**
 * Core patch: combatants tied on initiative sort into one order on every seat.
 *
 * `AcksCombat#setupTurns` sorts with the system's `sortCombatantsACKS`, and
 * `combat.turn` indexes that order. The system's comparator answers the same
 * sign in both directions for two combatants of the same side, so such a pair
 * is ordered by the engine's sort and its input order, which differ between
 * clients.
 *
 * This wrapper leaves a pair with different initiative to the system. On a tie:
 * a combatant on the outnumbering side sorts after one that is not; else a
 * hostile one sorts first; else the lower combatant id sorts first. The id is
 * the one key identical on every client.
 *
 * `setupTurns` passes the comparator unbound, so nothing here reads `this`.
 *
 * See docs/lib/DECISIONS.md, "Tied initiative sorts the same on every seat".
 */
import { MODULE_ID } from "../constants.mjs";

/** The wrapped method's path, as libWrapper takes it. */
const TARGET = "CONFIG.Combat.documentClass.prototype.sortCombatantsACKS";

/** Whether the combatant sits on the side the system flagged as outnumbering. */
function isOutnumbering(combatant) {
  return !!combatant?.flags?.acks?.outnumbering;
}

/** Whether the combatant's token is hostile. */
function isHostile(combatant) {
  const hostile = globalThis.CONST?.TOKEN_DISPOSITIONS?.HOSTILE ?? -1;
  return combatant?.token?.disposition === hostile;
}

/**
 * The tied-initiative order: negative when `a` sorts first, positive when `b`
 * does, zero only for the same combatant. A total order on the combatants of
 * one combat: it compares the tuple (outnumbering, not hostile, id).
 * @param {Combatant} a
 * @param {Combatant} b
 * @returns {number}
 */
export function compareTied(a, b) {
  const out = Number(isOutnumbering(a)) - Number(isOutnumbering(b));
  if (out) return out;
  const hostile = Number(isHostile(b)) - Number(isHostile(a));
  if (hostile) return hostile;
  const ids = [String(a?.id ?? ""), String(b?.id ?? "")];
  if (ids[0] === ids[1]) return 0;
  return ids[0] < ids[1] ? -1 : 1;
}

/**
 * MIXED form: the system's comparator answers a pair with different
 * initiative, and this answers a tie without calling it.
 */
function onSort(wrapped, a, b, ...rest) {
  if ((a?.initiative ?? null) !== (b?.initiative ?? null)) return wrapped(a, b, ...rest);
  return compareTied(a, b);
}

/**
 * Sort each loaded combat's turns again, in memory and with no write, and
 * redraw the tracker; a combat set up before the wrapper exists holds the
 * engine's order for ties. A combat whose turns are locked is left as
 * `setupTurns` leaves it.
 */
export function resortCombats() {
  for (const combat of game.combats ?? []) {
    try {
      combat.setupTurns();
    } catch (err) {
      console.warn(`${MODULE_ID} | combat ${combat?.id}: sorting its turns again failed`, err);
    }
  }
  ui.combat?.render?.();
}

/**
 * Install at `ready`, when the combat class is final, and re-sort the combats
 * the world loaded. Unconditional and settingless. The only owner of the
 * wrapped method.
 */
export function installTurnOrderPatch() {
  const proto = CONFIG.Combat?.documentClass?.prototype;
  if (typeof proto?.sortCombatantsACKS !== "function") {
    console.warn(`${MODULE_ID} | no Combat#sortCombatantsACKS to wrap; combatants tied on initiative may order differently on each seat.`);
    return;
  }
  if (globalThis.libWrapper?.register) {
    globalThis.libWrapper.register(MODULE_ID, TARGET, onSort, "MIXED");
  } else {
    const original = proto.sortCombatantsACKS;
    proto.sortCombatantsACKS = function (...args) {
      return onSort.call(this, (...a) => original.apply(this, a), ...args);
    };
  }
  resortCombats();
}
