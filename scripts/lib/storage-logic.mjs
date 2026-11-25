/**
 * The Foundry-free half of location storage: decides WHAT a transfer does,
 * split out so it imports under Node and is unit-tested offline (as
 * group-logic.mjs is to group.mjs). storage.mjs re-exports these and adds the
 * document writes.
 *
 * Works on PLAIN item data (`item.toObject()` results) and returns plans,
 * never side effects; nothing here dereferences a Foundry global.
 *
 * Reads two foreign vocabularies without importing their owners: `quantityOf`
 * resolves `system.quantity` by its shape, not the item type; `containedIn`
 * is the equipment feature's container pointer, read (and rewritten)
 * generically. See docs/lib/API.md, "storage".
 */
import { toNum as num } from "./util.mjs";
import { ITEM_TYPE } from "./vocab.mjs";
import { coinCount, coinKind, coinTotalGC } from "./money-logic.mjs";
import { setPath } from "./dotted-path.mjs";
import { VARIATION_TYPE } from "./constants.mjs";

// Coin's worth is money-logic's to compute; it is offered through here as
// well because the storage surface lists every place's coin beside its goods.
export { coinTotalGC };

/** The flag scope/key attribution lives under, on both providers and stored items. */
export const LIB_ID = "acks-extras";
/** The flag key the storage record lives under. */
export const STORAGE_KEY = "storage";

/**
 * The storage owner of a holder's OWN coin and goods: a location's house pile,
 * and what a row that carries no stamp reads as. Not a real uuid on purpose:
 * nothing can resolve it, so no character can claim it.
 */
export const HOUSE_OWNER = `${LIB_ID}:house`;

/** The flag naming the bundle a copy was unpacked from: provenance, never identity. */
export const UNPACKED_FROM = "unpackedFrom";

/** The equipment feature's container pointer — read generically, never imported. */
const EQUIPMENT_ID = "acks-extras";
const CONTAINED_IN = "containedIn";

/** The flag marking a weapon thrown away and awaiting recovery (equipment's `ITEM_FLAGS.THROWN_STATE`), read without importing its owner. */
const THROWN_AWAY = "thrownAway";

const isMoney = (plain) => plain?.type === ITEM_TYPE.money;

/* -------------------------------------------- */
/*  Reading the two foreign vocabularies         */
/* -------------------------------------------- */

/**
 * Where this item keeps its quantity, and how many it stands for. Every
 * Physical Item (gear, clothing, weapon, armour) keeps a plain whole number at
 * `system.quantity`, as does coin. The `{value}` object branch stays because an
 * item copy saved in a module flag before the system flattened the field still
 * carries that shape; its path is `system.quantity.value`.
 * @returns {{value: number, path: string}|null} null when the data carries no
 *   quantity in either shape. Whether the item may be split or merged is
 *   `isStackable`'s question, not this one's.
 */
export function quantityOf(plain) {
  const sys = plain?.system;
  if (!sys) return null;
  if (typeof sys.quantity === "number") return { value: sys.quantity, path: "system.quantity" };
  // quantity-shape-ok: this seam is the one reader of the object shape a saved item copy keeps
  if (sys.quantity && typeof sys.quantity === "object" && Number.isFinite(Number(sys.quantity.value))) {
    return { value: Number(sys.quantity.value), path: "system.quantity.value" }; // quantity-shape-ok: the path of that saved shape, handed to the caller as is
  }
  return null;
}

/**
 * Can this item be split into rows, folded into another row of itself, or
 * counted off one at a time? Every Physical Item keeps a quantity, a weapon and
 * a suit of armour included, so any row carrying one answers true, except a row
 * with Active Effects of its own: an effect applies once per document, so a
 * second row would apply it twice, and such a row moves whole. Anything that
 * carries no quantity answers false. Works on plain item data and on a
 * document alike (a document's `effects` is a collection with a `size`, plain
 * data's an array with a `length`).
 */
export function isStackable(plain) {
  const effects = plain?.effects;
  if ((effects?.size ?? effects?.length ?? 0) > 0) return false;
  return quantityOf(plain) !== null;
}

