/* global game, Hooks, ui, foundry, Handlebars */
/**
 * ACKS II — Item Markets. Entry point.
 *
 *  init:  settings. (The `location` sub-type, its sheet, and the market
 *         subtree belong to the location feature; this feature is a consumer
 *         that owns the `system.market.goods` semantics and every writer.)
 *  setup: table expectations, public API.
 *  ready: system check, missing-tables notice.
 */
import { acksExtras, assertAcksSystem } from "../namespace.mjs";
import { missingTablesList } from "../lib/ruledata.mjs";
import { MODULE_ID, LANG, RULEDATA, HOOKS } from "./constants.mjs";
import * as config from "./config.mjs";
import { registerSettings, getSetting } from "./settings.mjs";
import { registerAssessmentListener } from "./engine/assessment.mjs";
import * as availabilityRules from "./rules/availability.mjs";
import * as pricingRules from "./rules/pricing.mjs";
import * as importRules from "./rules/imports.mjs";
import * as commissionRules from "./rules/commissions.mjs";
// Importing the engine registers the GM socket handlers at module scope.
import { purchase, sell, performPurchase, performSell, performSearchDay, availabilityFor, buildCatalog, salePlan, abilityRanks } from "./engine/trade.mjs";
import { partyOf, partySize } from "./engine/parties.mjs";
import { openPurchaseDialog, PurchaseDialog } from "./apps/purchase-dialog.mjs";
import { openSellDialog, SellDialog } from "./apps/sell-dialog.mjs";
import {
  placeImportOrder,
  performImportOrder,
  placeCommission,
  performCommission,
  createItemSearch,
  performItemSearch,
  cancelItemSearch,
  performSearchCancel,
  processImports,
  processAllImports,
  registerImportWatcher,
} from "./engine/imports.mjs";
import { identifyAttempt, availableMethods, candidateIdentifiers, METHODS } from "./engine/identify.mjs";
import {
  postVentureAction,
  performVentureAction,
  cancelVentureAction,
  performVentureCancel,
  leaveVentureMarket,
  performVentureLeave,
  tradeMerchandise,
  performVentureTrade,
  ventureOf,
} from "./engine/ventures.mjs";
import { openVentureTradeDialog, VentureTradeDialog } from "./apps/venture-dialog.mjs";
import { PartyConfigApp } from "./apps/party-config.mjs";
import { openCommissionDialog, CommissionDialog } from "./apps/commission-dialog.mjs";
import * as arbitrageRules from "./rules/arbitrage.mjs";
import * as demandRules from "./rules/demand.mjs";
import { writeDemand, applyGenerated } from "./engine/demand.mjs";
import { openDemandGenerator, DemandGenerator } from "./apps/demand-generator.mjs";
import { buildMagicPanel } from "./apps/magic-panel.mjs";
// Registers the merchandise Item sub-type, its sheet and its setting at init.
import "./merchandise-module.mjs";
// Registers the market report Item sub-type, its sheet and the belief migration.
import "./report-module.mjs";
import { merchandiseCatalog, merchandiseFor, primeMerchandiseCatalog, buildMerchandiseFromTables } from "./engine/merchandise.mjs";
import * as tradeObjects from "./engine/trade-objects.mjs";
import * as reportRules from "./rules/reports.mjs";
import { isTrader } from "./apps/trader-tab.mjs";

Hooks.once("init", () => {
  registerSettings();

  // Uuids carry dots, which expandObject would split; the party-config
  // form encodes them as pipes and decodes on submit.
  try {
    Handlebars.registerHelper("acksExtrasDotsToPipes", (s) => String(s ?? "").replace(/\./g, "|"));
  } catch (err) {
    console.warn(`${MODULE_ID} | helper registration failed`, err);
  }

  game.settings.registerMenu(MODULE_ID, "marketPartiesMenu", {
    name: `${LANG}.parties.title`,
    label: `${LANG}.parties.open`,
    hint: `${LANG}.parties.hint`,
    icon: "fas fa-people-group",
    type: PartyConfigApp,
    restricted: true,
  });

  try {
    const T = `modules/${MODULE_ID}/templates/markets`;
    foundry.applications.handlebars.loadTemplates([
      `${T}/trade-tab.hbs`,
      `${T}/purchase-dialog.hbs`,
      `${T}/sell-dialog.hbs`,
      `${T}/commission-dialog.hbs`,
      `${T}/venture-dialog.hbs`,
      `${T}/party-config.hbs`,
      `${T}/demand-generator.hbs`,
      `${T}/trader-tab.hbs`,
    ]);
  } catch (err) {
    console.warn(`${MODULE_ID} | markets template preload skipped`, err);
  }
});

