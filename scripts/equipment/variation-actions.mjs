/* global game, foundry, ui */
import { MODULE_ID } from "./constants.mjs";
import { BASE_TYPE_FLAG, baseTypeAllowed, baseTypeOf } from "./base-types.mjs";
import { inferBaseType } from "./base-type-infer.mjs";
import { definitionOf, dataFields } from "./variation-defs.mjs";
import { blankData, coerceData } from "../lib/field-spec.mjs";
import {
  VARIATIONS_FLAG,
  addRefusal,
  variationsOf,
  withVariation,
  withVariationPatched,
  withoutVariation,
} from "./variations.mjs";
import { recomputeItemFields } from "./properties.mjs";

/**
 * The inventory verbs: what a Judge does to an item's variations.
 *
 * One verb set for every kind of difference — no `setMasterwork`,
 * `setShieldVariant`, `clearScavenged`. Adding a kind needs no new API, which
 * is the point of the shape.
 *
 * Every write recomputes the item's fields from its pristine baseline, so the
 * numbers on the sheet are always the sum of what is currently on the list and
 * never a residue of what used to be.
 */

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

/** What this item currently carries. */
export const listVariations = (item) => variationsOf(item);

/**
 * Add one, refusing by name rather than silently.
 *
 * The refusal names the entry it collided with: "cannot add that" is useless on
 * a blade already carrying four variations when the Judge cannot see which one
 * objected.
 */
export async function addVariation(item, key, { data = null, hidden = false, read = true } = {}) {
  const definition = definitionOf(key);
  const entries = variationsOf(item);
  const refusal = addRefusal(entries, definition, { baseType: itemBaseType(item), define: definitionOf });
  if (refusal) {
    ui.notifications?.warn(
      game.i18n.format(`ACKS-EQUIPMENT.variations.refuse.${refusal.reason}`, { key: refusal.key ?? key }),
    );
    return null;
  }

  const { fields } = dataFields(key);
  const entry = {
    id: foundry.utils.randomID(),
    key,
    data: data ? coerceData(fields, data) : blankData(fields),
    hidden,
    read,
  };
  await item.setFlag(MODULE_ID, VARIATIONS_FLAG, withVariation(entries, entry));
  await recomputeItemFields(item);
  return entry;
}

/** Take one off, by identity. Duplicates in different families remove cleanly. */
export async function removeVariation(item, entryId) {
  const entries = variationsOf(item);
  if (!entries.some((e) => e.id === entryId)) return false;
  await item.setFlag(MODULE_ID, VARIATIONS_FLAG, withoutVariation(entries, entryId));
  await recomputeItemFields(item);
  return true;
}

/**
 * Edit one in place: its stored data, or whether it is hidden or read.
 *
 * `data` is coerced against the definition's own field specs, so a value that
 * arrived from a form as a string lands as the number the spec asked for.
 */
export async function updateVariation(item, entryId, patch = {}) {
  const entries = variationsOf(item);
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) return false;

  const next = { ...patch };
  if (patch.data) {
    const { fields } = dataFields(entry.key);
    next.data = coerceData(fields, { ...entry.data, ...patch.data });
  }
  await item.setFlag(MODULE_ID, VARIATIONS_FLAG, withVariationPatched(entries, entryId, next));
  await recomputeItemFields(item);
  return true;
}

/**
 * Show or hide one from the players.
 *
 * Un-hiding is what identifying an item IS — there is no separate
 * identification mechanism, and a named weapon whose legend the party has just
 * uncovered is the same call as a disguise coming off.
 */
export const revealVariation = (item, entryId) => updateVariation(item, entryId, { hidden: false });
export const concealVariation = (item, entryId) => updateVariation(item, entryId, { hidden: true });