/**
 * Is this row in use: equipped, worn at a place, or thrown away awaiting
 * recovery? Nothing folds into a row in use, so it takes no merge identity
 * (`stackSignature`) and, where core can equip it, no count control
 * (`offersCount`). A container is not in use; it keeps its own row by
 * `stackSignature`'s own test. Reads plain item data and answers false for
 * anything without a mark of use, `null` included.
 */
export function isInUse(plain) {
  const own = plain?.flags?.[LIB_ID] ?? {};
  return !!(plain?.system?.equipped || own.gear?.wornAt || own[THROWN_AWAY]);
}

/**
 * Should a surface draw a count control (a divide, a take-how-many, a sale
 * count) on this row? Only a stackable row (`isStackable`) is offered one.
 * Core equips what carries an `equipped` field, the one probe `isEquippable`
 * reads, and a row it can equip is offered the control only while it rests:
 * a stack at rest takes every count control, a row in use (`isInUse`) takes
 * none. A row core cannot equip, gear, is offered it whenever it is stackable,
 * worn or not. The count field itself stays editable on any row.
 */
export function offersCount(plain) {
  if (!isStackable(plain)) return false;
  const equippable = !!plain?.system && "equipped" in plain.system;
  return equippable ? !isInUse(plain) : true;
}

/** The container this item is inside, per the equipment feature. Null when loose. */
export const containedInOf = (plain) => plain?.flags?.[EQUIPMENT_ID]?.[CONTAINED_IN] ?? null;

/** The attribution stamped on a stored item: whose goods these are. */
export const storageFlagOf = (plain) => plain?.flags?.[LIB_ID]?.[STORAGE_KEY] ?? null;

/** Whose a row is where goods are kept for owners: its stamp, or the holder's own where it carries none. */
export const rowOwnerOf = (plain) => storageFlagOf(plain)?.ownerUuid || HOUSE_OWNER;

/* -------------------------------------------- */
/*  Splitting and closure                        */
/* -------------------------------------------- */

/**
 * How much of one item moves. `requested` of null/undefined means "all of it".
 * A request larger than the stack is clamped rather than refused — the caller
 * asked for everything and everything is what it gets.
 */
export function splitSpec(plain, requested = null) {
  const q = quantityOf(plain);
  if (!isStackable(plain)) return { move: 1, remain: 0, whole: true, path: null };
  const have = Math.max(0, num(q.value));
  const want = requested == null ? have : Math.max(0, Math.floor(num(requested)));
  const move = Math.min(have, want);
  return { move, remain: have - move, whole: move >= have, path: q.path };
}

/**
 * Grow a set of whole-moved item ids to include everything stored inside them,
 * transitively: stashing a backpack stashes what is in the backpack.
 *
 * Only WHOLE moves pull a closure — half a stack of sacks cannot take the
 * contents of the other half with it. The visited set doubles as the cycle
 * guard, so a corrupt containedIn loop terminates instead of hanging.
 */
export function expandContainerClosure(plainItems, wholeIds) {
  const included = new Set(wholeIds ?? []);
  const contents = new Map();
  for (const it of plainItems ?? []) {
    const parent = containedInOf(it);
    if (!parent) continue;
    if (!contents.has(parent)) contents.set(parent, []);
    contents.get(parent).push(it._id);
  }
  const queue = [...included];
  while (queue.length) {
    for (const childId of contents.get(queue.shift()) ?? []) {
      if (included.has(childId)) continue; // also the cycle guard
      included.add(childId);
      queue.push(childId);
    }
  }
  return included;
}

/* -------------------------------------------- */
/*  The transfer payload                         */
/* -------------------------------------------- */

/** Normalise `[{id, quantity}]` / `["id"]` into a Map, dropping unknown ids. */
function readSpec(spec, byId) {
  const requests = new Map();
  for (const entry of spec ?? []) {
    const id = typeof entry === "string" ? entry : entry?.id;
    if (!id || !byId.has(id) || requests.has(id)) continue;
    requests.set(id, typeof entry === "string" ? null : (entry?.quantity ?? null));
  }
  return requests;
}

