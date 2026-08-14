/* global game, ui, foundry */
/**
 * Money is a physical thing that always sits somewhere (owner ruling,
 * 2026-08-14). A payment is therefore a TRANSFER: the coins taken from the
 * payer land on the payee's stacks — an actor's purse, or a location's till —
 * and change comes BACK from the payee's stacks by the same arithmetic. Coin
 * is never burned by a payment; a Judge who genuinely wants coin gone deletes
 * the stack, and owns that choice.
 *
 * The transfer is LOCATION-GATED before any denomination math: the payer's
 * coin must be somewhere it can actually reach the payee. For a location
 * payee that is the storage-reach rule (standing there, an owned vault, a
 * pinned place); for an actor payee it is sharing a scene. `gate: false` is
 * the Judge's override, as everywhere.
 *
 * Exchange terms come from the PLACE (owner ruling): a market exchanges
 * denominations freely — its till always makes change, minting small coin as
 * needed, which is what "freely" means mechanically — while a placeless deal
 * or a market-less place must barter: change only exists if the payee's own
 * stacks can represent it, and a transfer that cannot be changed refuses
 * whole rather than silently overcharging.
 *
 * The HOUSE pile: a location's own coin is storage-attributed to the sentinel
 * owner below rather than to any character. Every bucket-by-owner path treats
 * it as just another owner; only the retrieval UI treats it specially (the
 * Judge's, by default).
 */
import { MODULE_ID } from "./constants.mjs";
import { acksExtras } from "../namespace.mjs";
import { ITEM_TYPE, ACTOR_TYPE } from "./vocab.mjs";
import { toNum as num } from "./util.mjs";
import { coinKind, coinSlots, planCoinSpend, planCoinPayUpTo } from "./money-logic.mjs";
import { STORAGE_KEY } from "./storage-logic.mjs";

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

/** Plain coin items a holder can SPEND from: an actor's own purse+bank, or a
 * location's house-owned stacks (a till never spends a depositor's coin). */
function spendableCoinItems(holder) {
  const items = [...(holder?.items ?? [])].map((i) => i.toObject());
  if (!isLocation(holder)) return items.filter((i) => i.type === ITEM_TYPE.money);
  return items.filter(
    (i) => i.type === ITEM_TYPE.money && (i.flags?.[MODULE_ID]?.[STORAGE_KEY]?.ownerUuid ?? HOUSE_OWNER) === HOUSE_OWNER,
  );
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
  // Otherwise, actor to actor: they share a scene (a hand can reach a hand).
  for (const scene of game.scenes ?? []) {
    const has = (a) => scene.tokens.some((t) => t.actorId === a.id);
    if (has(from) && has(to)) return { can: true, reason: null };
  }
  return { can: false, reason: "notTogether" };
}

/** Merge credits ({name, img, cv, count}) into a holder's stacks by coin KIND,
 * creating missing kinds. Location credits are house-owned unless told
 * otherwise. Returns the applied updates/creates for the caller's receipt. */
export async function creditCoin(holder, credits, { ownerUuid = null, toBank = false } = {}) {
  const field = toBank ? "quantitybank" : "quantity";
  const updates = [];
  const creates = [];
  for (const credit of credits) {
    if (!credit.count) continue;
    const match = holder.items.find(
      (i) => i.type === ITEM_TYPE.money && coinKind(i) === `${String(credit.name).trim().toLowerCase()}|${credit.cv}` &&
        (!isLocation(holder) || (i.getFlag(MODULE_ID, STORAGE_KEY)?.ownerUuid ?? HOUSE_OWNER) === (ownerUuid ?? HOUSE_OWNER)),
    );
    if (match) {
      updates.push({ _id: match.id, [`system.${field}`]: num(match.system?.[field], 0) + credit.count });
    } else {
      const data = {
        name: credit.name,
        type: "money",
        img: credit.img ?? "icons/svg/coins.svg",
        system: { coppervalue: credit.cv, quantity: toBank ? 0 : credit.count, quantitybank: toBank ? credit.count : 0 },
      };
      if (isLocation(holder)) {
        foundry.utils.setProperty(data, `flags.${MODULE_ID}.${STORAGE_KEY}`, { ownerUuid: ownerUuid ?? HOUSE_OWNER });
      }
      creates.push(data);
    }
  }
  if (updates.length) await holder.updateEmbeddedDocuments("Item", updates);
  if (creates.length) await holder.createEmbeddedDocuments("Item", creates);
  return { updates: updates.length, creates: creates.length };
}

/** Apply a spend plan's takes to the holder's items (never below zero). */
async function applyTakes(holder, takes) {
  const byItem = new Map();
  for (const t of takes) {
    const u = byItem.get(t.id) ?? { _id: t.id };
    const item = holder.items.get(t.id);
    u[`system.${t.field}`] = Math.max(0, num(item?.system?.[t.field], 0) - t.take);
    byItem.set(t.id, u);
  }
  if (byItem.size) await holder.updateEmbeddedDocuments("Item", [...byItem.values()]);
}

