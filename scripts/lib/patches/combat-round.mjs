/* global CONFIG */
/**
 * Core patch: a combatant with no actor must not wedge the round counter.
 *
 * `AcksCombat#nextRound` strips the `surprised`, `delayed` and `done` statuses
 * from every combatant before it advances, and reads each one as
 * `t.actor.hasEffect(...)` with no guard — four sites, counting the
 * `skipDefeated` turn search. Its sibling `nextTurn` reads the same field as
 * `t.actor?.hasEffect(...)`, so the two disagree about whether an actor is
 * optional, and only the round path throws.
 *
 * A combatant whose `actor` is null is ordinary wreckage, not a corrupt world:
 * deleting a sidebar Actor leaves every LINKED token it placed standing on the
 * scene, and a token in a running combat keeps its combatant. From that moment
 * `nextRound()` raises `Cannot read properties of null (reading 'hasEffect')`
 * before it reaches its own `update()`, so the round never changes. Turns still
 * advance — `nextTurn` is guarded — until the last one, where core delegates to
 * `nextRound` and the fight stops on whatever round it was on. (An UNLINKED
 * token survives its Actor's deletion: its delta is the actor, and it is
 * unaffected.)
 *
 * THE PATCH ADDS THE GUARD CORE OMITS, AND NOTHING ELSE. Core's method runs
 * unmodified through a libWrapper WRAPPER; what changes is only what it finds
 * on an actor-less combatant while it reads. Each such combatant carries an own
 * `actor` property — an empty stand-in holding no effects and no statuses —
 * shadowing the class getter that answers null. The `hasEffect` reads then
 * answer "no effect", which is the truth about a combatant with no actor;
 * `removeEffect` is never reached because it is gated on that answer; and the
 * `isDefeated` read (`this.actor?.statuses`) is unchanged because the stand-in's
 * status set is empty. Length, indices, `advanceTime` and the combatants
 * themselves are untouched, so the round advances exactly as it would have with
 * the actor still there.
 *
 * THE STAND-IN LIVES ONLY FOR CORE'S SYNCHRONOUS PREFIX, and that is the whole
 * design. `nextRound` awaits nothing: every unguarded read runs before it
 * returns the promise for its own `update()`. So `wrapped()` is called and its
 * promise is NOT awaited before the shadows come off — by the time that promise
 * settles, the combatants answer null again. This is what keeps the stand-in
 * away from core's document lifecycle, which is not null-hostile but IS
 * type-strict: `Combat#updateCombatantActors`, running inside that update,
 * calls `combatant.actor?.render()` and tolerates a null far better than an
 * object that is not an Actor.
 *
 * Should core ever `await` ahead of those reads, the shadows are already off
 * when they run and the original throw returns — the same breakage as an
 * unpatched world, never a new one.
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
