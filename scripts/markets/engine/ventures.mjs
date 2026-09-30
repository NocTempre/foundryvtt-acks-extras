/* global game, foundry, Hooks, ChatMessage, Roll, fromUuid */
/**
 * Arbitrage ventures (RR §VIII.6), time-queued: entering the market,
 * assessing supply and demand, and soliciting buyers or sellers are each a
 * DEDICATED DAY — posted now, resolved by the due-work sweep once their day
 * has passed. Trading merchandise spends what a resolved solicitation
 * opened, at the month's rolled market price, with the optional spot-price
 * negotiation. Steady trade routes/networks are future work (ROADMAP).
 */
import { MODULE_ID, LANG, ITEM_FLAG } from "../constants.mjs";
import {
  parseStones,
  parseTollCpPerSt,
  marketImpact,
  assessmentOutcome,
  merchMarketPriceCp,
  negotiationOutcome,
  solicitedStones,
} from "../rules/arbitrage.mjs";
import { toGp } from "../rules/pricing.mjs";
import { trueDemand } from "../rules/demand.mjs";
import { registerHandler, executeAsGM } from "../../lib/sockets.mjs";
import { ITEM_TYPE } from "../../lib/vocab.mjs";
import { judgesAndOwners } from "../../lib/util.mjs";
import { optTable } from "../../henchmen/rules/tables.mjs";
import { findRow } from "../../lib/tables.mjs";
import { now } from "../../henchmen/time.mjs";
import * as adapter from "../../henchmen/acks-adapter.mjs";
import { partyOf } from "./parties.mjs";
import { marketMonthStart, abilityRanks } from "./trade.mjs";
import { impactLimits, assessmentBands, priceShifts, negotiation, printedError } from "./printed.mjs";
import { merchandiseCatalog, merchandiseFor } from "./merchandise.mjs";
import { writeReport } from "./trade-objects.mjs";

const SECONDS_PER_DAY = 86400;
const err = (error, data = {}) => ({ error, ...data });

const clone = (rows) => (rows ?? []).map((r) => r.toObject?.() ?? foundry.utils.deepClone(r));

/** Whispered card to the GM and an actor's owners. */
async function postCard(actor, html) {
  const whisper = judgesAndOwners(actor);
  await ChatMessage.create({
    content: `<div class="acks-extras-markets-receipt">${html}</div>`,
    whisper,
    speaker: ChatMessage.getSpeaker({ actor }),
  });
}

/** The imported Market Characteristics row for a class (null when absent). */
function characteristicsFor(marketClass) {
  const rows = optTable("mercantile", "marketCharacteristics")?.rows ?? [];
  return findRow(rows, (r) => Number(r.marketClass) === Number(marketClass)) ?? null;
}

/**
 * The imported table a dedicated day's kind cannot resolve without, when it is
 * unread: entering needs the impact limits, assessing its result bands,
 * soliciting the monthly price shifts. Null when the day can go ahead.
 */
function venturePrerequisite(kind) {
  if (kind === "enter" && !impactLimits()) return "impactProse";
  if (kind === "assess" && !assessmentBands()) return "assessmentProse";
  if (kind === "solicit" && !priceShifts()) return "priceShiftProse";
  return null;
}

/**
 * Tell an action's actor (and the GM) that a day could not resolve because an
 * imported table is absent. The action is spent; the card names the table and
 * the way to import it, so the failure is never silent.
 */
async function postTableMissing(actor, location, action, tableKey, log, t) {
  const table = game.i18n.localize(`${LANG}.ventures.table.${tableKey}`);
  log.push({ time: t, type: "ventureFailed", note: `${actor.name}: ${action.kind} could not resolve (${table} table not imported)` });
  await postCard(
    actor,
    `<strong>${game.i18n.format(`${LANG}.ventures.tableMissing`, {
      name: actor.name,
      kind: game.i18n.localize(`${LANG}.ventures.kind.${action.kind}`),
      location: location.name,
      table,
    })}</strong>`
  );
}

