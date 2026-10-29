/* global game, fromUuid */
/**
 * The shop's sources, read off the world: which ones the Judge has left out,
 * the Item compendiums the catalog lists, and the one resolver every shop
 * action and every delivery takes its item from. The shape is
 * `rules/sources.mjs`.
 *
 * A placement (a purchase, an import order, a commission, a search) is gated:
 * it takes the document its catalog row came from, and only from a source the
 * shop draws on (`listedSource`). A delivery is not: a paid order arrives as
 * the document it was placed for, whatever the shop draws on now
 * (`orderedSource`).
 */
import { CATALOG_EXCLUDED_SETTING } from "../constants.mjs";
import { getSetting } from "../settings.mjs";
import { findGearEntry } from "../../equipment/grant.mjs";
import { WORLD_SOURCE, normalizeExcluded, sourceAllowed, sourceOfUuid } from "../rules/sources.mjs";

/** The sources the shop leaves out, cleaned; none where the setting is unreadable. */
export function excludedSources() {
  try {
    return normalizeExcluded(getSetting(CATALOG_EXCLUDED_SETTING));
  } catch {
    return [];
  }
}

/** Whether the shop lists the world's own items. */
export const shopListsWorld = (excluded = excludedSources()) => sourceAllowed(WORLD_SOURCE, excluded);

/** The Item compendiums the shop lists, in `game.packs` order: the order a name's first copy is taken in. */
export function shopPacks(excluded = excludedSources()) {
  return [...(game.packs ?? [])].filter((p) => p.documentName === "Item" && sourceAllowed(p.collection, excluded));
}

/** A world or compendium Item's creatable data and address; null for anything else, an embedded item included. */
async function entryOf(uuid) {
  const doc = await fromUuid(uuid).catch(() => null);
  if (!doc || doc.documentName !== "Item" || doc.parent) return null;
  return { data: doc.toObject(), uuid: doc.uuid, inCompendium: !!doc.pack };
}

/**
 * The item a shop action names. With `sourceUuid` (what a catalog row
 * carries) it is that document, refused where the uuid names no source or a
 * source the shop leaves out. Without one it is the first item of the name
 * among the sources the shop lists.
 * @param {{sourceUuid?: string, itemName?: string}} named
 * @returns {Promise<{data: object, uuid: string, inCompendium: boolean}|null>}
 */
export async function listedSource({ sourceUuid = "", itemName = "" } = {}) {
  const excluded = excludedSources();
  if (sourceUuid) return sourceAllowed(sourceOfUuid(sourceUuid), excluded) ? entryOf(sourceUuid) : null;
  return findGearEntry(itemName, { world: shopListsWorld(excluded), pack: (p) => sourceAllowed(p.collection, excluded) });
}

/**
 * The item a paid order delivers: the document it was placed for while it
 * still exists, else the first of its name among the sources the shop lists,
 * else the first of its name anywhere. An order placed before orders stored
 * their source has only the name.
 * @param {{sourceUuid?: string, itemName?: string}} order
 * @returns {Promise<{data: object, uuid: string, inCompendium: boolean}|null>}
 */
export async function orderedSource({ sourceUuid = "", itemName = "" } = {}) {
  const placed = sourceOfUuid(sourceUuid) ? await entryOf(sourceUuid) : null;
  return placed ?? (await listedSource({ itemName })) ?? findGearEntry(itemName);
}
