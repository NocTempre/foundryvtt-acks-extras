/* global game, foundry, Hooks, ui, ChatMessage */
/**
 * Storage at a place — goods that belong to a character but are not on them.
 *
 * The system's item list is an actor's only inventory, and its drop handlers
 * COPY: they create on the target and never delete from the source. This file
 * is the one transfer primitive markets, banks and base camps share.
 *
 * Stored goods are real embedded items on a PROVIDER actor, stamped with whose
 * they are, so they do not weigh on the character and every reader of an
 * actor's items reads a place's stock unchanged. A provider is any actor
 * carrying `flags.acks-extras.storage.provider`; this file never names a
 * location type.
 *
 * Attribution (`ownerUuid`) is a UI convention, not a security boundary: a
 * player owning a shared place can reach every item on it from the console.
 * See docs/lib/DECISIONS.md, "Storage lands in the library, keyed on a flag
 * rather than a type".
 */
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import {
  HOUSE_OWNER,
  LIB_ID,
  STORAGE_KEY,
  buildTransferPayload,
  coinTotalGC,
  containedInOf,
  emptyMoneyDeletes,
  expandContainerClosure,
  groupByOwner,
  planCoinFold,
  planStackMerge,
  quantityOf,
  rowOwnerOf,
  splitSpec,
  stackSignature,
  storageFlagOf,
} from "./storage-logic.mjs";
import { isContainer, isGoods, isShutAway } from "./item-model.mjs";
import { gmIds, isPrimaryGM } from "./util.mjs";
import { isLeadClient } from "./automation-client.mjs";
import { ITEM_TYPE } from "./vocab.mjs";
import { coinCount, coinOrderOf, readStoreKey } from "./money-logic.mjs";

/**
 * `creditCoin` (money.mjs), reached when coin lands. money.mjs registers a
 * socket relay as it loads, and the offline suites import this file where no
 * socket exists, so the import waits for the call.
 */
const creditCoin = async (...args) => (await import("./money.mjs")).creditCoin(...args);

/**
 * The socket transport (sockets.mjs), reached when a move is handed to the
 * Judge's seat or the relay is registered; like `creditCoin`, its import waits
 * for the call.
 */
const transport = () => import("./sockets.mjs");

/** The socket handler that makes a move for a seat that may not write the place. */
const MOVE_HANDLER = "libMoveGoods";

// Re-export the Foundry-free half so consumers reach it all through
// `acksLib.storage`, while the pure half stays independently Node-importable.
export {
  buildTransferPayload,
  coinTotalGC,
  containedInOf,
  emptyMoneyDeletes,
  expandContainerClosure,
  groupByOwner,
  planCoinFold,
  planStackMerge,
  quantityOf,
  rowOwnerOf,
  splitSpec,
  stackSignature,
  storageFlagOf,
  STORAGE_KEY,
};

/** Custom hooks other modules key off. Namespaced per the family convention. */
export const STORAGE_HOOKS = Object.freeze({
  STASHED: "acksLibStorageStashed",
  RETRIEVED: "acksLibStorageRetrieved",
  MOVED: "acksLibStorageMoved",
  HANDED: "acksLibStorageHanded",
  RETURNED: "acksLibStorageReturned",
  LOST: "acksLibStorageLost",
  PROVIDER_CHANGED: "acksLibStorageProviderChanged",
});

/** The world setting deciding what happens to goods when their place is destroyed. */
export const DELETE_POLICY_SETTING = "storageDeletePolicy";

/* -------------------------------------------- */
/*  Providers                                    */
/* -------------------------------------------- */

/** Does this actor hold goods for other people? A flag read, never a type check. */
export const isProvider = (actor) => !!actor?.getFlag?.(MODULE_ID, STORAGE_KEY)?.provider;

/** The character a personal vault belongs to, or null for a shared place. */
export const vaultOwnerUuid = (actor) => actor?.getFlag?.(MODULE_ID, STORAGE_KEY)?.vaultOf ?? null;

/** Every provider in the world. */
export const providers = () => game.actors?.filter(isProvider) ?? [];