/** Stones of one merchandise category an actor carries as loads (one unit per stone, across every load item). */
export function loadsHeld(actor, category) {
  return (actor?.items ?? [])
    .filter((i) => i.type === ITEM_TYPE.item && i.getFlag(MODULE_ID, ITEM_FLAG)?.merchandise && i.getFlag(MODULE_ID, ITEM_FLAG)?.category === category)
    .reduce((sum, i) => sum + Math.max(0, Number(i.system?.quantity?.value ?? 0) || 0), 0);
}

/** This party's venture row for the month, if any. */
export function ventureOf(location, partyId, monthStart = marketMonthStart()) {
  return (location.system.market?.goods?.ventures ?? []).find(
    (v) => v.partyId === partyId && Number(v.monthStartTime) === monthStart
  );
}

/**
 * Post a dedicated-day venture action. Entering pays the toll NOW (the
 * gate collects on arrival); the rest of the day's outcome lands when the
 * sweep resolves it.
 */
export async function postVentureAction(location, payload) {
  const { kind, actorUuid, category = "", cargoSt = 0, requestUserId = null, resolutionId = "" } = payload;
  const actorDoc = await fromUuid(actorUuid).catch(() => null);
  const actor = actorDoc?.actor ?? actorDoc;
  if (!actor) return err("noBuyer");
  const goods = location?.system?.market?.goods;
  if (!goods) return err("noMarket");
  if (requestUserId) {
    const user = game.users.get(requestUserId);
    if (!user?.isGM && !actor.testUserPermission(user, "OWNER")) return err("notYours");
  }
  const actions = clone(goods.actions);
  if (resolutionId && actions.some((a) => a.id === resolutionId)) return err("duplicate");
  // Refused now, before the toll is taken, rather than spent as a day that cannot resolve.
  const unread = venturePrerequisite(kind);
  if (unread) return printedError(unread);

  const t = now();
  const monthStart = marketMonthStart(t);
  const party = partyOf(actor);
  const venture = ventureOf(location, party.id, monthStart);
  let tollCp = 0;

  if (kind === "enter") {
    if (venture?.entered) return err("alreadyEntered");
    if (actions.some((a) => a.status === "pending" && a.kind === "enter" && a.partyId === party.id)) return err("alreadyEntered");
    const ch = characteristicsFor(location.system.marketClass);
    if (!ch) return err("noCharacteristics");
    tollCp = Math.ceil(parseTollCpPerSt(ch.toll) * Math.max(0, Number(cargoSt) || 0));
    if (tollCp > 0) {
      const paid = await adapter.spendGold(actor, toGp(tollCp), game.i18n.localize(`${LANG}.ventures.tollReason`), { to: location, at: location });
      if (!paid) return err("insufficientGold");
    }
  } else {
    if (!venture?.entered) return err("notEntered");
    if (kind === "solicit" && !merchandiseFor(category)) return err("noCategory");
  }

  const action = {
    id: resolutionId || foundry.utils.randomID(),
    kind,
    partyId: party.id,
    actorUuid: actor.uuid,
    category,
    cargoSt: Math.max(0, Number(cargoSt) || 0),
    postedTime: t,
    resolveTime: t + SECONDS_PER_DAY,
    status: "pending",
    detail: tollCp > 0 ? `toll ${toGp(tollCp)}gp` : "",
  };
  const log = clone(location.system.market.marketLog);
  log.push({ time: t, type: "ventureAction", note: `${actor.name}: ${kind}${category ? ` (${category})` : ""} posted [${action.id}]` });
  await location.update({
    "system.market.goods.actions": [...actions, action],
    "system.market.marketLog": log.slice(-300),
  });
  return { ok: true, resolveTime: action.resolveTime };
}

/** Random distinct merchandise categories, from the whole catalogue (a Judge's own goods included). */
function randomCategories(n) {
  const keys = merchandiseCatalog().map((m) => m.key);
  const out = [];
  while (out.length < Math.min(n, keys.length)) {
    const k = keys[Math.floor(Math.random() * keys.length)];
    if (!out.includes(k)) out.push(k);
  }
  return out;
}

/** The truth: the market's true demand modifier for a category (0 unset). */
const trueDm = (goods, category) => trueDemand(goods, category);

