/* global CONFIG */
/**
 * Core patch: a combatant with no actor must not wedge the round counter.
 *
 * `AcksCombat#nextRound` dereferences `t.actor.hasEffect(...)` with no guard
 * at four sites (its sibling `nextTurn` guards the same read), so a token
 * whose Actor was deleted throws the method before it reaches its own
 * `update()` and the round never changes again. This wraps the method and
 * shadows `actor` on exactly those combatants with an empty stand-in while
 * core reads; core's method itself runs unmodified.
 *
 * The stand-in lives only for core's synchronous prefix: `nextRound` awaits
 * nothing ahead of those reads, so `wrapped()` is called unawaited here and
 * the shadows come off before its promise settles — which is what keeps the
 * stand-in away from core's document lifecycle. Should core ever `await`
 * ahead of those reads, the original throw returns rather than a new one.
 *
 * See docs/lib/DECISIONS.md, "extras guards the system's round counter, and
 * the guard is scoped to core's synchronous prefix".
 */
import { MODULE_ID } from "../constants.mjs";

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
 * WRAPPER form: core decides the round, and this only decides what it finds.
 *
 * `wrapped()` is deliberately called without `await` — see the file header.
 */
function onNextRound(wrapped, ...args) {
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
 * Unconditional and settingless: this repairs a throw, and a toggle for it
 * would only be a toggle for the broken state.
 */
export function installCombatRoundPatch() {
  const proto = CONFIG.Combat?.documentClass?.prototype;
  if (typeof proto?.nextRound !== "function") {
    console.warn(`${MODULE_ID} | no Combat#nextRound to wrap; an actor-less combatant will stall the round counter.`);
    return;
  }
  if (globalThis.libWrapper?.register) {
    globalThis.libWrapper.register(MODULE_ID, "CONFIG.Combat.documentClass.prototype.nextRound", onNextRound, "WRAPPER");
    return;
  }
  const original = proto.nextRound;
  proto.nextRound = function (...args) {
    return onNextRound.call(this, (...a) => original.apply(this, a), ...args);
  };
}
