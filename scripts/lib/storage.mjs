/* global game, foundry, Hooks, ui, ChatMessage */
/**
 * Storage at a place — goods that belong to a character but are not on them.
 *
 * The system has no concept of an inventory anywhere except an actor's own item
 * list, and no way to move an item from one actor to another at all (its drop
 * handlers COPY: they create on the target and never delete from the source).
 * Markets, banks, base camps and "leave it at the inn" all need the same missing
 * primitive, so it lands here once rather than in whichever module needed it
 * first.
 *
 * THE MODEL: stored goods are REAL EMBEDDED ITEMS on a PROVIDER actor, stamped
 * with whose they are. That choice is what makes the rest work — the goods stop
 * weighing on the character (they are not on the character), every sheet and
 * macro that reads an actor's items reads a location's stock unchanged, and
 * nothing has to be kept in sync with a parallel record of what is really where.
 *
 * A PROVIDER is any actor carrying `flags.acks-lib.storage.provider`. This
 * library deliberately does not know what a "location" is: acks-location's
 * settlement, acks-henchmen's market actor, and the carts and wagons a later
 * pass turns into base camps are all just actors with the flag. Storage is
 * type-agnostic on purpose.
 *
 * ATTRIBUTION IS A UI CONVENTION, NOT A SECURITY BOUNDARY. `ownerUuid` says
 * whose goods these are so the sheets can group and gate them; a player with
 * ownership of a shared location can still reach every item on it from the
 * console, exactly as they can with acks-equipment's containers (that module's
 * MODEL.md makes the same ruling — anything that must genuinely stay secret
 * belongs on a GM-owned actor).
 */
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import {
  LIB_ID,
  STORAGE_KEY,
  buildTransferPayload,
  coinTotalGC,
  containedInOf,
  emptyMoneyDeletes,
  expandContainerClosure,
  groupByOwner,
  planStackMerge,
  quantityOf,
  splitSpec,
  stackSignature,
  storageFlagOf,
} from "./storage-logic.mjs";
import { isPhysical } from "./item-model.mjs";

// Re-export the Foundry-free half so consumers reach it all through
// `acksLib.storage`, while the pure half stays independently Node-importable.
export {
  buildTransferPayload,
  coinTotalGC,
  containedInOf,
  emptyMoneyDeletes,
  expandContainerClosure,
  groupByOwner,
  planStackMerge,
  quantityOf,
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
  RETURNED: "acksLibStorageReturned",
  LOST: "acksLibStorageLost",
  PROVIDER_CHANGED: "acksLibStorageProviderChanged",
});

/** The world setting deciding what happens to goods when their place is destroyed. */
export const DELETE_POLICY_SETTING = "storageDeletePolicy";

/* -------------------------------------------- */
/*  Providers                                    */
/* -------------------------------------------- */

/**
 * Does this actor hold goods for other people? A flag read, not a type check —
 * see the header: the library does not know what a location is.
 */
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
 * Resolve an owner uuid without awaiting — render paths cannot. A uuid that no
 * longer resolves (the character was deleted) returns null and callers fall back
 * to the stored `ownerName`, which is exactly why that name is stored.
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
 *
 * One pass over the world's actors. Cheap at world scale, but it is a scan —
 * call it once per render and share the result rather than per row.
 */
export function providersFor(owner) {
  const uuid = owner?.uuid;
  if (!uuid) return [];
  const out = [];
  for (const provider of providers()) {
    const items = storedItems(provider, { ownerUuid: uuid });
    if (!items.length) continue;
    out.push({ provider, items, coinGC: coinTotalGC(items.map((i) => i.toObject())) });
  }
  return out;
}

/** Total coin this character has in storage, across every place. */
export const storedCoinGC = (owner) => providersFor(owner).reduce((sum, entry) => sum + entry.coinGC, 0);

/* -------------------------------------------- */
/*  Moving goods                                 */
/* -------------------------------------------- */

