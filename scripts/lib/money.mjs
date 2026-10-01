/* global game, ui */
/**
 * Money is a physical thing that always sits somewhere — a payment is a
 * TRANSFER, location-gated before any denomination math, with exchange
 * terms read from the place. See docs/lib/DECISIONS.md, "2026-08-14 — Money
 * is physical; four rulings land at once".
 *
 * Where it sits is a STORE (`coinStores`): carried loose, inside a container
 * the holder carries, or at a place that keeps it for them. A holder states
 * which store a payment draws on first and which one arriving coin lands in
 * (`coinOrderOf`), and a transaction states how far it reaches (`within`).
 * See docs/lib/DECISIONS.md, "Coin is kept in stores, and a holder states
 * their order".
 *
 * Every write of coin onto a holder goes through `creditCoin`, and every
 * write off one through `takeCoin` — a transfer, the Judge's mint and sink, a
 * changer's exchange and a deposit at a place are those two in different
 * orders. Coin lands on the row of its own KIND (`coinKind`) in the store it
 * lands in, and a row that has to be made is copied from a coin that already
 * exists, so it keeps the rate, the art and the per-stone weight its kind
 * states.
 *
 * The HOUSE pile: a location's own coin is storage-attributed to the
 * sentinel owner (`HOUSE_OWNER`) rather than to any character. Every
 * bucket-by-owner path treats it as just another owner; only the retrieval UI
 * treats it specially (the Judge's, by default).
 */
import { MODULE_ID } from "./constants.mjs";
import { acksExtras } from "../namespace.mjs";
import { ITEM_TYPE } from "./vocab.mjs";
import { toNum as num } from "./util.mjs";
import {
  COIN_ORDER_FLAG, LOOSE_STORE, coinCount, coinKind, coinKindKey, coinOrderOf, coinRate, coinSlots, coinTotalCp,
  containerStoreKey, placeStoreKey, planChange, planCoinSpend, planCoinPayUpTo, readStoreKey,
} from "./money-logic.mjs";
import { HOUSE_OWNER, STORAGE_KEY, emptyMoneyDeletes, rowOwnerOf } from "./storage-logic.mjs";
import { arrivalOf } from "./bundles-logic.mjs";
import { containedIn, isContainer, isShutAway } from "./item-model.mjs";
import { coinMayEnter, consolidateMoney, landGoods, providers, resolveActorSync, vaultOwnerUuid } from "./storage.mjs";
import { isLocation } from "./place.mjs";
import { registerHandler, executeAsGM } from "./sockets.mjs";

// The sentinel is storage-logic's; it is offered here because coin is what it
// is asked about.
export { HOUSE_OWNER };

/**
 * The world setting naming how far a payment reaches when its transaction
 * states nothing: `all` (every store), `scene` (coin on hand and at places on
 * the payer's scene) or `hand` (coin on hand).
 */
export const COIN_SCOPE_SETTING = "coinScope";

/** The world's standing reach as the setting states it; `all` where nothing is set. */
export function standingCoinScope() {
  try {
    return game.settings?.get(MODULE_ID, COIN_SCOPE_SETTING) ?? "all";
  } catch {
    return "all";
  }
}

/**
 * The exchange terms a place offers. A market (any market class) changes
 * denominations freely; anywhere else barters. A GM override on the market
 * subtree wins when present ("market" | "none").
 */
export function exchangeTermsAt(place) {
  if (!place || !isLocation(place)) return { mode: "none" };
  const override = place.system?.market?.exchangeOverride ?? null;
  if (override === "market" || override === "none") return { mode: override };
  return { mode: place.system?.marketClass != null ? "market" : "none" };
}

/**
 * Does this actor have a token on this scene? An unlinked (synthetic) token
 * actor is matched by its own token uuid, never by `id` — see
 * docs/lib/DECISIONS.md, "A reach check matches an unlinked token by its own
 * token, never by actor id (2026-09-22)".
 */
function standsOn(scene, actor) {
  if (!actor) return false;
  if (!actor.isToken) return scene.tokens.some((t) => t.actorId === actor.id);
  const own = actor.token?.uuid ?? null;
  return !!own && scene.tokens.some((t) => t.uuid === own);
}

/** Reach gate: may `from`'s coin get to `to` right now? */
export function coinReach(from, to) {
  if (isLocation(to)) {
    const reach = acksExtras.location?.reach?.depositReach?.(from, to);
    return reach ? { can: !!reach.can, reason: reach.reason ?? null } : { can: true, reason: null };
  }
  if (isLocation(from)) {
    // A till pays out under the same rule the depositor used to reach it.
    const reach = acksExtras.location?.reach?.depositReach?.(to, from);
    return reach ? { can: !!reach.can, reason: reach.reason ?? null } : { can: true, reason: null };
  }
  // An employer and their hireling travel together: the roster IS the reach.
  const rosterOf = (a) => (Array.isArray(a?.system?.henchmenList) ? a.system.henchmenList : []);
  const managerOf = (a) => a?.system?.retainer?.managerid ?? null;
  if (rosterOf(from).includes(to.id) || rosterOf(to).includes(from.id)) return { can: true, reason: null };
  if (managerOf(to) === from.id || managerOf(from) === to.id) return { can: true, reason: null };
  // A paid unit sits on nobody's roster: the employer its own actor names is
  // the same link.
  const employerOf = (a) => a?.system?.unit?.employerUuid || null;
  if ((employerOf(to) && employerOf(to) === from.uuid) || (employerOf(from) && employerOf(from) === to.uuid)) return { can: true, reason: null };
  // Otherwise, actor to actor: they share a scene.
  for (const scene of game.scenes ?? []) {
    if (standsOn(scene, from) && standsOn(scene, to)) return { can: true, reason: null };
  }
  return { can: false, reason: "notTogether" };
}

