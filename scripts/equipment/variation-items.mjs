/* global game, ui */
import { MODULE_ID, ITEM_FLAGS, VARIATION_ITEM_TYPE } from "./constants.mjs";
import { containedIn, contentsIn, siblingsOf } from "../lib/item-model.mjs";
import { addRefusal, entryOf, definitionFrom, familyOf } from "./variations.mjs";
import { BASE_TYPE_FLAG, baseTypeAllowed, baseTypeOf } from "./base-types.mjs";
import { inferBaseType } from "./base-type-infer.mjs";
import { recomputeItemFields, masterworkTierOf, scavengedOf, silveredFlagOf } from "./properties.mjs";

/**
 * Variations as CONTENTS — applying one is putting a document inside another.
 *
 * A variation Item sits in the same collection as the item it changes, flagged
 * `containedIn` at it, which is the relation `containers.mjs` already uses for
 * gear in a backpack. Everything that relation buys comes along: the sheet
 * lists it under its owner, dragging moves it, deleting removes it, and no new
 * storage shape had to be invented for a second kind of "inside".
 *
 * What does NOT come along is `storeIn`. That verb is about cargo — it checks
 * capacity, refuses through a shut lock, and unequips what it stows. A
 * variation is none of those things; it goes on a sword the sword is wielding,
 * weighs nothing, and is refused for reasons of its own (a family already
 * spoken for, a base type it cannot go on). So the write is here, sharing the
 * flag and nothing else.
 *
 * A variation is non-physical by schema, so encumbrance never sees it and
 * `isStowable` is false — a Judge cannot put one in a sack by mistake.
 */

/* The three reads below are function DECLARATIONS, not arrows. `properties.mjs`
 * imports them and this file imports its `recomputeItemFields`, so the two
 * modules are a cycle; a hoisted declaration is defined whichever one the
 * loader reaches first, where a `const` would depend on the order. */

/** Is this document a variation? */
export function isVariationItem(item) {
  return item?.type === VARIATION_ITEM_TYPE;
}

/** The variations applied to an item, in the order they were put on. */
export function variationItemsOf(item) {
  return contentsIn(item).filter(isVariationItem);
}

/** The item a variation is applied to, or null if it is loose. */
export function baseItemOf(variation) {
  const id = containedIn(variation);
  if (!id) return null;
  return siblingsOf(variation)?.get?.(id) ?? siblingsOf(variation)?.find?.((i) => i.id === id) ?? null;
}

/** The base type of a live item, with the legacy name-pattern guess behind it. */
export const itemBaseType = (item) => baseTypeOf(item, { infer: inferBaseType });

/**
 * Declare what an item IS.
 *
 * Refused where core would be left computing from underneath it — an `armor`
 * document cannot become a gem, because core reads AC off armour documents.
 */
export async function setBaseType(item, baseType) {
  if (baseType && !baseTypeAllowed(baseType, item?.type)) {
    ui.notifications?.warn(game.i18n.format("ACKS-EQUIPMENT.variations.badBaseType", { type: baseType }));
    return false;
  }
  if (!baseType) await item.unsetFlag(MODULE_ID, BASE_TYPE_FLAG);
  else await item.setFlag(MODULE_ID, BASE_TYPE_FLAG, baseType);
  return true;
}

/**
 * Why this variation may not go on this item, or null if it may.
 *
 * Delegates to the pure rule so the refusal a test asserts and the refusal a
 * Judge is shown are the same one.
 */
export function applyRefusal(base, variation) {
  if (!base || !isVariationItem(variation)) return { reason: "unknownVariation" };
  if (base.id === variation.id) return { reason: "selfContained" };
  const held = legacyFamily(base, familyOf(variation.system?.key));
  if (held) return { reason: "legacyClash", key: held };
  return addRefusal(variationItemsOf(base).map(entryOf), definitionFrom(variation), {
    baseType: itemBaseType(base),
    define: (key) => definitionFrom(variationItemsOf(base).find((v) => v.system?.key === key)),
  });
}

