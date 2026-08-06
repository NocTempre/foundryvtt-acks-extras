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
 *
 * The schema probe answers "can this be worn?" correctly and uselessly: `no`,
 * for every cloak, glove, harness and pack in the books, because the system
 * declares `equipped` on `weapon` and `armor` alone. So the wear half below
 * reads a DECLARATION instead — `flags.acks-extras.gear.slots`, the GearExtras
 * model — and `isWorn`/`setWorn` hide which of the two stores a given item uses.
 * Nothing outside this file should know there are two.
 */

import { MODULE_ID, FLAG_GEAR } from "./constants.mjs";
import { WEAR_SLOTS, slotCapacity } from "./vocab.mjs";

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
 * Is this clothing? The system's one sub-classification of the `item` type
 * (`system.subtype`), and the only place the schema distinguishes a tunic from
 * a coil of rope.
 */
export const isClothing = (item) => item?.type === "item" && item?.system?.subtype === "clothing";

/** Every ammunition name RAW recognises, across all three launcher families. */
const AMMO_NAME = /arrow|bolt|quarrel|bullet|sling\s*stone|shot/i;

/**
 * Is this item a stack of ammunition? The schema has no ammo sub-type, so this
 * reads the name — the same basis the per-launcher patterns in the equipment
 * feature's `ammo.mjs` use, kept here because more than one feature asks.
 */
export const isAmmoItem = (item) => AMMO_NAME.test(item?.name ?? "");

/**
 * What this item contributes to encumbrance, in `weight6`.
 *
 * Mirrors core's `computeEncumbrance` rule exactly — quantity multiplies where
 * the type has it, and CLOTHING IS EXCLUDED — so anything summing a non-
 * character's load reaches the same number core would for a character instead
 * of reimplementing the loop and drifting from it. Coin is 0 here by design:
 * core's `getTotalMoneyEncumbrance()` owns coin weight and callers add it.
 */
export const encumbering6 = (item) => (isClothing(item) ? 0 : weight6Of(item));

/**
 * Every physical item on an actor. The one place a module should ask "what is
 * this actor carrying" rather than filtering on a type list of its own.
 */
export function physicalItems(actor) {
  return actor?.items?.filter(isPhysical) ?? [];
}

/**
 * Does a stack have anything left? An item the system gives no quantity — a
 * weapon, a suit of armour — is a single thing and always answers yes.
 */
export const hasStock = (item) => (item?.system?.quantity?.value ?? 1) > 0;

/**
 * The item this actor is carrying whose NAME matches, or null.
 *
 * The one answer to "have they got a pole / a torch / a quill" — the shape every
 * rule takes that demands a physical implement before a character may do
 * something. Two riders come with it, and both matter: only PHYSICAL items
 * count, so a proficiency called "Mapping" is never mistaken for the mapper's
 * kit; and an empty stack reads as not carried, because a bundle of no torches
 * lights nothing.
 */
export function findCarried(actor, pattern) {
  return actor?.items?.find((i) => isPhysical(i) && pattern.test(i.name ?? "") && hasStock(i)) ?? null;
}

/** Whether `findCarried` finds anything — the predicate form. */
export const carriesItem = (actor, pattern) => findCarried(actor, pattern) !== null;

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

/* -------------------------------------------- */
/*  Goods — the things you can put somewhere     */
/* -------------------------------------------- */

/**
 * Is this a thing that can be carried, stowed, stored or handed over?
 *
 * `isPhysical` alone cannot answer it: the system gives `money` no `cost` and no
 * `weight6`, so coins fail the schema probe while obviously being goods. That
 * gap is why fifteen call sites grew a `|| i.type === "money"` rider. It is
 * answered HERE, once, and the riders read this instead.
 *
 * `bundle` is excluded: it holds uuid references rather than being a thing, so
 * stowing one would nest a pointer, not an object.
 */
export const isGoods = (item) => isPhysical(item) || item?.type === "money";

/**
 * Goods a container can hold. The same question as `isGoods` — kept as its own
 * name because the container code asks it about a candidate and reads better
 * for it, not because the answer differs.
 */
export const isStowable = isGoods;

/* -------------------------------------------- */
/*  Wear — where a piece of gear sits            */
/* -------------------------------------------- */

/** An item's stored gear model, as a plain object. Never null. */
export function gearOf(item) {
  const flags = item?.getFlag?.(MODULE_ID, FLAG_GEAR) ?? item?.flags?.[MODULE_ID]?.[FLAG_GEAR];
  return flags ?? {};
}

/**
 * The slots this item may occupy — declared only. Unknown keys are dropped, so
 * a stale or hand-edited flag degrades to "fewer slots", never to a slot the
 * sheet cannot draw.
 *
 * Callers that also want the slots INFERRED from a core type (a weapon's hands,
 * an armour's body) layer that on top; this is the declaration, and the
 * declaration always wins.
 */
export function slotsOf(item) {
  const declared = gearOf(item).slots;
  return Array.isArray(declared) ? declared.filter((s) => s in WEAR_SLOTS) : [];
}

