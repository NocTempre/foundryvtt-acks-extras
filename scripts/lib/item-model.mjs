/* global foundry */
/**
 * The shared item baseline: the one place that answers "is this a thing?",
 * "can it be worn?" and "what does it weigh?" by reading the system's schema
 * rather than a per-module type list, plus the field builders a module's own
 * item sub-type should use to match the system exactly. See
 * docs/lib/MODEL.md, "The item taxonomy: goods, gear, and where it sits".
 */

import { MODULE_ID, FLAG_GEAR, VARIATION_TYPE } from "./constants.mjs";
import { WEAR_SLOTS, slotCapacity, ITEM_TYPE } from "./vocab.mjs";

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
 * How many units one stated `weight6` covers. 1 for everything that does not
 * say otherwise, which is the arithmetic every item had before the field
 * existed.
 *
 * A bundle size below 1 is nonsense and would divide the weight away, so it
 * clamps; the value is a whole number of units because a fifth of an arrow is
 * not a thing you carry.
 */
export function bundleSizeOf(item) {
  const per = Number(gearOf(item).per);
  return Number.isFinite(per) && per >= 1 ? Math.floor(per) : 1;
}

/**
 * Effective weight in `weight6`, honouring quantity the way the system does.
 * Only stackable items multiply (a `weapon`/`armor` has no quantity field, so
 * it is read where it exists, not defaulted). A stated weight covering a
 * BUNDLE of units is counted once per whole bundle used (CEILS, not divides) —
 * see docs/lib/DECISIONS.md, "A bundled good's weight and its count share a
 * denominator, and the size is printed".
 */
export function weight6Of(item) {
  if (!isPhysical(item)) return 0;
  const w = Number(item.system.weight6 ?? 0);
  const qty = item.system.quantity?.value;
  if (!Number.isFinite(qty)) return w;
  const per = bundleSizeOf(item);
  return per > 1 ? w * Math.ceil(qty / per) : w * qty;
}

/**
 * What core's own encumbrance sum would make of this item — `weight6` times
 * quantity, with no bundle applied. Core owns the character encumbrance loop
 * and cannot be modified, so a bundle has to be corrected AFTER core has
 * counted it; this is the figure `encumbranceDelta6` corrects away.
 */
