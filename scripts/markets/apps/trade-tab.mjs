/* global game, ui, foundry, fromUuid, fromUuidSync */
/**
 * The Trade and Ventures tabs the location sheet mounts (the magic-panel
 * precedent: the location owns the sheet, the tab bar and one mount line per
 * hook; markets owns what the tabs prepare and every handler behind their
 * buttons). Trade is the shop: buying, selling, imports, commissions and
 * searches. Ventures is the merchant's: entering the market, assessing,
 * soliciting and trading merchandise. Both carry the acting-trader picker,
 * the market class and demand, and the trade history.
 *
 * `prepareTradeTab(sheet, context)` fills the context keys
 * `templates/markets/trade-tab.hbs` and `ventures-tab.hbs` read;
 * `TRADE_TAB_ACTIONS` are AppV2 action handlers the sheet spreads into its
 * `actions` (invoked with the sheet as `this`); `bindTradeTab(sheet)` wires
 * the one control an action cannot reach, the "acting as" picker on each
 * tab, and runs from the sheet's render.
 *
 * Every trade action is taken by one ACTING TRADER: a character the viewer
 * may act through, chosen in the picker and remembered per client. The
 * catalog is cached on the sheet (`sheet._tradeCatalog`) and rebuilt when a
 * write can change what it lists.
 */
import { MODULE_ID, LANG } from "../constants.mjs";
import { LANG_PREFIX as LOCATION_LANG } from "../../location/constants.mjs";
import { ACTOR_TYPE } from "../../lib/vocab.mjs";
import { acksExtras } from "../../namespace.mjs";
import { SECONDS_PER_DAY } from "../../henchmen/constants.mjs";
import { now } from "../../henchmen/time.mjs";
import { makeLoc } from "../../lib/util.mjs";
import { coinStores } from "../../lib/money.mjs";
import { coinCount, coinRate } from "../../lib/money-logic.mjs";
import { merchandiseCatalog, merchandiseFor } from "../engine/merchandise.mjs";
import { writeDemand } from "../engine/demand.mjs";
import { DEMAND_LAYER, demandSource, trueDemand } from "../rules/demand.mjs";
import { openDemandGenerator } from "./demand-generator.mjs";
import { getSetting } from "../settings.mjs";
import {
  buildCatalog,
  availabilityFor,
  performSearchDay,
  salePlan,
  demandStepsFor,
  categoryOf,
  marketMonthStart,
} from "../engine/trade.mjs";
import { processImports, performItemSearch, performSearchCancel } from "../engine/imports.mjs";
import { performVentureAction, performVentureCancel, performVentureLeave, ventureFor, ventureVehicles } from "../engine/ventures.mjs";
import { entryQuote, enteringMembers, goodKey, saleCandidates, stabledAsOf } from "../engine/gate.mjs";
import { stayOwed, STAY_AT, STABLED_AS, STAY_ANIMALS } from "../rules/stay.mjs";
import { manifestOf } from "../engine/manifest.mjs";
import { VEHICLE_TYPE } from "../../vehicles/constants.mjs";
import { holdOf } from "../../vehicles/hold.mjs";
import { carrierChain } from "../../lib/attachment.mjs";
import { marketKnownTo, knownMarketsOf, setMarketKnown } from "../engine/known-market.mjs";
import { effectiveMarketClass } from "../../henchmen/engine/recruitment.mjs";
import { hasEffectFlag } from "../../henchmen/effects.mjs";
import { networkSteps } from "../engine/network.mjs";
import { dayOfWorldTime } from "../../lib/world-time.mjs";
import { assessmentBands, impactLimits, printedError, tableLabel } from "../engine/printed.mjs";
import { assessmentBribeBasisHd } from "../engine/assessment.mjs";
import { assessmentPageBands, entryConflict, vehiclesEntered, ventureKey, VENTURE_MODES } from "../rules/arbitrage.mjs";
import { historyRows } from "../rules/ledger.mjs";
import { historyContext } from "./trader-tab.mjs";
import { partyOf, partiesConfig, partyMembers, DEFAULT_PARTY_ID } from "../engine/parties.mjs";
import { objectsAt, plainReport } from "../engine/trade-objects.mjs";
import { beliefsFor, heldByParty } from "../rules/reports.mjs";
import { outcomeLabel, reportDay } from "./report-sheet.mjs";
import { openPurchaseDialog } from "./purchase-dialog.mjs";
import { openSellDialog } from "./sell-dialog.mjs";
import { openCommissionDialog } from "./commission-dialog.mjs";
import { openVentureTradeDialog } from "./venture-dialog.mjs";

const loc = makeLoc(LANG);
const locationLoc = makeLoc(LOCATION_LANG);

/** Dialog classes every prompt this tab opens carries (the scroll contract). */
const DIALOG_CLASSES = ["acks-ui", "acks-extras", "acks-extras-scroll"];

const plain = (row) => row.toObject?.() ?? foundry.utils.deepClone(row);
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
const daysUntil = (time, t) => Math.max(0, Math.ceil((Number(time) - t) / SECONDS_PER_DAY));

/** The actor a uuid names, or null. Never throws: an unloaded pack's uuid does. */
function actorOfUuid(uuid) {
  if (!uuid) return null;
  try {
    const doc = fromUuidSync(uuid);
    return doc?.actor ?? doc ?? null;
  } catch {
    return null;
  }
}

/** Display name of a party id: its configured name, or the implicit table party. */
function partyLabel(partyId) {
  const named = partiesConfig().find((p) => p.id === partyId);
  if (named) return named.name || named.id;
  return partyId === DEFAULT_PARTY_ID || !partyId ? loc("parties.defaultName") : partyId;
}

/** The party a stored order row belongs to: its own id, else its buyer's party. */
const rowPartyId = (row) => row.partyId || partyOf(actorOfUuid(row.buyerUuid)).id;

/* ---------------------------- the acting trader --------------------------- */

/**
 * The characters this viewer may trade as. A GM chooses among the player
 * characters (those with a non-GM owner) and their own assigned character; a
 * player among the characters they own.
 * @returns {Actor[]} sorted by name
 */