/**
 * The one transfer path: plan everything first, then write.
 *
 * ORDER MATTERS AND IS DELIBERATE. Creates on the target land BEFORE deletes on
 * the source, so the failure mode of a half-finished transfer is a duplicated
 * item, never a destroyed one. If the source half then fails we compensate by
 * deleting what we just created; if even that fails the player is told loudly
 * and the manifest goes to the console. Goods are never silently lost.
 *
 * There are at most four server round-trips (create, merge-update, source
 * update, source delete) whatever the size of the move, which also keeps us
 * clear of the system's derived-data encumbrance write: `computeEncumbrance`
 * persists `system.encumbrance.max` during preparation, and the fewer separate
 * item writes a transfer makes, the fewer times that runs.
 *
 * @returns {Promise<{ok: boolean, manifest?: object[], reason?: string}>}
 */
async function transfer(source, target, spec, { hook, stampOwner, preserveOwner = false } = {}) {
  if (!source || !target) return { ok: false, reason: "missing" };
  if (source.uuid === target.uuid) return { ok: false, reason: "same" };

  // A synthetic actor's uuid dies with its token, so goods stamped with one
  // would be unreturnable. Linked tokens are the world actor and pass fine.
  if (source.isToken || target.isToken) {
    warn("tokenActor");
    return { ok: false, reason: "token" };
  }
  if (!source.isOwner || !target.isOwner) {
    warn("notOwner");
    return { ok: false, reason: "permission" };
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

  const merged = planStackMerge(
    planned.creates,
    target.items.map((i) => i.toObject()),
    { byOwner: stampOwner },
  );
  const tidied = emptyMoneyDeletes(planned.sourceUpdates, plainItems, planned.sourceDeletes);

  const manifest = planned.creates.map((c) => ({
    name: c.name,
    type: c.type,
    quantity: quantityOf(c)?.value ?? 1,
    coppervalue: c.system?.coppervalue ?? null,
  }));
  if (!manifest.length) {
    warn("nothingToMove");
    return { ok: false, reason: "empty" };
  }

  let created = [];
  try {
    if (merged.creates.length) {
      created = await target.createEmbeddedDocuments("Item", merged.creates, { keepId: true });
    }
    if (merged.targetUpdates.length) await target.updateEmbeddedDocuments("Item", merged.targetUpdates);
  } catch (err) {
    console.error(`${MODULE_ID} | storage transfer failed before anything moved`, err, manifest);
    warn("moveFailed");
    return { ok: false, reason: "create" };
  }

  try {
    if (tidied.sourceUpdates.length) await source.updateEmbeddedDocuments("Item", tidied.sourceUpdates);
    if (tidied.sourceDeletes.length) await source.deleteEmbeddedDocuments("Item", tidied.sourceDeletes);
  } catch (err) {
    console.error(`${MODULE_ID} | storage transfer failed after arrival — compensating`, err, manifest);
    try {
      if (created.length) await target.deleteEmbeddedDocuments("Item", created.map((d) => d.id));
      warn("moveFailed");
    } catch (undoErr) {
      // Both halves failed: the goods exist twice. Say so — a duplicate the
      // player knows about is recoverable, a silent one is not.
      console.error(`${MODULE_ID} | compensation failed; goods are duplicated`, undoErr, manifest);
      ui.notifications?.error(loc("storage.duplicated", { name: target.name }));
    }
    return { ok: false, reason: "source" };
  }

  const payload = {
    sourceUuid: source.uuid,
    targetUuid: target.uuid,
    ownerUuid: ownerActor?.uuid ?? null,
    ownerName: ownerActor?.name ?? "",
    manifest,
    userId: game.user?.id,
  };
  Hooks.callAll(hook, payload);
  return { ok: true, manifest };
}

/** Character → place. The goods leave the character entirely. */
export async function stash(source, provider, spec) {
  if (!isProvider(provider)) {
    warn("notProvider");
    return { ok: false, reason: "notProvider" };
  }
  return transfer(source, provider, spec, { hook: STORAGE_HOOKS.STASHED, stampOwner: true });
}

/** Place → character. Attribution is dropped; you own what you carry. */
export const retrieve = (provider, target, spec) =>
  transfer(provider, target, spec, { hook: STORAGE_HOOKS.RETRIEVED, stampOwner: false });

/**
 * Place → place, keeping each item's existing attribution — consolidating two
 * vaults into one must not quietly reassign whose gold it is.
 */
export const moveStored = (from, to, spec) =>
  transfer(from, to, spec, { hook: STORAGE_HOOKS.MOVED, stampOwner: true, preserveOwner: true });

/* -------------------------------------------- */
/*  Coin helpers                                 */
/* -------------------------------------------- */

/**
 * Put coin at a provider, merging into the owner's existing row of that
 * denomination. Idempotent by construction is NOT claimed here — callers that
 * must not double-credit (the vault sweep) carry their own ledger.
 */
export async function depositCoin(provider, { ownerUuid, ownerName = "", coppervalue = 100, quantity = 0, name = "Gold", img } = {}) {
  if (!provider || !(quantity > 0)) return null;
  const existing = provider.items.find(
    (i) => i.type === "money" && Number(i.system?.coppervalue) === Number(coppervalue) && storageFlagOf(i)?.ownerUuid === ownerUuid,
  );
  if (existing) {
    await existing.update({ "system.quantity": Number(existing.system.quantity ?? 0) + Number(quantity) });
    return existing;
  }
  const [created] = await provider.createEmbeddedDocuments("Item", [
    {
      name,
      type: "money",
      img: img ?? "icons/commodities/currency/coins-assorted-mix-copper-silver-gold.webp",
      system: { coppervalue: Number(coppervalue), quantity: Number(quantity), quantitybank: 0 },
      flags: { [LIB_ID]: { [STORAGE_KEY]: { ownerUuid, ownerName } } },
    },
  ]);
  return created ?? null;
}

/**
 * Fold an owner's duplicate coin rows together. Reassigning goods to a new owner
 * can leave two "Gold" rows attributed to the same character; this is the tidy-up.
 */
export async function consolidateMoney(provider, ownerUuid) {
  const rows = storedItems(provider, { ownerUuid }).filter((i) => i.type === "money");
  const keep = new Map();
  const updates = [];
  const deletes = [];
  for (const row of rows) {
    const cv = Number(row.system?.coppervalue ?? 1);
    const first = keep.get(cv);
    if (!first) {
      keep.set(cv, { id: row.id, quantity: Number(row.system?.quantity ?? 0) });
      continue;
    }
    first.quantity += Number(row.system?.quantity ?? 0);
    deletes.push(row.id);
  }
  for (const slot of keep.values()) {
    const row = provider.items.get(slot.id);
    if (row && Number(row.system?.quantity ?? 0) !== slot.quantity) {
      updates.push({ _id: slot.id, "system.quantity": slot.quantity });
    }
  }
  if (updates.length) await provider.updateEmbeddedDocuments("Item", updates);
  if (deletes.length) await provider.deleteEmbeddedDocuments("Item", deletes);
  return { merged: deletes.length };
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
 * Coin does NOT go in the container — it merges into the character's own coin
 * rows, because a purse inside a crate is not how anyone counts their money and
 * the system's totals only see loose money items.
 *
 * The container itself is a plain system `item` weighing nothing. When
 * acks-equipment is installed it is also flagged as one of that module's
 * containers so the goods nest properly in its UI; without it the contents are
 * simply loose and the container is a labelled marker. Either way this reads and
 * writes acks-equipment's documented flags only — no import, no dependency.
 */
export async function returnGoodsTo(owner, plainGoods, { containerName = "Storage" } = {}) {
  if (!owner || !plainGoods?.length) return { ok: false };
  const coin = plainGoods.filter((g) => g.type === "money");
  const goods = plainGoods.filter((g) => g.type !== "money");

  const equipment = game.modules?.get("acks-equipment")?.active;
  let containerId = null;
  if (goods.length) {
    const container = {
      name: containerName,
      type: "item",
      img: "icons/svg/chest.svg",
      system: { subtype: "item", cost: 0, weight6: 0, quantity: { value: 1, max: 0 } },
      ...(equipment ? { flags: { "acks-equipment": { container: { capacity: 0 } } } } : {}),
    };
    const [made] = await owner.createEmbeddedDocuments("Item", [container]);
    containerId = made?.id ?? null;
  }

  // Fresh ids up front: goods nested inside a stashed container point at the
  // OLD item id, which dies with the place, so the chain is remapped exactly as
  // a transfer does. Anything whose container did not come back goes loose into
  // the returned container instead.
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
    const nest = equipment ? (idMap.get(parent) ?? containerId) : null;
    if (nest) copy.flags["acks-equipment"] = { ...copy.flags["acks-equipment"], containedIn: nest };
    else if (copy.flags["acks-equipment"]) {
      copy.flags["acks-equipment"] = { ...copy.flags["acks-equipment"] };
      delete copy.flags["acks-equipment"].containedIn;
    }
    return copy;
  });
  if (arrivals.length) await owner.createEmbeddedDocuments("Item", arrivals, { keepId: true });

  for (const c of coin) {
    await depositCoinOnCharacter(owner, c);
  }
  return { ok: true, containerId };
}