/* -------------------------------------------- */
/*  Where a holder's coin is kept                */
/* -------------------------------------------- */

/**
 * One place a holder's coin is kept.
 * @typedef {object} CoinStore
 * @property {string} key  `LOOSE_STORE`, `item:<id>` or `place:<uuid>` — what a coin order names
 * @property {"loose"|"container"|"place"} kind
 * @property {string} name  the container's or the place's name; empty for coin carried loose
 * @property {Actor} actor  the document the store's rows are on: the holder, or the place
 * @property {string|null} containerId  the carried container the rows are inside
 * @property {Item[]} rows  the coin kept there
 * @property {boolean} shut  a lock keeps coin in and out
 * @property {boolean} takesCoin  arriving coin may be put there
 * @property {boolean} writable  this seat may write the document the rows are on
 * @property {boolean} vault  a place that is the holder's own vault
 */

/** The container a row is really inside among `items`, or null: a pointer at nothing reads as loose. */
const liveBox = (row, items) => {
  const id = containedIn(row);
  return id && items?.get?.(id) ? id : null;
};

/**
 * The stores a holder has on them: coin carried loose, then each container of
 * their own, and any other item their coin sits inside. A location's are the
 * house's; rows and containers kept there for an owner are that owner's and
 * are not listed. Every coin row that is the holder's own is in exactly one.
 * @returns {CoinStore[]}
 */
function handStores(holder) {
  const items = holder?.items;
  const own = (i) => rowOwnerOf(i) === HOUSE_OWNER;
  const coins = items?.filter((i) => i.type === ITEM_TYPE.money && own(i)) ?? [];
  const writable = !!holder?.isOwner;
  const loose = {
    key: LOOSE_STORE, kind: "loose", name: "", actor: holder, containerId: null,
    rows: coins.filter((r) => !liveBox(r, items)), shut: false, takesCoin: true, writable, vault: false,
  };
  const boxes = items?.filter((i) => i.type !== ITEM_TYPE.money && ((own(i) && isContainer(i)) || coins.some((r) => liveBox(r, items) === i.id))) ?? [];
  return [loose, ...boxes.map((box) => ({
    key: containerStoreKey(box.id), kind: "container", name: box.name, actor: holder, containerId: box.id,
    rows: coins.filter((r) => liveBox(r, items) === box.id),
    shut: isShutAway(box, items), takesCoin: coinMayEnter(holder, box), writable, vault: false,
  }))];
}

/**
 * May a place keep coin for this holder? Not for a location and not for a
 * token's own actor: nothing is kept for a house elsewhere, and a synthetic
 * actor's uuid dies with its token.
 */
export const keepsCoinElsewhere = (holder) => !!holder?.uuid && !holder.isToken && !isLocation(holder);

/**
 * The places keeping coin for a holder (`keepsCoinElsewhere`): each provider
 * holding coin stamped as theirs, their vault, and any place their coin order
 * names — the vault first, the rest by name. Coin shut inside a locked
 * container at the place is not among a store's rows.
 * @returns {CoinStore[]}
 */
function placeStores(holder) {
  if (!keepsCoinElsewhere(holder)) return [];
  const order = coinOrderOf(holder);
  const named = [order.payFrom, order.receiveInto].map(readStoreKey).filter((k) => k.kind === "place").map((k) => k.uuid);
  const stores = [];
  for (const place of providers()) {
    if (place.uuid === holder.uuid) continue;
    const vault = vaultOwnerUuid(place) === holder.uuid;
    const rows = place.items.filter((i) => {
      if (i.type !== ITEM_TYPE.money || rowOwnerOf(i) !== holder.uuid) return false;
      const box = place.items.get(liveBox(i, place.items));
      return !box || !isShutAway(box, place.items);
    });
    if (!rows.length && !vault && !named.includes(place.uuid)) continue;
    stores.push({
      key: placeStoreKey(place.uuid), kind: "place", name: place.name, actor: place, containerId: null,
      rows, shut: false, takesCoin: true, writable: !!place.isOwner, vault,
    });
  }
  return stores.sort((a, b) => Number(b.vault) - Number(a.vault) || String(a.name).localeCompare(String(b.name)));
}

/** The scene a holder is on: a place's own scene, else one its token stands on — the active scene before any other. */
function sceneOf(holder) {
  const linked = isLocation(holder) ? (acksExtras.location?.scenes?.sceneOfLocation?.(holder) ?? null) : null;
  if (linked) return linked;
  const active = game.scenes?.active ?? null;
  if (active && standsOn(active, holder)) return active;
  for (const scene of game.scenes ?? []) if (standsOn(scene, holder)) return scene;
  return null;
}

/**
 * The reach a transaction has, as the stores are filtered by it: `null` for
 * every store, `"hand"` for coin on hand, a place for coin on hand and at that
 * place, a Scene for coin on hand and at places on it. A transaction that
 * states nothing takes the world's standing reach (`COIN_SCOPE_SETTING`),
 * measured from the payer.
 */
function scopeOf(within, payer) {
  if (within === "all") return null;
  if (within != null) return within;
  const standing = standingCoinScope();
  if (standing === "hand") return "hand";
  if (standing === "scene") return sceneOf(payer) ?? "hand";
  return null;
}

