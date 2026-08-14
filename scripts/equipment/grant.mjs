/* global game */
/**
 * Handing gear over, and making room to hold it.
 *
 * A Judge who gives a character a torch is not asking whether that character
 * went shopping first. Two mutations make that true, and both are equipment
 * facts, so both live here: put the required gear in the pack (`grantGear`), and
 * empty enough hands to hold it (`clearHands`). Callers say WHAT is needed; this
 * file is the only place that says how it appears.
 *
 * Both are IDEMPOTENT. Gear already carried is left alone and hands already free
 * are not disturbed, so repeating a grant is a no-op rather than a second torch
 * and a dropped sword.
 *
 * Nothing here decides WHETHER a character should be given anything — that is a
 * rule, and it belongs to the feature holding the rule (a light source's gear
 * list lives with the light table; the mapper's kit lives with the roles).
 */
import { carriesItem } from "../lib/item-model.mjs";
import { getLoadout, releaseOrder } from "./loadout.mjs";
import { sheatheItem } from "./actions.mjs";

/**
 * A piece of gear a caller wants present on an actor.
 * @typedef {object} GearSpec
 * @property {RegExp} pattern what counts as already carrying it
 * @property {string} name the item to create when it is missing
 * @property {string} [label] i18n key naming it to the user
 * @property {object} [fallback] item data merged over the synthesized stand-in,
 *   used only when no world item or compendium entry carries `name`
 */

/**
 * The source data for a named item, taken from the world or a compendium.
 *
 * REUSE BEFORE INVENT: the system ships the RAW equipment, so a granted torch
 * should be core's torch — same icon, same price, same weight — rather than a
 * look-alike this module made up. World items are searched first so a Judge who
 * has customised their own "Lantern" gets theirs, then every Item compendium.
 *
 * Matching is on the exact name, case-insensitively. A loose match would be
 * worse than no match: "Oil, Common (1 pint)" must never resolve to the military
 * flask sitting beside it in the same pack.
 *
 * @returns {Promise<object|null>} creatable item data, or null if nothing matches
 */
export async function findGearSource(name) {
  return (await findGearEntry(name))?.data ?? null;
}

/**
 * The same lookup, keeping the source document's address — for callers that
 * must reference the found item rather than copy it (a purchase bundling
 * thirty swords points its bundle rows at the source).
 * @returns {Promise<{data: object, uuid: string, inCompendium: boolean}|null>}
 */
export async function findGearEntry(name) {
  if (!name) return null;
  const wanted = name.toLowerCase();

  const world = game.items?.find?.((i) => i.name?.toLowerCase() === wanted);
  if (world) return { data: world.toObject(), uuid: world.uuid, inCompendium: false };

  for (const pack of game.packs ?? []) {
    if (pack.documentName !== "Item") continue;
    const entry = pack.index?.find?.((e) => e.name?.toLowerCase() === wanted);
    if (!entry) continue;
    try {
      const doc = await pack.getDocument(entry._id);
      if (doc) return { data: doc.toObject(), uuid: doc.uuid, inCompendium: true };
    } catch (err) {
      console.warn(`acks-extras | could not read ${name} from ${pack.collection}`, err);
    }
  }
  return null;
}

/**
 * The stand-in for gear no compendium in this world carries.
 *
 * A plain, weightless, costless item bearing the right name — enough for the
 * pattern that was looking for it to find it, and deliberately not more. The
 * spec may override any of it (`fallback`), which is where a caller that knows
 * what the thing is worth says so.
 */
function synthesize(spec) {
  return {
    name: spec.name,
    type: "item",
    system: { quantity: { value: 1, max: 0 }, cost: 0, weight6: 0 },
    ...(spec.fallback ?? {}),
  };
}

/**
 * Ensure the actor is carrying every piece of gear in `specs`, creating what is
 * missing. Anything already carried is skipped, so this may create nothing.
 * @param {Actor} actor
 * @param {GearSpec[]} specs
 * @returns {Promise<Item[]>} the items created, in spec order
 */
export async function grantGear(actor, specs = []) {
  if (!actor?.createEmbeddedDocuments) return [];
  const missing = specs.filter((s) => s?.name && s?.pattern && !carriesItem(actor, s.pattern));
  if (!missing.length) return [];

  const data = [];
  for (const spec of missing) data.push((await findGearSource(spec.name)) ?? synthesize(spec));
  return (await actor.createEmbeddedDocuments("Item", data)) ?? [];
}

/**
 * Make room for `needed` hands by putting held gear away, and report what it cost.
 *
 * Sheathes in `releaseOrder` — shields, then weapons newest-first — one at a
 * time, re-reading the loadout after each so it stops the moment there is room.
 * A two-handed weapon therefore buys both hands in a single release.
 *
 * ROOM IS `handsSpare`, NOT `handsFree`. A lone versatile weapon widens its grip
 * to fill any hand going, so measuring what is FREE would see the sword eat each
 * hand as fast as this one emptied it and strip the character bare. What matters
 * is what is COMMITTED — and a two-handed grip commits nothing, because it
 * yields the instant the torch arrives.
 *
 * It can FALL SHORT and says so rather than throwing: hands filled by lit
 * torches are not freed by sheathing anything, because a light is put out, not
 * put away. The caller decides what a shortfall means.
 *
 * @returns {Promise<{handsSpare: number, released: Item[]}>} the room that ended
 *   up available, and what was put away to get it.
 */
export async function clearHands(actor, needed = 1) {
  if (!actor) return { handsSpare: 0, released: [] };
  let loadout = getLoadout(actor);
  const released = [];
  for (const item of releaseOrder(loadout)) {
    if (loadout.handsSpare >= needed) break;
    await sheatheItem(item);
    released.push(item);
    loadout = getLoadout(actor);
  }
  return { handsSpare: loadout.handsSpare, released };
}