/** The personal vault of a character, if one has been made. */
export const findVaultOf = (ownerUuid) => providers().find((a) => vaultOwnerUuid(a) === ownerUuid) ?? null;

/**
 * Turn storage on (or off) for an actor. Enabling is all a cart, a stronghold or
 * a hireling's wagon needs to start holding goods.
 * @returns {Promise<boolean>} whether anything was written
 */
export async function setProvider(actor, enabled = true, { vaultOf = null } = {}) {
  if (!actor) return false;
  if (!actor.isOwner) {
    warn("notOwner");
    return false;
  }
  if (!enabled) {
    if (!actor.getFlag(MODULE_ID, STORAGE_KEY)) return false;
    await actor.unsetFlag(MODULE_ID, STORAGE_KEY);
    Hooks.callAll(STORAGE_HOOKS.PROVIDER_CHANGED, actor, false);
    return true;
  }
  const current = actor.getFlag(MODULE_ID, STORAGE_KEY) ?? {};
  await actor.setFlag(MODULE_ID, STORAGE_KEY, { ...current, provider: true, ...(vaultOf ? { vaultOf } : {}) });
  Hooks.callAll(STORAGE_HOOKS.PROVIDER_CHANGED, actor, true);
  return true;
}

/* -------------------------------------------- */
/*  Reading what is stored                       */
/* -------------------------------------------- */

/** Whose goods is this item? `{uuid, name}`, or null if it is not stored goods. */
export function ownerOf(item) {
  const flag = storageFlagOf(item);
  if (!flag) return null;
  return { uuid: flag.ownerUuid ?? null, name: flag.ownerName ?? "" };
}

/**
 * Resolve an owner uuid without awaiting, for render paths. A uuid that no
 * longer resolves (the character was deleted) returns null and callers fall back
 * to the stored `ownerName`.
 */
export function resolveActorSync(uuid) {
  if (typeof uuid !== "string") return null;
  const parts = uuid.split(".");
  if (parts[0] === "Actor") return game.actors?.get(parts[1]) ?? null;
  if (parts[0] === "Scene") return game.scenes?.get(parts[1])?.tokens?.get(parts[3])?.actor ?? null;
  return null;
}

/** The goods held at a provider — all of them, or one owner's. */
export function storedItems(provider, { ownerUuid = null } = {}) {
  const all = provider?.items?.filter((i) => !!storageFlagOf(i)) ?? [];
  return ownerUuid == null ? [...all] : all.filter((i) => storageFlagOf(i)?.ownerUuid === ownerUuid);
}

/** The goods at a provider, bucketed by whose they are. */
export const storesByOwner = (provider) => groupByOwner(storedItems(provider).map((i) => i.toObject()));

/**
 * Every place holding goods for this character, with a coin subtotal each.
 * Only GOODS count: a stored Item that is not goods (a market report) is not
 * something a character retrieves, so it never makes its place a row here.
 *
 * One scan over the world's actors: call it once per render and share the
 * result rather than per row.
 */
export function providersFor(owner) {
  const uuid = owner?.uuid;
  if (!uuid) return [];
  const out = [];
  for (const provider of providers()) {
    const items = storedItems(provider, { ownerUuid: uuid }).filter(isGoods);
    if (!items.length) continue;
    out.push({ provider, items, coinGC: coinTotalGC(items.map((i) => i.toObject())) });
  }
  return out;
}

/** Total coin this character has in storage, across every place. */
export const storedCoinGC = (owner) => providersFor(owner).reduce((sum, entry) => sum + entry.coinGC, 0);

/* -------------------------------------------- */
/*  Landing goods                                */
/* -------------------------------------------- */

/**
 * The one write that lands goods on an actor: each stackable folds into the
 * identical stack already there and the rest are created (`planStackMerge`).
 * A transfer, a place stocked from a shelf, a delivery and a coin credit all
 * land through it, so they cannot disagree about which row an arrival joins.
 * Creates go before updates; either order lands the same rows.
 *
 * @param {Actor} actor
 * @param {object[]} arrivals plain item data
 * @param {{byOwner?: boolean, coinInto?: string|null, keepId?: boolean}} [opts]
 *   `byOwner` where the actor keeps goods for owners; `coinInto` the container
 *   arriving coin is put inside; `keepId` where the arrivals carry ids that
 *   other arrivals point at
 * @returns {Promise<{created: Item[], updated: Item[]}>}
 */
