/**
 * The Foundry-FREE half of location storage: everything that decides WHAT a
 * transfer does, split out so it imports under Node and is unit-tested offline
 * (the same split as group-logic.mjs vs group.mjs). storage.mjs re-exports these
 * and adds the document writes around them.
 *
 * Every function here works on PLAIN item data — `item.toObject()` results — and
 * returns plans, never side effects. Nothing dereferences a Foundry global.
 *
 * Two vocabularies are read here that this library does not own:
 *
 *  - `system.quantity` has two shapes in the system: `money` stores a bare
 *    number, `item` a `{value, max}` schema, and `weapon`/`armor` have none at
 *    all. `quantityOf` is the one place that difference is resolved, and it
 *    reads the SHAPE rather than the type name (item-model.mjs philosophy).
 *  - `flags.acks-equipment.containedIn` is acks-equipment's documented container
 *    pointer. It is READ (and rewritten) generically so a container stashed at a
 *    location takes its contents along; acks-lib never imports that module and
 *    the behaviour simply does not trigger when it is absent.
 */

/** The flag scope/key attribution lives under, on both providers and stored items. */
export const LIB_ID = "acks-lib";
export const STORAGE_KEY = "storage";

/** acks-equipment's container pointer — read generically, never imported. */
const EQUIPMENT_ID = "acks-equipment";
const CONTAINED_IN = "containedIn";

const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const isMoney = (plain) => plain?.type === "money";

/* -------------------------------------------- */
/*  Reading the two foreign vocabularies         */
/* -------------------------------------------- */

/**
 * Where this item keeps its stack size, and how big the stack is.
 * @returns {{value: number, path: string}|null} null when the item does not
 *   stack at all (weapon, armor) — those always move whole.
 */
export function quantityOf(plain) {
  const sys = plain?.system;
  if (!sys) return null;
  if (typeof sys.quantity === "number") return { value: sys.quantity, path: "system.quantity" };
  if (sys.quantity && typeof sys.quantity === "object" && Number.isFinite(Number(sys.quantity.value))) {
    return { value: Number(sys.quantity.value), path: "system.quantity.value" };
  }
  return null;
}

/** The container this item is inside, per acks-equipment. Null when loose. */
export const containedInOf = (plain) => plain?.flags?.[EQUIPMENT_ID]?.[CONTAINED_IN] ?? null;

/** The attribution stamped on a stored item: whose goods these are. */
export const storageFlagOf = (plain) => plain?.flags?.[LIB_ID]?.[STORAGE_KEY] ?? null;

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
  if (!q) return { move: 1, remain: 0, whole: true, path: null };
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

function setPath(obj, path, value) {
  const parts = path.split(".");
  let node = obj;
  for (let i = 0; i < parts.length - 1; i++) node = node[parts[i]] ??= {};
  node[parts.at(-1)] = value;
}

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
 * The arriving copies are NORMALISED, because state that was true on the source
 * is not true at the destination:
 *  - nothing arrives equipped (you cannot wield a sword you left in a vault);
 *  - `quantitybank` is zeroed — the bank field is retired, storage replaces it;
 *  - `containedIn` is remapped through the new ids when the container came
 *    along, and stripped when it did not (the pointer would dangle);
 *  - attribution is stamped when the target stores goods for someone, preserved
 *    on provider→provider moves so consolidation does not launder ownership,
 *    and stripped when goods land back on a character (who owns their own).
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

  const plans = new Map();
  for (const [id, requested] of readSpec(spec, byId)) {
    const plan = splitSpec(byId.get(id), requested);
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
    if (plan.whole) sourceDeletes.push(id);
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

/**
 * The merge identity of a stack — what makes two rows "the same thing", so
 * splitting a stack and putting it back gives you one row rather than two.
 * Returns null for anything that must keep its own row.
 *
 * Coin is keyed on DENOMINATION rather than a full comparison: two gold pieces
 * are the same money whatever their art or where they came from.
 *
 * Everything else is keyed on the whole document minus the quantity — same
 * type, name, art, system data and flags. That is strict on purpose: a torch
 * with a dent in it, a torch inside a backpack and a plain torch are three
 * different rows, and an item carrying its own Active Effects never merges at
 * all. Over-merging silently destroys data; under-merging is a tidy-up.
 *
 * At a provider the key also carries the owner, so two characters' goods stay
 * two rows.
 */
export function stackSignature(plain, { byOwner = false } = {}) {
  if (!quantityOf(plain)) return null; // unstackable: weapons, armour
  const owner = byOwner ? (storageFlagOf(plain)?.ownerUuid ?? "") : "";
  if (isMoney(plain)) return `money|${owner}|${num(plain.system?.coppervalue, 1)}`;
  if (plain.effects?.length) return null;

  const wrapper = { system: structuredClone(plain.system ?? {}) };
  setPath(wrapper, quantityOf(plain).path, 0);
  // Sheet-computed, not identity: the system recalculates it on every render.
  if ("totalvalue" in wrapper.system) wrapper.system.totalvalue = 0;
  const flags = structuredClone(plain.flags ?? {});
  if (flags[LIB_ID]) delete flags[LIB_ID][STORAGE_KEY];
  // An arriving item has had keys REMOVED from its flags (the attribution, and
  // a container pointer that would dangle), which leaves `{"acks-lib": {}}`
  // where a row that never travelled simply has no such scope. Those are the
  // same item, so an emptied scope must not read as a difference.
  for (const [scope, value] of Object.entries(flags)) {
    if (value && typeof value === "object" && !Object.keys(value).length) delete flags[scope];
  }
  return `${plain.type}|${plain.name}|${plain.img ?? ""}|${owner}|${canon(wrapper.system)}|${canon(flags)}`;
}

/**
 * Fold arriving goods into rows that already exist, instead of adding a second
 * "Gold" (or a second half-stack of torches).
 *
 * The system's own drop handler merges on document ID, which only works for
 * items sharing an id lineage — anything that has been through a transfer has a
 * fresh id, so the merge has to be by identity here.
 *
 * @returns {{creates: object[], targetUpdates: object[]}}
 */
export function planStackMerge(creates, targetItems = [], { byOwner = false } = {}) {
  const slots = new Map();
  for (const target of targetItems) {
    const key = stackSignature(target, { byOwner });
    if (!key || slots.has(key)) continue;
    const q = quantityOf(target);
    slots.set(key, { _id: target._id, path: q.path, quantity: num(q.value), merged: false });
  }

  const outCreates = [];
  const firstCreate = new Map();
  for (const create of creates ?? []) {
    const key = stackSignature(create, { byOwner });
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
 * Both halves must be empty: a row with coin still in the (retired) bank field
 * is left alone for the vault sweep to find.
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

/** Total value of coin rows in gold, the way the system counts it (100cp = 1gp). */
export function coinTotalGC(moneyItems) {
  let copper = 0;
  for (const m of moneyItems ?? []) {
    if (!isMoney(m)) continue;
    copper += num(m.system?.quantity) * num(m.system?.coppervalue, 1);
  }
  return copper / 100;
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
