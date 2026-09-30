/* global game, foundry, Hooks, ChatMessage, Roll, fromUuid, fromUuidSync */
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
  pendingDuplicate,
  cancelVerdict,
  leaveMarket,
  planLoadDraw,
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
import { VEHICLE_TYPE } from "../../vehicles/constants.mjs";
import { holdOf } from "../../vehicles/hold.mjs";
import { storageFlagOf } from "../../lib/storage-logic.mjs";

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
  log.push({ time: t, type: "ventureFailed", note: `${actor.name}: ${action.kind} could not resolve (${table} table not imported)`, actorUuid: actor.uuid, gp: 0 });
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

/**
 * The loads of one merchandise category a trader may trade from a holder —
 * their own packs, or a vehicle's hold — in the order a sale draws them.
 * Goods kept aboard for somebody else (stamped with another owner) are that
 * owner's, and never counted.
 */
export function loadStacks(holder, category, traderUuid = holder?.uuid ?? null) {
  return (holder?.items ?? []).filter((i) => {
    if (i.type !== ITEM_TYPE.item) return false;
    const flag = i.getFlag(MODULE_ID, ITEM_FLAG);
    if (!flag?.merchandise || flag.category !== category) return false;
    const owner = storageFlagOf(i)?.ownerUuid;
    return !owner || owner === traderUuid;
  });
}

/** Stones of one merchandise category a holder carries as loads (one unit per stone, across every stack). */
export function loadsHeld(holder, category, traderUuid = holder?.uuid ?? null) {
  return loadStacks(holder, category, traderUuid).reduce((sum, i) => sum + Math.max(0, Number(i.system?.quantity?.value ?? 0) || 0), 0);
}

/**
 * The vehicles a venture entered with, as documents — where its loads are
 * bought into and sold from. A vehicle deleted since drops out.
 */
export function ventureVehicles(venture) {
  return (venture?.vehicleUuids ?? []).map((uuid) => fromUuidSync(uuid)).filter((a) => a?.type === VEHICLE_TYPE);
}

/**
 * The vehicles a trader declares at entry, checked and weighed. Each must be
 * a vehicle the requesting seat owns; what they bring is their cargo capacity
 * (RR §VIII.6, market impact), read from the one hold computation
 * (vehicles/hold.mjs) so the figure a market counts is the one the sheet shows.
 */
async function enteringVehicles(uuids, requestUserId) {
  const user = requestUserId ? game.users.get(requestUserId) : game.user;
  const out = { uuids: [], names: [], capacity: 0 };
  for (const uuid of new Set((uuids ?? []).filter(Boolean))) {
    const doc = await fromUuid(uuid).catch(() => null);
    if (doc?.type !== VEHICLE_TYPE) return err("noVehicle");
    if (!user?.isGM && !doc.testUserPermission(user, "OWNER")) return err("notYourVehicle");
    out.uuids.push(doc.uuid);
    out.names.push(doc.name);
    out.capacity += Math.max(0, holdOf(doc)?.capacity ?? 0);
  }
  return out;
}

/** This party's venture row for the month, if any. */
export function ventureOf(location, partyId, monthStart = marketMonthStart()) {
  return (location.system.market?.goods?.ventures ?? []).find(
    (v) => v.partyId === partyId && Number(v.monthStartTime) === monthStart
  );
}

/**
 * Post a dedicated-day venture action. Entering pays the toll NOW (the gate
 * collects on arrival) and an assessment its bribe (the merchants pocket it
 * whatever the day brings); the rest of the day's outcome lands when the
 * sweep resolves it. An assessment arrives with the Judge's roll already made
 * on the influence page (`roll: {natural, total}`); one posted without a roll
 * is rolled bare (2d6 + Charisma) by the sweep. The same trader's same day
 * cannot wait in the queue twice.
 */
