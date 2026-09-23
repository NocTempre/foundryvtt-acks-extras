/**
 * BASE TYPE — what an item is, as the books sort equipment. Refines the
 * document type; it never replaces it (see docs/equipment/MODEL.md, "Base
 * types and variations"). What each category RECORDS is content and arrives
 * as imported field specs (`lib/field-spec.mjs`), rendered generically —
 * nothing here knows what a gem has, only that gems are a thing items can be.
 */
import { ITEM_TYPE } from "../lib/vocab.mjs";

/** The categories. Extending this list is a structural change, not a content one. */
export const BASE_TYPE = Object.freeze({
  weapon: "weapon",
  armour: "armour",
  shield: "shield",
  clothing: "clothing",
  gear: "gear",
  food: "food",
  gem: "gem",
  coin: "coin",
  tradeGood: "tradeGood",
});

/** Flag holding the declared base type. Absent means "infer it" (below). */
export const BASE_TYPE_FLAG = "baseType";

/**
 * Which document types a base type is allowed to sit on.
 *
 * This is the constraint core imposes, not a rule from a book: a base type that
 * claimed to be `armour` on a `weapon` document would have core computing the
 * wrong numbers from underneath it. Everything physical may be `gear` — that is
 * the fallback category, not a judgement.
 */
export const BASE_TYPE_DOCUMENTS = Object.freeze({
  [BASE_TYPE.weapon]: [ITEM_TYPE.weapon],
  [BASE_TYPE.armour]: [ITEM_TYPE.armor],
  [BASE_TYPE.shield]: [ITEM_TYPE.armor],
  [BASE_TYPE.clothing]: [ITEM_TYPE.item, ITEM_TYPE.armor],
  [BASE_TYPE.gear]: [ITEM_TYPE.item, ITEM_TYPE.weapon, ITEM_TYPE.armor],
  [BASE_TYPE.food]: [ITEM_TYPE.item],
  [BASE_TYPE.gem]: [ITEM_TYPE.item],
  [BASE_TYPE.coin]: [ITEM_TYPE.item, ITEM_TYPE.money],
  [BASE_TYPE.tradeGood]: [ITEM_TYPE.item],
});

/** May this base type be set on a document of this type? */
export function baseTypeAllowed(baseType, documentType) {
  const allowed = BASE_TYPE_DOCUMENTS[baseType];
  return !!allowed && allowed.includes(documentType);
}

/** Every base type that may sit on this document type, for a picker. */
export function baseTypesFor(documentType) {
  return Object.values(BASE_TYPE).filter((t) => baseTypeAllowed(t, documentType));
}

/**
 * What a document type is, before anyone declares anything.
 *
 * The floor under the inference below, and the answer for an item nobody has
 * classified: a weapon document is a weapon, an armour document is armour, and
 * everything else physical is gear until told otherwise.
 */
export function documentBaseType(documentType) {
  if (documentType === ITEM_TYPE.weapon) return BASE_TYPE.weapon;
  if (documentType === ITEM_TYPE.armor) return BASE_TYPE.armour;
  if (documentType === ITEM_TYPE.money) return BASE_TYPE.coin;
  return BASE_TYPE.gear;
}

/**
 * The base type of an item: what it DECLARES, else what can be inferred. The
 * declared flag always wins (see docs/equipment/MODEL.md, "Base types and
 * variations").
 *
 * @param {object} item a Foundry Item, or any `{type, name, flags}` shape
 * @param {object} [opts]
 * @param {(item: object) => string|null} [opts.infer] the name-pattern guess,
 *   injected so this file needs neither the pattern tables nor Foundry.
 */
export function baseTypeOf(item, { infer = null } = {}) {
  const declared = item?.flags?.["acks-extras"]?.[BASE_TYPE_FLAG];
  if (declared && Object.hasOwn(BASE_TYPE, declared) && baseTypeAllowed(declared, item?.type)) {
    return declared;
  }
  const guessed = infer?.(item) ?? null;
  if (guessed && baseTypeAllowed(guessed, item?.type)) return guessed;
  return documentBaseType(item?.type);
}

/** Has a Judge (or the importer) actually declared this one? */
export function baseTypeIsDeclared(item) {
  const declared = item?.flags?.["acks-extras"]?.[BASE_TYPE_FLAG];
  return !!declared && Object.hasOwn(BASE_TYPE, declared);
}