/**
 * Plan one transfer: what to create on the target, and what to update or delete
 * on the source. Nothing is written — the caller decides the order.
 *
 * The arriving copies are normalised for the destination:
 *  - nothing arrives equipped;
 *  - `quantitybank` is zeroed (the field is retired; storage replaces it);
 *  - `containedIn` is remapped through the new ids when the container came
 *    along, and stripped when it did not (the pointer would dangle);
 *  - attribution is stamped when the target stores goods for someone,
 *    preserved on provider→provider moves, and stripped when goods land on a
 *    character.
 *
 * @param {object[]} plainItems - every item on the source, as plain data
 * @param {Array<string|{id: string, quantity?: number}>} spec - what to move
 * @param {object} opts
 * @param {string|null} opts.ownerUuid - whose goods these become
 * @param {string} opts.ownerName - display fallback for a dangling owner
 * @param {boolean} opts.stampOwner - target stores goods for an owner
 * @param {boolean} opts.preserveOwner - keep existing attribution where present
 * @param {() => string} opts.newId - id generator (foundry.utils.randomID)
 */
export function buildTransferPayload(plainItems, spec, opts = {}) {
  const { ownerUuid = null, ownerName = "", stampOwner = false, preserveOwner = false, newId = () => null } = opts;
  const items = plainItems ?? [];
  const byId = new Map(items.map((i) => [i._id, i]));

  // A row holding a variation moves whole whatever count was asked: a divided
  // copy would arrive with none of the variation documents inside it.
  const holdsVariation = new Set(items.filter((i) => i?.type === VARIATION_TYPE && containedInOf(i)).map(containedInOf));

  const plans = new Map();
  for (const [id, requested] of readSpec(spec, byId)) {
    const plan = splitSpec(byId.get(id), holdsVariation.has(id) ? null : requested);
    if (plan.move <= 0) continue; // nothing asked for, or an empty stack
    plans.set(id, plan);
  }

  // Contents follow their container, and always whole.
  const wholeIds = [...plans].filter(([, p]) => p.whole).map(([id]) => id);
  for (const id of expandContainerClosure(items, wholeIds)) {
    if (plans.has(id)) continue;
    plans.set(id, { ...splitSpec(byId.get(id), null), whole: true });
  }

  const idMap = new Map();
  for (const id of plans.keys()) idMap.set(id, newId());

  const creates = [];
  const sourceUpdates = [];
  const sourceDeletes = [];

  for (const [id, plan] of plans) {
    const copy = structuredClone(byId.get(id));
    copy._id = idMap.get(id);
    if (plan.path) setPath(copy, plan.path, plan.move);
    if (copy.system && "equipped" in copy.system) copy.system.equipped = false;
    if (copy.system && "quantitybank" in copy.system) copy.system.quantitybank = 0;
    if (copy.system && "totalvalue" in copy.system) copy.system.totalvalue = 0;

    const parent = containedInOf(copy);
    if (parent) {
      copy.flags[EQUIPMENT_ID] = { ...copy.flags[EQUIPMENT_ID] };
      if (idMap.has(parent)) copy.flags[EQUIPMENT_ID][CONTAINED_IN] = idMap.get(parent);
      else delete copy.flags[EQUIPMENT_ID][CONTAINED_IN];
    }

    copy.flags ??= {};
    const inherited = preserveOwner ? storageFlagOf(copy) : null;
    if (stampOwner) {
      copy.flags[LIB_ID] = {
        ...copy.flags[LIB_ID],
        [STORAGE_KEY]: {
          ownerUuid: inherited?.ownerUuid || ownerUuid || null,
          ownerName: inherited?.ownerName || ownerName || "",
        },
      };
    } else if (copy.flags[LIB_ID]) {
      copy.flags[LIB_ID] = { ...copy.flags[LIB_ID] };
      delete copy.flags[LIB_ID][STORAGE_KEY];
    }

    creates.push(copy);
    // A coin row with a balance still in the system's banked field is emptied,
    // not removed: `emptyMoneyDeletes` keeps the row for the same balance.
    const src = byId.get(id);
    const keepsRow = isMoney(src) && num(src.system?.quantitybank) > 0;
    if (plan.whole && !keepsRow) sourceDeletes.push(id);
    else sourceUpdates.push({ _id: id, [plan.path]: plan.remain });
  }

  return { creates, sourceUpdates, sourceDeletes, idMap };
}