/** Roll and record the month's market price for a category, if not yet. */
async function ensureMerchPrice(goods, merchPrices, category, marketClass, monthStart) {
  let row = merchPrices.find((p) => p.category === category && Number(p.monthStartTime) === monthStart);
  if (row) return row;
  const merch = merchandiseFor(category);
  const shifts = priceShifts();
  if (!merch || !shifts) return null;
  const basePriceCp = Math.round((Number(merch.pricePerStoneGp) || 0) * 100);
  const stepCp = Math.max(1, Math.round((Number(merch.priceStepGp) || 0) * 100));
  const roll = (await new Roll("4d4").evaluate()).total;
  const { priceCp, steps } = merchMarketPriceCp({
    basePriceCp,
    stepCp,
    roll4d4: roll,
    dm: trueDm(goods, category),
    marketClass,
    grain: category === "grainVegetables",
    season: null, // the Judge's calendar season is future work
    ...shifts,
  });
  row = { category, monthStartTime: monthStart, priceCp, detail: `4d4 ${roll} → ${steps >= 0 ? "+" : ""}${steps} steps` };
  merchPrices.push(row);
  return row;
}

/**
 * Resolve due venture actions (called from the due-work sweep). Returns the
 * updated arrays to write, or null when nothing was due.
 */
export async function processVentureActions(location, log, t) {
  const goods = location.system.market?.goods;
  if (!goods) return null;
  const actions = clone(goods.actions);
  const due = actions.filter((a) => a.status === "pending" && Number(a.resolveTime) <= t);
  if (!due.length) return null;

  const monthStart = marketMonthStart(t);
  const ventures = clone(goods.ventures);
  const merchPrices = clone(goods.merchPrices);
  const solicitations = clone(goods.solicitations);

  for (const action of due) {
    action.status = "done";
    const actorDoc = await fromUuid(action.actorUuid).catch(() => null);
    const actor = actorDoc?.actor ?? actorDoc;
    if (!actor) continue;

    if (action.kind === "enter") {
      const ch = characteristicsFor(location.system.marketClass);
      if (!ch) {
        await postTableMissing(actor, location, action, "marketCharacteristics", log, t);
        continue;
      }
      const limits = impactLimits();
      if (!limits) {
        await postTableMissing(actor, location, action, "impactProse", log, t);
        continue;
      }
      const { impact, effectiveClass } = marketImpact({
        ...limits,
        cargoSt: action.cargoSt,
        baselineCargoSt: parseStones(ch.baselineCargo),
        marketClass: Number(location.system.marketClass) || 6,
        urbanFamilies: Number(location.system.market.urbanFamilies) || 0,
        baselineOfClass: (cls) => parseStones(characteristicsFor(cls)?.baselineCargo),
      });
      const existing = ventures.find((v) => v.partyId === action.partyId && Number(v.monthStartTime) === monthStart);
      const row = existing ?? { partyId: action.partyId, monthStartTime: monthStart, cargoSt: 0, impact: 0, effectiveClass: 0, tollCp: 0, entered: false };
      if (!existing) ventures.push(row);
      row.cargoSt = action.cargoSt;
      row.impact = impact;
      row.effectiveClass = effectiveClass;
      // The toll was paid when the action was posted; the row records it.
      row.tollCp = Math.ceil(parseTollCpPerSt(ch.toll) * Math.max(0, Number(action.cargoSt) || 0));
      row.entered = true;
      log.push({ time: t, type: "ventureEntered", note: `${actor.name}: entered the market, impact ${impact}` });
      await postCard(actor, `<strong>${game.i18n.format(`${LANG}.ventures.enteredLine`, { name: actor.name, location: location.name, impact })}</strong>`);
    }

    if (action.kind === "assess") {
      // A report is written on the trade house, which only the GM's seat can
      // write; a player's client leaves the day for the GM's sweep.
      if (!game.user.isGM) {
        action.status = "pending";
        continue;
      }
      const bands = assessmentBands();
      if (!bands) {
        await postTableMissing(actor, location, action, "assessmentProse", log, t);
        continue;
      }
      const roll = await new Roll("2d6").evaluate();
      const total = roll.total + adapter.getChaMod(actor);
      const outcome = assessmentOutcome(total, bands);
      const catalog = merchandiseCatalog();
      const beliefs = [];
      const believe = (category, dm) => beliefs.push({ category, dm });
      if (outcome === "success") {
        for (const m of catalog) believe(m.key, trueDm(goods, m.key));
      } else if (outcome === "partial") {
        for (const c of randomCategories((await new Roll("1d6").evaluate()).total)) believe(c, trueDm(goods, c));
      } else if (outcome === "expertise") {
        // Expertise reveals only categories the assessor works in: an
        // Art/Craft/Profession ability at 2+ ranks whose name contains the
        // category's label (or vice versa).
        for (const m of catalog) {
          const label = String(m.label).toLowerCase();
          const expert = actor.items.some((i) => {
            if (i.type !== ITEM_TYPE.ability) return false;
            const n = String(i.name).toLowerCase();
            // The merged proficiency is printed "Art/Craft (weaving)", so the
            // slash form is tried FIRST — alternation is leftmost-first, and
            // matching the bare "art" left "/craft (weaving" behind, which no
            // merchandise label contains.
            const related = n.includes(label) || label.includes(n.replace(/^(art\/craft|art|craft|profession)\s*\(?/, "").replace(/\)$/, ""));
            return related && abilityRanks(actor, i.name) >= 2;
          });
          if (expert) believe(m.key, trueDm(goods, m.key));
        }
      } else if (outcome === "false") {
        for (const c of randomCategories((await new Roll("1d6").evaluate()).total)) {
          const wrong = trueDm(goods, c) + ((await new Roll("1d6").evaluate()).total >= 4 ? 1 : -1) * (await new Roll("1d3").evaluate()).total;
          believe(c, wrong);
        }
      }
      // ONE report per assessment that learned anything; the false outcome is
      // stored as it fell, and every surface shows a non-GM a partial.
      if (beliefs.length) {
        const written = await writeReport({
          ownerUuid: actor.uuid,
          marketUuid: location.uuid,
          marketName: location.name,
          assessorUuid: actor.uuid,
          partyId: action.partyId,
          time: t,
          outcome,
          beliefs,
        }).catch((error) => ({ error: String(error?.message ?? error) }));
        if (written.error) {
          // The day is kept, not spent: the sweep tries it again.
          console.error(`${MODULE_ID} | the assessment report could not be written (${written.error}) for ${actor.name} at ${location.name}`);
          action.status = "pending";
          continue;
        }
      }
      log.push({ time: t, type: "ventureAssessed", note: `${actor.name}: assessment ${outcome} (${beliefs.length} DMs)` });
      await postCard(
        actor,
        `<strong>${game.i18n.format(`${LANG}.ventures.assessedLine`, { name: actor.name })}</strong><br>` +
          // The FALSE outcome reads as a partial assessment to the party —
          // only the Judge's copy names it (2d6 detail stays GM-side).
          game.i18n.format(`${LANG}.ventures.assessed.${outcome === "false" ? "partial" : outcome}`, { n: beliefs.length })
      );
    }

    if (action.kind === "solicit") {
      const venture = ventures.find((v) => v.partyId === action.partyId && Number(v.monthStartTime) === monthStart);
      const merch = merchandiseFor(action.category);
      if (!merch) {
        await postTableMissing(actor, location, action, "merchandiseTypes", log, t);
        continue;
      }
      if (!priceShifts()) {
        await postTableMissing(actor, location, action, "priceShiftProse", log, t);
        continue;
      }
      if (!venture?.entered) continue;
      const price = await ensureMerchPrice(goods, merchPrices, action.category, Number(location.system.marketClass) || 6, monthStart);
      if (!price) continue;
      const gained = solicitedStones({
        baseStones: Number(merch.dailyStones?.[(venture.effectiveClass || location.system.marketClass) - 1]) || 0,
        impact: venture.impact,
      });
      const srow =
        solicitations.find((s) => s.partyId === action.partyId && s.category === action.category && Number(s.monthStartTime) === monthStart) ??
        (() => {
          const fresh = { partyId: action.partyId, category: action.category, monthStartTime: monthStart, stones: 0 };
          solicitations.push(fresh);
          return fresh;
        })();
      srow.stones += gained;
      log.push({ time: t, type: "ventureSolicited", note: `${actor.name}: solicited ${action.category} (+${gained} st @ ${toGp(price.priceCp)}gp/st)` });
      await postCard(
        actor,
        `<strong>${game.i18n.format(`${LANG}.ventures.solicitedLine`, { name: actor.name, label: merch.label })}</strong><br>` +
          game.i18n.format(`${LANG}.ventures.solicitedDetail`, { stones: Math.floor(srow.stones), price: toGp(price.priceCp) })
      );
    }
  }

  return { actions, ventures, merchPrices, solicitations };
}