export async function landGoods(actor, arrivals, { byOwner = false, coinInto = null, keepId = false } = {}) {
  const plan = planStackMerge(arrivals, actor.items.map((i) => i.toObject()), { byOwner, coinInto });
  const created = plan.creates.length ? ((await actor.createEmbeddedDocuments("Item", plan.creates, keepId ? { keepId: true } : {})) ?? []) : [];
  const updated = plan.targetUpdates.length ? ((await actor.updateEmbeddedDocuments("Item", plan.targetUpdates)) ?? []) : [];
  return { created, updated };
}

/**
 * May coin be put inside `box`, a container `holder` carries? Not while a lock
 * shuts it or anything it sits inside, and not where it names the kinds it
 * takes and coin is not one. The kinds are the equipment feature's to answer;
 * it is asked through the namespace, and a world without it takes coin.
 */
export function coinMayEnter(holder, box) {
  if (!box || !isContainer(box) || isShutAway(box, holder?.items)) return false;
  try {
    return globalThis.acksExtras?.equipment?.canStore?.(holder, { type: ITEM_TYPE.money, name: "" }, box)?.ok !== false;
  } catch {
    return true;
  }
}

/**
 * The carried container a holder's arriving coin is put inside, or null for
 * loose: the container their coin order names (`coinOrderOf`), while it is
 * theirs, on them and takes coin. A place named there is not an answer here —
 * coin handed to a holder lands on the holder.
 * @returns {string|null} the container's item id
 */
export function coinContainerOf(holder) {
  const named = readStoreKey(coinOrderOf(holder).receiveInto);
  if (named.kind !== "container") return null;
  const box = holder?.items?.get?.(named.id) ?? null;
  return box && rowOwnerOf(box) === HOUSE_OWNER && coinMayEnter(holder, box) ? box.id : null;
}

/* -------------------------------------------- */
/*  Moving goods                                 */
/* -------------------------------------------- */

/**
 * The one transfer path: plan everything first, then write.
 *
 * Creates on the target land before deletes on the source, so a half-finished
 * transfer duplicates an item and never destroys one. If the source half fails
 * the created items are deleted again; if that fails too the player is told and
 * the manifest goes to the console.
 *
 * At most four server round-trips (create, merge-update, source update, source
 * delete) whatever the size of the move, which keeps the system's derived-data
 * encumbrance write (`computeEncumbrance` persists `system.encumbrance.max`)
 * to a minimum.
 *
 * A seat that owns the character's end of a deposit or a retrieval and not the
 * place's hands the whole move to the Judge's seat (`askJudge`), which plans it
 * again from the same arguments.
 *
 * @param {object} [opts]
 * @param {string} [opts.relay] the move a seat may hand to the Judge: "stash" or "retrieve"
 * @param {boolean} [opts.quiet] refuse by result alone; the asking seat says why
 * @param {string|null} [opts.userId] the user the move is made for, where another seat makes it
 * @returns {Promise<{ok: boolean, manifest?: object[], reason?: string}>}
 */