/* -------------------------------------------- */
/*  Coin                                         */
/* -------------------------------------------- */

/** JSON with sorted keys, so two equal objects always stringify identically. */
function canon(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canon).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canon(value[k])}`)
    .join(",")}}`;
}

/** The flag naming the stack a split row came from: provenance, never identity. */
const SPLIT_FROM = "splitFrom";
/**
 * The wear leftovers on a resting row, which core's equip toggle does not
 * clear (the hand a weapon was drawn in, the chosen grip, a shield's strap):
 * they describe the last time the row was in use, not what the row is.
 */
const WEAR_LEFTOVERS = ["hand", "grip", "strap"];

/**
 * The merge identity of a stack — what makes two rows "the same thing" for
 * merging. Returns null for anything that must keep its own row: an
 * unstackable row (`isStackable`), a container, and a row in use (`isInUse`:
 * equipped, worn at a slot or thrown away), because nothing folds into a row in
 * use. Callers read a null as "equal to nothing", never as a value two rows
 * share. Coin keys on its kind; everything else keys on the whole document
 * minus quantity, provenance and the wear leftovers of a resting row
 * (`WEAR_LEFTOVERS`). At a provider the key also carries the owner. See
 * docs/lib/API.md, "storage".
 */
export function stackSignature(plain, { byOwner = false } = {}) {
  if (!isStackable(plain)) return null;
  // Coin identity is the KIND (name and rate together), not the rate alone,
  // and `coinKind` is its one statement. See docs/lib/DECISIONS.md,
  // "2026-08-14 — Money is physical; four rulings land at once". A coin row
  // that carries no stamp is the holder's own (`rowOwnerOf`), so a house pile
  // made before house rows were stamped is one owner's with the stamped one.
  if (isMoney(plain)) return `money|${byOwner ? rowOwnerOf(plain) : ""}|${coinKind(plain)}`;
  const owner = byOwner ? (storageFlagOf(plain)?.ownerUuid ?? "") : "";
  const own = plain.flags?.[LIB_ID] ?? {};
  // A container keeps its own row: merging two would leave the second's
  // contents pointing at a container id that is never created.
  if (own.container) return null;
  if (isInUse(plain)) return null;

  const wrapper = { system: structuredClone(plain.system ?? {}) };
  setPath(wrapper, quantityOf(plain).path, 0);
  // Sheet-computed, not identity: the system recalculates it on every render.
  if ("totalvalue" in wrapper.system) wrapper.system.totalvalue = 0;
  const flags = structuredClone(plain.flags ?? {});
  if (flags[LIB_ID]) {
    delete flags[LIB_ID][STORAGE_KEY];
    delete flags[LIB_ID][UNPACKED_FROM];
    delete flags[LIB_ID][SPLIT_FROM];
    delete flags[LIB_ID][THROWN_AWAY]; // a falsy mark is left over from a recovery
    for (const key of WEAR_LEFTOVERS) delete flags[LIB_ID][key];
    // A resting row's `wornAt` is empty (a set one returned above); an empty
    // one is no more a difference than a missing one.
    if (flags[LIB_ID].gear) {
      delete flags[LIB_ID].gear.wornAt;
      if (!Object.keys(flags[LIB_ID].gear).length) delete flags[LIB_ID].gear;
    }
  }
  // An arriving item has had keys removed from its flags (attribution, a
  // dangling container pointer), which can leave an emptied `{"acks-extras": {}}`
  // scope where a row that never travelled has none; an emptied scope must
  // not read as a difference.
  for (const [scope, value] of Object.entries(flags)) {
    if (value && typeof value === "object" && !Object.keys(value).length) delete flags[scope];
  }
  return `${plain.type}|${plain.name}|${plain.img ?? ""}|${owner}|${canon(wrapper.system)}|${canon(flags)}`;
}

