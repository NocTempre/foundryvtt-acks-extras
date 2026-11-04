/* global game */
/**
 * Handing gear over, and making room to hold it.
 *
 * Two mutations, both equipment facts: put the required gear in the pack
 * (`grantGear`), and empty enough hands to hold it (`clearHands`). Callers
 * say WHAT is needed; this file is the only place that says how it appears.
 * Both are IDEMPOTENT — gear already carried is left alone and hands
 * already free are not disturbed.
 *
 * Nothing here decides WHETHER a character should be given anything (see
 * docs/equipment/MODEL.md, "Giving gear, and making room for it —
 * `grant.mjs`").
 */
import { carriesItem } from "../lib/item-model.mjs";
import { getLoadout, releaseOrder } from "./loadout.mjs";
import { sheatheItem } from "./actions.mjs";

/**
 * A piece of gear a caller wants present on an actor.
 * @typedef {object} GearSpec
 * @property {RegExp} pattern what counts as already carrying it
 * @property {string} [name] the item to create when it is missing; without
 *   one, the item created is the stack `pattern` matches that holds the most
 *   (`findGearByPattern`), and a stand-in is named by `label`
 * @property {string} [label] i18n key naming it to the user
 * @property {object} [fallback] item data merged over the synthesized stand-in,
 *   used only when no world item or compendium entry answers the spec
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
 * worse than no match: the common oil flask must never resolve to the military
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
 * thirty swords points its bundle rows at the source). A caller that draws on
 * fewer sources narrows the search: `world: false` skips the world's items,
 * and `pack` is asked of each Item compendium before it is searched.
 * @param {string} name
 * @param {{world?: boolean, pack?: (pack: object) => boolean}} [scope]
 * @returns {Promise<{data: object, uuid: string, inCompendium: boolean}|null>}
 */
export async function findGearEntry(name, { world: searchWorld = true, pack: packAllowed = null } = {}) {
  if (!name) return null;
  const wanted = name.toLowerCase();

  const world = searchWorld ? game.items?.find?.((i) => i.name?.toLowerCase() === wanted) : null;
  if (world) return { data: world.toObject(), uuid: world.uuid, inCompendium: false };

  for (const pack of game.packs ?? []) {
    if (pack.documentName !== "Item") continue;
    if (packAllowed && !packAllowed(pack)) continue;
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

/** The count a stack holds, as its quantity field stores it; 1 where it stores none. */
const stackSize = (entry) => {
  const n = Number(entry?.system?.quantity?.value);
  return Number.isFinite(n) && n > 0 ? n : 1;
};

/**
 * The source data for gear known by what it IS rather than by a name: among
 * the items `pattern` matches, the stack holding the most, so a grant hands
 * over a bundle where the store sells one. The world's items answer first, as
 * in `findGearSource`; then every Item compendium, read with its quantities.
 * Ties go to the first found.
 * @returns {Promise<object|null>} creatable item data, or null if nothing matches
 */
export async function findGearByPattern(pattern) {
  if (!(pattern instanceof RegExp)) return null;
  const largest = (entries) => entries.reduce((best, e) => (!best || stackSize(e) > stackSize(best) ? e : best), null);

  const world = largest([...(game.items ?? [])].filter((i) => pattern.test(i.name ?? "")));
  if (world) return world.toObject();

  let best = null;
  for (const pack of game.packs ?? []) {
    if (pack.documentName !== "Item") continue;
    const index = (await pack.getIndex?.({ fields: ["system.quantity.value"] })) ?? pack.index ?? [];
    const found = largest([...index].filter((e) => pattern.test(e.name ?? "")));
    if (found && (!best || stackSize(found) > stackSize(best.entry))) best = { pack, entry: found };
  }
  if (!best) return null;
  try {
    return (await best.pack.getDocument(best.entry._id))?.toObject() ?? null;
  } catch (err) {
    console.warn(`acks-extras | could not read ${best.entry.name} from ${best.pack.collection}`, err);
    return null;
  }
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
    name: spec.name ?? (spec.label ? game.i18n?.localize?.(spec.label) ?? spec.label : ""),
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
  const missing = specs.filter((s) => (s?.name || s?.label) && s?.pattern && !carriesItem(actor, s.pattern));
  if (!missing.length) return [];

  const data = [];
  for (const spec of missing) {
    const source = spec.name ? await findGearSource(spec.name) : await findGearByPattern(spec.pattern);
    data.push(source ?? synthesize(spec));
  }
  return (await actor.createEmbeddedDocuments("Item", data)) ?? [];
}

/**
 * Make room for `needed` hands by putting held gear away, and report what it cost.
 *
 * Sheathes in `releaseOrder` — shields, then weapons newest-first — one at a
 * time, re-reading the loadout after each so it stops the moment there is room.
 * A two-handed weapon therefore buys both hands in a single release.
 *
 * ROOM IS `handsSpare`, NOT `handsFree` (see docs/equipment/MODEL.md,
 * "Hands: free, committed, spare").
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
