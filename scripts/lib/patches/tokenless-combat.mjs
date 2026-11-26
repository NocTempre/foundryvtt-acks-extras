/* global CONFIG, ui */
/**
 * The shared half of the three patches that meet a combat holding a combatant
 * with no token (none set, or none on the scene): `initiative-card.mjs`,
 * `combat-start.mjs` and `group-initiative.mjs`.
 *
 * The system's start, roll and group methods read the token of every combatant
 * in the combat and throw on a null one, so while such a combatant is present
 * each patch hands the call to Foundry's own method or refuses it. What they
 * share is here: the test for such a combat, the walk to Foundry's own method,
 * the one notice a Judge is shown for the combat, and the release of the
 * turn-order lock a throw leaves set.
 *
 * Each of the three skips `wrapped` for such a combat, and libWrapper
 * unregisters a `WRAPPER` that settles without chaining, so every one that can
 * skip is registered `MIXED`: a `WRAPPER` here is dropped by the first press that
 * takes the tokenless branch and every later press meets the system's method.
 * See docs/lib/DECISIONS.md, "A combat holding a combatant with no token is
 * rolled whole by Foundry's own method".
 */
import { MODULE_ID, LANG_PREFIX } from "../constants.mjs";
import { makeLoc } from "../util.mjs";

const loc = makeLoc(LANG_PREFIX);

/** The system's flag scope and key for the turn-order lock its `rollInitiative` holds while it runs. */
const LOCK_SCOPE = "acks";
const LOCK_KEY = "lock-turns";

/** The combats this client has already shown the notice for, by id. */
const noticed = new Set();

/**
 * The names of a combat's combatants that have no token, in the combat's order.
 * Reads the collection's values, so a Foundry `Collection`, a `Map` and an array
 * all answer alike.
 */
export const tokenlessNames = (combat) =>
  Array.from(combat?.combatants?.values?.() ?? [])
    .filter((c) => !c?.token)
    .map((c) => c?.name ?? "");

/**
 * Foundry's own `Combat` method of that name, reached by walking the prototype
 * chain up from the combat class's parent to `foundry.documents.Combat`; null
 * when the chain never reaches it or it holds no such method of its own.
 * Starting at the parent keeps a wrapper on the class itself out of the walk.
 */
export function foundryCombatMethod(name) {
  const base = globalThis.foundry?.documents?.Combat?.prototype;
  let at = Object.getPrototypeOf(CONFIG.Combat?.documentClass?.prototype ?? null);
  while (at && at !== base) at = Object.getPrototypeOf(at);
  return at && Object.hasOwn(at, name) ? at[name] : null;
}

/**
 * Shows the Judge the one notice for this combat, naming its tokenless rows and
 * saying it runs on Foundry's own start and initiative with no surprise step and
 * no grouping. Once per combat per client, whichever of the three patches meets
 * the combat first; a combat with no tokenless row shows nothing.
 */
export function noticeOnce(combat) {
  const names = tokenlessNames(combat);
  if (!names.length || noticed.has(combat.id)) return;
  noticed.add(combat.id);
  ui.notifications?.warn(loc("initiative.tokenless", { names: names.join(", ") }));
}

/** Sets the system's turn-order lock back to false where it is set; a failed write is warned. */
export async function releaseLock(combat) {
  try {
    if (combat.getFlag(LOCK_SCOPE, LOCK_KEY)) await combat.setFlag(LOCK_SCOPE, LOCK_KEY, false);
  } catch (err) {
    console.warn(`${MODULE_ID} | could not release the combat's turn-order lock`, err);
  }
}