/**
 * The families the three shipped flags still speak for, and what they hold.
 *
 * `layerDeltas` sums the flags and the variations together, so an item carrying
 * a masterwork FLAG and a masterwork variation would count masterwork twice.
 * Until the importer can publish these as documents and the flags retire, a
 * flag owns its family and the variation is refused by name.
 *
 * @returns {string|null} what the flag holds, for the refusal to quote
 */
function legacyFamily(base, family) {
  switch (family) {
    case "masterwork": {
      const tier = masterworkTierOf(base);
      return tier && tier !== "none" ? tier : null;
    }
    case "material":
      return silveredFlagOf(base) === true ? "silvered" : null;
    case "condition":
      return scavengedOf(base) ? "scavenged" : null;
    case "form":
      return base?.getFlag?.(MODULE_ID, ITEM_FLAGS.SHIELD_VARIANT) ?? null;
    default:
      return null;
  }
}

/**
 * Put a variation on an item.
 *
 * The source is COPIED, never moved: a variation dragged off a compendium is a
 * published description of masterwork, and the blade needs its own so that
 * re-importing the register cannot revalue a sword the Judge already priced.
 * Dragging one from another item moves it instead — that is the same document
 * changing hands, which is what the gesture means.
 *
 * @param base the item being changed
 * @param source a variation Item, from anywhere
 * @param {object} [opts]
 * @param {boolean} [opts.move] take the source rather than copying it
 * @returns {Promise<Item|null>} the applied variation, or null if refused
 */
export async function applyVariation(base, source, { move = false } = {}) {
  const refusal = applyRefusal(base, source);
  if (refusal) {
    ui.notifications?.warn(
      game.i18n.format(`ACKS-EQUIPMENT.variations.refuse.${refusal.reason}`, {
        key: refusal.key ?? source?.system?.key ?? source?.name ?? "",
      }),
    );
    return null;
  }

  const inPlace = move && siblingsOf(source) === siblingsOf(base);
  let applied;
  if (inPlace) {
    await source.update({ [`flags.${MODULE_ID}.${ITEM_FLAGS.CONTAINED_IN}`]: base.id });
    applied = source;
  } else {
    const data = source.toObject();
    delete data._id;
    data.flags = { ...(data.flags ?? {}), [MODULE_ID]: { ...(data.flags?.[MODULE_ID] ?? {}), [ITEM_FLAGS.CONTAINED_IN]: base.id } };
    const [created] = base.parent
      ? await base.parent.createEmbeddedDocuments("Item", [data])
      : [await getDocumentClass("Item").create(data)];
    applied = created ?? null;
    if (move && source.isOwner) await source.delete();
  }
  await recomputeItemFields(base);
  return applied ?? null;
}

/** Take a variation off, deleting the document it is. */
export async function removeVariation(variation) {
  const base = baseItemOf(variation);
  await variation.delete();
  if (base) await recomputeItemFields(base);
  return true;
}

/**
 * Edit one in place.
 *
 * Every write recomputes the base item, so its numbers are always the sum of
 * what is on it now and never a residue of what used to be.
 */
export async function updateVariation(variation, patch = {}) {
  await variation.update(patch);
  const base = baseItemOf(variation);
  if (base) await recomputeItemFields(base);
  return true;
}

/**
 * Show or hide one from the players.
 *
 * Un-hiding is what identifying an item IS — there is no separate
 * identification step, and a named blade whose legend the party has just
 * uncovered is the same call as a disguise coming off.
 */
export const revealVariation = (variation) => updateVariation(variation, { "system.hidden": false });
export const concealVariation = (variation) => updateVariation(variation, { "system.hidden": true });

/** Foundry's Item class, resolved late so this module imports offline. */
const getDocumentClass = (name) => globalThis.CONFIG?.[name]?.documentClass ?? globalThis.foundry?.documents?.[name];