async function transfer(source, target, spec, { hook, stampOwner, preserveOwner = false, relay = null, quiet = false, userId = null } = {}) {
  if (!source || !target) return { ok: false, reason: "missing" };
  if (source.uuid === target.uuid) return { ok: false, reason: "same" };
  const refuse = (reason) => {
    if (!quiet) warn(REFUSALS[reason]);
    return { ok: false, reason };
  };

  // A synthetic actor's uuid dies with its token, so a move that stamps an owner
  // refuses a token's own actor at either end; a move that stamps nothing
  // crosses freely. Linked tokens are the world actor either way.
  if (stampOwner && (source.isToken || target.isToken)) return refuse("token");
  if (!source.isOwner || !target.isOwner) {
    const mine = relay === "stash" ? source : relay === "retrieve" ? target : null;
    if (mine?.isOwner && !game.user?.isGM) return askJudge(relay, source, target, spec);
    return refuse("permission");
  }

  const ownerActor = stampOwner ? (preserveOwner ? null : source) : target;
  const plainItems = source.items.map((i) => i.toObject());
  const planned = buildTransferPayload(plainItems, spec, {
    ownerUuid: ownerActor?.uuid ?? null,
    ownerName: ownerActor?.name ?? "",
    stampOwner,
    preserveOwner,
    newId: () => foundry.utils.randomID(),
  });

  const tidied = emptyMoneyDeletes(planned.sourceUpdates, plainItems, planned.sourceDeletes);

  // Read before the landing is planned, which folds arriving stacks together.
  const manifest = planned.creates.map((c) => ({
    name: c.name,
    type: c.type,
    quantity: quantityOf(c)?.value ?? 1,
    coppervalue: c.system?.coppervalue ?? null,
  }));
  if (!manifest.length) return refuse("empty");

  // Coin handed to a holder goes where they keep arriving coin; goods kept for
  // an owner at a place are put where the move put them.
  let created = [];
  try {
    ({ created } = await landGoods(target, planned.creates, {
      byOwner: stampOwner,
      coinInto: stampOwner ? null : coinContainerOf(target),
      keepId: true,
    }));
  } catch (err) {
    console.error(`${MODULE_ID} | storage transfer failed before anything moved`, err, manifest);
    return refuse("create");
  }

  try {
    if (tidied.sourceUpdates.length) await source.updateEmbeddedDocuments("Item", tidied.sourceUpdates);
    if (tidied.sourceDeletes.length) await source.deleteEmbeddedDocuments("Item", tidied.sourceDeletes);
  } catch (err) {
    console.error(`${MODULE_ID} | storage transfer failed after arrival — compensating`, err, manifest);
    try {
      if (created.length) await target.deleteEmbeddedDocuments("Item", created.map((d) => d.id));
    } catch (undoErr) {
      // Both halves failed: the goods exist twice. Say so on the seat that wrote.
      console.error(`${MODULE_ID} | compensation failed; goods are duplicated`, undoErr, manifest);
      ui.notifications?.error(loc("storage.duplicated", { name: target.name }));
      return { ok: false, reason: "duplicated" };
    }
    return refuse("source");
  }

  const payload = {
    sourceUuid: source.uuid,
    targetUuid: target.uuid,
    ownerUuid: ownerActor?.uuid ?? null,
    ownerName: ownerActor?.name ?? "",
    manifest,
    userId: userId ?? game.user?.id,
  };
  // hook-ok: one of STORAGE_HOOKS, passed by the wrappers below
  Hooks.callAll(hook, payload);
  return { ok: true, manifest };
}

/** Character → place. The goods leave the character entirely. */
export async function stash(source, provider, spec) {
  if (!isProvider(provider)) {
    warn("notProvider");
    return { ok: false, reason: "notProvider" };
  }
  return transfer(source, provider, spec, { hook: STORAGE_HOOKS.STASHED, stampOwner: true, relay: "stash" });
}

/** Place → character. Attribution is dropped; you own what you carry. */
export const retrieve = (provider, target, spec) =>
  transfer(provider, target, spec, { hook: STORAGE_HOOKS.RETRIEVED, stampOwner: false, relay: "retrieve" });

/* -------------------------------------------- */
/*  A move the seat cannot write alone           */
/* -------------------------------------------- */

/**
 * Hand a deposit or a retrieval to the Judge's seat, where this seat owns the
 * character and may not write the place. A refusal is said here, from the
 * answer; with no Judge connected the transport says so itself.
 * @returns {Promise<{ok: boolean, manifest?: object[], reason?: string}>}
 */
async function askJudge(kind, source, target, spec) {
  const { executeAsGM } = await transport();
  const answer = (await executeAsGM(MOVE_HANDLER, { kind, sourceUuid: source.uuid, targetUuid: target.uuid, spec })) ?? { ok: false, reason: "noGm" };
  if (answer.ok || answer.reason === "noGm") return answer;
  if (answer.reason === "outOfReach") {
    ui.notifications?.warn(game.i18n.format(`${LANG_PREFIX}.money.reach.${answer.why}`, { who: source.name, place: target.name, scene: answer.scene ?? "" }));
  } else if (answer.reason === "duplicated") ui.notifications?.error(loc("storage.duplicated", { name: target.name }));
  else warn(REFUSALS[answer.reason] ?? "moveFailed");
  return answer;
}

