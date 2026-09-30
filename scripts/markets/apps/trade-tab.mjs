/* global game, ui, foundry, fromUuid, fromUuidSync */
/**
 * The Trade tab the location sheet mounts (the magic-panel precedent: the
 * location owns the sheet, the tab bar and one mount line per hook; markets
 * owns what the tab prepares and every handler behind its buttons).
 *
 * `prepareTradeTab(sheet, context)` fills the context keys
 * `templates/markets/trade-tab.hbs` reads; `TRADE_TAB_ACTIONS` are AppV2
 * action handlers the sheet spreads into its `actions` (invoked with the
 * sheet as `this`); `bindTradeTab(sheet)` wires the one control an action
 * cannot reach, the "acting as" picker, and runs from the sheet's render.
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
import { performVentureAction, performVentureCancel, performVentureLeave, ventureOf } from "../engine/ventures.mjs";
import { assessmentBands, printedError } from "../engine/printed.mjs";
import { assessmentBribeBasisHd } from "../engine/assessment.mjs";
import { assessmentPageBands } from "../rules/arbitrage.mjs";
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
 * character, else the first candidate; null when the viewer has none.
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
 * Everything the Trade tab renders: the catalog with each row's live
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

  // Venture state for the acting trader's party, and its queue.
  const monthStart = marketMonthStart(t);
  context.venture = partyId ? (ventureOf(location, partyId, monthStart) ?? null) : null;
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
 * reports it holds) and how its venture stands this month. A party with
 * neither is left out.
 */
function partyBlocks(goods, monthStart, reports) {
  const ventures = (goods.ventures ?? []).map(plain).filter((v) => Number(v.monthStartTime) === monthStart);
  const ids = new Set([DEFAULT_PARTY_ID, ...partiesConfig().map((p) => p.id)]);
  for (const row of [...reports, ...ventures]) if (row.partyId) ids.add(row.partyId);
  const blocks = [];
  for (const id of ids) {
    const mine = beliefsFor(reports, { partyId: id, memberUuids: partyMembers(id).map((a) => a.uuid) });
    const venture = ventures.find((v) => v.partyId === id);
    if (!mine.length && !venture) continue;
    blocks.push({
      name: partyLabel(id),
      beliefs: mine.map((k) => ({
        label: goodLabel(k.category),
        modifier: signed(k.dm),
        when: reportDay(k.time),
        // The Judge's copy marks a belief a false assessment left.
        falseNote: k.outcome === "false" ? loc("report.falseNote") : "",
      })),
      ventureLine: venture
        ? loc("parties.ventureLine", {
            state: game.i18n.localize(`${LANG}.ventures.${venture.entered ? "entered" : "notEntered"}`),
            cargo: venture.cargoSt,
            impact: venture.impact,
            marketClass: venture.effectiveClass,
            toll: Math.round(Number(venture.tollCp) || 0) / 100,
          })
        : "",
    });
  }
  return blocks;
}

/**
 * Wire the controls a click action cannot reach: the acting-trader picker
 * stores the choice on this client and re-renders. The change is kept from the
 * sheet's submit-on-change form, which has nothing to save from it.
 * @param {Application} sheet  The hosting sheet, after a render.
 */
export function bindTradeTab(sheet) {
  const picker = sheet.element?.querySelector("[data-trade-trader]");
  if (!picker) return;
  picker.addEventListener("change", async (event) => {
    event.stopPropagation();
    await game.settings.set(MODULE_ID, "marketsActingTrader", picker.value);
    sheet.render();
  });
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
    const stacks = trader.items.filter((i) => i.type === "money" && Number(i.system?.quantity ?? 0) > 0 && Number(i.system?.coppervalue ?? 0) > 0);
    if (!stacks.length) {
      ui.notifications.warn(locationLoc("market.exchangeNothing", { name: trader.name }));
      return;
    }
    const options = stacks.map((i) => `<option value="${i.id}">${foundry.utils.escapeHTML(i.name)} ×${i.system.quantity} (${i.system.coppervalue} cp)</option>`).join("");
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
    const r = await acksExtras.lib.money.exchangeCoins({ actor: trader, place: this.actor, ...form });
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

  /** Enter the market: a dedicated day, the toll paid at the gate. */
  async ventureEnter() {
    const cargoSt = await promptNumber({ title: loc("ventures.enter"), label: loc("ventures.cargo"), value: 0, min: 0 });
    if (cargoSt == null) return;
    await postVenture(this, "enter", { cargoSt });
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
    const sure = await foundry.applications.api.DialogV2.confirm({
      classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
      window: { title: loc("ventures.leaveTitle") },
      content: `<p>${loc("ventures.leaveBody")}</p>`,
      rejectClose: false,
    }).catch(() => false);
    if (!sure) return;
    reportResult(this, await performVentureLeave(this.actor, { actorUuid: trader.uuid }), loc("ventures.left"));
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

  /** GM gate: whether players see the market's true demand modifiers. */
  async togglePlayersSeeDemand() {
    if (!game.user.isGM) return;
    const current = !!this.actor.system.market.goods.playersSeeDemand;
    await this.actor.update({ "system.market.goods.playersSeeDemand": !current });
    this.render();
  },
};
