/* global foundry */
/**
 * The shared item baseline.
 *
 * The system's item data models were built type by type, so what is really one
 * concept is spelled out repeatedly and inconsistently:
 *
 *  - `cost` + `weight6` are hand-spread into `item`, `weapon` and `armor` from
 *    a template — but `spell`, `language`, `ability` and `bundle` do not have
 *    them, so "is this thing physical?" has no answer in the schema.
 *  - `equipped` is declared SEPARATELY on `weapon` and on `armor`, and nowhere
 *    else — so "can this be worn or wielded?" is a hardcoded type list.
 *  - `favorite` lives on `weapon` and `ability`; `save` on `weapon`, `ability`
 *    and `spell`; `pattern` on `weapon` and `ability`.
 *
 * Every module then re-derives the same facts with its own type list, and they
 * disagree: acks-equipment's stowable set, its weight sum, and its worn-armour
 * lookup each encode "which types are physical" separately.
 *
 * The system is an unmodifiable reference, so this cannot be fixed by giving
 * those models a common base. What it CAN be is one place that answers the
 * questions — plus the field builders a module's own item sub-type should use
 * so it matches the system exactly rather than approximately.
 *
 * Everything here reads the SCHEMA, not a type name, wherever it can: `"cost" in
 * item.system` keeps working when the system adds a physical type this library
 * has never heard of, and a hardcoded list does not.
 */

const F = () => foundry.data.fields;

/* -------------------------------------------- */
/*  Field builders — for a module's own sub-type */
/* -------------------------------------------- */

/**
 * Cost and weight, matching the system's ItemPhysicalTemplate exactly.
 * `weight6` is SIXTHS OF A STONE — the family's only weight unit.
 * @returns {object} schema fields
 */
export function physicalFields() {
  const { NumberField } = F();
  return {
    cost: new NumberField({ initial: 0, min: 0 }),
    weight6: new NumberField({ initial: 0 }),
  };
}

/** Physical, plus the worn/wielded flag the system puts on weapon and armor. */
export function equippableFields() {
  return {
    ...physicalFields(),
    equipped: new (F().BooleanField)({ initial: false }),
  };
}

/* -------------------------------------------- */
/*  Accessors — one answer per question          */
/* -------------------------------------------- */

/** A stone is six `weight6` units. */
export const STONE = 6;

/**
 * Does this item have a cost and a weight — is it a THING, rather than a spell,
 * a language or a proficiency? Read from the schema, not a type list.
 */
export const isPhysical = (item) => !!item?.system && "cost" in item.system && "weight6" in item.system;

/** Can this item be worn or wielded? */
export const isEquippable = (item) => !!item?.system && "equipped" in item.system;

/** Is it worn or wielded right now? */
export const isEquipped = (item) => !!item?.system?.equipped;

/**
 * Effective weight in `weight6`, honouring quantity the way the system does.
 *
 * Only stackable items multiply: a `weapon` or `armor` has no quantity field,
 * and reading `quantity?.value ?? 1` off one would be harmless today and wrong
 * the moment the system adds it. Quantity is read where it exists.
 */
export function weight6Of(item) {
  if (!isPhysical(item)) return 0;
  const w = Number(item.system.weight6 ?? 0);
  const qty = item.system.quantity?.value;
  return Number.isFinite(qty) ? w * qty : w;
}

/** The same weight in stone, for display. */
export const weightStoneOf = (item) => weight6Of(item) / STONE;

/**
 * Every physical item on an actor. The one place a module should ask "what is
 * this actor carrying" rather than filtering on a type list of its own.
 */
export function physicalItems(actor) {
  return actor?.items?.filter(isPhysical) ?? [];
}

/** Everything the actor currently has worn or wielded. */
export function equippedItems(actor) {
  return actor?.items?.filter((i) => isEquippable(i) && isEquipped(i)) ?? [];
}

/**
 * Set (or clear) an item's equipped state, if it has one.
 * @returns {Promise<boolean>} whether anything was written
 */
export async function setEquipped(item, equipped = true) {
  if (!isEquippable(item) || !!item.system.equipped === !!equipped) return false;
  await item.update({ "system.equipped": !!equipped });
  return true;
}