/** Coin returning to a character merges by denomination — never a second "Gold" row. */
async function depositCoinOnCharacter(owner, plainMoney) {
  const cv = Number(plainMoney.system?.coppervalue ?? 1);
  const qty = Number(plainMoney.system?.quantity ?? 0);
  if (!(qty > 0)) return;
  const existing = owner.items.find((i) => i.type === "money" && Number(i.system?.coppervalue) === cv);
  if (existing) {
    await existing.update({ "system.quantity": Number(existing.system.quantity ?? 0) + qty });
    return;
  }
  const copy = foundry.utils.deepClone(plainMoney);
  delete copy._id;
  copy.system.quantitybank = 0;
  copy.flags = { ...copy.flags };
  if (copy.flags[LIB_ID]) {
    copy.flags[LIB_ID] = { ...copy.flags[LIB_ID] };
    delete copy.flags[LIB_ID][STORAGE_KEY];
  }
  await owner.createEmbeddedDocuments("Item", [copy]);
}

/**
 * The fallback when a place holding goods is deleted.
 *
 * This is a FALLBACK, not a rule: the world setting decides. "Return" hands
 * everything back so a GM tidying the actor directory does not wipe a party's
 * belongings; "lose" is the setting for a campaign where a sacked city really
 * does take your warehouse with it.
 */