/**
 * May a seat that does not own this place take this row from it for
 * `claimant`? A row kept there for that character, and a row of the place's
 * own that the Judge marked retrievable.
 */
const takeableBy = (row, claimant) =>
  !!row && (rowOwnerOf(row) === claimant.uuid || (rowOwnerOf(row) === HOUSE_OWNER && !!storageFlagOf(row)?.retrievable));

/**
 * The move `askJudge` asked for, made on the Judge's seat. A relayed call
 * (`requestUserId`, set by `lib/sockets.mjs`) is made only for a sender who
 * owns the character. A deposit must be within that character's reach of the
 * place, as the location feature answers it; a retrieval takes only rows
 * `takeableBy` the character, from wherever they stand.
 * @returns {Promise<{ok: boolean, manifest?: object[], reason?: string, why?: string, scene?: string}>}
 */
async function moveForSeat({ kind, sourceUuid, targetUuid, spec, requestUserId = null } = {}) {
  const source = resolveActorSync(sourceUuid);
  const target = resolveActorSync(targetUuid);
  if (!source || !target) return { ok: false, reason: "missing" };
  const sender = requestUserId ? game.users.get(requestUserId) : null;
  const owns = (actor) => !requestUserId || (!!sender && actor.testUserPermission(sender, "OWNER"));
  const made = { quiet: true, userId: requestUserId };

  if (kind === "stash") {
    if (!owns(source)) return { ok: false, reason: "permission" };
    if (!isProvider(target)) return { ok: false, reason: "notProvider" };
    const reach = globalThis.acksExtras?.location?.reach?.depositReach?.(source, target);
    if (reach && !reach.can) return { ok: false, reason: "outOfReach", why: reach.reason, scene: reach.scene?.name ?? "" };
    return transfer(source, target, spec, { hook: STORAGE_HOOKS.STASHED, stampOwner: true, ...made });
  }
  if (kind === "retrieve") {
    if (!owns(target) || !isProvider(source)) return { ok: false, reason: "permission" };
    const asked = (spec ?? []).map((entry) => (typeof entry === "string" ? entry : entry?.id));
    if (!asked.every((id) => takeableBy(source.items.get(id), target))) return { ok: false, reason: "permission" };
    return transfer(source, target, spec, { hook: STORAGE_HOOKS.RETRIEVED, stampOwner: false, ...made });
  }
  return { ok: false, reason: "permission" };
}

/** Register the Judge's half of a relayed deposit or retrieval — once, at init. */
export async function registerStorageRelay() {
  const { registerHandler } = await transport();
  registerHandler(MOVE_HANDLER, moveForSeat);
}

/**
 * Place → place, keeping each item's existing attribution.
 */
export const moveStored = (from, to, spec) =>
  transfer(from, to, spec, { hook: STORAGE_HOOKS.MOVED, stampOwner: true, preserveOwner: true });

/**
 * Character → character. Attribution is dropped, as in `retrieve`. The stack
 * leaves the giver and merges into the receiver's row of the same kind. Either
 * end may be a token's own actor, since nothing is stamped. Both seats must be
 * owned by whoever drags (`transfer`'s own check).
 */
export const handOver = (from, to, spec) =>
  transfer(from, to, spec, { hook: STORAGE_HOOKS.HANDED, stampOwner: false });

/**
 * Goods that come from nobody — a compendium, the sidebar — are put at a
 * provider under an owner, each stack folding into that owner's identical
 * one. They are STAMPED on the way in: an unflagged row sits at the place
 * invisibly, because `storedItems` lists only attributed goods.
 * @param {Actor} provider
 * @param {object[]} goods arrival-shaped plain item data
 * @param {{ownerUuid: string, ownerName?: string}} owner whose they become
 * @returns {Promise<{created: number, merged: number}>}
 */
