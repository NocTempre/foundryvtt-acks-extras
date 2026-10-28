/* global CONFIG, game, ui */
/**
 * Core patch: `AcksCombat#nextRound` runs on the GM's seat, and a combatant
 * with no actor must not wedge the round counter.
 *
 * A seat that is not a GM's sends its round advance to the active GM instead
 * of running core's method. Core resets initiative through `Combat#resetAll`,
 * which writes every combatant's initiative into the calling client's own copy
 * before it asks the server; the server refuses that write from a player and
 * nothing rolls the copy back, while the round and turn that follow are
 * accepted. The GM's handler advances only a combat still at the round and
 * turn the request was made on, for the player whose combatant is up — the
 * seat the tracker gives End Turn. With no GM connected nothing advances.
 *
 * `AcksCombat#nextRound` dereferences `t.actor.hasEffect(...)` with no guard
 * at four sites (its sibling `nextTurn` guards the same read), so a token
 * whose Actor was deleted throws the method before it reaches its own
 * `update()` and the round never changes again. On the GM's seat this shadows
 * `actor` on exactly those combatants with an empty stand-in while core
 * reads; core's method itself runs unmodified.
 *
 * The stand-in lives only for core's synchronous prefix: `nextRound` awaits
 * nothing ahead of those reads, so `wrapped()` is called unawaited here and
 * the shadows come off before its promise settles — which is what keeps the
 * stand-in away from core's document lifecycle. Should core ever `await`
 * ahead of those reads, the original throw returns rather than a new one.
 *
 * See docs/lib/DECISIONS.md, "extras guards the system's round counter, and
 * the guard is scoped to core's synchronous prefix" and "A player's round
 * advance runs on the GM's seat".
 */
import { MODULE_ID } from "../constants.mjs";
import { executeAsGM, registerHandler } from "../sockets.mjs";

/** The relay a player's round advance travels by. */
export const NEXT_ROUND_HANDLER = "libNextRound";

/**
 * What an actor-less combatant honestly has: no effects, no statuses. Frozen
 * and shared — core only reads from it.
 */
const NO_ACTOR = Object.freeze({
  hasEffect: () => undefined,
  statuses: Object.freeze(new Set()),
});

/** Combats already reported this session, so a broken fight warns once. */
const warned = new Set();

/**
 * Shadow `actor` on each combatant that has none, returning the undo. The class
 * getter is configurable, so deleting the own property restores it.
 */
function standIn(combatants) {
  for (const combatant of combatants) {
    Object.defineProperty(combatant, "actor", { value: NO_ACTOR, configurable: true });
  }
  return () => {
    for (const combatant of combatants) delete combatant.actor;
  };
}

/**
 * Why the GM's seat does not advance `combat` for a request, or null when it
 * does: `stale` when the combat has left the round or turn the request was
 * made on, `notYourTurn` when the requesting player owns no combatant up. A
 * request with no `requestUserId` is the Judge's own and is not turn-checked.
 * @param {Combat|null} combat
 * @param {{round: number, turn: number|null}} request  The state the requester saw.
 * @param {string|null} [requestUserId]  The relayed sender, as `runRelayed` stamps it.
 * @returns {"noCombat"|"stale"|"notYourTurn"|null}
 */
export function roundRefusal(combat, { round, turn } = {}, requestUserId = null) {
  if (!combat) return "noCombat";
  if (combat.round !== round || combat.turn !== turn) return "stale";
  if (requestUserId && !(combat.combatant?.players ?? []).some((u) => u.id === requestUserId)) return "notYourTurn";
  return null;
}

/** Combats whose relayed advance has not resolved: the round they will leave still reads current until it does. */
const advancing = new Set();

/**
 * The GM's half of the relay: advances the round when `roundRefusal` finds
 * nothing and no advance of that combat is in flight (else `stale`),
 * answering `{ok, round, turn}` or `{error}`.
 */
async function advanceForSeat({ combatId, round, turn, requestUserId = null } = {}) {
  const combat = game.combats.get(combatId) ?? null;
  const error = advancing.has(combatId) ? "stale" : roundRefusal(combat, { round, turn }, requestUserId);
  if (error) return { error };
  advancing.add(combatId);
  try {
    await combat.nextRound();
  } finally {
    advancing.delete(combatId);
  }
  return { ok: true, round: combat.round, turn: combat.turn };
}

registerHandler(NEXT_ROUND_HANDLER, advanceForSeat);

/** A player's half: the request, and a warning where the GM refused it as out of turn. Resolves to the combat, as core's does. */
async function relayNextRound(combat) {
  const answer = await executeAsGM(NEXT_ROUND_HANDLER, { combatId: combat.id, round: combat.round, turn: combat.turn });
  if (answer?.error === "notYourTurn") ui.notifications.warn(game.i18n.localize("ACKS-LIB.combatRound.notYourTurn"));
  return combat;
}

/**
 * MIXED form: a player's call never reaches core, and libWrapper unregisters
 * a WRAPPER that skips the chain. On the GM's seat core decides the round,
 * and this only decides what it finds; `wrapped()` is deliberately called
 * without `await` — see the file header.
 */
function onNextRound(wrapped, ...args) {
  if (!game.user?.isGM) return relayNextRound(this);
  const orphans = (this.turns ?? []).filter((t) => t && !t.actor);
  if (!orphans.length) return wrapped(...args);

  if (!warned.has(this.id)) {
    warned.add(this.id);
    console.warn(
      `${MODULE_ID} | combat ${this.id}: ${orphans.length} combatant(s) have no actor — ` +
        `${orphans.map((c) => c.name ?? c.id).join(", ")}. Rounds advance anyway; delete the rows to clear it.`,
    );
  }

  const restore = standIn(orphans);
  try {
    return wrapped(...args);
  } finally {
    restore();
  }
}

/**
 * Install at `ready`, when the combat class is final.
 *
 * Unconditional and settingless: this repairs a desync and a throw, and a
 * toggle for either would only be a toggle for the broken state.
 */
export function installCombatRoundPatch() {
  const proto = CONFIG.Combat?.documentClass?.prototype;
  if (typeof proto?.nextRound !== "function") {
    console.warn(`${MODULE_ID} | no Combat#nextRound to wrap; a player's round advance and an actor-less combatant go unguarded.`);
    return;
  }
  if (globalThis.libWrapper?.register) {
    globalThis.libWrapper.register(MODULE_ID, "CONFIG.Combat.documentClass.prototype.nextRound", onNextRound, "MIXED");
    return;
  }
  const original = proto.nextRound;
  proto.nextRound = function (...args) {
    return onNextRound.call(this, (...a) => original.apply(this, a), ...args);
  };
}