/**
 * Trade merchandise against a solicitation: buy loads in, or sell loads
 * from the trader's packs, at the month's market price — one optional
 * negotiation swings the spot price a step (or slams the door).
 */
export async function tradeMerchandise(location, payload) {
  const { actorUuid, category, stones: rawStones, direction, negotiate = false, requestUserId = null, resolutionId = "" } = payload;
  const stones = Math.max(1, Math.floor(Number(rawStones) || 1));
  const actorDoc = await fromUuid(actorUuid).catch(() => null);
  const actor = actorDoc?.actor ?? actorDoc;
  if (!actor) return err("noBuyer");
  const goods = location?.system?.market?.goods;
  if (!goods) return err("noMarket");
  if (requestUserId) {
    const user = game.users.get(requestUserId);
    if (!user?.isGM && !actor.testUserPermission(user, "OWNER")) return err("notYours");
  }
  const log = clone(location.system.market.marketLog);
  if (resolutionId && log.some((l) => l.note?.includes(resolutionId))) return err("duplicate");

  const t = now();
  const monthStart = marketMonthStart(t);
  const party = partyOf(actor);
  const venture = ventureOf(location, party.id, monthStart);
  if (!venture?.entered) return err("notEntered");

  const solicitations = clone(goods.solicitations);
  const srow = solicitations.find((s) => s.partyId === party.id && s.category === category && Number(s.monthStartTime) === monthStart);
  if (!srow || Math.floor(srow.stones) < stones) return err("notSolicited", { remaining: Math.floor(srow?.stones ?? 0) });

  const merchPrices = clone(goods.merchPrices);
  const price = merchPrices.find((p) => p.category === category && Number(p.monthStartTime) === monthStart);
  const merch = merchandiseFor(category);
  if (!price || !merch) return err("noCategory");
  const stepCp = Math.max(1, Math.round((Number(merch.priceStepGp) || 0) * 100));

  // Spot-price negotiation (RR §VIII.6 step 5): the merchant profile is the
  // book's typical trader for the tier, sharpened on a 1d6 over the class.
  const printed = negotiate ? negotiation() : null;
  if (negotiate && !printed) return printedError("negotiationProse");
  let unitCp = price.priceCp;
  let negotiationLine = null;
  if (negotiate) {
    const typical = merch.tier === "precious" ? printed.precious : printed.common;
    const merchantCha = typical.cha;
    let merchantRanks = typical.ranks;
    if ((await new Roll("1d6").evaluate()).total > (Number(location.system.marketClass) || 6)) merchantRanks += printed.extraRanks;
    const roll = await new Roll("2d6").evaluate();
    const total = roll.total + adapter.getChaMod(actor) + printed.rankStep * abilityRanks(actor, "Bargaining") - merchantCha - printed.rankStep * merchantRanks;
    const outcome = negotiationOutcome(total, roll.total, printed.bands);
    negotiationLine = game.i18n.format(`${LANG}.ventures.negotiation.${outcome}`, { total });
    if (outcome === "outrage") return err("negotiationOutrage");
    if (outcome === "grudging" || outcome === "agreement") {
      unitCp = Math.max(stepCp, unitCp + (direction === "sell" ? stepCp : -stepCp));
    }
  }

  const totalGp = toGp(unitCp * stones);
  const label = merch.label;

  if (direction === "buy") {
    const paid = await adapter.spendGold(actor, totalGp, game.i18n.format(`${LANG}.ventures.buyReason`, { stones, label }), { to: location, at: location });
    if (!paid) return err("insufficientGold");
    // Merchandise loads: one item per category, one unit per stone.
    const carried = actor.items.find(
      (i) => i.type === ITEM_TYPE.item && i.getFlag(MODULE_ID, ITEM_FLAG)?.merchandise && i.getFlag(MODULE_ID, ITEM_FLAG)?.category === category
    );
    if (carried) {
      await carried.update({ "system.quantity.value": Number(carried.system.quantity?.value ?? 0) + stones });
    } else {
      await actor.createEmbeddedDocuments("Item", [
        {
          name: label,
          type: ITEM_TYPE.item,
          img: "icons/containers/bags/sack-simple-leather-brown.webp",
          system: {
            quantity: { value: stones, max: 0 },
            cost: Number(merch.pricePerStoneGp) || 0,
            weight6: 6, // one stone per unit
            description: game.i18n.format(`${LANG}.ventures.loadDescription`, { label, location: location.name }),
          },
          flags: { [MODULE_ID]: { [ITEM_FLAG]: { merchandise: true, category } } },
        },
      ]);
    }
  } else {
    const carried = actor.items.find(
      (i) => i.type === ITEM_TYPE.item && i.getFlag(MODULE_ID, ITEM_FLAG)?.merchandise && i.getFlag(MODULE_ID, ITEM_FLAG)?.category === category
    );
    const held = Number(carried?.system?.quantity?.value ?? 0);
    if (!carried || held < stones) return err("noLoads", { remaining: held });
    if (held > stones) await carried.update({ "system.quantity.value": held - stones });
    else await carried.delete();
    await adapter.grantGold(actor, totalGp, { from: location, at: location, allowMint: true });
  }

  srow.stones -= stones;
  const stamp = resolutionId ? ` [${resolutionId}]` : "";
  log.push({
    time: t,
    type: "ventureTrade",
    note: `${actor.name}: ${direction === "buy" ? "bought" : "sold"} ${stones} st ${category} @ ${toGp(unitCp)}gp/st = ${totalGp}gp${stamp}`,
  });
  await location.update({
    "system.market.goods.solicitations": solicitations,
    "system.market.marketLog": log.slice(-300),
  });
  await postCard(
    actor,
    [
      `<strong>${game.i18n.format(`${LANG}.ventures.tradeLine.${direction}`, { name: actor.name, stones, label, location: location.name })}</strong>`,
      negotiationLine,
      `<strong>${game.i18n.format(direction === "buy" ? `${LANG}.trade.totalLine` : `${LANG}.trade.earnedLine`, { total: totalGp })}</strong>`,
    ]
      .filter(Boolean)
      .join("<br>")
  );
  return { ok: true, stones, unitGp: toGp(unitCp), totalGp };
}