/**
 * The slot a coin row stacks in: its signature and the container it is really
 * inside. `present` are the ids of the items it sits among — a pointer at a
 * container that is not one of them dangles, and the row reads as loose.
 */
function coinSlotKey(plain, present, { byOwner = false } = {}) {
  const signature = stackSignature(plain, { byOwner });
  if (signature === null) return null;
  const box = containedInOf(plain);
  return `${signature}|@${box && present.has(box) ? box : ""}`;
}

/** A copy of `plain` put inside `containerId`, or made loose when there is none. */
function inContainer(plain, containerId) {
  const copy = structuredClone(plain);
  copy.flags = { ...(copy.flags ?? {}), [EQUIPMENT_ID]: { ...(copy.flags?.[EQUIPMENT_ID] ?? {}) } };
  if (containerId) copy.flags[EQUIPMENT_ID][CONTAINED_IN] = containerId;
  else delete copy.flags[EQUIPMENT_ID][CONTAINED_IN];
  return copy;
}

/**
 * Fold arriving goods into rows that already exist, instead of duplicating a
 * stack the system's own (document-ID-based) drop-handler merge cannot match —
 * anything that has been through a transfer has a fresh id. See docs/lib/API.md,
 * "storage".
 *
 * Coin stacks by its kind AND where it is kept (`coinSlotKey`): an arriving
 * coin joins the row of its kind in the place it lands, and makes a row there
 * when there is none. It lands loose, or inside `coinInto` — a container among
 * the target's items — and a coin that travelled inside a container which came
 * along stays inside it.
 *
 * @param {object[]} creates arriving goods, as plain item data
 * @param {object[]} [targetItems] every item already on the target
 * @param {{byOwner?: boolean, coinInto?: string|null}} [opts] `byOwner` where
 *   the target keeps goods for owners; `coinInto` the container arriving coin
 *   is put inside
 * @returns {{creates: object[], targetUpdates: object[]}}
 */
export function planStackMerge(creates, targetItems = [], { byOwner = false, coinInto = null } = {}) {
  const present = new Set();
  const pointedAt = new Set();
  for (const item of [...targetItems, ...(creates ?? [])]) {
    if (item?._id) present.add(item._id);
    if (containedInOf(item)) pointedAt.add(containedInOf(item));
  }
  // A row some document is stored inside keeps its own row, as a container
  // does: merging it would leave the other document pointing at a row that is
  // never created, or at a row now holding more than it described.
  const slotKey = (plain) => {
    if (isMoney(plain)) return coinSlotKey(plain, present, { byOwner });
    return pointedAt.has(plain?._id) ? null : stackSignature(plain, { byOwner });
  };
  const into = coinInto && present.has(coinInto) ? coinInto : null;
  // Where an arriving coin row is put: left where it travelled, else inside
  // `coinInto`, else loose with a pointer at nothing taken off it.
  const placed = (create) => {
    if (!isMoney(create)) return create;
    const box = containedInOf(create);
    if (box && present.has(box)) return create;
    return box || into ? inContainer(create, into) : create;
  };

  const slots = new Map();
  for (const target of targetItems) {
    const key = slotKey(target);
    if (!key) continue;
    // A row kept for an owner takes only what arrives stamped as theirs. Where
    // the merge is not by owner the arrival is nobody's, and folding it into
    // such a row would hand it to whoever the row belongs to.
    if (!byOwner && storageFlagOf(target)?.ownerUuid) continue;
    // Two rows under one key are duplicates; the first takes what arrives.
    if (slots.has(key)) continue;
    const q = quantityOf(target);
    slots.set(key, { _id: target._id, path: q.path, quantity: num(q.value), merged: false });
  }

  const outCreates = [];
  const firstCreate = new Map();
  for (const arrival of creates ?? []) {
    const create = placed(arrival);
    const key = slotKey(create);
    if (!key) {
      outCreates.push(create);
      continue;
    }
    const arriving = quantityOf(create);
    const slot = slots.get(key);
    if (slot) {
      slot.quantity += num(arriving.value);
      slot.merged = true;
      continue;
    }
    // No matching row at the target yet: the first arrival becomes the row the
    // rest of this batch merges into, so stashing two gold stacks lands as one.
    const prior = firstCreate.get(key);
    if (prior) {
      setPath(prior, arriving.path, num(quantityOf(prior).value) + num(arriving.value));
      continue;
    }
    firstCreate.set(key, create);
    outCreates.push(create);
  }

  const targetUpdates = [];
  for (const slot of slots.values()) {
    if (slot.merged) targetUpdates.push({ _id: slot._id, [slot.path]: slot.quantity });
  }
  return { creates: outCreates, targetUpdates };
}

