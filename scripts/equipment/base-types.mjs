/**
 * BASE TYPE — what an item is, as the books sort equipment.
 *
 * The books put a gem, a loaf, a cloak and a sword in different categories, and
 * each records different things. Foundry has four physical document sub-types,
 * so everything below that line used to be GUESSED from the item's name:
 * sixteen regexes deciding whether something is a garment, a profile table
 * keyed by normalised name, weapon aliases matched by string. A flag declares
 * what those infer.
 *
 * **Base type REFINES the document type; it never replaces it.** Core's
 * `actor.mjs` derives AC, initiative and encumbrance straight from
 * `item.type === "armor"` / `"weapon"`, and the system is an unmodifiable
 * reference — so plate stays an `armor` document and says `armour` here, and a
 * gem is an ordinary `item` document that says `gem`. Anything that made a
 * category its own document sub-type would stop being `item` and fall out of
 * every core path that asks "is this ordinary gear".
 *
 * **The keys ship; what each category RECORDS does not.** Naming the concept
 * `"gem"` is how this code talks about itself. What a gem records — cut, carat,
 * whatever the book says — is content and arrives as imported field specs
 * (`lib/field-spec.mjs`), rendered generically. Nothing here knows what a gem
 * has, only that gems are a thing items can be.
 */
import { ITEM_TYPE } from "../lib/vocab.mjs";

/**
 * The categories. Extending this list is a structural change, not a content
 * one — a new key is only ever added because the code needs to talk about a
 * category, and what that category records still comes from the register.
 */
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
 * The base type of an item: what it DECLARES, else what can be inferred.
 *
 * The declared flag always wins. Inference is the compatibility path for the
 * worlds that predate the flag, and it is deliberately kept — introducing the
 * flag and dropping the guess in one release would strip every existing world's
 * clothing of the slots it was being granted by name. It retires when the
 * migration has run and the importer sets base types on what it materialises.
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