Hooks.once("setup", () => {
  // Tables arrive per world through the ruledata-import contract (see the
  // henchmen entry point for the layering); declaring them here lets the
  // materialize flow generate fillable placeholders for missing ones.
  try {
    acksExtras.lib?.tables?.expectTables?.("availability", ["equipmentAvailability", "marketRulesProse", "bargainingProse"]);
    acksExtras.lib?.tables?.expectTables?.("mercantile", [
      "merchandiseTypes",
      "marketCharacteristics",
      "impactProse",
      "assessmentProse",
      "priceShiftProse",
      "negotiationProse",
    ]);
    acksExtras.lib?.tables?.expectTables?.("magicItems", ["transactionsByMarketClass", "priceProse", "identifyProse"]);
    acksExtras.lib?.tables?.expectTables?.("construction", ["wageAndConstructionRates"]);
    acksExtras.lib?.tables?.expectTables?.("demand", ["landRevenueProse"]);
  } catch (err) {
    console.warn(`${MODULE_ID} | markets expectTables failed`, err);
  }

  const api = {
    HOOKS,
    config,
    getSetting,
    // engine (local-first; relays through the GM socket when the seat cannot write)
    purchase,
    sell,
    performPurchase,
    performSell,
    performSearchDay,
    availabilityFor,
    buildCatalog,
    salePlan,
    placeImportOrder,
    performImportOrder,
    placeCommission,
    performCommission,
    createItemSearch,
    performItemSearch,
    cancelItemSearch,
    performSearchCancel,
    processImports,
    processAllImports,
    abilityRanks,
    partyOf,
    partySize,
    // ventures
    postVentureAction,
    performVentureAction,
    cancelVentureAction,
    performVentureCancel,
    leaveVentureMarket,
    performVentureLeave,
    tradeMerchandise,
    performVentureTrade,
    ventureOf,
    // identification
    identifyAttempt,
    availableMethods,
    candidateIdentifiers,
    METHODS,
    // apps
    openPurchaseDialog,
    PurchaseDialog,
    openSellDialog,
    SellDialog,
    openCommissionDialog,
    CommissionDialog,
    openVentureTradeDialog,
    VentureTradeDialog,
    buildMagicPanel,
    // the merchandise catalogue
    merchandiseCatalog,
    merchandiseFor,
    primeMerchandiseCatalog,
    buildMerchandiseFromTables,
    // the trade house: reports and the objects a player owns or hands over
    tradeObjects,
    isTrader,
    // demand: the one writer and the demand generator
    writeDemand,
    applyGenerated,
    openDemandGenerator,
    DemandGenerator,
    // rules (pure)
    rules: { ...availabilityRules, ...pricingRules, imports: importRules, commissions: commissionRules, arbitrage: arbitrageRules, demand: demandRules, reports: reportRules },
  };
  acksExtras.markets = api;
});

Hooks.once("ready", () => {
  if (!assertAcksSystem("item markets expect the ACKS II system.")) return;

  // GM-side due-processing whenever world time moves: import arrivals and
  // losses reveal on their rolled dates (idempotent per order).
  registerImportWatcher();
  // The assessment day's roll, made on the influence page, becomes a queued day.
  registerAssessmentListener();

  // Book tables are imported per-world, not shipped. Name the missing
  // documents once to the GM — by the declared TABLES that are readable, never
  // by id, so a partly-arrived import is reported as partly arrived. The
  // shared `availability` doc is announced by henchmen; only this feature's
  // own docs are checked here.
  if (game.user.isGM) {
    const missing = missingTablesList(RULEDATA);
    if (missing.length) {
      ui.notifications.warn(game.i18n.format(`${LANG}.tablesMissing`, { list: missing.join(", ") }));
    }
  }
});