export async function stockProvider(provider, goods, { ownerUuid, ownerName = "" } = {}) {
  const stamped = (goods ?? []).map((g) => ({
    ...g,
    flags: { ...(g.flags ?? {}), [LIB_ID]: { ...(g.flags?.[LIB_ID] ?? {}), [STORAGE_KEY]: { ownerUuid, ownerName } } },
  }));
  const landed = await landGoods(provider, stamped, { byOwner: true });
  return { created: landed.created.length, merged: landed.updated.length };
}

/* -------------------------------------------- */
/*  Coin helpers                                 */
/* -------------------------------------------- */

/**
 * Put coin at a provider for an owner, merging into that owner's row of the
 * same kind (`creditCoin`). `source` — a coin row's plain data — says which
 * coin it is and is what a new row is copied from; without one the coin is
 * known by `name` and `coppervalue`, or by its rate alone. Not idempotent:
 * callers that must not double-credit (the vault sweep) carry their own ledger.
 * @returns {Promise<boolean>} whether any coin landed
 */
export async function depositCoin(provider, { ownerUuid, ownerName = "", coppervalue = 100, quantity = 0, name = null, source = null } = {}) {
  if (!provider || !(quantity > 0)) return false;
  const credit = source ? { source, count: quantity } : { cv: Number(coppervalue), count: quantity, ...(name ? { name } : {}) };
  const done = await creditCoin(provider, [credit], { ownerUuid, ownerName });
  return done.updates + done.creates > 0;
}

/**
 * Fold one owner's duplicate coin rows on a holder together (`planCoinFold`):
 * rows of one kind kept in one place become one row. `ownerUuid` names whose
 * rows are folded; the holder's own when none is given.
 * @returns {Promise<{merged: number}>} how many rows were folded away
 */
export async function consolidateMoney(holder, ownerUuid = null) {
  const owner = ownerUuid ?? HOUSE_OWNER;
  const plan = planCoinFold(holder.items.map((i) => i.toObject()), (row) => rowOwnerOf(row) === owner);
  if (plan.updates.length) await holder.updateEmbeddedDocuments("Item", plan.updates);
  if (plan.deletes.length) await holder.deleteEmbeddedDocuments("Item", plan.deletes);
  return { merged: plan.merged };
}

/* -------------------------------------------- */
/*  When a place is destroyed                    */
/* -------------------------------------------- */

/** What happens to stored goods when their place is deleted: return | lose. */
export const deletePolicy = () => {
  try {
    return game.settings?.get(MODULE_ID, DELETE_POLICY_SETTING) ?? "return";
  } catch {
    return "return";
  }
};

/**
 * Hand one character's goods back, gathered into a container named after the
 * place they were kept.
 *
 * Coin does not go in the container: it merges into the character's own coin
 * rows, since the system's totals only see loose money items.
 *
 * The container is a plain system `item` weighing nothing, flagged as one of the
 * equipment feature's containers; that vocabulary is read and written, never
 * imported. Never put the nesting behind an `equipment` guard: the undeclared
 * identifier throws on every non-coin item and the caller's try/catch hides it.
 */
export async function returnGoodsTo(owner, plainGoods, { containerName = "Storage" } = {}) {
  if (!owner || !plainGoods?.length) return { ok: false };
  const coin = plainGoods.filter((g) => g.type === ITEM_TYPE.money);
  const goods = plainGoods.filter((g) => g.type !== ITEM_TYPE.money);

  let containerId = null;
  if (goods.length) {
    const container = {
      name: containerName,
      type: "item",
      img: "icons/svg/chest.svg",
      system: { subtype: "item", cost: 0, weight6: 0, quantity: { value: 1, max: 0 } },
      flags: { "acks-extras": { container: { capacity: 0 } } },
    };
    const [made] = await owner.createEmbeddedDocuments("Item", [container]);
    containerId = made?.id ?? null;
  }

  // Fresh ids up front: goods nested in a stashed container point at its old
  // item id, which dies with the place, so the chain is remapped as a transfer
  // does. Goods whose container did not come back go into the returned one.
  const idMap = new Map(goods.map((g) => [g._id, foundry.utils.randomID()]));
  const arrivals = goods.map((g) => {
    const copy = foundry.utils.deepClone(g);
    copy._id = idMap.get(g._id);
    if (copy.system && "equipped" in copy.system) copy.system.equipped = false;
    copy.flags = { ...copy.flags };
    if (copy.flags[LIB_ID]) {
      copy.flags[LIB_ID] = { ...copy.flags[LIB_ID] };
      delete copy.flags[LIB_ID][STORAGE_KEY];
    }
    const parent = containedInOf(copy);
    // Its original container if that came back too, else the one made here.
    const nest = idMap.get(parent) ?? containerId;
    if (nest) copy.flags["acks-extras"] = { ...copy.flags["acks-extras"], containedIn: nest };
    else if (copy.flags["acks-extras"]) {
      copy.flags["acks-extras"] = { ...copy.flags["acks-extras"] };
      delete copy.flags["acks-extras"].containedIn;
    }
    return copy;
  });
  if (arrivals.length) await owner.createEmbeddedDocuments("Item", arrivals, { keepId: true });

  // Coin lands on the character's row of the same kind and on their person
  // (`within: "hand"`), not at another place that keeps coin for them.
  await creditCoin(owner, coin.map((c) => ({ source: c, count: coinCount(c) })), { within: "hand" });
  return { ok: true, containerId };
}