/** Is a place's coin inside a transaction's reach? Only that place is; a scene takes the places linked to it or standing on it. */
function placeWithin(place, scope) {
  if (!scope) return true;
  if (scope === "hand") return false;
  if (scope.documentName !== "Scene") return scope.uuid === place.uuid;
  const location = acksExtras.location;
  return location?.scenes?.sceneOfLocation?.(place)?.id === scope.id || !!location?.here?.placeStandsOn?.(scope, place);
}

/** The stores inside a reach already resolved (`scopeOf`), in their standing order: loose, containers, places. */
function storesOf(holder, scope) {
  if (!holder) return [];
  const onHand = handStores(holder);
  if (scope === "hand") return onHand;
  return [...onHand, ...placeStores(holder).filter((s) => placeWithin(s.actor, scope))];
}

/**
 * Every store a holder's coin is kept in, in the standing order a payment
 * falls back on: carried loose, each carried container, then the places — the
 * vault first.
 * @param {Actor} holder
 * @param {{within?: "all"|"hand"|Actor|Scene|null}} [opts] how far to look;
 *   unstated, the world's standing reach
 * @returns {CoinStore[]}
 */
export const coinStores = (holder, { within = null } = {}) => storesOf(holder, scopeOf(within, holder));

/**
 * The coin rows a holder has ON them and that are their own: an actor's purse
 * and what its containers hold, or a location's house-owned stacks (a till
 * never spends a depositor's coin). Loose rows come first.
 * @returns {Item[]}
 */
export const ownCoin = (holder) => handStores(holder).flatMap((s) => s.rows);

/** What the coin a holder has on them is worth, in gold. */
export const purseGp = (holder) => coinTotalCp(ownCoin(holder)) / 100;

/**
 * What a payment draws on: the rows of every store no lock shuts, as spend
 * slots ranked in the holder's pay order — the store they named first, then
 * the standing order. `rows` leads each slot back to its row and the document
 * it is on.
 * @returns {{slots: object[], rows: Map<string, {actor: Actor, row: Item}>}}
 */
function purseOf(holder, scope) {
  const first = coinOrderOf(holder).payFrom;
  const open = storesOf(holder, scope).filter((s) => !s.shut);
  const ordered = [...open.filter((s) => s.key === first), ...open.filter((s) => s.key !== first)];
  const slots = [];
  const rows = new Map();
  ordered.forEach((store, rank) => {
    for (const row of store.rows) {
      const [slot] = coinSlots([row]);
      if (!slot) continue;
      const id = `${rank}:${slot.id}`;
      slots.push({ ...slot, id, rank });
      rows.set(id, { actor: store.actor, row });
    }
  });
  return { slots, rows };
}

/**
 * What a holder can pay with, in gold: the coin of every store inside the
 * reach that no lock shuts.
 * @param {Actor} holder
 * @param {{within?: "all"|"hand"|Actor|Scene|null}} [opts]
 */
export function spendableGp(holder, { within = null } = {}) {
  return purseOf(holder, scopeOf(within, holder)).slots.reduce((cp, s) => cp + s.cv * s.qty, 0) / 100;
}

/**
 * State a holder's coin order: the store a payment draws on first and the
 * store arriving coin lands in. A half left out keeps what it was. A key is
 * stored as given; one whose store is gone reads as carried loose.
 * @param {Actor} holder
 * @param {{payFrom?: string, receiveInto?: string}} order store keys
 * @returns {Promise<{payFrom: string, receiveInto: string}>} the order now stated
 */
export async function setCoinOrder(holder, { payFrom, receiveInto } = {}) {
  const next = { ...coinOrderOf(holder) };
  if (typeof payFrom === "string") next.payFrom = payFrom;
  if (typeof receiveInto === "string") next.receiveInto = receiveInto;
  await holder.setFlag(MODULE_ID, COIN_ORDER_FLAG, next);
  return next;
}

/**
 * Fold a holder's duplicate coin rows together, store by store: rows of one
 * kind in one place become one (`consolidateMoney`), on the holder and at
 * each place keeping coin for them that this seat may write.
 * @returns {Promise<{merged: number}>} how many rows were folded away
 */
export async function gatherCoin(holder) {
  if (!holder?.isOwner) return { merged: 0 };
  let merged = (await consolidateMoney(holder)).merged;
  for (const store of placeStores(holder)) {
    if (store.writable) merged += (await consolidateMoney(store.actor, holder.uuid)).merged;
  }
  return { merged };
}

/* -------------------------------------------- */
/*  What a coin row is made from                 */
/* -------------------------------------------- */

/** The name a coin of this rate goes by when no coin anywhere says. */
function standardCoinName(cv) {
  if (cv === 100) return game.i18n.localize("ACKS-LIB.money.gpName");
  if (cv === 10) return game.i18n.localize("ACKS-LIB.money.spName");
  if (cv === 1) return game.i18n.localize("ACKS-LIB.money.cpName");
  return `${game.i18n.localize("ACKS-LIB.money.gpName")} (${cv})`;
}

/** Compendium coins already looked for this session, by `name|rate`. */
const shelfCoins = new Map();

/**
 * The coin a new row is copied from, as plain item data, or null when the
 * world has none. A row built from nothing would carry no art, no description
 * and no stated weight; a copy carries its kind's. The coin is wanted by its
 * rate, by its name, or by both — a caller that knows only what a coin is
 * CALLED never has to state what it is worth. A NAMED coin is looked for in
 * the world's own items first (a Judge's re-skinned Gold is theirs), then on
 * the shelves; a coin wanted only by its rate takes the system's own first,
 * because that is the standard denomination.
 * @param {{cv?: number|null, name?: string|null}} want
 */