export function coreWeight6Of(item) {
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
export const isClothing = (item) => item?.type === ITEM_TYPE.item && item?.system?.subtype === "clothing";

/**
 * Is this item magic? Two stores say so, and either is enough: the markets
 * feature's declaration on the item (`flags.acks-extras.markets.magic`, the
 * Judge's toggle on the Construction tab), and a magical variation applied to
 * it — a variation document inside it whose kind or key family is magical.
 */
export function isMagical(item) {
  const declared = item?.getFlag?.(MODULE_ID, "markets")?.magic ?? item?.flags?.[MODULE_ID]?.markets?.magic;
  if (declared) return true;
  return contentsIn(item).some(
    (v) => v?.type === VARIATION_TYPE && (v.system?.kind === "magical" || String(v.system?.key ?? "").split(".")[0] === "magical"),
  );
}

/** Every ammunition name RAW recognises, across all three launcher families. */
const AMMO_NAME = /arrow|bolt|quarrel|bullet|sling\s*stone|shot/i;

/**
 * Is this item a stack of ammunition? The schema has no ammo sub-type, so this
 * reads the name — the same basis the per-launcher patterns in the equipment
 * feature's `ammo.mjs` use, kept here because more than one feature asks.
 */
export const isAmmoItem = (item) => AMMO_NAME.test(item?.name ?? "");

/**
 * What this item contributes to encumbrance, in `weight6`. Mirrors core's
 * `computeEncumbrance` rule exactly, clothing excluded, so a non-character's
 * load reaches the same number core would for a character. Coin is 0 here by
 * design: core's `getTotalMoneyEncumbrance()` owns coin weight.
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
 * The item this actor is carrying whose NAME matches, or null — the one
 * answer to "have they got a pole / a torch / a quill". Only PHYSICAL items
 * count (a proficiency named "Mapping" is never mistaken for the mapper's
 * kit), and an empty stack reads as not carried.
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
 * `isPhysical` alone cannot answer it: `money` has no `cost`/`weight6` and so
 * fails the schema probe while obviously being goods. `bundle` is excluded —
 * it holds uuid references rather than being a thing.
 */
export const isGoods = (item) => isPhysical(item) || item?.type === ITEM_TYPE.money;

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
 * sheet cannot draw. Callers wanting slots INFERRED from a core type layer
 * that on top; this declaration always wins.
 */
export function slotsOf(item) {
  const declared = gearOf(item).slots;
  return Array.isArray(declared) ? declared.filter((s) => s in WEAR_SLOTS) : [];
}

/**
 * Has anyone declared where this item sits, as opposed to declaring that it
 * sits NOWHERE? `slotsOf` cannot tell the two apart (both are an empty list).
 * See docs/lib/MODEL.md, "Slots" — every name-heuristic fallback gates on
 * this, never on `slotsOf(item).length`.
 */
export const declaresSlots = (item) => Array.isArray(gearOf(item).slots);

/**
 * Can this be worn or wielded at all? Core says yes for anything carrying its
 * `equipped` field (`weapon`, `armor`); a declared slot says yes for
 * everything core forgot. An item with neither is plain goods.
 */
export const isWearable = (item) => isEquippable(item) || slotsOf(item).length > 0;

/**
 * Is it worn or wielded right now? READ THROUGH HERE, never off one store —
 * see docs/lib/MODEL.md, "Two stores, and why nothing outside this file
 * knows".
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
 * Put an item in a slot, or take it off with `null`. Writes to whichever store
 * the item's type uses, so callers never branch. A slot the item does not
 * declare is refused rather than stored; core-equippable types keep answering
 * through `system.equipped` but still record a declared slot, because
 * "equipped" cannot say whether a shield is in the hand or on the back.
 *
 * @param {Item} item
 * @param {string|null} slot a WEAR_SLOTS key, or null to remove
 * @returns {Promise<boolean>} whether anything was written
 */
export async function setWorn(item, slot = null) {
  if (!item) return false;
  // Core-equippable types are never refused for an undeclared slot: they have
  // no slot to be wrong about, and every imported one arrives undeclared.
  if (slot !== null && slotsOf(item).length && !slotsOf(item).includes(slot)) return false;
  if (slot !== null && !slotsOf(item).length && !isEquippable(item)) return false;

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
 * How much this item holds, in STONE, or `null` for "holds nothing". Capacity
 * is a property of GEAR, not of a category called containers — see
 * docs/lib/MODEL.md, "Capacity". Reads the gear model first and the legacy
 * container record second, so worlds annotated before the concept moved keep
 * answering correctly.
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
 * The weight of ordinary equipment a harness relieves its wearer of, in
 * stone, or `null` when the item does not state one — read from the item
 * (the annotate pass or its sheet), never from a constant here.
 */
export function reliefOf(item) {
  const declared = gearOf(item).relief;
  return Number.isFinite(declared) ? Number(declared) : null;
}

/* --- Containment READS. The stow/unstow writes and their warnings stay in the
 * equipment feature; the relation itself is one flag, and the capacity
 * primitive has to read it from lib — same promotion capacityOf took. --- */

/** The container item id this item is stored inside, if any. */
export function containedIn(item) {
  return item?.getFlag?.(MODULE_ID, "containedIn") ?? item?.flags?.[MODULE_ID]?.containedIn ?? null;
}

/**
 * The collection an item's contents would live in.
 *
 * Containment points at a SIBLING by id, so what counts as a sibling depends on
 * where the container is: an actor's own items for carried gear, the world's
 * Items directory for a loose one. A compendium item has neither — its pack is
 * not loaded — so it holds nothing until it is imported, which is the honest
 * answer rather than an empty list pretending to be complete.
 */
export function siblingsOf(item) {
  if (item?.parent?.items) return item.parent.items;
  if (item?.pack) return null;
  return globalThis.game?.items ?? null;
}

/**
 * Items stored directly inside a container.
 *
 * Takes the container's OWNER — an actor, or any collection of items — because
 * a container need not be carried by anyone. Passing the container item itself
 * asks `siblingsOf` where to look, which is what callers holding only the
 * container should do.
 */
export function contentsOf(owner, containerId) {
  const items = owner?.items ?? (typeof owner?.filter === "function" ? owner : null);
  return items?.filter((i) => containedIn(i) === containerId) ?? [];
}

/** Everything contained in this item, wherever the item happens to live. */
export const contentsIn = (item) => (item?.id ? contentsOf(siblingsOf(item), item.id) : []);

/** A thing gear can go inside: declared capacity, or the legacy container
 * record (which may state no capacity and still contain). */
export const isContainer = (item) =>
  holdsGear(item) || !!(item?.getFlag?.(MODULE_ID, "container") ?? item?.flags?.[MODULE_ID]?.container);

/** Total weight6 of a container's contents (one level; nesting recurses). */
export function contentsWeight6(actor, containerId, seen = new Set()) {
  if (seen.has(containerId)) return 0; // guard against a container inside itself
  seen.add(containerId);
  return contentsOf(actor, containerId).reduce(
    (sum, i) => sum + weight6Of(i) + (isContainer(i) ? contentsWeight6(actor, i.id, seen) : 0),
    0,
  );
}

/**
 * Everything the actor has in a given slot, by the wear declaration. A weapon
 * or a shield is placed by the equipment feature's resolver instead, so a
 * caller holding that answer passes its own list to `slotUse`.
 */
export function itemsInSlot(actor, slot) {
  return actor?.items?.filter((i) => wornSlotOf(i) === slot) ?? [];
}

/**
 * How a place is occupied. Two counts cap two different things — a form's
 * MAGIC-item cap (`slotCapacity`) and the body's one-of-what-core-can-equip
 * cap; clothing and plain gear count against neither. See docs/lib/MODEL.md,
 * "Slots" — a full magic count is a state rather than a refused write, so
 * what it MEANS is the caller's to decide.
 * @param {string} slot a wear-slot key
 * @param {Item[]} items what is at that place, as the caller resolved it
 * @returns {{equip:number, magic:number, cap:number, used:number, full:boolean}}
 *   `cap` the magic capacity (Infinity when uncapped); `used` the larger of
 *   the two counts, for a badge; `full` when either rule is broken
 */
export function slotUse(slot, items) {
  const cap = slotCapacity(slot);
  const equip = items.filter(isEquippable).length;
  const magic = items.filter(isMagical).length;
  return { equip, magic, cap, used: Math.max(equip, magic), full: magic > cap || (cap !== Infinity && equip > 1) };
}

/** Is the slot carrying more than it can, by either rule? */
export const slotOverfilled = (actor, slot) => slotUse(slot, itemsInSlot(actor, slot)).full;