/**
 * A coin row emptied by a transfer is deleted rather than left as a 0 stack.
 * A row still carrying a balance in the system's banked field is kept: that
 * balance is not coin anyone holds, and deleting the row would destroy it
 * before the migration that moves it out has run.
 */
export function emptyMoneyDeletes(sourceUpdates, plainItems, sourceDeletes = []) {
  const byId = new Map((plainItems ?? []).map((i) => [i._id, i]));
  const updates = [];
  const deletes = [...sourceDeletes];
  for (const update of sourceUpdates ?? []) {
    const src = byId.get(update._id);
    const emptied = isMoney(src) && num(update["system.quantity"]) <= 0 && num(src.system?.quantitybank) <= 0;
    if (emptied) deletes.push(update._id);
    else updates.push(update);
  }
  return { sourceUpdates: updates, sourceDeletes: deletes };
}

/**
 * Fold duplicate coin rows together: rows of one kind, one owner and one
 * container (`coinSlotKey`) become the first of them. A folded row still
 * carrying a balance in the system's banked field is emptied and kept, as
 * `emptyMoneyDeletes` keeps one, and is not counted again once it is empty.
 * @param {object[]} plainItems every item on the holder, as plain data
 * @param {(plain: object) => boolean} [mine] which coin rows are folded
 * @returns {{updates: object[], deletes: string[], merged: number}} `merged`
 *   counts the rows folded away
 */
export function planCoinFold(plainItems, mine = () => true) {
  const items = plainItems ?? [];
  const present = new Set(items.map((i) => i._id));
  const kept = new Map();
  const updates = new Map();
  const deletes = [];
  let merged = 0;
  for (const row of items) {
    if (!isMoney(row) || !mine(row)) continue;
    const key = coinSlotKey(row, present, { byOwner: true });
    if (key === null) continue;
    const keep = kept.get(key);
    if (!keep) {
      kept.set(key, { _id: row._id, quantity: coinCount(row) });
      continue;
    }
    const count = coinCount(row);
    const banked = num(row.system?.quantitybank) > 0;
    if (banked && count <= 0) continue;
    merged += 1;
    if (count > 0) {
      keep.quantity += count;
      updates.set(keep._id, { _id: keep._id, "system.quantity": keep.quantity });
    }
    if (banked) updates.set(row._id, { _id: row._id, "system.quantity": 0 });
    else deletes.push(row._id);
  }
  return { updates: [...updates.values()], deletes, merged };
}

/**
 * Bucket stored items by whose they are. A missing owner uuid buckets under ""
 * so unattributed goods are visible rather than silently dropped from every view.
 * @returns {Map<string, {ownerUuid: string, ownerName: string, items: object[]}>}
 */
export function groupByOwner(plainItems) {
  const out = new Map();
  for (const item of plainItems ?? []) {
    const flag = storageFlagOf(item);
    const uuid = flag?.ownerUuid ?? "";
    if (!out.has(uuid)) out.set(uuid, { ownerUuid: uuid, ownerName: flag?.ownerName ?? "", items: [] });
    const bucket = out.get(uuid);
    if (!bucket.ownerName && flag?.ownerName) bucket.ownerName = flag.ownerName;
    bucket.items.push(item);
  }
  return out;
}