export async function coinTemplate({ cv = null, name = null } = {}) {
  const wanted = name == null ? null : String(name).trim().toLowerCase();
  if (cv == null && wanted === null) return null;
  const fits = (i) =>
    i?.type === ITEM_TYPE.money && (cv == null || coinRate(i) === cv) && (wanted === null || String(i.name ?? "").trim().toLowerCase() === wanted);
  const inWorld = () => game.items?.find(fits)?.toObject() ?? null;

  const key = `${wanted ?? "*"}|${cv ?? "*"}`;
  const onShelf = async (ofSystem) => {
    const slot = `${ofSystem ? "system" : "other"}|${key}`;
    if (shelfCoins.has(slot)) return shelfCoins.get(slot);
    let found = null;
    const packs = game.packs?.filter((p) => p.documentName === "Item" && (p.metadata?.packageType === "system") === ofSystem) ?? [];
    for (const pack of packs) {
      const index = await pack.getIndex().catch(() => null);
      // The rate is not an index field, so every coin a shelf lists is opened
      // and asked; a shelf with no coin on it is never opened at all.
      const coins = index?.filter((e) => e.type === ITEM_TYPE.money && (wanted === null || String(e.name ?? "").trim().toLowerCase() === wanted)) ?? [];
      for (const entry of coins) {
        const doc = await pack.getDocument(entry._id).catch(() => null);
        if (doc && fits(doc)) found = doc.toObject();
        if (found) break;
      }
      if (found) break;
    }
    shelfCoins.set(slot, found);
    return found;
  };

  if (wanted !== null) return inWorld() ?? (await onShelf(true)) ?? (await onShelf(false));
  return (await onShelf(true)) ?? inWorld() ?? (await onShelf(false));
}

/** Plain data for a new coin row of `count` coins, copied from `base`. */
function coinRowData(base, count) {
  const data = arrivalOf(base);
  data.system = { ...(data.system ?? {}), quantity: count };
  return data;
}

/**
 * The coin one credit lands as. Coin that MOVED is its `source`. Coin known by
 * a name, or only by its rate, is the row of that kind — or of that rate —
 * the holder already keeps, which `kin` finds, nearest the landing first;
 * failing those a coin the world already has (`coinTemplate`), and failing
 * that the bare standard coin.
 * @param {object} credit
 * @param {(fits: (row: Item) => boolean) => Item|undefined} kin
 */
async function coinBaseFor(credit, kin) {
  if (credit.source) return credit.source;
  const cv = num(credit.cv, 1);
  const kind = credit.name != null ? coinKindKey(credit.name, cv) : null;
  const held = kin((i) => (kind === null ? coinRate(i) === cv : coinKind(i) === kind));
  if (held) return held.toObject();
  return (await coinTemplate({ cv, name: credit.name ?? null }))
    ?? { name: credit.name ?? standardCoinName(cv), type: ITEM_TYPE.money, img: "icons/svg/coins.svg", system: { coppervalue: cv } };
}

/* -------------------------------------------- */
/*  Landing coin                                 */
/* -------------------------------------------- */

/**
 * Where coin credited to a holder is written: the document, the carried
 * container on it, and the stamp its rows take.
 *
 * Coin kept for a named owner (`ownerUuid`) is put on the holder under that
 * owner and nowhere else. Otherwise it goes to the store `into` names, else
 * the one the holder's coin order names, while that store is inside the reach
 * and takes coin; a store that cannot is passed over for coin carried loose.
 * A location's own rows are stamped as the house's.
 * @returns {{actor: Actor, containerId: string|null, stamp: object|null}}
 */
function landingOf(holder, { ownerUuid = null, ownerName = "", into = null, scope = null } = {}) {
  if (ownerUuid) return { actor: holder, containerId: null, stamp: { ownerUuid, ...(ownerName ? { ownerName } : {}) } };
  const key = into ?? coinOrderOf(holder).receiveInto;
  const named = readStoreKey(key);
  // A carried container is looked for on the holder alone: no place is read.
  const store = named.kind === "loose"
    ? null
    : (storesOf(holder, named.kind === "place" ? scope : "hand").find((s) => s.key === key && s.takesCoin) ?? null);
  if (store?.kind === "place") return { actor: store.actor, containerId: null, stamp: { ownerUuid: holder.uuid, ownerName: holder.name } };
  return { actor: holder, containerId: store?.containerId ?? null, stamp: isLocation(holder) ? { ownerUuid: HOUSE_OWNER } : null };
}

/**
 * A finder over the coin a holder already keeps, nearest a landing first: the
 * same owner's rows in the container it lands in, their other rows on that
 * document, the coin the holder carries, and last the coin places keep for
 * them — which is a scan of the world's places, made only when nothing nearer
 * fits.
 * @returns {(fits: (row: Item) => boolean) => Item|undefined}
 */
function kinOf(holder, landing) {
  const items = landing.actor.items;
  const owner = landing.stamp?.ownerUuid ?? HOUSE_OWNER;
  const rows = items.filter((i) => i.type === ITEM_TYPE.money && rowOwnerOf(i) === owner);
  const there = (r) => liveBox(r, items) === landing.containerId;
  const near = [...rows.filter(there), ...rows.filter((r) => !there(r)), ...(landing.actor === holder ? [] : ownCoin(holder))];
  let far = null;
  return (fits) => near.find(fits) ?? (far ??= placeStores(holder).flatMap((s) => s.rows)).find(fits);
}

