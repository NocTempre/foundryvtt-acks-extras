/* global game, ui, foundry */
/**
 * Money is a physical thing that always sits somewhere — a payment is a
 * TRANSFER, location-gated before any denomination math, with exchange
 * terms read from the place. See docs/lib/DECISIONS.md, "2026-08-14 — Money
 * is physical; four rulings land at once".
 *
 * Every write of coin onto a holder goes through `creditCoin`, and every
 * write off one through `applyTakes` — a transfer, the Judge's mint and sink,
 * a changer's exchange and a deposit at a place are those two in different
 * orders. Coin lands on a row of its own KIND (`coinKind`), and a row that
 * has to be made is copied from a coin that already exists, so it keeps the
 * rate, the art and the per-stone weight its kind states.
 *
 * The HOUSE pile: a location's own coin is storage-attributed to the
 * sentinel owner below rather than to any character. Every bucket-by-owner
 * path treats it as just another owner; only the retrieval UI treats it
 * specially (the Judge's, by default).
 */
import { MODULE_ID } from "./constants.mjs";
import { acksExtras } from "../namespace.mjs";
import { ITEM_TYPE } from "./vocab.mjs";
import { toNum as num } from "./util.mjs";
import {
  coinCount, coinKind, coinKindKey, coinRate, coinSlots, coinTotalCp, planChange, planCoinSpend, planCoinPayUpTo,
} from "./money-logic.mjs";
import { STORAGE_KEY, containedInOf } from "./storage-logic.mjs";
import { arrivalOf } from "./bundles-logic.mjs";
import { registerHandler, executeAsGM } from "./sockets.mjs";

/** The storage owner of a location's own coin and goods. Not a real uuid on
 * purpose: nothing can resolve it, so no character can claim it. */
export const HOUSE_OWNER = `${MODULE_ID}:house`;

/** Is this document a location actor? */
const isLocation = (doc) => doc?.type === `${MODULE_ID}.location`;

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

/** Whose a coin row is where goods are kept for owners: its stamp, or the
 * holder's own where it carries none. */
const rowOwner = (row) => row?.flags?.[MODULE_ID]?.[STORAGE_KEY]?.ownerUuid ?? HOUSE_OWNER;

/**
 * Rows carried loose ahead of rows kept inside a container. A holder can keep
 * one kind of coin in both, and every path that picks among rows of one kind
 * takes the earlier: coin lands on the loose pile, and is spent from it, before
 * the one packed away.
 */
const looseFirst = (rows) => [...rows].sort((a, b) => Number(!!containedInOf(a)) - Number(!!containedInOf(b)));

/**
 * The coin rows that are a holder's OWN: an actor's purse, or a location's
 * house-owned stacks (a till never spends a depositor's coin). Loose rows come
 * first (`looseFirst`).
 * @returns {Item[]}
 */
export function ownCoin(holder) {
  return looseFirst(holder?.items?.filter((i) => i.type === ITEM_TYPE.money && rowOwner(i) === HOUSE_OWNER) ?? []);
}

/** What a holder's own coin is worth, in gold. */
export const purseGp = (holder) => coinTotalCp(ownCoin(holder)) / 100;

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
  // Otherwise, actor to actor: they share a scene. An unlinked (synthetic)
  // token actor is matched by its own token uuid, never by `id` — see
  // docs/lib/DECISIONS.md, "A reach check matches an unlinked token by its
  // own token, never by actor id (2026-09-22)".
  const standsOn = (scene, a) => {
    if (!a) return false;
    if (!a.isToken) return scene.tokens.some((t) => t.actorId === a.id);
    const own = a.token?.uuid ?? null;
    return !!own && scene.tokens.some((t) => t.uuid === own);
  };
  for (const scene of game.scenes ?? []) {
    if (standsOn(scene, from) && standsOn(scene, to)) return { can: true, reason: null };
  }
  return { can: false, reason: "notTogether" };
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
 * Land coin on a holder. Each credit is `{cv, count}` plus what says which
 * coin it is: `source` (a coin row's plain data — coin that MOVED keeps its
 * kind), or `name`, or neither for coin known only by its rate (a mint,
 * change), which lands on the row of that rate the holder already keeps.
 *
 * Coin merges into the holder's row of the same kind and never makes a
 * second; a kind the holder has none of is copied from `source`, else from a
 * coin of that kind the world already has (`coinTemplate`). Where goods are
 * kept for owners the rows are `ownerUuid`'s — the house's when none is given.
 *
 * @param {Actor} holder
 * @param {Array<{cv?: number, count: number, source?: object, name?: string}>} credits
 * @param {{ownerUuid?: string|null, ownerName?: string}} [opts]
 * @returns {Promise<{updates: number, creates: number}>} what was written, for the caller's receipt
 */
