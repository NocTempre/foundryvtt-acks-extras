/* global game */
/**
 * Hand enforcement stands aside while an import places gear, then the hands are
 * settled once.
 *
 * Placing gear one item at a time asks hand enforcement to rule on every
 * intermediate state, and each ruling unequips something the next placement
 * needed. The import therefore holds the actor (`holdHands`): a flag on the
 * actor, not an in-memory variable or an update option, because the client that
 * resolves an overflow is the active GM's and only a stored flag reaches it.
 * While the flag stands, `enforce.mjs` neither vetoes nor resolves nor warns for
 * a hand overflow on the actor (`handsHeld`); every other violation is enforced
 * as usual. The loadout effect rebuilds when the flag is cleared, through the
 * `updateActor` hook that rebuilds it for any change to the module's actor
 * flags. The flag holds the id of the user whose import set it. A hold left
 * standing by a window closed mid-import is cleared by the next import onto that
 * actor, and by the primary GM's window when it loads (`clearStrandedHolds`).
 *
 * `settleHands` then decides the hands once, after the last placement. Items are
 * kept in this order, each held only if the hands still fit with it:
 * 1. the sheet's placements, in the sheet's order, first fit, so a placement
 *    that does not fit is carried and a later one that does is still held;
 * 2. the items held before the import that the sheet did not place.
 * Whatever is not kept is carried (unequipped, its hand cleared) in one write.
 */
import { MODULE_ID, ACTOR_FLAGS, ITEM_FLAGS } from "./constants.mjs";
import { getLoadout, releaseOrder, VIOLATION } from "./loadout.mjs";
import { rowsSettled } from "./weapon-rows.mjs";
import { unset } from "../lib/util.mjs";
import { stackCountOf } from "../lib/item-model.mjs";

/**
 * A name with its stack count where there is more than one, in the form the
 * import report's other gear lists use: `Javelin ×3`.
 * @param {string} name
 * @param {number|null|undefined} count
 * @returns {string}
 */
export function handsLabel(name, count) {
  return Number(count) > 1 ? `${name} ×${count}` : name;
}

/**
 * Is hand enforcement held for this actor? True while an import places its gear.
 * @param {Actor|null|undefined} actor
 * @returns {boolean}
 */
export function handsHeld(actor) {
  return !!actor?.getFlag?.(MODULE_ID, ACTOR_FLAGS.HANDS_SETTLING);
}

/**
 * Run `run` with hand enforcement held for `actor`. The flag is cleared when
 * `run` returns or throws, so a failed import never leaves the actor unguarded.
 * A flag already standing is taken over and cleared like this run's own: the
 * only way one outlives its import is a window closed mid-import.
 * @param {Actor} actor
 * @param {() => Promise<*>} run
 * @returns {Promise<*>} what `run` returned
 */
export async function holdHands(actor, run) {
  await actor.setFlag(MODULE_ID, ACTOR_FLAGS.HANDS_SETTLING, game.user?.id ?? true);
  try {
    return await run();
  } finally {
    await actor.unsetFlag(MODULE_ID, ACTOR_FLAGS.HANDS_SETTLING);
  }
}

/**
 * Clear the holds no running import owns: one set by a user who is not logged
 * in, or by this user, whose window has only just loaded and so runs no import.
 * A hold set by another user who is logged in is left to that user's import.
 * @param {Iterable<Actor>} [actors]
 * @returns {Promise<number>} how many holds were cleared
 */
export async function clearStrandedHolds(actors = game.actors) {
  const stranded = [...actors].filter((actor) => {
    const holder = actor.getFlag?.(MODULE_ID, ACTOR_FLAGS.HANDS_SETTLING);
    if (!holder) return false;
    const user = typeof holder === "string" ? game.users?.get(holder) : null;
    return !user?.active || user.id === game.user?.id;
  });
  for (const actor of stranded) await actor.unsetFlag(MODULE_ID, ACTOR_FLAGS.HANDS_SETTLING);
  return stranded.length;
}

/**
 * Decide which hand-holders stay in hand. Pure: the loadout enters through
 * `measure`, which answers whether the hands overflow with only the listed
 * item ids drawn.
 * @param {object} args
 * @param {{item: Item, label: string}[]} args.sheet the sheet's placements, in the sheet's order
 * @param {{item: Item, label: string}[]} args.prior items held before the import that the sheet did not place, in keep order
 * @param {(ids: string[]) => {overflow: boolean, hands: number, budget: number}} args.measure
 * @returns {{used: number, budget: number, carried: {item: Item, label: string}[]}|null} null when everything fits
 */
export function planHands({ sheet, prior, measure }) {
  const ranked = [...sheet, ...prior];
  if (!measure(ranked.map((e) => e.item.id)).overflow) return null;
  const kept = [];
  const carried = [];
  for (const entry of ranked) {
    if (measure([...kept, entry.item.id]).overflow) carried.push(entry);
    else kept.push(entry.item.id);
  }
  const asked = measure(sheet.map((e) => e.item.id));
  return { used: asked.hands, budget: asked.budget, carried };
}

/**
 * Settle the hands once, after an import's last placement: keep what fits in the
 * order `planHands` gives and carry the rest in one write. Waits for the weapon
 * rows, whose sizes the hand count is weighed from.
 * @param {Actor} actor
 * @param {{item: Item, label: string}[]} placements the items the sheet put at a place, in the sheet's order
 * @param {object} [options]
 * @param {(actor: Actor, opts?: object) => object} [options.loadoutOf] stand-in for `getLoadout`, for the unit suite
 * @returns {Promise<{used: number, budget: number, carried: string[]}|null>} the hands the sheet asked for, what the actor has and what was carried; null where nothing was carried
 */
export async function settleHands(actor, placements, { loadoutOf = getLoadout } = {}) {
  await rowsSettled();
  const current = loadoutOf(actor);
  const holders = new Map([...current.weapons.map((w) => w.item), ...current.handShields].map((item) => [item.id, item]));
  const seen = new Set();
  const sheet = placements.filter(({ item }) => holders.has(item.id) && !seen.has(item.id) && seen.add(item.id));
  const prior = releaseOrder(current)
    .reverse()
    .filter((item) => holders.has(item.id) && !seen.has(item.id) && seen.add(item.id))
    .map((item) => ({ item, label: handsLabel(item.name, stackCountOf(item)) }));
  const measure = (ids) => {
    const drawn = new Set(ids);
    const loadout = loadoutOf(actor, { overrides: new Map([...holders.keys()].map((id) => [id, drawn.has(id)])) });
    return {
      overflow: loadout.violations.some((v) => v.type === VIOLATION.HAND_OVERFLOW && !v.advisory),
      hands: loadout.handsCommitted - loadout.heldLights - loadout.mappingHands,
      budget: loadout.handBudget,
    };
  };
  const plan = planHands({ sheet, prior, measure });
  if (!plan?.carried.length) return null;
  await actor.updateEmbeddedDocuments(
    "Item",
    plan.carried.map(({ item }) => ({ _id: item.id, "system.equipped": false, [`flags.${MODULE_ID}.${ITEM_FLAGS.WORN_HAND}`]: unset() })),
  );
  return { used: plan.used, budget: plan.budget, carried: plan.carried.map((e) => e.label) };
}