export function tradeCandidates() {
  const characters = game.actors.filter((a) => a.type === ACTOR_TYPE.character);
  const mine = game.user.isGM
    ? characters.filter((a) => a === game.user.character || a.hasPlayerOwner)
    : characters.filter((a) => a.testUserPermission(game.user, "OWNER"));
  return mine.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The character every trade action on this sheet is taken as: the picker's
 * remembered choice while it is still a candidate, else the user's own
 * character, else the first candidate who is nobody's hireling, else the
 * first; null when the viewer has none. A hireling stays pickable, but a hire
 * shares its employer's owners and must never become the default by its name.
 * @param {Application} _sheet  The hosting sheet (the choice is per client, not per sheet).
 * @returns {Actor|null}
 */
export function actingTrader(_sheet) {
  const candidates = tradeCandidates();
  if (!candidates.length) return null;
  let chosen = "";
  try {
    chosen = getSetting("marketsActingTrader");
  } catch {
    chosen = "";
  }
  return (
    candidates.find((a) => a.uuid === chosen) ??
    candidates.find((a) => a === game.user.character) ??
    candidates.find((a) => !a.system?.retainer?.enabled) ??
    candidates[0]
  );
}

/** Warn that no acting trader exists; returns the trader when there is one. */
function requireTrader(sheet) {
  const trader = actingTrader(sheet);
  if (!trader) ui.notifications.warn(loc("trade.noTrader"));
  return trader;
}

/* ----------------------------- relay outcomes ----------------------------- */

/**
 * Report what a perform* call came back with. An error warns; `{ok: true}`
 * is the only success (the caller's toast, then a re-render). No result means
 * the call was relayed to a GM without an answer: the socket layer already
 * warned when no GM is online, and when one is, the viewer is told it was sent.
 * @param {Application} sheet
 * @param {object|undefined} result
 * @param {string} [successMessage]  Localized toast for an accepted call; none when omitted.
 * @returns {boolean} whether the call was accepted
 */
function reportResult(sheet, result, successMessage) {
  if (result?.error) {
    ui.notifications.warn(game.i18n.format(`${LANG}.trade.error.${result.error}`, { remaining: 0, table: "", crowd: "", ...result }));
    return false;
  }
  if (result?.ok) {
    if (successMessage) ui.notifications.info(successMessage);
    sheet.render();
    return true;
  }
  const gmOnline = !!(game.users.activeGM ?? game.users.find((u) => u.isGM && u.active));
  if (result === undefined && !game.user.isGM && gmOnline) ui.notifications.info(loc("relay.sent"));
  return false;
}

/* ------------------------------ tab preparation --------------------------- */

/**
 * Everything the Trade and Ventures tabs render: the catalog with each row's live
 * availability for the acting trader, that trader's sellable goods, the
 * viewer's party's orders, searches, ventures and demand knowledge, and for a
 * GM the per-party beliefs and ventures across the whole table.
 * @param {Application} sheet    The hosting location sheet.
 * @param {object} context       The sheet's render context, filled in place.
 */
export async function prepareTradeTab(sheet, context) {
  const location = sheet.actor;
  const goods = location.system.market.goods;
  const isGM = game.user.isGM;
  sheet._tradeCatalog ??= await buildCatalog(location);

  const trader = actingTrader(sheet);
  const candidates = tradeCandidates();
  context.tradeActor = trader;
  context.tradeTraders = candidates.map((a) => ({ uuid: a.uuid, name: a.name, selected: a === trader }));
  context.tradeShowPicker = candidates.length > 1 || (isGM && candidates.length > 0);

  // The class the acting trader trades at: the town's own, shifted by a
  // mercantile network where this market is one they have been in before.
  const trueClass = location.system.marketClass;
  if (trueClass != null) {
    const effective = trader ? effectiveMarketClass(location, trader) : trueClass;
    const network = !!trader && hasEffectFlag(trader, "marketClass");
    context.tradeClass = {
      trueLabel: game.i18n.format(`${LANG}.trade.classLabel`, { n: trueClass }),
      effectiveLabel: game.i18n.format(`${LANG}.trade.classLabel`, { n: effective }),
      shifted: effective !== trueClass,
      network,
      known: network && marketKnownTo(location, trader),
      // The Judge's switch states their own list only; the verdict beside it may also come from the record.
      judgeListed: network && knownMarketsOf(trader).includes(location.uuid),
      traderName: trader?.name ?? "",
    };
  }

  context.tradeRows = sheet._tradeCatalog.map((row) => {
    // A held row is one physical item on this market's shelf: it is bought
    // off the shelf, never banded, searched for or commissioned.
    if (row.held) {
      return {
        ...row,
        rowKey: catalogRowKey(row),
        availabilityLabel: game.i18n.format(`${LANG}.availability.held`, { remaining: row.heldQty }),
        canBuy: true,
      };
    }
    const avail = availabilityFor(location, {
      itemName: row.name, costGp: row.costGp, trader, magic: row.magic, magicBaseGp: row.magicBaseGp,
    });
    return {
      ...row,
      rowKey: catalogRowKey(row),
      availability: avail,
      availabilityLabel: game.i18n.format(`${LANG}.availability.${avail.status}`, avail),
      canBuy: avail.status === "available" || avail.status === "pending",
    };
  });
  context.masterworkContact = !!goods.masterworkContact;
  context.playersSeeDemand = !!goods.playersSeeDemand;
  context.extendedSearchOn = game.settings.get(MODULE_ID, "marketsExtendedSearch");

  // The acting trader's sellable goods: priced mundane gear, or magic items
  // whose flags give them a market value.
  context.sellRows = !trader
    ? []
    : trader.items
        // Merchandise loads trade as stones through ventures, never here.
        .filter((i) => ["weapon", "armor", "item"].includes(i.type) && !i.getFlag(MODULE_ID, "markets")?.merchandise)
        .map((i) => {
          const data = i.toObject();
          const plan = salePlan(data, { demandSteps: demandStepsFor(goods, categoryOf(data)) });
          return plan.unitCp > 0 && plan.bandValueGp > 0
            ? {
                id: i.id,
                name: i.name,
                img: i.img,
                qty: Number(data.system?.quantity?.value ?? 1) || 1,
                estimateGp: Math.round(plan.unitCp) / 100,
              }
            : null;
        })
        .filter(Boolean);

  const t = now();
  const partyId = trader ? partyOf(trader).id : null;
  // A player sees their own party's orders; the GM sees every party's, labeled.
  const visible = (row) => isGM || (partyId != null && rowPartyId(row) === partyId);
  const attribution = (row) => ({
    partyLabel: partyLabel(rowPartyId(row)),
    buyerName: actorOfUuid(row.buyerUuid)?.name ?? "",
  });

  // In-transit orders: players see the expected window, never the roll.
  // Commissions ride the same table, labeled by their worker.
  context.importRows = [
    ...(goods.imports ?? [])
      .filter((o) => o.status === "ordered" && visible(o))
      .map((o) => ({
        itemName: o.itemName,
        qty: o.qty,
        hubLabel: game.i18n.localize(`${LANG}.imports.${(o.hub || (o.hubShift === 2 ? "regional" : "local")) === "regional" ? "hubRegional" : "hubLocal"}`),
        etaDays: daysUntil(o.arrivalTime, t),
        ...attribution(o),
      })),
    ...(goods.commissions ?? [])
      .filter((o) => o.status === "building" && visible(o))
      .map((o) => ({
        itemName: o.itemName,
        qty: o.qty,
        hubLabel: game.i18n.localize(`${LANG}.commissions.worker.${o.worker}`),
        etaDays: daysUntil(o.completionTime, t),
        ...attribution(o),
      })),
  ];
  // Directed searches: the standing asks and their outcomes.
  context.searchRows = (goods.searches ?? [])
    .filter((o) => o.status !== "cancelled" && visible(o))
    .map((o) => ({
      id: o.id,
      itemName: o.itemName,
      qty: o.qty,
      statusLabel: game.i18n.localize(`${LANG}.searches.status.${o.status}`),
      active: o.status === "active",
      ...attribution(o),
    }));

  // Due work is anything the sweep would resolve: a GM may always run it, an
  // owner only while something is waiting.
  const pending =
    (goods.imports ?? []).some((o) => o.status === "ordered") ||
    (goods.commissions ?? []).some((o) => o.status === "building") ||
    (goods.actions ?? []).some((a) => a.status === "pending") ||
    (goods.searches ?? []).some((o) => o.status === "active");
  context.tradeCanProcess = isGM || (pending && location.testUserPermission(game.user, "OWNER"));

  // Demand modifiers: the GM (or an open market) sees the truth; a party
  // sees what its reports taught it — right or wrong, it cannot tell.
  const reports = objectsAt(location.uuid).map(plainReport);
  const who = partyId ? { partyId, memberUuids: partyMembers(partyId).map((a) => a.uuid) } : null;
  if (isGM || goods.playersSeeDemand) {
    context.demandRows = demandChips(goods, isGM);
  } else if (who) {
    context.demandRows = beliefsFor(reports, { ...who, marketUuid: location.uuid }).map((b) => ({ label: goodLabel(b.category), modifier: signed(b.dm) }));
  } else {
    context.demandRows = [];
  }

  // The reports held here: the GM sees every one; a player, their party's.
  // The outcome is masked for a non-GM (a false assessment reads as partial).
  context.reportRows = reports
    .filter((r) => isGM || (who && heldByParty(r, who)))
    .sort((a, b) => b.time - a.time)
    .map((r) => ({
      uuid: r.uuid,
      when: reportDay(r.time),
      assessorName: actorOfUuid(r.assessorUuid)?.name ?? "",
      ownerName: r.ownerName,
      outcomeLabel: outcomeLabel(r.outcome, isGM),
      count: r.beliefs.length,
    }));

  // Venture state for the acting trader — their party's, or their own where
  // they entered separately — and the party's queue.
  const monthStart = marketMonthStart(t);
  context.venture = trader ? (ventureFor(location, trader, monthStart) ?? null) : null;
  context.ventureApart = context.venture?.entrantUuid ? loc("ventures.apartMarker", { n: context.venture.entrants }) : "";
  // The merchandise picker is the input of Solicit (shown once entered) and of the
  // Judge's Set demand; where neither is offered it is not rendered.
  context.ventureCategoryShown = !!context.venture?.entered || isGM;
  // The vehicles the venture entered with, named on its status line, and the stay's daily fee.
  context.ventureVehicles = ventureVehicles(context.venture).map((v) => v.name).join(", ");
  context.ventureStay = context.venture?.stayCpPerDay > 0 ? loc("ventures.stayStatus", { gp: context.venture.stayCpPerDay / 100, where: loc(`ventures.stayAt.${context.venture.stayAt}`) }) : "";
  context.ventureActions = (goods.actions ?? [])
    .filter((a) => a.status === "pending" && (isGM || a.partyId === partyId))
    .map((a) => {
      const trader = actorOfUuid(a.actorUuid);
      return {
        id: a.id,
        kindLabel: game.i18n.localize(`${LANG}.ventures.kind.${a.kind}`),
        category: a.category ? goodLabel(a.category) : "",
        etaDays: daysUntil(a.resolveTime, t),
        traderName: trader?.name ?? "",
        // A queued day can be withdrawn by the Judge, or by whoever owns the trader who posted it.
        canCancel: isGM || !!trader?.isOwner,
      };
    });

  // This market's ledger, for the viewer's own traders (the Judge: every trader's rows).
  const historyWho = isGM
    ? (goods.actions ?? []).map((a) => a.actorUuid).concat((location.system.market.marketLog ?? []).map((r) => r.actorUuid))
    : game.actors.filter((a) => a.isOwner).map((a) => a.uuid);
  context.history = historyContext(
    historyRows([{ marketUuid: location.uuid, marketName: location.name, rows: location.system.market.marketLog ?? [] }], {
      actorUuids: [...new Set(historyWho.filter(Boolean))],
    })
  );
  // The Judge reads every trader's rows, so each names its trader.
  if (isGM) for (const row of context.history.rows) row.traderName = actorOfUuid(row.actorUuid)?.name ?? "";
  // The catalogue lists a Judge's own goods too.
  context.merchOptions = merchandiseCatalog().map((row) => ({ key: row.key, label: row.label }));

  context.partyBlocks = isGM ? partyBlocks(goods, monthStart, reports) : [];
}

/** A merchandise category's display name: the catalogue's label (a Judge's own good included), else the key. */
const goodLabel = (category) => merchandiseFor(category)?.label ?? category;

/**
 * The demand chips: one per category any layer holds, showing its true
 * demand. For the GM a pinned category is marked, and shows the base it hides.
 * @param {object} goods
 * @param {boolean} isGM
 * @returns {Array<{label: string, modifier: string, pinned: boolean, baseNote: string}>}
 */
function demandChips(goods, isGM) {
  const categories = new Set();
  for (const field of Object.values(DEMAND_LAYER)) for (const row of goods[field] ?? []) if (row.category) categories.add(row.category);
  return [...categories].map((category) => {
    const pinned = isGM && demandSource(goods, category) === "override";
    const base = (goods.demand ?? []).find((d) => d.category === category);
    return {
      label: goodLabel(category),
      modifier: signed(trueDemand(goods, category)),
      pinned,
      baseNote: pinned && base ? loc("trade.demandBase", { base: signed(Number(base.modifier) || 0) }) : "",
    };
  });
}

/**
 * The GM's per-party picture: what each party believes about demand (from the
 * reports it holds) and how its ventures stand this month — one line for a
 * party entered as one, one per character where they entered separately. A
 * party with neither is left out.
 */
function partyBlocks(goods, monthStart, reports) {
  const ventures = (goods.ventures ?? []).map(plain).filter((v) => Number(v.monthStartTime) === monthStart);
  const ids = new Set([DEFAULT_PARTY_ID, ...partiesConfig().map((p) => p.id)]);
  for (const row of [...reports, ...ventures]) if (row.partyId) ids.add(row.partyId);
  const blocks = [];
  for (const id of ids) {
    const mine = beliefsFor(reports, { partyId: id, memberUuids: partyMembers(id).map((a) => a.uuid) });
    const rows = ventures.filter((v) => v.partyId === id);
    if (!mine.length && !rows.length) continue;
    blocks.push({
      name: partyLabel(id),
      beliefs: mine.map((k) => ({
        label: goodLabel(k.category),
        modifier: signed(k.dm),
        when: reportDay(k.time),
        // The Judge's copy marks a belief a false assessment left.
        falseNote: k.outcome === "false" ? loc("report.falseNote") : "",
      })),
      ventureLines: rows.map((venture) =>
        [
          venture.entrantUuid ? `${actorOfUuid(venture.entrantUuid)?.name ?? venture.entrantUuid}, ${loc("ventures.apartMarker", { n: venture.entrants })}` : "",
          loc("parties.ventureLine", {
            state: game.i18n.localize(`${LANG}.ventures.${venture.entered ? "entered" : "notEntered"}`),
            cargo: venture.cargoSt,
            impact: venture.impact,
            marketClass: venture.effectiveClass,
            toll: Math.round(Number(venture.tollCp) || 0) / 100,
            tariff: Math.round(Number(venture.tariffCp) || 0) / 100,
          }),
          venture.privilegeUuid ? loc("ventures.paidPrivilege") : "",
          ventureVehicles(venture).map((v) => v.name).join(", "),
          venture.networkMode && venture.networkMode !== "auto"
            ? `${loc("ventures.network.legend")}: ${loc(`ventures.network.mode.${venture.networkMode}`)}`
            : "",
        ]
          .filter(Boolean)
          .join(" — ")
      ),
    });
  }
  return blocks;
}

/**
 * Wire the controls a click action cannot reach: each tab's acting-trader
 * picker stores the choice on this client and re-renders, so both tabs act as
 * the trader last picked on either. The change is kept from the sheet's
 * submit-on-change form, which has nothing to save from it.
 * @param {Application} sheet  The hosting sheet, after a render.
 */
export function bindTradeTab(sheet) {
  for (const picker of sheet.element?.querySelectorAll("[data-trade-trader]") ?? []) {
    picker.addEventListener("change", async (event) => {
      event.stopPropagation();
      await game.settings.set(MODULE_ID, "marketsActingTrader", picker.value);
      sheet.render();
    });
  }
}

/* --------------------------------- prompts -------------------------------- */

/** Ask for one whole number; null when the prompt is dismissed. */
async function promptNumber({ title, label, value, min, max }) {
  const id = foundry.utils.randomID();
  const bounds = `${min != null ? ` min="${min}"` : ""}${max != null ? ` max="${max}"` : ""}`;
  const content = `<div class="form-group"><label for="${id}">${foundry.utils.escapeHTML(label)}</label><input id="${id}" type="number" name="value" value="${value}"${bounds} step="1"></div>`;
  return foundry.applications.api.DialogV2.prompt({
    classes: DIALOG_CLASSES,
    window: { title },
    content,
    ok: { callback: (_ev, button) => Number(button.form.elements.value?.value) || 0 },
  }).catch(() => null);
}

/**
 * What the gate will charge on a declaration, as the Enter dialog shows it.
 * That is the toll, the tariff with a line per good assessed (or the span a
 * thrown tariff can come to), nothing under the Ruler's Privilege or where
 * the party sneaks in, any charge a Judge's hook added, and what is smuggled
 * past. The figures are the entry's own quote (`entryQuote`), so the payment
 * matches them.
 */
function gateQuoteHtml(location, trader, declaration) {
  const esc = foundry.utils.escapeHTML;
  const quote = entryQuote(location, trader, declaration);
  if (quote.error) return `<p class="hint">${esc(game.i18n.format(`${LANG}.trade.error.${quote.error}`, { remaining: 0, table: "", crowd: "", ...quote }))}</p>`;
  const gp = (cp) => Math.round(Number(cp) || 0) / 100;
  const line = (l, figure) => {
    const key = l.kind === "item" ? "item" : "load";
    const text = loc(l.exempt ? `ventures.quote.${key}Exempt` : figure ? `ventures.quote.${key}` : `ventures.quote.${key}Thrown`, {
      label: esc(l.label),
      stones: Math.round(l.stones * 100) / 100,
      pct: l.pct,
      gp: gp(l.cp),
    });
    return `<li>${l.holderName ? `<span class="hint">${esc(l.holderName)}:</span> ` : ""}${text}</li>`;
  };
  const out = [];
  if (quote.sneaked) out.push(`<p>${loc("ventures.quote.sneaked")}</p>`);
  else if (quote.privilege) out.push(`<p>${loc("ventures.quote.privilege", { domain: esc(quote.privilege.name) })}</p>`);
  else {
    out.push(`<p>${loc("ventures.quote.toll", { gp: gp(quote.tollCp), stone: quote.capacitySt })}</p>`);
    if (!quote.loads.length) out.push(`<p>${loc("ventures.quote.noLoads")}</p>`);
    else if (quote.dice) {
      out.push(`<p>${loc("ventures.quote.tariffThrown", { min: gp(quote.range.minCp), max: gp(quote.range.maxCp) })}</p>`);
      out.push(`<ul>${quote.loads.map((l) => line(l, false)).join("")}</ul>`);
    } else {
      out.push(`<p>${loc("ventures.quote.tariff", { gp: gp(quote.tariff.totalCp) })}</p>`);
      out.push(`<ul>${quote.tariff.lines.map((l) => line(l, true)).join("")}</ul>`);
    }
  }
  // The stay's day: the fee charged (a Judge's hook may have changed it) over the lines it was figured from.
  const stay = quote.stay;
  if (stay?.privilege && stay.lines.length) out.push(`<p>${loc("ventures.quote.stayWaived", { domain: esc(stay.privilege.name) })}</p>`);
  else if (!stay?.privilege && stay?.cpPerDay > 0) {
    out.push(`<p>${loc("ventures.quote.stay", { gp: gp(stay.cpPerDay), where: loc(`ventures.stayAt.${stay.at}`) })}</p>`);
    const unit = (l) =>
      l.name ? loc("ventures.quote.stayVehicle", { label: esc(l.name), gp: gp(l.cp) }) : loc("ventures.quote.stayAnimals", { label: loc(`ventures.stay.animal.${l.unit}`), count: l.count, gp: gp(l.cp) });
    if (stay.lines.length) out.push(`<ul>${stay.lines.map((l) => `<li>${unit(l)}</li>`).join("")}</ul>`);
  }
  if (quote.extra.length) out.push(`<ul>${quote.extra.map((c) => `<li>${loc("ventures.quote.extra", { label: esc(c.label), gp: gp(c.cp) })}</li>`).join("")}</ul>`);
  if (quote.smuggled.length) {
    out.push(`<p>${loc("ventures.quote.smuggled")}</p><ul>${quote.smuggled.map((l) => line({ ...l, exempt: false }, false)).join("")}</ul>`);
  }
  return out.join("");
}

/**
 * The Enter dialog's goods block. It lists every merchandise load the party
 * brings: those in the packs of the members entering (`enteringMembers`) and
 * those in the holds of `vehicles`, each hold's rows shown only while its
 * vehicle is ticked, and another member's packs only while the trader enters
 * as the party (`gateHolders`). Each load can be marked smuggled. It also
 * lists the items those members carry that can be brought to sell
 * (`saleCandidates`), each declared for sale or smuggled in to sell. One tick
 * sneaks the whole party in.
 */
function goodsFieldset(location, trader, vehicles, aboard, separately) {
  const esc = foundry.utils.escapeHTML;
  const members = enteringMembers(location, trader);
  const vehicleUuids = new Set(vehicles.map((v) => v.uuid));
  const smuggle = (key, label) => `<label class="checkbox"><input type="checkbox" name="smuggle" value="${key}" aria-label="${esc(loc("ventures.goods.smuggleLabel", { label }))}"> ${loc("ventures.goods.smuggle")}</label>`;
  const row = (inner, holder) => {
    const where = vehicleUuids.has(holder)
      ? ` data-good-vehicle="${holder}"${aboard.has(holder) ? "" : " hidden"}`
      : holder !== trader.uuid
        ? ` data-good-member="${holder}"${separately ? " hidden" : ""}`
        : "";
    return `<div class="acks-extras-markets-good"${where}>${inner}</div>`;
  };
  const rows = [];
  for (const r of manifestOf([...members, ...vehicles], { traderUuid: members.map((a) => a.uuid) }).rows) {
    const key = goodKey(r.holderUuid, r.itemId);
    rows.push(row(`<span>${esc(r.label)}, ${Math.round(r.stones * 100) / 100} st <span class="hint">${esc(r.holderName)}</span></span>${smuggle(key, r.label)}`, r.holderUuid));
  }
  for (const member of members) {
    for (const c of saleCandidates(member)) {
      const key = goodKey(member.uuid, c.itemId);
      const sale = `<label class="checkbox"><input type="checkbox" name="forSale" value="${key}" aria-label="${esc(loc("ventures.goods.forSaleLabel", { label: c.name }))}"> ${loc("ventures.goods.forSale")}</label>`;
      rows.push(row(`<span>${esc(c.name)}${c.quantity > 1 ? ` ×${c.quantity}` : ""} <span class="hint">${esc(member.name)}</span></span>${sale}${smuggle(key, c.name)}`, member.uuid));
    }
  }
  return `<fieldset class="acks-extras-markets-goods"><legend>${loc("ventures.goods.legend")}</legend>
    <p class="hint">${loc("ventures.goods.hint")}</p>${rows.join("") || `<p class="hint">${loc("ventures.goods.none")}</p>`}
    <label class="checkbox"><input type="checkbox" name="sneak"> ${loc("ventures.goods.sneak")}</label></fieldset>`;
}

/**
 * The Enter dialog's moorage and stabling block: where the party's ships and
 * animals wait, how each land vehicle is stabled (starting at `stabledAsOf`,
 * each row shown only while its vehicle is ticked), and the head of each
 * kind of animal brought besides the vehicles' teams.
 */
function stayFieldset(vehicles, ticks) {
  const esc = foundry.utils.escapeHTML;
  const field = (label, control) => {
    const id = foundry.utils.randomID();
    return `<label for="${id}">${label}</label>${control(id)}`;
  };
  const at = field(loc("ventures.stay.at"), (id) => `<select id="${id}" name="stayAt">${STAY_AT.map((s) => `<option value="${s}">${loc(`ventures.stay.atOption.${s}`)}</option>`).join("")}</select>`);
  const stabling = vehicles
    .filter((v) => v.system?.kind !== "sea")
    .map((v) => {
      const as = stabledAsOf(v);
      const row = field(loc("ventures.stay.stabledAs", { name: esc(v.name) }), (id) =>
        `<select id="${id}" name="stabled" data-vehicle="${v.uuid}">${STABLED_AS.map((s) => `<option value="${s}"${s === as ? " selected" : ""}>${loc(`ventures.stay.as.${s}`)}</option>`).join("")}</select>`
      );
      return `<div class="form-group" data-stay-vehicle="${v.uuid}"${ticks.has(v.uuid) ? "" : " hidden"}>${row}</div>`;
    })
    .join("");
  const animals = Object.keys(STAY_ANIMALS)
    .map((unit) => `<div class="form-group">${field(loc(`ventures.stay.animal.${unit}`), (id) => `<input id="${id}" type="number" name="animal" data-unit="${unit}" value="0" min="0" step="1">`)}</div>`)
    .join("");
  return `<fieldset class="acks-extras-markets-stay"><legend>${loc("ventures.stay.legend")}</legend>
    <div class="form-group">${at}</div>${stabling}<p class="hint">${loc("ventures.stay.animalsHint")}</p>${animals}</fieldset>`;
}

/** What the Enter dialog declares, read off its form: what `entryQuote` and the entry take. */
function readDeclaration(root) {
  const vehicleUuids = [...root.querySelectorAll('input[name="vehicle"]:checked')].map((el) => el.value);
  const values = (name) => [...root.querySelectorAll(`input[name="${name}"]:checked`)].map((el) => el.value);
  return {
    vehicleUuids,
    vehicles: vehicleUuids.map((uuid) => fromUuidSync(uuid)).filter(Boolean),
    otherSt: Math.max(0, Number(root.querySelector('input[name="other"]')?.value) || 0),
    forSale: values("forSale"),
    smuggled: values("smuggle"),
    sneak: !!root.querySelector('input[name="sneak"]')?.checked,
    separately: root.querySelector('input[name="mode"]:checked')?.value === "separately",
    stayAt: root.querySelector('select[name="stayAt"]')?.value ?? "berth",
    stabled: Object.fromEntries([...root.querySelectorAll('select[name="stabled"]')].map((el) => [el.dataset.vehicle, el.value])),
    animals: Object.fromEntries([...root.querySelectorAll('input[name="animal"]')].map((el) => [el.dataset.unit, Math.max(0, Math.floor(Number(el.value) || 0))])),
  };
}

/**
 * Ask what the trader brings to the gate: the vehicles entering, each at the
 * cargo capacity its hold states (vehicles/hold.mjs), any other capacity
 * (porters, pack animals) as a number, the goods brought to sell and
 * smuggled (`goodsFieldset`), or whether the party sneaks in, and where its
 * ships and animals wait, how each land vehicle is stabled and what animals
 * come besides the teams (`stayFieldset`). What the gate will charge is
 * shown beneath and follows the declaration as it changes.
 *
 * A party of more than one character also says whether the trader enters as
 * the party or separately (RR ch. 8, Entering the Market, step 2, Parties),
 * with the maximum impact each separate entrant gets; while any of them
 * stands entered separately this month, the choice is fixed to that. Every
 * vehicle a member rides, drives or is harnessed to starts ticked entering as
 * the party, and only the trader's own entering separately, where another
 * member's packs leave the goods list and the network block is the trader's
 * alone. A vehicle already through the gate this month cannot be ticked.
 * Null when dismissed.
 */
async function promptEntry(trader, location) {
  const esc = foundry.utils.escapeHTML;
  const party = partyOf(trader);
  const members = [...new Set([trader, ...partyMembers(party.id)])];
  const goods = location.system.market.goods;
  const monthStart = marketMonthStart();
  const state = { ventures: goods.ventures ?? [], actions: goods.actions ?? [] };
  const locked = !!ventureKey(state, { partyId: party.id, actorUuid: trader.uuid, monthStart }).entrantUuid;
  const share = entryConflict(state, { partyId: party.id, actorUuid: trader.uuid, monthStart, mode: "separately", characters: members.length });
  const n = share.entrants || members.length;
  const limits = impactLimits();
  const aboardOf = (actors) => new Set(actors.flatMap((a) => carrierChain(a).map((c) => c?.uuid)));
  const aboard = { party: aboardOf(members), separately: aboardOf([trader]) };
  const through = vehiclesEntered(state, monthStart);
  const ticks = new Set([...aboard[locked ? "separately" : "party"]].filter((uuid) => !through.has(uuid)));
  const vehicles = game.actors.filter((a) => a.type === VEHICLE_TYPE && a.isOwner).sort((a, b) => a.name.localeCompare(b.name));
  const rows = vehicles
    .map((v) => {
      const stone = Math.round(holdOf(v)?.capacity ?? 0);
      const gone = through.has(v.uuid);
      // A vehicle through the gate is never ticked, so its hold's goods start hidden with it.
      const attr = gone ? " disabled" : ticks.has(v.uuid) ? " checked" : "";
      return `<label class="checkbox"><input type="checkbox" name="vehicle" value="${v.uuid}"${attr}> ${esc(v.name)} <span class="hint">${loc("ventures.vehicleCapacity", { stone })}${gone ? ` ${loc("ventures.vehicleThrough")}` : ""}</span></label>`;
    })
    .join("");
  const modes =
    locked || members.length > 1
      ? `<fieldset class="acks-extras-markets-mode"><legend>${loc("ventures.mode.legend")}</legend>${VENTURE_MODES.map(
          (m) => `<label class="checkbox"><input type="radio" name="mode" value="${m}"${(m === "separately") === locked ? " checked" : ""}${locked ? " disabled" : ""}> ${loc(`ventures.mode.${m}`)}</label>`
        ).join("")}<p class="hint">${loc(locked ? "ventures.mode.locked" : "ventures.mode.hint")}</p><p class="hint">${
          limits ? loc("ventures.mode.share", { max: Math.floor(limits.impactCap / n), n }) : loc("ventures.mode.shareUnread", { table: tableLabel("impactProse") })
        }</p></fieldset>`
      : "";
  const otherId = foundry.utils.randomID();
  const gate = gateQuoteHtml(location, trader, { vehicles: vehicles.filter((v) => ticks.has(v.uuid)), otherSt: 0, separately: locked });
  const content = [
    modes,
    vehicles.length
      ? `<fieldset><legend>${loc("ventures.vehiclesLegend")}</legend>${rows}</fieldset>`
      : `<p class="hint">${loc("ventures.noVehicles")}</p>`,
    `<div class="form-group"><label for="${otherId}">${loc("ventures.otherCargo")}</label><input id="${otherId}" type="number" name="other" value="0" min="0" step="1"></div>`,
    `<p class="hint">${loc("ventures.enterHint")}</p>`,
    goodsFieldset(location, trader, vehicles, ticks, locked),
    stayFieldset(vehicles, ticks),
    `<fieldset class="acks-extras-markets-gate"><legend>${loc("ventures.quote.legend")}</legend><div data-gate-quote aria-live="polite">${gate}</div></fieldset>`,
    `<div data-entry-network>${networkFieldset(locked ? [trader] : members, location)}</div>`,
  ].join("");
  return foundry.applications.api.DialogV2.prompt({
    classes: DIALOG_CLASSES,
    window: { title: loc("ventures.enter") },
    content,
    render: (_event, dialog) => {
      // The quote follows the declaration: the mode chosen, a vehicle ticked
      // (its hold's goods and its stabling shown with it), the other capacity
      // typed, a good declared for sale or smuggled, the party sneaking in,
      // where it waits, how a vehicle is stabled, or an animal counted.
      const root = dialog?.element;
      const refresh = (event) => {
        if (!event.target?.matches?.('input[name="vehicle"], input[name="other"], input[name="forSale"], input[name="smuggle"], input[name="sneak"], input[name="mode"], select[name="stayAt"], select[name="stabled"], input[name="animal"]')) return;
        if (event.type === "change" && event.target.name === "mode") {
          // A mode starts from its own vehicles and its own network holders.
          const apart = event.target.value === "separately";
          const start = aboard[apart ? "separately" : "party"];
          for (const el of root.querySelectorAll('input[name="vehicle"]:not(:disabled)')) el.checked = start.has(el.value);
          const net = root.querySelector("[data-entry-network]");
          if (net) net.innerHTML = networkFieldset(apart ? [trader] : members, location);
        }
        const declaration = readDeclaration(root);
        for (const el of root.querySelectorAll("[data-good-vehicle]")) el.hidden = !declaration.vehicleUuids.includes(el.dataset.goodVehicle);
        for (const el of root.querySelectorAll("[data-stay-vehicle]")) el.hidden = !declaration.vehicleUuids.includes(el.dataset.stayVehicle);
        for (const el of root.querySelectorAll("[data-good-member]")) el.hidden = declaration.separately;
        const box = root.querySelector("[data-gate-quote]");
        if (box) box.innerHTML = gateQuoteHtml(location, trader, declaration);
      };
      root?.addEventListener("change", refresh);
      root?.addEventListener("input", refresh);
    },
    ok: {
      label: loc("ventures.enterSubmit"),
      callback: (_ev, button) => {
        const { vehicleUuids, otherSt, forSale, smuggled, sneak, separately, stayAt, stabled, animals } = readDeclaration(button.form);
        return { vehicleUuids, cargoSt: otherSt, forSale, smuggled, sneak, mode: separately ? "separately" : "party", networkMode: button.form.elements.networkMode?.value ?? "auto", stayAt, stabled, animals };
      },
    },
  }).catch(() => null);
}

/**
 * The Enter dialog's network block: the mode the party's solicitations use
 * this visit, offered only where a member holds a network with a value, and
 * one line per network holder saying whether it counts on the visit this entry
 * opens. Empty where no member holds one.
 */
function networkFieldset(members, location) {
  const holders = members.filter((a) => hasEffectFlag(a, "marketClass") || networkSteps(a).impactStep > 0);
  if (!holders.length) return "";
  const today = dayOfWorldTime(game.time.worldTime);
  const steps = holders.map((a) => networkSteps(a));
  const modes = ["auto", ...(steps.some((s) => s.classStep > 0) ? ["class"] : []), ...(steps.some((s) => s.impactStep > 0) ? ["impact"] : [])];
  const lines = holders.map((a, i) => {
    const name = foundry.utils.escapeHTML(a.name);
    const missing = steps[i].missing.map((power) => `<p class="hint">${loc("ventures.network.missing", { power: foundry.utils.escapeHTML(power) })}</p>`).join("");
    const known = marketKnownTo(location, a, { visitStartDay: today });
    return `<p class="hint">${loc(known ? "ventures.network.counted" : "ventures.network.notCounted", { name })}</p>${missing}`;
  });
  const select =
    modes.length > 1
      ? `<label class="form-group">${loc("ventures.network.legend")}<select name="networkMode">${modes
          .map((m) => `<option value="${m}">${loc(`ventures.network.mode.${m}`)}</option>`)
          .join("")}</select></label><p class="hint">${loc("ventures.network.hint")}</p>`
      : "";
  return `<fieldset><legend>${loc("ventures.network.legend")}</legend>${select}${lines.join("")}</fieldset>`;
}

/* --------------------------------- handlers ------------------------------- */

/** A dedicated-day venture action, posted as the acting trader. */
async function postVenture(sheet, kind, extra = {}) {
  const trader = requireTrader(sheet);
  if (!trader) return;
  const result = await performVentureAction(sheet.actor, {
    kind,
    actorUuid: trader.uuid,
    resolutionId: foundry.utils.randomID(),
    ...extra,
  });
  reportResult(sheet, result, loc("ventures.posted"));
}

/**
 * The Trade tab's action handlers, keyed by their `data-action` names. Each is
 * invoked by AppV2 with the hosting sheet as `this`.
 */
/**
 * A catalog row's key in the tab. A held row shares its item key with the
 * compendium row of the same name, so it is keyed by the embedded item's id.
 */
function catalogRowKey(row) {
  return row.held ? `held.${row.heldItemId}` : row.key;
}

/** The cached catalog row a tab control names, or undefined. */
function catalogRow(sheet, rowKey) {
  return (sheet._tradeCatalog ?? []).find((r) => catalogRowKey(r) === rowKey);
}

export const TRADE_TAB_ACTIONS = {
  /** Open a report held at this market. */
  async openReport(_event, target) {
    const item = await fromUuid(target?.dataset?.uuid).catch(() => null);
    item?.sheet?.render(true);
  },

  /** Open the purchase dialog for a catalog row. */
  async openPurchase(_event, target) {
    const row = catalogRow(this, target?.dataset?.key);
    if (row) openPurchaseDialog(this.actor, row);
  },

  /** Open the sell dialog for one of the acting trader's carried items. */
  async openSell(_event, target) {
    const trader = requireTrader(this);
    const item = trader?.items.get(target?.dataset?.itemId);
    if (trader && item) openSellDialog(this.actor, trader, item);
  },

  /** Spend a further dedicated day searching this market. */
  async marketsSearchDay() {
    const trader = requireTrader(this);
    if (!trader) return;
    const result = await performSearchDay(this.actor, { actorUuid: trader.uuid, resolutionId: foundry.utils.randomID() });
    reportResult(this, result, loc("ventures.posted"));
  },

  /** Change coin at the market's till — the changer's service, face value. */
  async marketsExchange() {
    const trader = requireTrader(this);
    if (!trader) return;
    // The coin on the trader's person that no lock shuts away.
    const stacks = coinStores(trader, { within: "hand" })
      .filter((store) => !store.shut)
      .flatMap((store) => store.rows)
      .filter((i) => coinCount(i) > 0 && coinRate(i) > 0);
    if (!stacks.length) {
      ui.notifications.warn(locationLoc("market.exchangeNothing", { name: trader.name }));
      return;
    }
    const options = stacks.map((i) => `<option value="${i.id}">${foundry.utils.escapeHTML(i.name)} ×${coinCount(i)} (${coinRate(i)} cp)</option>`).join("");
    const denoms = [[100, locationLoc("market.exchangeGp")], [10, locationLoc("market.exchangeSp")], [1, locationLoc("market.exchangeCp")]]
      .map(([cv, label]) => `<option value="${cv}">${label}</option>`).join("");
    const form = await foundry.applications.api.DialogV2.prompt({
      window: { title: locationLoc("market.exchangeTitle") },
      classes: DIALOG_CLASSES,
      content: `<div class="form-group"><label>${locationLoc("market.exchangeFrom")}</label><select name="itemId">${options}</select></div>
        <div class="form-group"><label>${locationLoc("market.exchangeCount")}</label><input type="number" name="count" min="1" value="1"/></div>
        <div class="form-group"><label>${locationLoc("market.exchangeTo")}</label><select name="toCv">${denoms}</select></div>`,
      ok: { callback: (_e, button) => ({
        itemId: button.form.elements.itemId.value,
        count: Number(button.form.elements.count.value),
        toCv: Number(button.form.elements.toCv.value),
      }) },
    }).catch(() => null);
    if (!form) return;
    // This seat declares the exchange, so a Judge's is the Judge's own.
    const r = await acksExtras.lib.money.exchangeCoins({ actor: trader, place: this.actor, ...form, judge: game.user.isGM });
    if (r.ok) {
      ui.notifications.info(locationLoc("market.exchanged", { name: trader.name }));
      this.render();
    }
  },

  /** Resolve everything due at this market now (owners may; the clock is the GM's). */
  async processImports() {
    const result = await processImports(this.actor);
    ui.notifications.info(loc("imports.processed", { n: result.resolved }));
    this.render();
  },

  /** Commission a catalog item's construction. */
  async openCommission(_event, target) {
    const row = catalogRow(this, target?.dataset?.key);
    if (row) openCommissionDialog(this.actor, row);
  },

  /** Post a directed search for a catalog item the market cannot supply now. */
  async postSearch(_event, target) {
    const row = catalogRow(this, target?.dataset?.key);
    const trader = requireTrader(this);
    if (!row || !trader) return;
    const asked = await promptNumber({ title: loc("searches.qtyTitle", { name: row.name }), label: loc("purchase.qty"), value: 1, min: 1 });
    if (asked == null) return;
    const result = await performItemSearch(this.actor, {
      buyerUuid: trader.uuid,
      itemName: row.name,
      sourceUuid: row.sourceUuid ?? "",
      qty: Math.max(1, Math.floor(asked) || 1),
      resolutionId: foundry.utils.randomID(),
    });
    reportResult(this, result, loc("searches.posted", { name: row.name }));
  },

  /** Withdraw a directed search. */
  async cancelSearch(_event, target) {
    const result = await performSearchCancel(this.actor, { searchId: target?.dataset?.searchId });
    reportResult(this, result);
  },

  /**
   * Enter the market: a dedicated day, the toll paid at the gate on the cargo
   * capacity declared — the vehicles brought, and anything else stated.
   */
  async ventureEnter() {
    const trader = requireTrader(this);
    if (!trader) return;
    const entry = await promptEntry(trader, this.actor);
    if (!entry) return;
    await postVenture(this, "enter", entry);
  },

  /**
   * Assess supply and demand: a dedicated day, its roll made now on the
   * influence page against this market (Charisma, a tone proficiency, a
   * bribe, reaction effects) and posted with the day by the roll-complete
   * listener (`engine/assessment.mjs`). Without the influence feature the day
   * is posted bare and the sweep rolls Charisma alone.
   */
  async ventureAssess() {
    const trader = requireTrader(this);
    if (!trader) return;
    const location = this.actor;
    const bands = assessmentPageBands(assessmentBands());
    if (!bands) {
      reportResult(this, printedError("assessmentProse"));
      return;
    }
    const api = globalThis.acksExtras?.influence;
    if ((api?.apiVersion ?? 0) < 9) {
      ui.notifications.warn(loc("ventures.assessNoInfluence"));
      await postVenture(this, "assess");
      return;
    }
    api.open(trader, {
      mode: "marketAssessment",
      targetActor: location,
      ctx: {
        bands,
        targetName: location.name,
        targetImg: location.img,
        bribeBasisHd: assessmentBribeBasisHd(location),
      },
      context: { module: MODULE_ID, kind: "marketAssessment", locationUuid: location.uuid, actorUuid: trader.uuid },
    });
  },

  /** Withdraw a queued day. Nothing paid for it comes back. */
  async ventureCancel(_event, target) {
    const actionId = target?.dataset?.actionId;
    if (!actionId) return;
    const sure = await foundry.applications.api.DialogV2.confirm({
      classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
      window: { title: loc("ventures.cancelTitle") },
      content: `<p>${loc("ventures.cancelBody")}</p>`,
      rejectClose: false,
    }).catch(() => false);
    if (!sure) return;
    reportResult(this, await performVentureCancel(this.actor, { actionId }), loc("ventures.cancelled"));
  },

  /** Leave the market as the acting trader's party. The toll stays spent; waiting days are withdrawn. */
  async ventureLeave() {
    const trader = requireTrader(this);
    if (!trader) return;
    // The stay is settled on leaving: say what it comes to today, and who pays it.
    const venture = ventureFor(this.actor, trader);
    const owed =
      venture?.stayCpPerDay > 0 && !venture.staySettled
        ? stayOwed({ cpPerDay: venture.stayCpPerDay, arrivalDay: dayOfWorldTime(venture.enteredTime), departureDay: dayOfWorldTime(now()) })
        : null;
    const stay = owed ? `<p>${loc("ventures.leaveStay", { gp: owed.cp / 100, days: owed.days, name: foundry.utils.escapeHTML(trader.name) })}</p>` : "";
    const sure = await foundry.applications.api.DialogV2.confirm({
      classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
      window: { title: loc("ventures.leaveTitle") },
      content: `<p>${loc("ventures.leaveBody")}</p>${stay}`,
      rejectClose: false,
    }).catch(() => false);
    if (!sure) return;
    const result = await performVentureLeave(this.actor, { actorUuid: trader.uuid });
    reportResult(this, result, result?.stay ? loc("ventures.leftStay", { gp: result.stay.gp, days: result.stay.days }) : loc("ventures.left"));
  },

  /** Solicit buyers/sellers in the selected merchandise: a dedicated day. */
  async ventureSolicit() {
    const category = this.element.querySelector("[data-venture-category]")?.value;
    if (!category) return;
    await postVenture(this, "solicit", { category });
  },

  /** Trade merchandise a solicitation opened. */
  async ventureTrade() {
    const trader = requireTrader(this);
    if (trader) openVentureTradeDialog(this.actor, trader);
  },

  /**
   * GM: set, pin or clear the market's demand modifier for the selected
   * category. Set and Clear act on the base layer; Pin and Unpin on the
   * override layer, which outranks the base.
   */
  async setDemand() {
    if (!game.user.isGM) return;
    const category = this.element.querySelector("[data-venture-category]")?.value;
    if (!category) return;
    const goods = this.actor.system.market.goods;
    const id = foundry.utils.randomID();
    const content = `<p class="hint">${loc("ventures.demandLayers")}</p><div class="form-group"><label for="${id}">${loc("ventures.dmValue")}</label><input id="${id}" type="number" name="modifier" value="${trueDemand(goods, category)}" min="-12" max="12" step="1"></div>`;
    const value = (_ev, button) => Number(button.form.elements.modifier?.value) || 0;
    const choice = await foundry.applications.api.DialogV2.wait({
      classes: DIALOG_CLASSES,
      window: { title: loc("ventures.setDemand") },
      content,
      rejectClose: false,
      buttons: [
        { action: "set", label: loc("ventures.demandSet"), icon: "fas fa-check", default: true, callback: (ev, button) => ({ layer: "base", modifier: value(ev, button) }) },
        { action: "pin", label: loc("ventures.demandPin"), icon: "fas fa-thumbtack", callback: (ev, button) => ({ layer: "override", modifier: value(ev, button) }) },
        { action: "clear", label: loc("ventures.demandClear"), icon: "fas fa-eraser", callback: () => ({ layer: "base", modifier: null }) },
        { action: "unpin", label: loc("ventures.demandUnpin"), icon: "fas fa-link-slash", callback: () => ({ layer: "override", modifier: null }) },
      ],
    }).catch(() => null);
    if (!choice || typeof choice !== "object") return;
    reportResult(this, await writeDemand(this.actor, { category, ...choice }));
  },

  /** GM: open the Demand Generator for this market. */
  async openDemandGenerator() {
    openDemandGenerator(this.actor, this);
  },

  /** GM gate: whether masterwork gear has a contact at this market (RR §IV.6). */
  async toggleMasterworkContact() {
    if (!game.user.isGM) return;
    const current = !!this.actor.system.market.goods.masterworkContact;
    await this.actor.update({ "system.market.goods.masterworkContact": !current });
    this._tradeCatalog = null;
    this.render();
  },

  /** The Judge states that the acting trader has (or has not) been in this market before. */
  async toggleKnownMarket() {
    if (!game.user.isGM) return;
    const trader = requireTrader(this);
    if (!trader) return;
    const listed = knownMarketsOf(trader).includes(this.actor.uuid);
    reportResult(this, await setMarketKnown(trader, this.actor, !listed));
  },

  /** GM gate: whether players see the market's true demand modifiers. */
  async togglePlayersSeeDemand() {
    if (!game.user.isGM) return;
    const current = !!this.actor.system.market.goods.playersSeeDemand;
    await this.actor.update({ "system.market.goods.playersSeeDemand": !current });
    this.render();
  },
};