export async function postVentureAction(location, payload) {
  const { kind, actorUuid, category = "", cargoSt = 0, vehicleUuids = [], requestUserId = null, resolutionId = "", roll = null, bribeGp = 0 } = payload;
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
  if (pendingDuplicate(actions, { kind, actorUuid: actor.uuid, category })) return err("duplicatePending");
  // Refused now, before the toll is taken, rather than spent as a day that cannot resolve.
  const unread = venturePrerequisite(kind);
  if (unread) return printedError(unread);

  const t = now();
  const monthStart = marketMonthStart(t);
  const party = partyOf(actor);
  const venture = ventureOf(location, party.id, monthStart);
  let tollCp = 0;
  const bribe = kind === "assess" ? Math.max(0, Number(bribeGp) || 0) : 0;
  // Entering declares what the party brings: the vehicles' capacity plus any
  // other (porters, pack animals) stated as a number.
  let capacitySt = Math.round(Math.max(0, Number(cargoSt) || 0));
  let brought = { uuids: [], names: [] };

  if (kind === "enter") {
    if (venture?.entered) return err("alreadyEntered");
    if (actions.some((a) => a.status === "pending" && a.kind === "enter" && a.partyId === party.id)) return err("alreadyEntered");
    const ch = characteristicsFor(location.system.marketClass);
    if (!ch) return err("noCharacteristics");
    brought = await enteringVehicles(vehicleUuids, requestUserId);
    if (brought.error) return brought;
    capacitySt = Math.round(capacitySt + brought.capacity);
    tollCp = Math.ceil(parseTollCpPerSt(ch.toll) * capacitySt);
    if (tollCp > 0) {
      const paid = await adapter.spendGold(actor, toGp(tollCp), game.i18n.localize(`${LANG}.ventures.tollReason`), { to: location, at: location });
      if (!paid) return err("insufficientGold");
    }
  } else {
    if (!venture?.entered) return err("notEntered");
    if (kind === "solicit" && !merchandiseFor(category)) return err("noCategory");
    if (bribe > 0) {
      const paid = await adapter.spendGold(actor, bribe, game.i18n.localize(`${LANG}.ventures.bribeReason`), { to: location, at: location });
      if (!paid) return err("insufficientGold");
    }
  }

  const natural = Number.isInteger(roll?.natural) ? roll.natural : null;
  const total = Number.isInteger(roll?.total) ? roll.total : null;
  const detail = [
    brought.names.length ? `with ${brought.names.join(", ")}` : "",
    tollCp > 0 ? `toll ${toGp(tollCp)}gp` : "",
    bribe > 0 ? `bribe ${bribe}gp` : "",
    total !== null ? `rolled ${natural} → ${total}` : "",
  ]
    .filter(Boolean)
    .join("; ");
  const action = {
    id: resolutionId || foundry.utils.randomID(),
    kind,
    partyId: party.id,
    actorUuid: actor.uuid,
    category,
    cargoSt: kind === "enter" ? capacitySt : 0,
    vehicleUuids: brought.uuids,
    postedTime: t,
    resolveTime: t + SECONDS_PER_DAY,
    status: "pending",
    detail,
    natural,
    total,
    bribeGp: bribe,
  };
  const log = clone(location.system.market.marketLog);
  const paidGp = toGp(tollCp) + bribe;
  log.push({
    time: t,
    type: "ventureAction",
    note: `${actor.name}: ${kind}${category ? ` (${category})` : ""} posted${paidGp > 0 ? ` (${paidGp}gp paid)` : ""} [${action.id}]`,
    actorUuid: actor.uuid,
    gp: -paidGp,
  });
  await location.update({
    "system.market.goods.actions": [...actions, action],
    "system.market.marketLog": log.slice(-300),
  });
  return { ok: true, resolveTime: action.resolveTime };
}

/**
 * Withdraw a queued day before it resolves. What it cost stays spent: the
 * toll went to the gate, the bribe to the merchants, and neither comes back.
 * The row is kept as withdrawn, so the ledger still says the day was bought.
 */
export async function cancelVentureAction(location, { actionId, requestUserId = null } = {}) {
  const goods = location?.system?.market?.goods;
  if (!goods) return err("noMarket");
  const actions = clone(goods.actions);
  const action = actions.find((a) => a.id === actionId);
  const user = requestUserId ? game.users.get(requestUserId) : game.user;
  const ownsActor = (uuid) => {
    const doc = fromUuidSync(uuid);
    const actor = doc?.actor ?? doc;
    return !!actor?.testUserPermission?.(user, "OWNER");
  };
  const verdict = cancelVerdict(action, { isGM: !!user?.isGM, ownsActor });
  if (verdict !== "ok") return err(verdict);
  action.status = "cancelled";
  const actorDoc = fromUuidSync(action.actorUuid);
  const actor = actorDoc?.actor ?? actorDoc;
  const log = clone(location.system.market.marketLog);
  log.push({
    time: now(),
    type: "ventureCancelled",
    note: `${actor?.name ?? action.actorUuid}: ${action.kind}${action.category ? ` (${action.category})` : ""} withdrawn, nothing refunded [${action.id}]`,
    actorUuid: action.actorUuid,
    gp: 0,
  });
  await location.update({
    "system.market.goods.actions": actions,
    "system.market.marketLog": log.slice(-300),
  });
  return { ok: true };
}