/**
 * Register the cleanup for a place holding goods that is deleted: the world
 * setting (`deletePolicy`) decides between handing the goods back and losing
 * them. The manifest is posted before anything moves.
 */
export function registerStorageCleanup() {
  Hooks.on("deleteActor", async (doc, options, userId) => {
    try {
      if (game.system?.id !== "acks") return;
      if (!isProvider(doc)) return;

      // One window does the work: every GM window sees this hook and the cleanup
      // creates documents. With no GM online, the deleting user's elected window.
      if (game.users?.activeGM) {
        if (!isPrimaryGM()) return;
      } else if (userId !== game.user?.id || !isLeadClient()) return;

      const goods = doc.items.filter((i) => !!storageFlagOf(i) && isGoods(i));
      if (!goods.length) return;

      const buckets = groupByOwner(goods.map((i) => i.toObject()));
      const policy = deletePolicy();
      const lines = [];

      for (const bucket of buckets.values()) {
        const who = resolveActorSync(bucket.ownerUuid)?.name || bucket.ownerName || "—";
        lines.push(`<li><b>${who}</b>: ${bucket.items.map((i) => i.name).join(", ")}</li>`);
      }
      const returning = policy === "return";
      await ChatMessage.create({
        content: `<p><b>${loc(returning ? "storage.returnedTitle" : "storage.lostTitle", { place: doc.name })}</b></p><ul>${lines.join("")}</ul>`,
        whisper: gmIds(),
      });

      for (const bucket of buckets.values()) {
        const owner = resolveActorSync(bucket.ownerUuid);
        if (returning && owner) {
          await returnGoodsTo(owner, bucket.items, { containerName: doc.name });
          Hooks.callAll(STORAGE_HOOKS.RETURNED, { ownerUuid: bucket.ownerUuid, place: doc.name, manifest: bucket.items });
          continue;
        }
        // Lost: the policy says so, or the owner is gone too.
        Hooks.callAll(STORAGE_HOOKS.LOST, {
          ownerUuid: bucket.ownerUuid,
          ownerName: bucket.ownerName,
          place: doc.name,
          manifest: bucket.items,
        });
      }
    } catch (err) {
      console.error(`${MODULE_ID} | storage cleanup failed for "${doc?.name}"`, err);
    }
  });
}

/* -------------------------------------------- */
/*  Localisation                                 */
/* -------------------------------------------- */

function loc(key, data = {}) {
  const full = `${LANG_PREFIX}.${key}`;
  return game.i18n?.has?.(full) ? game.i18n.format(full, data) : full;
}

function warn(key, data = {}) {
  ui.notifications?.warn(loc(`storage.${key}`, data));
}

/** The warning each refusal of a move is said with, by its `reason`. */
const REFUSALS = Object.freeze({
  token: "tokenActor",
  permission: "notOwner",
  empty: "nothingToMove",
  create: "moveFailed",
  source: "moveFailed",
  missing: "moveFailed",
  notProvider: "notProvider",
});