/** The coins a plan takes, grouped as credits for the receiving side. */
function takenAsCredits(holder, takes) {
  const byKind = new Map();
  for (const t of takes) {
    const item = holder.items.get(t.id);
    if (!item) continue;
    const key = coinKind(item);
    const entry = byKind.get(key) ?? { name: item.name, img: item.img, cv: num(item.system?.coppervalue, 0), count: 0 };
    entry.count += t.take;
    byKind.set(key, entry);
  }
  return [...byKind.values()];
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
 * @param {boolean} [opts.toBank=false]  credit the payee's banked field
 * @param {boolean} [opts.upTo=false]  pay only what the purse represents
 *                              EXACTLY — no coin broken, no change owed; the
 *                              uncovered remainder comes back as `arrearsCp`
 *                              for the caller to book (how wages survive a
 *                              world with no changer in reach)
 * @returns {{ok: boolean, reason?: string, changeCp?: number,
 *            paidCp?: number, arrearsCp?: number}}
 */
export async function transferCoin({ from, to, gp, reason = "", at = null, gate = true, allowMint = false, toBank = false, upTo = false } = {}) {
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
    const upPlan = planCoinPayUpTo(coinSlots(spendableCoinItems(from)), needCp);
    if (!upPlan.takes.length && upPlan.shortCp === needCp && needCp > 0 && upPlan.paidCp === 0) {
      // Nothing representable at all — still a valid result; the caller books
      // the whole amount. Report rather than warn: partial pay is expected here.
      return { ok: true, paidCp: 0, arrearsCp: upPlan.shortCp };
    }
    const paidCoins = takenAsCredits(from, upPlan.takes);
    await applyTakes(from, upPlan.takes);
    await creditCoin(to, paidCoins, { toBank });
    return { ok: true, paidCp: upPlan.paidCp, arrearsCp: upPlan.shortCp };
  }

  let plan = planCoinSpend(coinSlots(spendableCoinItems(from)), needCp);
  if (plan.shortfallCp > 0 && allowMint && terms.mode === "market" && isLocation(from)) {
    // Market liquidity: the till covers what its stacks cannot, in gold.
    await creditCoin(from, [{ name: game.i18n.localize("ACKS-LIB.money.gpName"), cv: 100, count: Math.ceil(plan.shortfallCp / 100) }]);
    plan = planCoinSpend(coinSlots(spendableCoinItems(from)), needCp);
  }
  if (plan.shortfallCp > 0) {
    ui?.notifications?.warn(game.i18n.format("ACKS-LIB.money.insufficient", { name: from.name, detail: reason }));
    return { ok: false, reason: "insufficient", shortfallCp: plan.shortfallCp };
  }

  // Change must be POSSIBLE before anything moves: the payee (with the coins
  // about to arrive) makes it by the same arithmetic. A market till always
  // can — minting is what "exchanges freely" means. Barter refuses instead.
  let changePlan = null;
  if (plan.changeCp > 0) {
    const payeeItems = [...spendableCoinItems(to), ...takenAsCredits(from, plan.takes).map((c, i) => ({
      _id: `incoming-${i}`, type: "money", name: c.name, img: c.img,
      system: { coppervalue: c.cv, quantity: c.count, quantitybank: 0 },
    }))];
    changePlan = planCoinSpend(coinSlots(payeeItems), plan.changeCp);
    if (changePlan.shortfallCp > 0) {
      if (terms.mode === "market") {
        changePlan = null; // mint the change outright below
      } else {
        ui?.notifications?.warn(game.i18n.format("ACKS-LIB.money.noChange", { name: to.name, detail: reason }));
        return { ok: false, reason: "noChange", changeCp: plan.changeCp };
      }
    }
  }

  // Move: payer loses the taken coins; payee gains them; change comes back.
  const paidCoins = takenAsCredits(from, plan.takes);
  await applyTakes(from, plan.takes);
  await creditCoin(to, paidCoins, { toBank });
  if (plan.changeCp > 0) {
    if (changePlan) {
      // The change plan ran against payee stacks INCLUDING the incoming coins,
      // which are now real rows on the payee — re-plan on live items so the
      // takes reference real ids, then hand the changed coins to the payer.
      const live = planCoinSpend(coinSlots(spendableCoinItems(to)), plan.changeCp);
      if (live.shortfallCp === 0) {
        const changeCoins = takenAsCredits(to, live.takes);
        await applyTakes(to, live.takes);
        await creditCoin(from, changeCoins);
      } else if (terms.mode === "market") {
        await creditCoin(from, mintChange(plan.changeCp));
      }
    } else {
      await creditCoin(from, mintChange(plan.changeCp));
    }
  }
  return { ok: true, changeCp: plan.changeCp };
}

/** Change minted by a market: standard denominations, largest first. */
function mintChange(cp) {
  const denoms = [
    { name: game.i18n.localize("ACKS-LIB.money.gpName"), cv: 100 },
    { name: game.i18n.localize("ACKS-LIB.money.spName"), cv: 10 },
    { name: game.i18n.localize("ACKS-LIB.money.cpName"), cv: 1 },
  ];
  const credits = [];
  let owed = Math.round(cp);
  for (const d of denoms) {
    const count = Math.floor(owed / d.cv);
    if (count > 0) { credits.push({ ...d, count }); owed -= count * d.cv; }
  }
  return credits;
}