export async function creditCoin(holder, credits, { ownerUuid = null, ownerName = "" } = {}) {
  const owner = ownerUuid ?? HOUSE_OWNER;
  const mine = looseFirst(holder.items.filter((i) => i.type === ITEM_TYPE.money && rowOwner(i) === owner));
  const adds = new Map();
  const made = new Map();

  for (const credit of credits ?? []) {
    const count = Math.floor(num(credit?.count, 0));
    if (!(count > 0)) continue;
    const cv = credit.source ? coinRate(credit.source) : num(credit.cv, 1);
    const kind = credit.source ? coinKind(credit.source) : credit.name != null ? coinKindKey(credit.name, cv) : null;

    const row = kind === null ? mine.find((i) => coinRate(i) === cv) : mine.find((i) => coinKind(i) === kind);
    if (row) {
      adds.set(row.id, (adds.get(row.id) ?? 0) + count);
      continue;
    }
    const base = credit.source
      ?? (await coinTemplate({ cv, name: credit.name ?? null }))
      ?? { name: credit.name ?? standardCoinName(cv), type: ITEM_TYPE.money, img: "icons/svg/coins.svg", system: { coppervalue: cv } };
    const data = coinRowData(base, count);
    // Two credits of one kind in the same call make one row between them.
    const pending = made.get(coinKind(data));
    if (pending) {
      pending.system.quantity += count;
      continue;
    }
    if (ownerUuid || isLocation(holder)) {
      foundry.utils.setProperty(data, `flags.${MODULE_ID}.${STORAGE_KEY}`, { ownerUuid: owner, ...(ownerName ? { ownerName } : {}) });
    }
    made.set(coinKind(data), data);
  }

  const updates = [...adds].map(([id, add]) => ({ _id: id, "system.quantity": coinCount(holder.items.get(id)) + add }));
  const creates = [...made.values()];
  if (updates.length) await holder.updateEmbeddedDocuments("Item", updates);
  if (creates.length) await holder.createEmbeddedDocuments("Item", creates);
  return { updates: updates.length, creates: creates.length };
}

/** Apply a spend plan's takes to the holder's rows (never below zero). */
async function applyTakes(holder, takes) {
  const byItem = new Map();
  for (const t of takes) {
    const left = byItem.get(t.id)?.["system.quantity"] ?? coinCount(holder.items.get(t.id));
    byItem.set(t.id, { _id: t.id, "system.quantity": Math.max(0, left - t.take) });
  }
  if (byItem.size) await holder.updateEmbeddedDocuments("Item", [...byItem.values()]);
}