/** `creditCoin` over a reach already resolved (`scopeOf`). */
async function credit(holder, credits, { ownerUuid = null, ownerName = "", into = null, scope = null } = {}) {
  const wanted = (credits ?? []).filter((c) => Math.floor(num(c?.count, 0)) > 0);
  if (!holder || !wanted.length) return { updates: 0, creates: 0 };
  let landing = landingOf(holder, { ownerUuid, ownerName, into, scope });
  // A seat that cannot write the place keeps the coin on the holder. A payment
  // never arrives here in that state: it is relayed whole (`moveCoin`).
  if (landing.actor !== holder && !landing.actor.isOwner) landing = landingOf(holder, { into: LOOSE_STORE });
  const kin = kinOf(holder, landing);
  const arrivals = [];
  for (const one of wanted) {
    const data = coinRowData(await coinBaseFor(one, kin), Math.floor(num(one.count, 0)));
    if (landing.stamp) data.flags = { ...(data.flags ?? {}), [MODULE_ID]: { ...(data.flags?.[MODULE_ID] ?? {}), [STORAGE_KEY]: { ...landing.stamp } } };
    arrivals.push(data);
  }
  const landed = await landGoods(landing.actor, arrivals, { byOwner: !!landing.stamp, coinInto: landing.containerId });
  return { updates: landed.updated.length, creates: landed.created.length };
}

/**
 * Land coin on a holder. Each credit is `{cv, count}` plus what says which
 * coin it is: `source` (a coin row's plain data — coin that MOVED keeps its
 * kind), or `name`, or neither for coin known only by its rate (a mint,
 * change), which lands as the coin of that rate the holder already keeps.
 *
 * The coin goes to the store the holder's coin order names (`landingOf`) and
 * merges into the row of its kind THERE, making one where there is none; a
 * new row is copied from `source`, else from a coin of that kind the world
 * already has (`coinTemplate`). Coin kept for a named owner is put on the
 * holder under that owner, whatever any order says.
 *
 * @param {Actor} holder
 * @param {Array<{cv?: number, count: number, source?: object, name?: string}>} credits
 * @param {object} [opts]
 * @param {string|null} [opts.ownerUuid]  whose the rows are, where the holder keeps goods for owners
 * @param {string} [opts.ownerName]  display fallback for that owner
 * @param {string|null} [opts.into]  a store key that overrides the holder's order
 * @param {"all"|"hand"|Actor|Scene|null} [opts.within]  how far the coin may be sent
 * @returns {Promise<{updates: number, creates: number}>} what was written, for the caller's receipt
 */
export const creditCoin = (holder, credits, { ownerUuid = null, ownerName = "", into = null, within = null } = {}) =>
  credit(holder, credits, { ownerUuid, ownerName, into, scope: scopeOf(within, holder) });

/* -------------------------------------------- */
/*  Taking coin, and change                      */
/* -------------------------------------------- */

/**
 * Take a plan's coins off the rows they name. A row a take empties is deleted
 * rather than left listed at none (`emptyMoneyDeletes`), whichever document
 * it is on.
 * @param {{rows: Map<string, {actor: Actor, row: Item}>}} purse
 * @param {Array<{id: string, take: number}>} takes
 */
async function takeCoin(purse, takes) {
  const byActor = new Map();
  for (const t of takes ?? []) {
    const held = purse.rows.get(t.id);
    if (!held) continue;
    const updates = byActor.get(held.actor) ?? new Map();
    const left = updates.get(held.row.id)?.["system.quantity"] ?? coinCount(held.row);
    updates.set(held.row.id, { _id: held.row.id, "system.quantity": Math.max(0, left - t.take) });
    byActor.set(held.actor, updates);
  }
  for (const [actor, updates] of byActor) {
    const plain = [...updates.keys()].map((id) => actor.items.get(id)?.toObject()).filter(Boolean);
    const tidy = emptyMoneyDeletes([...updates.values()], plain);
    if (tidy.sourceUpdates.length) await actor.updateEmbeddedDocuments("Item", tidy.sourceUpdates);
    if (tidy.sourceDeletes.length) await actor.deleteEmbeddedDocuments("Item", tidy.sourceDeletes);
  }
}

/** The coins a plan takes, as credits that carry the rows they came off. */
function takenAsCredits(purse, takes) {
  const byKind = new Map();
  for (const t of takes ?? []) {
    const row = purse.rows.get(t.id)?.row;
    if (!row) continue;
    const key = coinKind(row);
    const entry = byKind.get(key) ?? { source: row.toObject(), cv: coinRate(row), count: 0 };
    entry.count += t.take;
    byKind.set(key, entry);
  }
  return [...byKind.values()];
}

/**
 * Change for a payment, made out of the coins being paid before anything
 * else: a coin the plan took and the change would hand straight back stays
 * where it is. `kept` are the plan's takes and `own` the stacks, or the bare
 * rates, the other side makes change from. The kept coins are tried alone,
 * then with `own` covering what they leave; where neither is exact the two are
 * drawn on together, largest first, so a payment the mix can complete is never
 * refused for the preference.
 * @returns {{credits: Array<{kind, cv, count}>, remainderCp: number}}
 */
function changeKeeping(kept, own, changeCp) {
  const first = planChange(kept, changeCp);
  if (first.remainderCp === 0) return first;
  const rest = planChange(own, first.remainderCp);
  if (rest.remainderCp === 0) return { credits: [...first.credits, ...rest.credits], remainderCp: 0 };
  return planChange([...kept, ...own], changeCp);
}