/* ------------------------- socket relays ------------------------- */

registerHandler("marketsVentureAction", async ({ locationUuid, ...payload }) => {
  const doc = await fromUuid(locationUuid).catch(() => null);
  const location = doc?.actor ?? doc;
  if (!location) return err("noMarket");
  return postVentureAction(location, payload);
});

registerHandler("marketsVentureTrade", async ({ locationUuid, ...payload }) => {
  const doc = await fromUuid(locationUuid).catch(() => null);
  const location = doc?.actor ?? doc;
  if (!location) return err("noMarket");
  return tradeMerchandise(location, payload);
});

async function dispatch(handler, fn, location, payload) {
  const target = payload.actorUuid ? await fromUuid(payload.actorUuid).catch(() => null) : null;
  const canLocal =
    game.user.isGM ||
    (location.testUserPermission(game.user, "OWNER") && (target == null || target.testUserPermission?.(game.user, "OWNER")));
  if (canLocal) return fn(location, { ...payload, requestUserId: game.user.isGM ? null : game.user.id });
  return executeAsGM(handler, { locationUuid: location.uuid, ...payload, requestUserId: game.user.id });
}

/** Local-first dispatch for posting a venture action. */
export async function performVentureAction(location, payload) {
  return dispatch("marketsVentureAction", postVentureAction, location, payload);
}

/** Local-first dispatch for a merchandise trade. */
export async function performVentureTrade(location, payload) {
  return dispatch("marketsVentureTrade", tradeMerchandise, location, payload);
}
