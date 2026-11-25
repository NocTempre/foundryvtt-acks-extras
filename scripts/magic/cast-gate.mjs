/* global game, ui */
/**
 * The cast gate: a second claimant on the cast seam (`lib/patches/spell-use.mjs`),
 * registered after the cast window's, so it is offered only the casts that one
 * declined. It takes the cast of a spell on an actor this seat owns whose bound
 * class casts from at least one list (`listTraditions`): the spell a hand made,
 * with no effect rows, which core would cast with no regard for the list. It
 * leaves to core a spell on an actor with no class bound, a class that casts from
 * no list, and a monster.
 *
 * The gate reads the cast's standing as the cast window does (`castReading`) and
 * judges it as the Magic tab's row does (`listGate`): the spell is on none of the
 * class's lists, or the list's own slots at its level are all used. A spell that
 * names no list is read against no list and is never refused here. A Player is blocked, with a notification, before core's cast
 * runs: nothing is spent and nothing is written. A Judge is warned and the cast
 * goes on. The cast itself stays core's (`spend()`: the count and the card); where
 * it ran and the list has a slot row, the list's used count rises by one, the same
 * write the cast window makes. No window or prompt opens, and where the world holds
 * no slot maximum the capacity is unknown and nothing blocks.
 */
import { MODULE_ID, SPELL_TYPE } from "./constants.mjs";
import { listTraditions, spendsFromPool } from "./cast-capacity.mjs";
import { listGate } from "./cast-plan.mjs";
import { castReading } from "./cast-spell.mjs";
import { addSpellUseClaimant, removeSpellUseClaimant } from "../lib/patches/spell-use.mjs";

/** The claimant's key on the cast seam. */
export const CAST_GATE_KEY = `${MODULE_ID}.magic.castGate`;

/**
 * The world readers a gate run uses, as the live world gives them; a test
 * supplies its own. `classFor` is absent here: the claimant is given the classes
 * feature's lookup. `pools` and `adjustPool` may answer a promise.
 */
const liveDeps = () => ({
  pools: async (actor) => (await import("../classes/casting.mjs")).poolState(actor),
  adjustPool: async (actor, tradition, slotKey) => (await import("../classes/casting.mjs")).adjustPool(actor, tradition, slotKey, 1),
  isGM: () => game.user.isGM,
  notify: (level, key) => ui.notifications?.[level]?.(game.i18n.localize(`ACKS-MAGIC.cast.notice.${key}`)),
});

/**
 * Does the gate take this cast? A spell item on an actor this seat owns whose
 * bound class casts from at least one list. Everything else stays the system's.
 * @param {Item} item
 * @param {((actor: object) => object|null)|null} classFor  the classes feature's `classForActor`; without it nothing is taken
 */
export function castGateClaims(item, classFor) {
  if (item?.type !== SPELL_TYPE || item.parent?.isOwner !== true || typeof classFor !== "function") return false;
  return listTraditions(classFor(item.parent)?.system?.casting).length > 0;
}

/**
 * Gate and spend one cast of a spell the cast window did not take. Reads the
 * cast's standing, refuses a Player a spell off the class's lists or with no slot
 * left (`spend` is never called and nothing is written), warns a Judge and goes
 * on, calls `spend()` and raises the list's used count where the cast spends from
 * a list's slots.
 *
 * @param {Item} item
 * @param {{tradition?: string}} [options]  the cast's options from the seam; `tradition` is the key of the list the cast was pressed under
 * @param {() => Promise<boolean>} spend  the seam's once-only door to the system's cast
 * @param {{classFor: (actor: object) => object|null, pools: (actor: object) => object[]|Promise<object[]>, adjustPool: (actor: object, tradition: string, slotKey: string) => Promise<void>, isGM: () => boolean, notify: (level: string, key: string) => void}} [deps]  the world readers, `blocked.<key>` and `verdict.<key>` being the cast notices' keys
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function castGateRun(item, options, spend, deps = liveDeps()) {
  const actor = item.parent;
  const classItem = deps.classFor(actor);
  const pools = await deps.pools(actor);
  const { offList, capacity } = castReading(actor, item, { classItem, pools, tradition: typeof options?.tradition === "string" ? options.tradition : null });
  const found = listGate({ capacity, offList, isGM: deps.isGM() === true });
  if (found?.severity === "block") {
    deps.notify("warn", `blocked.${found.key}`);
    return { ok: false, reason: found.key };
  }
  if (found) deps.notify("warn", `verdict.${found.key}`);
  const spent = await spend();
  if (spent === true && spendsFromPool(capacity)) await deps.adjustPool(actor, capacity.tradition, capacity.slotKey);
  return spent === true ? { ok: true } : { ok: false, reason: "notSpent" };
}

/**
 * The claimant for the cast seam. `claims` is synchronous.
 * @param {object} [deps]  see `castGateRun`; `classFor` here is the lookup `claims` and the run use where `claim` gives none
 * @param {{classFor?: ((actor: object) => object|null)|null}} [claim]  the classes feature's `classForActor`
 */
export function castGateClaimant(deps = liveDeps(), { classFor = null } = {}) {
  const lookup = classFor ?? deps.classFor ?? null;
  return {
    key: CAST_GATE_KEY,
    claims: (item) => castGateClaims(item, lookup),
    cast: (item, options, spend) => castGateRun(item, options, spend, { ...deps, classFor: lookup }),
  };
}

let unregister = null;

/**
 * Register the claimant after the cast window's. Once, at `init`; a second call
 * replaces the first.
 * @param {{classFor?: ((actor: object) => object|null)|null}} [claim]  the classes feature's `classForActor`; without it the gate takes nothing
 * @returns {() => void}
 */
export function registerCastGate(claim = {}) {
  unregister?.();
  addSpellUseClaimant(castGateClaimant(undefined, claim));
  let done = false;
  const off = () => {
    if (done) return;
    done = true;
    removeSpellUseClaimant(CAST_GATE_KEY);
    if (unregister === off) unregister = null;
  };
  unregister = off;
  return off;
}