/**
 * How a spend plan's change is made, decided before anything moves. `own` are
 * the other side's slots — bounded stacks for a payee, bare rates for coin
 * handed back from off-stage. What the two cannot make exactly is settled by
 * `onShort`: `refuse` (a payee with no changer), `mintAll` (a market, which
 * hands the whole change back in standard coin) or `mintRemainder` (off-stage:
 * what the payer's own rates cannot represent comes back as standard coin).
 * @returns {{takes: object[], handBack: object[], mintCp: number}|null} the
 *   takes with the kept coins left out, what the other side hands back, and
 *   what is minted; null when the change is refused
 */
function settleChange(plan, own, onShort) {
  if (!(plan.changeCp > 0)) return { takes: plan.takes, handBack: [], mintCp: 0 };
  const change = changeKeeping(
    plan.takes.map((t, i) => ({ kind: `kept:${i}`, cv: t.cv, qty: t.take })),
    own,
    plan.changeCp,
  );
  if (change.remainderCp > 0 && onShort === "refuse") return null;
  if (change.remainderCp > 0 && onShort === "mintAll") return { takes: plan.takes, handBack: [], mintCp: plan.changeCp };
  // A coin that would be handed over and handed straight back never leaves
  // the payer's purse.
  const kept = new Map();
  const handBack = [];
  for (const c of change.credits) {
    if (c.kind.startsWith("own:")) handBack.push({ id: c.kind.slice(4), cv: c.cv, take: c.count });
    else kept.set(Number(c.kind.slice(5)), c.count);
  }
  return {
    takes: plan.takes.map((t, i) => ({ ...t, take: t.take - (kept.get(i) ?? 0) })).filter((t) => t.take > 0),
    handBack,
    mintCp: change.remainderCp,
  };
}

/** Coin known only by its worth: standard denominations, largest first. */
function mintCredits(cp) {
  const credits = [];
  let owed = Math.max(0, Math.round(cp));
  for (const cv of [100, 10, 1]) {
    const count = Math.floor(owed / cv);
    if (count > 0) {
      credits.push({ cv, count });
      owed -= count * cv;
    }
  }
  return credits;
}

/* -------------------------------------------- */
/*  The one payment                              */
/* -------------------------------------------- */

/** A reach as a relayed call carries it: a keyword as it is, a document as its uuid. */
const scopeToWire = (within) => (within == null || typeof within === "string" ? (within ?? null) : { [within.documentName === "Scene" ? "scene" : "actor"]: within.uuid });

/** The reach a relayed call carried, back as what `scopeOf` reads. */
function scopeFromWire(within) {
  if (within == null || typeof within === "string") return within ?? null;
  if (within.scene) return game.scenes?.get?.(String(within.scene).split(".")[1]) ?? "hand";
  return resolveActorSync(within.actor) ?? "hand";
}

/**
 * Plan a payment without writing: which coins leave the payer, what the other
 * side hands back, and what is minted. With no payee the coin leaves the
 * world, and its change is made in the payer's own denominations.
 *
 * A payer's order decides which coins go, never whether the payment can be
 * made: where the ranked plan would need change nobody can make, the plan that
 * spends smallest first across every store is tried before the payment is
 * refused.
 * @returns {Promise<object>} `{refusal}` or `{purse, other, takes, handBack, mintCp, changeCp}`
 */
async function planPayment({ from, to, needCp, scope, terms, minting }) {
  let purse = purseOf(from, scope);
  let plan = planCoinSpend(purse.slots, needCp);
  if (plan.shortfallCp > 0 && minting) {
    // Market liquidity: the till covers what its stacks cannot, in gold.
    await credit(from, [{ cv: 100, count: Math.ceil(plan.shortfallCp / 100) }], { scope });
    purse = purseOf(from, scope);
    plan = planCoinSpend(purse.slots, needCp);
  }
  if (plan.shortfallCp > 0) return { refusal: { ok: false, reason: "insufficient", shortfallCp: plan.shortfallCp } };

  const other = to ? purseOf(to, scope) : purse;
  const own = other.slots.map((s) => ({ kind: `own:${s.id}`, cv: s.cv, ...(to ? { qty: s.qty } : {}) }));
  // A market till that cannot make change is not refused — minting is what
  // "exchanges freely" means. Barter refuses instead.
  const onShort = !to ? "mintRemainder" : terms.mode === "market" ? "mintAll" : "refuse";
  let settled = settleChange(plan, own, onShort);
  if (!settled && purse.slots.some((s) => s.rank)) {
    const flat = planCoinSpend(purse.slots.map(({ rank, ...slot }) => slot), needCp);
    const again = settleChange(flat, own, onShort);
    if (again) [plan, settled] = [flat, again];
  }
  if (!settled) return { refusal: { ok: false, reason: "noChange", changeCp: plan.changeCp } };
  return { purse, other, ...settled, changeCp: plan.changeCp };
}

/** The documents a planned payment writes: the rows it takes from, and where what is paid and what comes back land. */
function writesOf(pay, from, to, scope) {
  const actors = new Set();
  for (const t of pay.takes) actors.add(pay.purse.rows.get(t.id)?.actor);
  if (to) {
    for (const t of pay.handBack) actors.add(pay.other.rows.get(t.id)?.actor);
    if (pay.takes.length) actors.add(landingOf(to, { scope }).actor);
  }
  if (pay.handBack.length || pay.mintCp > 0) actors.add(landingOf(from, { scope }).actor);
  actors.delete(undefined);
  return [...actors];
}

/**
 * The one payment every coin movement is: gate, plan, then write — or hand
 * the whole payment to the GM where this seat may not write a document it
 * touches (a place keeping coin for either side, a payee the seat does not
 * own). The GM's seat plans again from the same arguments; nothing this seat
 * worked out is taken on trust. No warning is raised here: the caller's seat
 * raises its own from the result.
 *
 * The coins paid land before they are taken, and change lands before it is
 * taken, so a payment cut short leaves a duplicate and never a loss.
 * @returns {Promise<object>} `transferCoin`'s result; a reach refusal carries `outOfReach: true`
 */