export function registerStorageCleanup() {
  Hooks.on("deleteActor", async (doc, options, userId) => {
    try {
      if (game.system?.id !== "acks") return;
      if (!isProvider(doc)) return;

      // ONE client does the work. Every GM sees this hook, and unlike the mount
      // cleanup (idempotent flag unsets) this one creates documents — running it
      // on three GM screens would hand out three copies of everything.
      const gm = game.users?.activeGM;
      if (gm) {
        if (!gm.isSelf) return;
      } else if (userId !== game.user?.id) return;

      const goods = doc.items.filter((i) => !!storageFlagOf(i) && (isPhysical(i) || i.type === "money"));
      if (!goods.length) return;

      const buckets = groupByOwner(goods.map((i) => i.toObject()));
      const policy = deletePolicy();
      const lines = [];

      // The manifest is posted BEFORE anything is moved, so a failure halfway
      // still leaves a record of what was where.
      for (const bucket of buckets.values()) {
        const who = resolveActorSync(bucket.ownerUuid)?.name || bucket.ownerName || "—";
        lines.push(`<li><b>${who}</b>: ${bucket.items.map((i) => i.name).join(", ")}</li>`);
      }
      const returning = policy === "return";
      await ChatMessage.create({
        content: `<p><b>${loc(returning ? "storage.returnedTitle" : "storage.lostTitle", { place: doc.name })}</b></p><ul>${lines.join("")}</ul>`,
        whisper: game.users.filter((u) => u.isGM).map((u) => u.id),
      });

      for (const bucket of buckets.values()) {
        const owner = resolveActorSync(bucket.ownerUuid);
        if (returning && owner) {
          await returnGoodsTo(owner, bucket.items, { containerName: doc.name });
          Hooks.callAll(STORAGE_HOOKS.RETURNED, { ownerUuid: bucket.ownerUuid, place: doc.name, manifest: bucket.items });
          continue;
        }
        // Lost: either the policy says so, or the owner is gone too and there is
        // nobody to hand them to.
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