/** The coins a plan takes, as credits that carry the rows they came off. */
function takenAsCredits(holder, takes) {
  const byKind = new Map();
  for (const t of takes) {
    const item = holder.items.get(t.id);
    if (!item) continue;
    const key = coinKind(item);
    const entry = byKind.get(key) ?? { source: item.toObject(), cv: coinRate(item), count: 0 };
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

/**
 * Coin from nowhere — the Judge's mint: a market's liquidity, a reward, a
 * month's till. Standard denominations, largest first, each landing on the
 * holder's own row of that rate.
 * @returns {Promise<{updates: number, creates: number}>}
 */
export async function mintCoin(holder, gp, { ownerUuid = null, ownerName = "" } = {}) {
  if (!holder) return { updates: 0, creates: 0 };
  return creditCoin(holder, mintCredits(num(gp, 0) * 100), { ownerUuid, ownerName });
}

/**
 * Coin spent to nobody — the payee is off-stage and the coin leaves the
 * world. The spend policy is a transfer's; change is the coins being paid
 * held back first (`changeKeeping`), then the holder's own denominations,
 * largest first, and what those cannot represent comes back as standard small
 * coin, so a broken coin never costs more than was owed. Nothing is written
 * when the purse cannot cover the amount.
 * @returns {Promise<{ok: boolean, reason?: string, shortfallCp?: number, changeCp?: number}>}
 */
export async function sinkCoin(holder, gp) {
  const needCp = Math.round(num(gp, 0) * 100);
  if (needCp <= 0) return { ok: true, changeCp: 0 };
  if (!holder) return { ok: false, reason: "missing" };
  const rows = ownCoin(holder);
  const plan = planCoinSpend(coinSlots(rows), needCp);
  if (plan.shortfallCp > 0) return { ok: false, reason: "insufficient", shortfallCp: plan.shortfallCp };

  const left = new Map(rows.map((i) => [i.id, coinCount(i)]));
  const touched = new Set();
  for (const t of plan.takes) {
    left.set(t.id, Math.max(0, left.get(t.id) - t.take));
    touched.add(t.id);
  }
  const change = changeKeeping(
    plan.takes.map((t) => ({ kind: t.id, cv: t.cv, qty: t.take })),
    rows.map((i) => ({ kind: i.id, cv: coinRate(i) })),
    plan.changeCp,
  );
  for (const c of change.credits) {
    left.set(c.kind, left.get(c.kind) + c.count);
    touched.add(c.kind);
  }
  await holder.updateEmbeddedDocuments("Item", [...touched].map((id) => ({ _id: id, "system.quantity": left.get(id) })));
  if (change.remainderCp > 0) await creditCoin(holder, mintCredits(change.remainderCp));
  return { ok: true, changeCp: plan.changeCp };
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
 * @returns {{ok: boolean, reason?: string, changeCp?: number,
 *            paidCp?: number, arrearsCp?: number}}
 */
export async function transferCoin({ from, to, gp, reason = "", at = null, gate = true, allowMint = false, upTo = false } = {}) {
  const needCp = Math.round(num(gp, 0) * 100);
  if (needCp <= 0) return { ok: true };
  if (!from || !to) return { ok: false, reason: "missing" };

  if (gate) {
    const reach = coinReach(from, to);
    if (!reach.can) {
      ui?.notifications?.warn(game.i18n.format("ACKS-LIB.money.outOfReach", { reason: reach.reason ?? "?", detail: reason }));
      return { ok: false, reason: reach.reason ?? "outOfReach" };
    }
  }

  const place = at ?? (isLocation(to) ? to : isLocation(from) ? from : null);
  const terms = exchangeTermsAt(place);

  if (upTo) {
    const upPlan = planCoinPayUpTo(coinSlots(ownCoin(from)), needCp);
    if (!upPlan.takes.length && upPlan.shortCp === needCp && needCp > 0 && upPlan.paidCp === 0) {
      // Nothing representable at all — still a valid result; the caller books
      // the whole amount. Report rather than warn: partial pay is expected here.
      return { ok: true, paidCp: 0, arrearsCp: upPlan.shortCp };
    }
    const paidCoins = takenAsCredits(from, upPlan.takes);
    await applyTakes(from, upPlan.takes);
    await creditCoin(to, paidCoins);
    return { ok: true, paidCp: upPlan.paidCp, arrearsCp: upPlan.shortCp };
  }

  let plan = planCoinSpend(coinSlots(ownCoin(from)), needCp);
  if (plan.shortfallCp > 0 && allowMint && terms.mode === "market" && isLocation(from)) {
    // Market liquidity: the till covers what its stacks cannot, in gold.
    await creditCoin(from, [{ cv: 100, count: Math.ceil(plan.shortfallCp / 100) }]);
    plan = planCoinSpend(coinSlots(ownCoin(from)), needCp);
  }
  if (plan.shortfallCp > 0) {
    ui?.notifications?.warn(game.i18n.format("ACKS-LIB.money.insufficient", { name: from.name, detail: reason }));
    return { ok: false, reason: "insufficient", shortfallCp: plan.shortfallCp };
  }

  // Change must be POSSIBLE before anything moves, and it is made EXACTLY: out
  // of the coins being handed over first — those simply stay — then out of
  // the payee's own stacks. A market till that cannot is not refused —
  // minting is what "exchanges freely" means. Barter refuses instead.
  let takes = plan.takes;
  const handBack = [];
  let mintedCp = 0;
  if (plan.changeCp > 0) {
    const change = changeKeeping(
      plan.takes.map((t, i) => ({ kind: `kept:${i}`, cv: t.cv, qty: t.take })),
      ownCoin(to).map((i) => ({ kind: `own:${i.id}`, cv: coinRate(i), qty: coinCount(i) })),
      plan.changeCp,
    );
    if (change.remainderCp > 0 && terms.mode !== "market") {
      ui?.notifications?.warn(game.i18n.format("ACKS-LIB.money.noChange", { name: to.name, detail: reason }));
      return { ok: false, reason: "noChange", changeCp: plan.changeCp };
    }
    if (change.remainderCp > 0) {
      mintedCp = plan.changeCp;
    } else {
      // A coin that would be handed over and handed straight back never leaves
      // the payer's purse.
      const kept = new Map();
      for (const c of change.credits) {
        if (c.kind.startsWith("own:")) handBack.push({ id: c.kind.slice(4), cv: c.cv, take: c.count });
        else kept.set(Number(c.kind.slice(5)), c.count);
      }
      takes = plan.takes.map((t, i) => ({ ...t, take: t.take - (kept.get(i) ?? 0) })).filter((t) => t.take > 0);
    }
  }

  // Move: the payer loses the coins paid and the payee gains them; the payee
  // loses the change and the payer gains it.
  const paidCoins = takenAsCredits(from, takes);
  const changeCoins = takenAsCredits(to, handBack);
  await applyTakes(from, takes);
  await creditCoin(to, paidCoins);
  await applyTakes(to, handBack);
  await creditCoin(from, mintedCp > 0 ? mintCredits(mintedCp) : changeCoins);
  return { ok: true, changeCp: plan.changeCp };
}

/**
 * Exchange one coin kind for another at a place, at face value — the changer's
 * service. Only a market offers it (its till absorbs the old coin and pays
 * the new, minting freely); anywhere else the answer is the barter warning.
 * The remainder below the target denomination comes back in standard small
 * coin, so the actor never loses value to the split.
 *
 * The exchange writes BOTH sides: the actor's coin goes down and the till's
 * goes up. A seat that cannot write the place would debit itself and then fail
 * the credit, so it relays the whole exchange to the GM instead
 * (`libExchangeCoins`); the result shape is the same either way.
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

/** The two writes of a coin exchange, run by a seat that may make both. */
async function applyExchange({ actor, place, itemId, count, toCv }) {
  const item = actor.items.get(itemId);
  if (item?.type !== ITEM_TYPE.money) return { ok: false, reason: "nothingToChange" };
  const cv = coinRate(item);
  const have = coinCount(item);
  count = Math.min(Math.max(1, Math.round(num(count, 0))), have);
  toCv = num(toCv, 0);
  if (cv <= 0 || count <= 0 || toCv <= 0) return { ok: false, reason: "nothingToChange" };

  const totalCp = cv * count;
  // The old coin goes to the till; the new comes out of it.
  const taken = [{ source: item.toObject(), count }];
  await actor.updateEmbeddedDocuments("Item", [{ _id: item.id, "system.quantity": have - count }]);
  await creditCoin(place, taken);
  const out = [];
  const wanted = Math.floor(totalCp / toCv);
  if (wanted > 0) out.push({ cv: toCv, count: wanted });
  const remainder = totalCp - wanted * toCv;
  if (remainder > 0) out.push(...mintCredits(remainder));
  await creditCoin(actor, out);
  return { ok: true, paidOutCp: totalCp };
}

/** Resolve an actor or token uuid to its actor, or null. */
async function actorFromUuid(uuid) {
  const doc = await foundry.utils.fromUuid(uuid).catch(() => null);
  return doc?.actor ?? doc ?? null;
}

// The relayed exchange: the sender must own the actor whose coin moves, and
// the GM's own preflight (terms, reach) runs again — nothing the seat checked
// is taken on trust.
registerHandler("libExchangeCoins", async ({ actorUuid, placeUuid, requestUserId = null, ...rest }) => {
  const actor = await actorFromUuid(actorUuid);
  const place = await actorFromUuid(placeUuid);
  if (!actor || !place) return { ok: false, reason: "missing" };
  if (requestUserId) {
    const user = game.users.get(requestUserId);
    if (!user?.isGM && !actor.testUserPermission(user, "OWNER")) return { ok: false, reason: "notYours" };
  }
  return exchangeCoins({ actor, place, ...rest, gate: true });
});