async function moveCoin({ from, to = null, needCp, at = null, gate = true, allowMint = false, upTo = false, within = null }) {
  if (to && gate) {
    const reach = coinReach(from, to);
    if (!reach.can) return { ok: false, reason: reach.reason ?? "outOfReach", outOfReach: true };
  }
  const scope = scopeOf(within, from);
  const terms = exchangeTermsAt(at ?? (isLocation(to) ? to : isLocation(from) ? from : null));

  let pay;
  if (upTo) {
    const purse = purseOf(from, scope);
    const plan = planCoinPayUpTo(purse.slots, needCp);
    pay = { purse, other: purse, takes: plan.takes, handBack: [], mintCp: 0, paidCp: plan.paidCp, arrearsCp: plan.shortCp };
  } else {
    // Liquidity is minted by a seat that may write the till; no other seat's
    // plan makes a write.
    pay = await planPayment({ from, to, needCp, scope, terms, minting: allowMint && terms.mode === "market" && isLocation(from) && !!from.isOwner });
    if (pay.refusal) return pay.refusal;
  }

  if (!game.user?.isGM && writesOf(pay, from, to, scope).some((a) => !a.isOwner)) {
    const relayed = await executeAsGM("libMoveCoin", {
      fromUuid: from.uuid, toUuid: to?.uuid ?? null, atUuid: at?.uuid ?? null, needCp, gate, upTo, within: scopeToWire(within),
    });
    return relayed ?? { ok: false, reason: "noGm" };
  }

  // Both landings are worked out from the rows as they stand, then written
  // ahead of both takes.
  const paid = takenAsCredits(pay.purse, pay.takes);
  const back = [...takenAsCredits(pay.other, pay.handBack), ...mintCredits(pay.mintCp)];
  if (to) await credit(to, paid, { scope });
  await credit(from, back, { scope });
  await takeCoin(pay.purse, pay.takes);
  if (to) await takeCoin(pay.other, pay.handBack);
  return upTo ? { ok: true, paidCp: pay.paidCp, arrearsCp: pay.arrearsCp } : { ok: true, changeCp: pay.changeCp };
}

// The relayed payment: the sender must own the payer whose coin moves, and
// the GM's seat runs the whole of `moveCoin` again — gate, reach and plan. A
// relayed call never mints: liquidity is a market's own, paid from its seat.
registerHandler("libMoveCoin", async ({ fromUuid, toUuid = null, atUuid = null, needCp, gate = true, upTo = false, within = null, requestUserId = null } = {}) => {
  const from = resolveActorSync(fromUuid);
  const to = toUuid ? resolveActorSync(toUuid) : null;
  if (!from || (toUuid && !to) || !(Number(needCp) > 0)) return { ok: false, reason: "missing" };
  if (requestUserId) {
    const user = game.users.get(requestUserId);
    if (!user || (!user.isGM && !from.testUserPermission(user, "OWNER"))) return { ok: false, reason: "notYours" };
  }
  return moveCoin({
    from, to, needCp: Math.round(Number(needCp)), at: atUuid ? resolveActorSync(atUuid) : null,
    gate: gate !== false, upTo: !!upTo, within: scopeFromWire(within),
  });
});

/**
 * Coin from nowhere — the Judge's mint: a market's liquidity, a reward, a
 * month's till. Standard denominations, largest first, each landing as the
 * coin of that rate the holder already keeps, where `creditCoin` puts it.
 * @param {Actor} holder
 * @param {number} gp
 * @param {object} [opts] `creditCoin`'s: `ownerUuid`, `ownerName`, `into`, `within`
 * @returns {Promise<{updates: number, creates: number}>}
 */
export async function mintCoin(holder, gp, opts = {}) {
  if (!holder) return { updates: 0, creates: 0 };
  return creditCoin(holder, mintCredits(num(gp, 0) * 100), opts);
}

/**
 * Coin spent to nobody — the payee is off-stage and the coin leaves the
 * world. The spend is a transfer's (`moveCoin`); change is the coins being
 * paid held back first, then the holder's own denominations, largest first,
 * and what those cannot represent comes back as standard small coin, so a
 * broken coin never costs more than was owed. Nothing is written when the
 * purse cannot cover the amount, and no warning is raised: the caller says
 * why its payment failed.
 * @param {Actor} holder
 * @param {number} gp
 * @param {{within?: "all"|"hand"|Actor|Scene|null}} [opts] which of the holder's coin may be spent
 * @returns {Promise<{ok: boolean, reason?: string, shortfallCp?: number, changeCp?: number}>}
 */
export async function sinkCoin(holder, gp, { within = null } = {}) {
  const needCp = Math.round(num(gp, 0) * 100);
  if (needCp <= 0) return { ok: true, changeCp: 0 };
  if (!holder) return { ok: false, reason: "missing" };
  return moveCoin({ from: holder, needCp, gate: false, within });
}