/**
 * Leave the market this month, as the acting trader's party. What the entry
 * cost stays spent and the party's waiting days are withdrawn with it
 * (`rules/arbitrage.mjs` `leaveMarket`); the Enter button then offers a fresh
 * declaration at a fresh toll. The Judge may leave for any party; anyone else
 * only through a trader they own.
 */
export async function leaveVentureMarket(location, { actorUuid, requestUserId = null } = {}) {
  const goods = location?.system?.market?.goods;
  if (!goods) return err("noMarket");
  const actorDoc = await fromUuid(actorUuid).catch(() => null);
  const actor = actorDoc?.actor ?? actorDoc;
  if (!actor) return err("noBuyer");
  if (requestUserId) {
    const user = game.users.get(requestUserId);
    if (!user?.isGM && !actor.testUserPermission(user, "OWNER")) return err("notYours");
  }
  const t = now();
  const state = { ventures: clone(goods.ventures), actions: clone(goods.actions), solicitations: clone(goods.solicitations) };
  const result = leaveMarket(state, { partyId: partyOf(actor).id, monthStart: marketMonthStart(t) });
  if (result.error) return err(result.error);
  const log = clone(location.system.market.marketLog);
  log.push({
    time: t,
    type: "ventureLeft",
    note: `${actor.name}: left the market, nothing refunded${result.cancelledIds.length ? ` (withdrawn: ${result.cancelledIds.join(", ")})` : ""}`,
    actorUuid: actor.uuid,
    gp: 0,
  });
  await location.update({
    "system.market.goods.ventures": state.ventures,
    "system.market.goods.actions": state.actions,
    "system.market.goods.solicitations": state.solicitations,
    "system.market.marketLog": log.slice(-300),
  });
  return { ok: true, cancelled: result.cancelledIds.length };
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
      const row = existing ?? { partyId: action.partyId, monthStartTime: monthStart, cargoSt: 0, vehicleUuids: [], impact: 0, effectiveClass: 0, tollCp: 0, entered: false };
      if (!existing) ventures.push(row);
      row.cargoSt = action.cargoSt;
      row.vehicleUuids = [...(action.vehicleUuids ?? [])];
      row.impact = impact;
      row.effectiveClass = effectiveClass;
      // The toll was paid when the action was posted; the row records it.
      row.tollCp = Math.ceil(parseTollCpPerSt(ch.toll) * Math.max(0, Number(action.cargoSt) || 0));
      row.entered = true;
      log.push({ time: t, type: "ventureEntered", note: `${actor.name}: entered the market, impact ${impact}`, actorUuid: actor.uuid, gp: 0 });
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
      // The Judge's roll was made on the influence page when the day was
      // posted (tone, bribe and effects priced there); a bare posting is
      // rolled here with Charisma alone.
      const total = Number.isInteger(action.total) ? action.total : (await new Roll("2d6").evaluate()).total + adapter.getChaMod(actor);
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
      // The ledger names the outcome as the trader is told it: a false picture reads as partial.
      log.push({
        time: t,
        type: "ventureAssessed",
        note: `${actor.name}: assessment ${outcome === "false" ? "partial" : outcome} (${beliefs.length} DMs)`,
        actorUuid: actor.uuid,
        gp: 0,
      });
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
      log.push({
        time: t,
        type: "ventureSolicited",
        note: `${actor.name}: solicited ${action.category} (+${gained} st @ ${toGp(price.priceCp)}gp/st)`,
        actorUuid: actor.uuid,
        gp: 0,
      });
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
 * Trade merchandise against a solicitation: buy loads in, or sell loads out,
 * at the month's market price — one optional negotiation swings the spot
 * price a step (or slams the door). The loads go into, or come out of, the
 * trader's own packs or one of the vehicles the party entered with
 * (`holdUuid`): a buyer loads into their own transport (RR §VIII.6). A
 * vehicle's hold refuses a purchase it has no room for, at the same line its
 * sheet's bar turns red.
 */
export async function tradeMerchandise(location, payload) {
  const { actorUuid, category, stones: rawStones, direction, negotiate = false, holdUuid = "", requestUserId = null, resolutionId = "" } = payload;
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

  let hold = actor;
  if (holdUuid && holdUuid !== actor.uuid) {
    hold = ventureVehicles(venture).find((v) => v.uuid === holdUuid) ?? null;
    if (!hold) return err("notInVenture");
    if (requestUserId) {
      const user = game.users.get(requestUserId);
      if (!user?.isGM && !hold.testUserPermission(user, "OWNER")) return err("notYourHold", { hold: hold.name });
    }
  }
  const inVehicle = hold !== actor;
  // Refused before any negotiation is rolled: a trade that cannot land is not
  // worth a merchant's patience.
  const stacks = loadStacks(hold, category, actor.uuid);
  const draw = direction === "buy" ? null : planLoadDraw(stacks.map((i) => ({ id: i.id, qty: i.system?.quantity?.value })), stones);
  if (draw?.short) return err("noLoads", { remaining: draw.held });
  if (direction === "buy" && inVehicle) {
    const free = Math.floor(holdOf(hold)?.free ?? 0);
    if (free < stones) return err("noRoom", { remaining: Math.max(0, free), hold: hold.name });
  }

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
    // Merchandise loads: one stack per category, one unit per stone — joining
    // a stack nobody else's stamp is on.
    const carried = stacks.find((i) => !storageFlagOf(i)) ?? stacks[0] ?? null;
    if (carried) {
      await carried.update({ "system.quantity.value": Number(carried.system.quantity?.value ?? 0) + stones });
    } else {
      await hold.createEmbeddedDocuments("Item", [
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
    if (draw.updates.length) {
      await hold.updateEmbeddedDocuments("Item", draw.updates.map((u) => ({ _id: u.id, "system.quantity.value": u.qty })));
    }
    if (draw.deletes.length) await hold.deleteEmbeddedDocuments("Item", draw.deletes);
    await adapter.grantGold(actor, totalGp, { from: location, at: location, allowMint: true });
  }

  srow.stones -= stones;
  const stamp = resolutionId ? ` [${resolutionId}]` : "";
  log.push({
    time: t,
    type: "ventureTrade",
    note: `${actor.name}: ${direction === "buy" ? "bought" : "sold"} ${stones} st ${category} @ ${toGp(unitCp)}gp/st = ${totalGp}gp${inVehicle ? ` (${direction === "buy" ? "into" : "from"} ${hold.name})` : ""}${stamp}`,
    actorUuid: actor.uuid,
    gp: direction === "buy" ? -totalGp : totalGp,
  });
  await location.update({
    "system.market.goods.solicitations": solicitations,
    "system.market.marketLog": log.slice(-300),
  });
  await postCard(
    actor,
    [
      `<strong>${game.i18n.format(`${LANG}.ventures.tradeLine.${direction}`, { name: actor.name, stones, label, location: location.name })}</strong>`,
      inVehicle ? game.i18n.format(`${LANG}.ventures.holdLine.${direction}`, { hold: hold.name }) : null,
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
  // A trade that loads a vehicle writes to it too, so its hold must be this
  // seat's to write before the trade may run here.
  const hold = payload.holdUuid ? await fromUuid(payload.holdUuid).catch(() => null) : null;
  const owns = (doc) => doc == null || !!doc.testUserPermission?.(game.user, "OWNER");
  const canLocal = game.user.isGM || (location.testUserPermission(game.user, "OWNER") && owns(target) && owns(hold));
  if (canLocal) return fn(location, { ...payload, requestUserId: game.user.isGM ? null : game.user.id });
  return executeAsGM(handler, { locationUuid: location.uuid, ...payload, requestUserId: game.user.id });
}

/** Local-first dispatch for posting a venture action. */
export async function performVentureAction(location, payload) {
  return dispatch("marketsVentureAction", postVentureAction, location, payload);
}

registerHandler("marketsVentureCancel", async ({ locationUuid, ...payload }) => {
  const doc = await fromUuid(locationUuid).catch(() => null);
  const location = doc?.actor ?? doc;
  if (!location) return err("noMarket");
  return cancelVentureAction(location, payload);
});

/** Local-first dispatch for withdrawing a queued day (the Judge, or the trader's owner through the relay). */
export async function performVentureCancel(location, payload) {
  return dispatch("marketsVentureCancel", cancelVentureAction, location, payload);
}

registerHandler("marketsVentureLeave", async ({ locationUuid, ...payload }) => {
  const doc = await fromUuid(locationUuid).catch(() => null);
  const location = doc?.actor ?? doc;
  if (!location) return err("noMarket");
  return leaveVentureMarket(location, payload);
});

/** Local-first dispatch for leaving the market as the acting trader's party. */
export async function performVentureLeave(location, payload) {
  return dispatch("marketsVentureLeave", leaveVentureMarket, location, payload);
}

/** Local-first dispatch for a merchandise trade. */
export async function performVentureTrade(location, payload) {
  return dispatch("marketsVentureTrade", tradeMerchandise, location, payload);
}