/**
 * Has anyone declared where this item sits — as opposed to declaring that it
 * sits NOWHERE?
 *
 * The two are different answers and `slotsOf` cannot tell them apart, because
 * both are an empty list. Every name-heuristic fallback in the family gates on
 * THIS, not on `slotsOf(item).length`: a Judge who deliberately sets a Great
 * Helm to sit nowhere must not have the name test put it back on the head.
 */
export const declaresSlots = (item) => Array.isArray(gearOf(item).slots);

/**
 * Can this be worn or wielded at all?
 *
 * Two grounds, because the system splits the answer: core says yes for anything
 * carrying its `equipped` field (`weapon`, `armor`), and a declared slot says
 * yes for everything core forgot (clothing, rigging, packs). An item with
 * neither is plain goods — which is exactly how rations, loot and coin get the
 * wear features switched off without a flag saying so.
 */
export const isWearable = (item) => isEquippable(item) || slotsOf(item).length > 0;

/**
 * Is it worn or wielded right now?
 *
 * READ THROUGH HERE, never off one store. Core owns `system.equipped` where it
 * exists and its own equip toggle writes it; everything else records the slot
 * it occupies. Two stores, one question — gating on either alone answers `false`
 * for half the gear on the character.
 */
export function isWorn(item) {
  if (isEquippable(item)) return !!item.system.equipped;
  return !!gearOf(item).wornAt;
}

/**
 * Which slot it occupies now, or null. Only ever a slot the item declares: a
 * `wornAt` left behind by an edit that removed the slot reads as not worn there
 * rather than as worn somewhere impossible.
 */
export function wornSlotOf(item) {
  const at = gearOf(item).wornAt;
  return at && slotsOf(item).includes(at) ? at : null;
}

/**
 * Put an item in a slot, or take it off with `null`.
 *
 * Writes to whichever store the item's type uses, so callers never branch. A
 * slot the item does not declare is refused rather than stored — the declaration
 * is what bounds this, and silently accepting would make it decoration.
 *
 * Core-equippable types keep answering through `system.equipped`; the slot is
 * still recorded for them when they declare one, because "equipped" cannot say
 * whether a shield is in the hand or strapped to the back.
 *
 * @param {Item} item
 * @param {string|null} slot a WEAR_SLOTS key, or null to remove
 * @returns {Promise<boolean>} whether anything was written
 */
export async function setWorn(item, slot = null) {
  if (!item) return false;
  if (slot !== null && !slotsOf(item).includes(slot)) return false;

  const update = {};
  if (isEquippable(item)) {
    if (!!item.system.equipped !== (slot !== null)) update["system.equipped"] = slot !== null;
  }
  if (slotsOf(item).length) {
    const current = gearOf(item).wornAt || "";
    if (current !== (slot ?? "")) update[`flags.${MODULE_ID}.${FLAG_GEAR}.wornAt`] = slot ?? "";
  }
  if (!Object.keys(update).length) return false;
  await item.update(update);
  return true;
}

/* -------------------------------------------- */
/*  Capacity — what a thing can hold             */
/* -------------------------------------------- */

/**
 * How much this item holds, in STONE, or `null` for "holds nothing".
 *
 * Capacity is a property of GEAR, not of a category called containers. A coat
 * with hidden pockets, a bandolier, a saddle and a sack all hold things, and
 * while the concept lived inside the equipment feature's container record only
 * the items it recognised as carrying devices could have one — which is why
 * clothing could carry magical qualities but not a dagger.
 *
 * Reads the gear model first and the legacy container record second, so worlds
 * annotated before the concept moved keep answering correctly with nothing to
 * migrate.
 *
 * 0 is a real answer, distinct from null: a container of unstated size. RAW
 * capacity is a warning rather than a limit, so an unstated one simply never
 * warns.
 */
export function capacityOf(item) {
  const declared = gearOf(item).capacity;
  if (Number.isFinite(declared)) return Number(declared);
  const legacy = item?.getFlag?.(MODULE_ID, "container")?.capacity ?? item?.flags?.[MODULE_ID]?.container?.capacity;
  return Number.isFinite(legacy) ? Number(legacy) : null;
}

/** Can gear be put inside this at all? */
export const holdsGear = (item) => capacityOf(item) !== null;

/**
 * Everything the actor has in a given slot. The basis of the exclusivity check:
 * a slot holds `slotCapacity(slot)` items and no more.
 */
export function itemsInSlot(actor, slot) {
  return actor?.items?.filter((i) => wornSlotOf(i) === slot) ?? [];
}

/**
 * Is the slot carrying more than it can?
 *
 * The Treasure Tome's rings are why this returns a state rather than blocking a
 * write: a third ring does not fail to go on, it stops all three working. What
 * an over-filled slot MEANS is the caller's to decide.
 */
export const slotOverfilled = (actor, slot) => itemsInSlot(actor, slot).length > slotCapacity(slot);