/**
 * Move `gp` from one holder to another, physically.
 *
 * @param {object} opts
 * @param {Actor} opts.from     payer (actor or location)
 * @param {Actor} opts.to       payee (actor or location)
 * @param {number} opts.gp      amount in gold pieces
 * @param {string} [opts.reason]  for warnings and the optional receipt
 * @param {Actor}  [opts.at]    the place whose exchange terms govern change
 *                              (defaults to whichever party is a location)
 * @param {boolean} [opts.gate=true]   apply the reach gate
 * @param {boolean} [opts.allowMint=false]  a market till may pay out coin it
 *                              does not hold (market liquidity; ignored under
 *                              barter terms)
 * @param {boolean} [opts.upTo=false]  pay only what the purse represents
 *                              EXACTLY — no coin broken, no change owed; the
 *                              uncovered remainder comes back as `arrearsCp`
 *                              for the caller to book (how wages survive a
 *                              world with no changer in reach)
 * @param {"all"|"hand"|Actor|Scene|null} [opts.within]  how far the payment
 *                              reaches into both sides' coin: every store
 *                              (`"all"`), coin on hand (`"hand"`), coin on
 *                              hand and at one place, or coin on hand and at
 *                              places on a scene. Unstated, the world's
 *                              standing reach (`COIN_SCOPE_SETTING`)
 * @returns {{ok: boolean, reason?: string, changeCp?: number,
 *            paidCp?: number, arrearsCp?: number}}
 */
export async function transferCoin({ from, to, gp, reason = "", at = null, gate = true, allowMint = false, upTo = false, within = null } = {}) {
  const needCp = Math.round(num(gp, 0) * 100);
  if (needCp <= 0) return { ok: true };
  if (!from || !to) return { ok: false, reason: "missing" };
  const { outOfReach, ...result } = await moveCoin({ from, to, needCp, at, gate, allowMint, upTo, within });
  if (outOfReach) ui?.notifications?.warn(game.i18n.format("ACKS-LIB.money.outOfReach", { reason: result.reason ?? "?", detail: reason }));
  else if (result.reason === "insufficient") ui?.notifications?.warn(game.i18n.format("ACKS-LIB.money.insufficient", { name: from.name, detail: reason }));
  else if (result.reason === "noChange") ui?.notifications?.warn(game.i18n.format("ACKS-LIB.money.noChange", { name: to.name, detail: reason }));
  return result;
}

/* -------------------------------------------- */
/*  The changer                                  */
/* -------------------------------------------- */

/**
 * Exchange one coin kind for another at a place, at face value — the changer's
 * service. Only a market offers it (its till absorbs the old coin and pays
 * the new, minting freely); anywhere else the answer is the barter warning.
 * The remainder below the target denomination comes back in standard small
 * coin, so the actor never loses value to the split.
 *
 * The exchange writes BOTH sides: the actor's coin goes down and the till's
 * goes up. A seat that cannot write the place relays the whole exchange to
 * the GM instead (`libExchangeCoins`); the result shape is the same either way.
 * @returns {{ok: boolean, reason?: string, paidOutCp?: number}}
 */
export async function exchangeCoins({ actor, place, itemId, count, toCv, gate = true } = {}) {
  const terms = exchangeTermsAt(place);
  if (terms.mode !== "market") {
    ui?.notifications?.warn(game.i18n.localize("ACKS-LIB.money.noChanger"));
    return { ok: false, reason: "noChanger" };
  }
  if (gate) {
    const reach = coinReach(actor, place);
    if (!reach.can) {
      ui?.notifications?.warn(game.i18n.format("ACKS-LIB.money.outOfReach", { reason: reach.reason ?? "?", detail: "" }));
      return { ok: false, reason: reach.reason ?? "outOfReach" };
    }
  }
  if (!game.user.isGM && !place.isOwner) {
    const relayed = await executeAsGM("libExchangeCoins", { actorUuid: actor.uuid, placeUuid: place.uuid, itemId, count, toCv });
    return relayed ?? { ok: false, reason: "noGm" };
  }
  return applyExchange({ actor, place, itemId, count, toCv });
}

/**
 * The writes of a coin exchange, run by a seat that may make them all: the old
 * coin lands in the till and leaves the actor, and the new comes back where
 * the actor keeps arriving coin, on hand or at this place.
 */
async function applyExchange({ actor, place, itemId, count, toCv }) {
  const item = actor.items.get(itemId);
  if (item?.type !== ITEM_TYPE.money) return { ok: false, reason: "nothingToChange" };
  const cv = coinRate(item);
  const have = coinCount(item);
  count = Math.min(Math.max(1, Math.round(num(count, 0))), have);
  toCv = num(toCv, 0);
  if (cv <= 0 || count <= 0 || toCv <= 0) return { ok: false, reason: "nothingToChange" };

  const totalCp = cv * count;
  const purse = { rows: new Map([[item.id, { actor, row: item }]]) };
  const takes = [{ id: item.id, take: count }];
  await credit(place, takenAsCredits(purse, takes));
  await takeCoin(purse, takes);
  const out = [];
  const wanted = Math.floor(totalCp / toCv);
  if (wanted > 0) out.push({ cv: toCv, count: wanted });
  out.push(...mintCredits(totalCp - wanted * toCv));
  await credit(actor, out, { scope: place });
  return { ok: true, paidOutCp: totalCp };
}

// The relayed exchange: the sender must own the actor whose coin moves, and
// the GM's own preflight (terms, reach) runs again — nothing the seat checked
// is taken on trust.
registerHandler("libExchangeCoins", async ({ actorUuid, placeUuid, requestUserId = null, ...rest }) => {
  const actor = resolveActorSync(actorUuid);
  const place = resolveActorSync(placeUuid);
  if (!actor || !place) return { ok: false, reason: "missing" };
  if (requestUserId) {
    const user = game.users.get(requestUserId);
    if (!user?.isGM && !actor.testUserPermission(user, "OWNER")) return { ok: false, reason: "notYours" };
  }
  return exchangeCoins({ actor, place, ...rest, gate: true });
});
