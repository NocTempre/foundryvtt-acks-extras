/* global game, ui */
import { MODULE_ID, ITEM_FLAGS, VARIATION_ITEM_TYPE } from "./constants.mjs";
import { containedIn, contentsIn, siblingsOf } from "../lib/item-model.mjs";
import { addRefusal, entryOf, definitionFrom, familyOf } from "./variations.mjs";
import { BASE_TYPE_FLAG, baseTypeAllowed, baseTypeOf } from "./base-types.mjs";
import { inferBaseType } from "./base-type-infer.mjs";
import { recomputeItemFields, masterworkTierOf, scavengedOf, silveredFlagOf } from "./properties.mjs";

/**
 * Variations as CONTENTS: applying one puts a variation Item in the same
 * collection as the item it changes, flagged `containedIn` at it (the relation
 * `containers.mjs` uses for gear in a pack). The write here shares that flag
 * and not `storeIn`'s capacity, lock or unequip checks. See
 * docs/equipment/DECISIONS.md, "A variation is a document, and applying it is
 * putting it inside".
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

/**
 * The base type of a live item: the declared `baseType` flag, else the guess
 * from its document type and name. The importer writes no flag, so the guess
 * answers for every imported item and for any a Judge has not declared.
 */
export const itemBaseType = (item) => baseTypeOf(item, { infer: inferBaseType });

/**
 * Declare what an item IS, or clear the declaration with a falsy `baseType`.
 * Refused (false, with a warning) where the base type is not allowed on the
 * item's document type.
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
 * Why this variation may not go on this item, or null if it may. The family
 * and base-type rules are `addRefusal`'s; a flag-held family refuses first.
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
 * The families the item's flag layers speak for, and what they hold.
 * `layerDeltas` sums flags and variations together, so a flag owns its family
 * and a variation of it is refused. See docs/equipment/DECISIONS.md, "A
 * variation is a document, and applying it is putting it inside".
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
 * Put a variation on an item. The source is COPIED unless `move` is set, so a
 * compendium variation stays published and the item holds its own.
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
 * Edit one in place, then recompute the base item.
 */
export async function updateVariation(variation, patch = {}) {
  await variation.update(patch);
  const base = baseItemOf(variation);
  if (base) await recomputeItemFields(base);
  return true;
}

/**
 * Show or hide one from the players. Un-hiding is the identification step;
 * there is no other.
 */
export const revealVariation = (variation) => updateVariation(variation, { "system.hidden": false });

/**
 * Hide a variation from the players (the reverse of `revealVariation`).
 */
export const concealVariation = (variation) => updateVariation(variation, { "system.hidden": true });

/** Foundry's Item class, resolved late so this module imports offline. */
const getDocumentClass = (name) => globalThis.CONFIG?.[name]?.documentClass ?? globalThis.foundry?.documents?.[name];
